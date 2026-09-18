import { INestApplication } from '@nestjs/common';
import { ConvertTimestampsToUtc1758153600000 } from 'src/database/migrations/1758153600000-ConvertTimestampsToUtc';
import { AddRestaurantPublicSlug1758326400000 } from 'src/database/migrations/1758326400000-AddRestaurantPublicSlug';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import {
  api,
  auth,
  createTestApp,
  isMysqlTestRun,
  registerOwner,
  type TestContext,
} from './test-app';

/**
 * Behaviour that depends on which database is underneath.
 *
 * Run twice to be meaningful:
 *   npm run test:e2e                      (SQLite - the default)
 *   TEST_DB_DRIVER=mysql npm run test:e2e (real MySQL 8)
 *
 * Rather than assert one answer and quietly pass on the wrong driver, each spec
 * asserts the answer that is correct for the driver actually in use, so the
 * divergence is documented and checked instead of assumed.
 */
describe(`Driver-specific behaviour (running on ${isMysqlTestRun ? 'MySQL' : 'SQLite'})`, () => {
  let ctx: TestContext;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('DECIMAL round-tripping', () => {
    it('returns money as an exact JS number, not a string', async () => {
      const owner = await registerOwner(app);
      const headers = auth(owner.accessToken);

      const created = await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name: 'Precise Dish', price: 1234.56 })
        .expect(201);

      const fetched = await api(app).get(`/dishes/${created.body.id}`).set(headers).expect(200);

      // mysql2 hands DECIMAL back as a string to avoid float precision loss;
      // NumericTransformer is what turns it back into a number. Under SQLite the
      // value is already numeric, so only the MySQL run really exercises that.
      expect(typeof fetched.body.price).toBe('number');
      expect(fetched.body.price).toBe(1234.56);
    });

    it('preserves the scale of nutrition values', async () => {
      const owner = await registerOwner(app);
      const headers = auth(owner.accessToken);

      const created = await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name: 'Macro Dish', price: 10, proteinGrams: 22.5, calories: 380.25 })
        .expect(201);

      const fetched = await api(app).get(`/dishes/${created.body.id}`).set(headers).expect(200);

      expect(fetched.body.proteinGrams).toBe(22.5);
      expect(fetched.body.calories).toBe(380.25);
    });

    it('stores prices at DECIMAL precision rather than float precision', async () => {
      const owner = await registerOwner(app);
      const headers = auth(owner.accessToken);

      // 0.1 + 0.2 style values are exactly where FLOAT columns would drift.
      const created = await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name: 'Float Trap', price: 0.3 })
        .expect(201);

      const row = await ctx.dataSource
        .getRepository(Dish)
        .findOneOrFail({ where: { id: created.body.id } });

      expect(row.price).toBe(0.3);
    });
  });

  describe('per-restaurant unique name indexes', () => {
    it('applies the collation rules of the underlying database to duplicate names', async () => {
      const owner = await registerOwner(app);
      const headers = auth(owner.accessToken);

      await api(app).post('/categories').set(headers).send({ name: 'Starters' }).expect(201);

      const differentCase = await api(app)
        .post('/categories')
        .set(headers)
        .send({ name: 'starters' });

      if (isMysqlTestRun) {
        // Production collation is utf8mb4_unicode_ci: case-insensitive, so
        // "starters" collides with "Starters" and the service returns 409.
        expect(differentCase.status).toBe(409);
      } else {
        // SQLite compares TEXT binary by default, so the two coexist. This is a
        // known test-environment divergence, not a difference in intent.
        expect(differentCase.status).toBe(201);
      }
    });

    it('always rejects an exactly duplicated name', async () => {
      const owner = await registerOwner(app);
      const headers = auth(owner.accessToken);

      await api(app).post('/ingredients').set(headers).send({ name: 'Paneer' }).expect(201);
      await api(app).post('/ingredients').set(headers).send({ name: 'Paneer' }).expect(409);
    });
  });

  describe('timestamps', () => {
    /** API timestamps must describe the real moment of the write, in UTC ISO form. */
    const expectRecent = (iso: string, before: number, after: number) => {
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      // `updated_at` is written by TypeORM as CURRENT_TIMESTAMP (whole seconds),
      // hence the one-second allowance before the request started.
      expect(new Date(iso).getTime()).toBeGreaterThanOrEqual(before - 1_000);
      expect(new Date(iso).getTime()).toBeLessThanOrEqual(after + 1_000);
    };

    it('reports createdAt and updatedAt at the real time of the write', async () => {
      const owner = await registerOwner(app);
      const headers = auth(owner.accessToken);

      const createStart = Date.now();
      const created = await api(app).post('/categories').set(headers).send({ name: 'Clock Check' }).expect(201);
      const createEnd = Date.now();

      const fetched = await api(app).get(`/categories/${created.body.id}`).set(headers).expect(200);
      expectRecent(fetched.body.createdAt, createStart, createEnd);
      expectRecent(fetched.body.updatedAt, createStart, createEnd);

      const updateStart = Date.now();
      await api(app).patch(`/categories/${created.body.id}`).set(headers).send({ sortOrder: 3 }).expect(200);
      const updateEnd = Date.now();

      const updated = await api(app).get(`/categories/${created.body.id}`).set(headers).expect(200);
      expect(updated.body.createdAt).toBe(fetched.body.createdAt);
      expectRecent(updated.body.updatedAt, updateStart, updateEnd);
    });

    (isMysqlTestRun ? it : it.skip)('pins every MySQL session to UTC', async () => {
      // Several concurrent queries force the pool to open more than one connection.
      const zones = await Promise.all(
        Array.from({ length: 4 }, () =>
          ctx.dataSource.query('SELECT @@session.time_zone AS zone, SLEEP(0.05) AS pause'),
        ),
      );

      for (const [row] of zones) {
        expect(row.zone).toBe('+00:00');
      }
    });

    (isMysqlTestRun ? it : it.skip)(
      'converts IST timestamps to UTC and back without touching other columns',
      async () => {
        const owner = await registerOwner(app);
        const headers = auth(owner.accessToken);
        const category = await api(app).post('/categories').set(headers).send({ name: 'Shifted' }).expect(201);
        await api(app).post('/dishes').set(headers).send({ categoryId: category.body.id, name: 'Shifted Dish', price: 99.5 }).expect(201);

        const snapshot = async () => ({
          categories: await ctx.dataSource.query(
            "SELECT id, restaurant_id, name, sort_order, is_active, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') AS created_at, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s.%f') AS updated_at FROM categories ORDER BY id",
          ),
          dishes: await ctx.dataSource.query(
            "SELECT id, restaurant_id, category_id, name, price, is_available, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') AS created_at, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s.%f') AS updated_at FROM dishes ORDER BY id",
          ),
        });
        const plusMinutes = (value: string, minutes: number) =>
          new Date(new Date(`${value.replace(' ', 'T').slice(0, 23)}Z`).getTime() + minutes * 60_000)
            .toISOString()
            .replace('T', ' ')
            .slice(0, 23) + value.slice(23);

        const migration = new ConvertTimestampsToUtc1758153600000();
        const queryRunner = ctx.dataSource.createQueryRunner();
        const original = await snapshot();

        try {
          // down(): back to the legacy IST values.
          await migration.down(queryRunner);
          const legacy = await snapshot();

          for (const table of ['categories', 'dishes'] as const) {
            legacy[table].forEach((row: Record<string, string>, index: number) => {
              const before = original[table][index];
              expect(row.created_at).toBe(plusMinutes(before.created_at, 330));
              expect(row.updated_at).toBe(plusMinutes(before.updated_at, 330));
              expect({ ...row, created_at: null, updated_at: null }).toEqual({ ...before, created_at: null, updated_at: null });
            });
          }

          const [{ offset }] = await ctx.dataSource.query(
            "SELECT TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', @@global.time_zone)) AS offset",
          );

          if (Number(offset) === 330) {
            // up(): exactly the original values again.
            await migration.up(queryRunner);
            expect(await snapshot()).toEqual(original);
          } else {
            // A server outside IST: existing rows cannot be IST, so up() must refuse.
            await expect(migration.up(queryRunner)).rejects.toThrow(/expected the MySQL server zone/);
            expect(await snapshot()).toEqual(legacy);
          }
        } finally {
          await queryRunner.release();
        }
      },
    );
  });

  (isMysqlTestRun ? describe : describe.skip)('restaurant public slug migration', () => {
    it('backfills public_slug from slug without changing updated_at or any other column', async () => {
      await registerOwner(app, { restaurantName: 'Backfill Alpha' });
      await registerOwner(app, { restaurantName: 'Backfill Beta' });

      const rows = () =>
        ctx.dataSource.query(
          "SELECT id, name, slug, description, address, phone, logo_url, status, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') AS created_at, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s.%f') AS updated_at FROM restaurants ORDER BY id",
        );
      const before = await rows();

      const migration = new AddRestaurantPublicSlug1758326400000();
      const queryRunner = ctx.dataSource.createQueryRunner();
      try {
        await migration.down(queryRunner);
        const [columnGone] = await ctx.dataSource.query(
          "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'restaurants' AND COLUMN_NAME = 'public_slug'",
        );
        expect(Number(columnGone.n)).toBe(0);
        expect(await rows()).toEqual(before);

        // Sleep past a second so an accidental ON UPDATE CURRENT_TIMESTAMP would show.
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await migration.up(queryRunner);
      } finally {
        await queryRunner.release();
      }

      expect(await rows()).toEqual(before);
      const slugs = await ctx.dataSource.query('SELECT slug, public_slug FROM restaurants');
      expect(slugs.every((row: { slug: string; public_slug: string }) => row.public_slug === row.slug)).toBe(true);

      const [column] = await ctx.dataSource.query(
        "SELECT IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'restaurants' AND COLUMN_NAME = 'public_slug'",
      );
      expect(column.nullable).toBe('NO');
      const [index] = await ctx.dataSource.query(
        "SELECT NON_UNIQUE AS nonUnique FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'restaurants' AND INDEX_NAME = 'UQ_restaurants_public_slug'",
      );
      expect(Number(index.nonUnique)).toBe(0);
    });
  });

  describe('referential actions', () => {
    it('detaches dishes when their category is deleted (ON DELETE SET NULL)', async () => {
      const owner = await registerOwner(app);
      const headers = auth(owner.accessToken);

      const category = await api(app)
        .post('/categories')
        .set(headers)
        .send({ name: 'Doomed Section' })
        .expect(201);

      const dish = await api(app)
        .post('/dishes')
        .set(headers)
        .send({ categoryId: category.body.id, name: 'Orphan Dish', price: 100 })
        .expect(201);

      await api(app).delete(`/categories/${category.body.id}`).set(headers).expect(204);

      const survivor = await api(app).get(`/dishes/${dish.body.id}`).set(headers).expect(200);
      expect(survivor.body.categoryId).toBeNull();
    });

    it('removes recipe lines when their ingredient is deleted (ON DELETE CASCADE)', async () => {
      const owner = await registerOwner(app);
      const headers = auth(owner.accessToken);

      const dish = await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name: 'Recipe Dish', price: 250 })
        .expect(201);

      const ingredient = await api(app)
        .post('/ingredients')
        .set(headers)
        .send({ name: 'Disappearing Spice' })
        .expect(201);

      await api(app)
        .post(`/dishes/${dish.body.id}/ingredients`)
        .set(headers)
        .send({ ingredients: [{ ingredientId: ingredient.body.id, quantity: 10, unit: 'g' }] })
        .expect(201);

      await api(app).delete(`/ingredients/${ingredient.body.id}`).set(headers).expect(204);

      const recipe = await api(app)
        .get(`/dishes/${dish.body.id}/ingredients`)
        .set(headers)
        .expect(200);
      expect(recipe.body).toEqual([]);
    });
  });
});
