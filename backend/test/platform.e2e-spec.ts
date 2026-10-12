import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RestaurantStatus, UserRole } from 'src/common/enums';
import { hashPassword } from 'src/common/security/password';
import { User } from 'src/modules/users/entities/user.entity';
import {
  api,
  auth,
  createTestApp,
  platformAdminToken,
  registerOwner,
  type TestContext,
} from './test-app';

/**
 * Running Plateo.
 *
 * The thing worth testing hardest is not that the panel works - it is that a
 * platform token, which belongs to no restaurant, cannot be pointed at one. Every
 * tenant-scoped route in Plateo reads its scope through `ActiveRestaurantId`, and
 * the safety of this whole design rests on that refusing a token with no tenant
 * rather than defaulting to something.
 */
describe('Platform admin (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  let platform: Record<string, string>;

  const account = (over: Record<string, unknown> = {}) => ({
    restaurantName: `Opened ${Math.random().toString(36).slice(2, 7)}`,
    ownerName: 'New Owner',
    ownerEmail: `new-${Math.random().toString(36).slice(2, 8)}@example.com`,
    ownerPassword: 'StrongPassword123!',
    ...over,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
    platform = auth(await platformAdminToken(app));
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('the platform token', () => {
    it('cannot be pointed at a restaurant', async () => {
      // It carries no tenant, so every tenant-scoped route must refuse it rather
      // than fall back to one. This is the single property the design rests on.
      for (const path of [
        '/restaurants/me',
        '/dishes',
        '/restaurants/me/orders',
        '/restaurants/me/reports/sales?from=2026-01-01&to=2026-01-01',
        '/restaurants/me/inventory/stock',
      ]) {
        const response = await api(app).get(path).set(platform);

        expect(response.status).not.toBe(200);
      }
    });

    it('is refused for a restaurant owner', async () => {
      const owner = await registerOwner(app);

      await api(app).get('/platform/restaurants').set(auth(owner.accessToken)).expect(403);
      await api(app).get('/platform/stats').set(auth(owner.accessToken)).expect(403);
    });

    it('is not issued to a non-administrator, whatever the password', async () => {
      const owner = await registerOwner(app);

      const response = await api(app)
        .post('/auth/platform/login')
        .send({ email: owner.email, password: owner.password });

      expect(response.status).toBe(401);
      // The same message as a wrong password: knowing which is which tells
      // somebody probing when they have found a real address.
      expect(response.body.message).toBe('Invalid email or password.');
    });

    it('stops working the moment the account stops being an administrator', async () => {
      const email = `demoted-${Date.now()}@plateo.test`;
      const users = dataSource.getRepository(User);

      const password = 'TemporaryAdmin123!';

      // Hashed here rather than copied off whichever administrator happens to be
      // first in the table. A developer with PLATFORM_ADMIN_* set in their .env
      // has a second one, seeded at boot, and borrowing its hash made this test
      // fail on their machine and nowhere else.
      const admin = await users.save(
        users.create({
          name: 'Temporary admin',
          email,
          passwordHash: await hashPassword(password),
          role: UserRole.SUPER_ADMIN,
        }),
      );

      const login = await api(app)
        .post('/auth/platform/login')
        .send({ email, password })
        .expect(200);

      const token = auth(login.body.accessToken);
      await api(app).get('/platform/stats').set(token).expect(200);

      await users.update({ id: admin.id }, { role: UserRole.RESTAURANT_OWNER });

      // The role is re-read on every request, so demotion bites at once rather
      // than when the token expires.
      await api(app).get('/platform/stats').set(token).expect(403);
    });
  });

  describe('opening and running accounts', () => {
    it('lists every restaurant with its people', async () => {
      const owner = await registerOwner(app, { restaurantName: 'Listed Kitchen' });

      const { body } = await api(app).get('/platform/restaurants').set(platform).expect(200);

      const found = body.find((row: { id: number }) => row.id === owner.restaurantId);
      expect(found).toMatchObject({ name: 'Listed Kitchen', status: 'ACTIVE' });
      expect(found.owners.map((o: { email: string }) => o.email)).toContain(owner.email);
    });

    it('never leaks a password hash into the list', async () => {
      await registerOwner(app);

      const { text } = await api(app).get('/platform/restaurants').set(platform).expect(200);

      expect(text).not.toMatch(/passwordHash|\$argon2/i);
    });

    it('suspends a restaurant, and its staff are out on the next request', async () => {
      const owner = await registerOwner(app);
      const headers = auth(owner.accessToken);

      await api(app).get('/restaurants/me').set(headers).expect(200);

      await api(app)
        .patch(`/platform/restaurants/${owner.restaurantId}/status`)
        .set(platform)
        .send({ status: RestaurantStatus.INACTIVE })
        .expect(200);

      // Not when the token expires - now.
      await api(app).get('/restaurants/me').set(headers).expect(403);

      await api(app)
        .patch(`/platform/restaurants/${owner.restaurantId}/status`)
        .set(platform)
        .send({ status: RestaurantStatus.ACTIVE })
        .expect(200);

      await api(app).get('/restaurants/me').set(headers).expect(200);
    });

    it('refuses to set a status the restaurant already has', async () => {
      const owner = await registerOwner(app);

      await api(app)
        .patch(`/platform/restaurants/${owner.restaurantId}/status`)
        .set(platform)
        .send({ status: RestaurantStatus.ACTIVE })
        .expect(409);
    });

    it('resets a password, and the owner signs in with the new one', async () => {
      const owner = await registerOwner(app);

      await api(app)
        .post(`/platform/restaurants/${owner.restaurantId}/reset-password`)
        .set(platform)
        .send({ email: owner.email, newPassword: 'BrandNewPassword1!' })
        .expect(201);

      await api(app)
        .post('/auth/login')
        .send({ email: owner.email, password: owner.password, restaurantId: owner.restaurantId })
        .expect(401);

      await api(app)
        .post('/auth/login')
        .send({
          email: owner.email,
          password: 'BrandNewPassword1!',
          restaurantId: owner.restaurantId,
        })
        .expect(200);
    });

    it('will not reset somebody who belongs to a different restaurant', async () => {
      const mine = await registerOwner(app);
      const theirs = await registerOwner(app);

      // A mistyped restaurant id must not reach across to another tenant's owner.
      await api(app)
        .post(`/platform/restaurants/${mine.restaurantId}/reset-password`)
        .set(platform)
        .send({ email: theirs.email, newPassword: 'BrandNewPassword1!' })
        .expect(404);

      // ...and the password it refused to change still works.
      await api(app)
        .post('/auth/login')
        .send({
          email: theirs.email,
          password: theirs.password,
          restaurantId: theirs.restaurantId,
        })
        .expect(200);
    });

    it('refuses a weak password on a reset, as it does on creation', async () => {
      const owner = await registerOwner(app);

      await api(app)
        .post(`/platform/restaurants/${owner.restaurantId}/reset-password`)
        .set(platform)
        .send({ email: owner.email, newPassword: 'weak' })
        .expect(400);
    });

    it('counts what the platform has', async () => {
      const { body } = await api(app).get('/platform/stats').set(platform).expect(200);

      expect(body.restaurants).toBeGreaterThan(0);
      expect(body.restaurants).toBe(body.active + body.suspended);
    });
  });
});
