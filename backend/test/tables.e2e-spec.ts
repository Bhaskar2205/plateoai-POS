import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RestaurantStatus, UserRole } from 'src/common/enums';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantUser } from 'src/modules/restaurants/entities/restaurant-user.entity';
import { RestaurantTable } from 'src/modules/tables/entities/restaurant-table.entity';
import { User } from 'src/modules/users/entities/user.entity';
import {
  api,
  auth,
  createTestApp,
  isMysqlTestRun,
  registerOwner,
  testConfig,
  type RegisteredOwner,
  type TestContext,
} from './test-app';

const TABLE_KEYS = ['createdAt', 'id', 'isActive', 'menuPath', 'menuUrl', 'name', 'updatedAt'];

/** The `?table=` value inside a table's menu path. */
const tokenOf = (table: { menuPath: string }) =>
  new URL(table.menuPath, 'http://placeholder').searchParams.get('table')!;

describe('Restaurant tables and QR codes (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  let owner: RegisteredOwner;
  let rival: RegisteredOwner;
  let headers: Record<string, string>;
  let rivalHeaders: Record<string, string>;
  let slug: string;
  let rivalSlug: string;

  const tables = '/restaurants/me/tables';
  const publicMenu = (restaurantSlug: string, query = '') =>
    `/public/restaurants/${restaurantSlug}/menu${query}`;
  const createTable = async (h: Record<string, string>, name: string, extra: object = {}) =>
    (await api(app).post(tables).set(h).send({ name, ...extra }).expect(201)).body;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;

    owner = await registerOwner(app, { restaurantName: 'Town Tables Cafe' });
    rival = await registerOwner(app, { restaurantName: 'Rival Tables Bistro' });
    headers = auth(owner.accessToken);
    rivalHeaders = auth(rival.accessToken);
    slug = (await api(app).get('/restaurants/me').set(headers).expect(200)).body.slug;
    rivalSlug = (await api(app).get('/restaurants/me').set(rivalHeaders).expect(200)).body.slug;

    const category = (await api(app).post('/categories').set(headers).send({ name: 'Coffee' }).expect(201)).body;
    await api(app).post('/dishes').set(headers).send({ name: 'Filter Coffee', price: 90, categoryId: category.id }).expect(201);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('owner management', () => {
    it('creates a table with a safe response shape and a random QR token', async () => {
      const table = await createTable(headers, '  Table   01 ');

      expect(Object.keys(table).sort()).toEqual(TABLE_KEYS);
      expect(table.name).toBe('Table 01');
      expect(table.isActive).toBe(true);
      expect(JSON.stringify(table)).not.toMatch(/qrToken|qr_token|restaurantId/);

      const token = tokenOf(table);
      expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(table.menuPath).toBe(`/menu/${slug}?table=${token}`);
      expect(table.menuUrl).toBe(`${testConfig().publicWebUrl}${table.menuPath}`);
    });

    it('gives every table a different QR token', async () => {
      const a = await createTable(headers, 'Token A');
      const b = await createTable(headers, 'Token B');

      expect(tokenOf(a)).not.toBe(tokenOf(b));
    });

    it('lists tables in natural order', async () => {
      await createTable(headers, 'Table 10');
      await createTable(headers, 'Table 2');

      const names = (await api(app).get(tables).set(headers).expect(200)).body.map((t: { name: string }) => t.name);
      expect(names.indexOf('Table 2')).toBeLessThan(names.indexOf('Table 10'));
      expect(names.indexOf('Table 01')).toBeLessThan(names.indexOf('Table 2'));
    });

    it('gets, renames and deactivates a table without changing its QR URL', async () => {
      const table = await createTable(headers, 'Patio 1');

      const fetched = await api(app).get(`${tables}/${table.id}`).set(headers).expect(200);
      expect(fetched.body.menuUrl).toBe(table.menuUrl);

      const renamed = await api(app).patch(`${tables}/${table.id}`).set(headers).send({ name: 'Patio One' }).expect(200);
      expect(renamed.body.name).toBe('Patio One');
      expect(renamed.body.menuUrl).toBe(table.menuUrl);

      const inactive = await api(app).patch(`${tables}/${table.id}`).set(headers).send({ isActive: false }).expect(200);
      expect(inactive.body.isActive).toBe(false);
      expect(inactive.body.menuUrl).toBe(table.menuUrl);
    });

    it('rejects duplicate names within a restaurant, on create and rename', async () => {
      await createTable(headers, 'Window Seat');
      const other = await createTable(headers, 'Corner Seat');

      const dup = await api(app).post(tables).set(headers).send({ name: 'Window Seat' }).expect(409);
      expect(dup.body.message).toBe('A table named "Window Seat" already exists.');
      await api(app).patch(`${tables}/${other.id}`).set(headers).send({ name: 'Window Seat' }).expect(409);
    });

    it('allows the same table name in a different restaurant', async () => {
      await createTable(headers, 'Shared Name');
      await createTable(rivalHeaders, 'Shared Name');
    });

    it.each([
      [{ name: '' }],
      [{ name: '   ' }],
      [{ name: 'x'.repeat(61) }],
      [{ name: 'Bad\u0000Name' }],
      [{ name: 'Table 99', isActive: 'yes' }],
      [{ name: 'Table 99', restaurantId: 1 }],
      [{ name: 'Table 99', qrToken: 'A'.repeat(32) }],
    ])('rejects an invalid body %j with 400', async (body) => {
      const response = await api(app).post(tables).set(headers).send(body).expect(400);
      expect(response.body.message).toBe('Validation failed');
    });

    it('returns 404 for an unknown table id', async () => {
      await api(app).get(`${tables}/999999`).set(headers).expect(404);
      await api(app).post(`${tables}/999999/regenerate-qr`).set(headers).expect(404);
    });

    it('never writes the token anywhere but the URL, even in the entity row', async () => {
      const table = await createTable(headers, 'Stored Token');
      const row = await dataSource.getRepository(RestaurantTable).findOneByOrFail({ id: table.id });

      expect(row.qrToken).toBe(tokenOf(table));
      expect(row.restaurantId).toBe(owner.restaurantId);
    });
  });

  describe('public table menu', () => {
    it('serves the menu with the table name and no internal fields', async () => {
      const table = await createTable(headers, 'Table 05');
      const token = tokenOf(table);

      const response = await api(app).get(publicMenu(slug, `?table=${token}`)).expect(200);

      expect(response.body.table).toEqual({ name: 'Table 05' });
      expect(response.body.restaurant.name).toBe('Town Tables Cafe');
      expect(response.body.categories[0].dishes[0].name).toBe('Filter Coffee');
      expect(response.headers['cache-control']).toBe('no-store');

      const raw = JSON.stringify(response.body);
      expect(raw).not.toContain(token);
      expect(raw).not.toMatch(/qrToken|restaurantId|isActive|passwordHash|email/);
    });

    it('keeps the plain restaurant menu working, with table null', async () => {
      const response = await api(app).get(publicMenu(slug)).expect(200);
      expect(response.body.table).toBeNull();
    });

    it('ignores unrelated query parameters such as tracking tags', async () => {
      const table = await createTable(headers, 'Table 06');
      await api(app).get(publicMenu(slug, `?utm_source=qr&table=${tokenOf(table)}&fbclid=abc`)).expect(200);
    });

    it('refuses an inactive table, and serves it again once reactivated', async () => {
      const table = await createTable(headers, 'Table 07');
      const url = publicMenu(slug, `?table=${tokenOf(table)}`);

      await api(app).patch(`${tables}/${table.id}`).set(headers).send({ isActive: false }).expect(200);
      const refused = await api(app).get(url).expect(404);
      expect(refused.body.message).toBe('This table is not available.');

      await api(app).patch(`${tables}/${table.id}`).set(headers).send({ isActive: true }).expect(200);
      await api(app).get(url).expect(200);
    });

    it('can create a table inactive from the start', async () => {
      const table = await createTable(headers, 'Table 08', { isActive: false });
      expect(table.isActive).toBe(false);
      await api(app).get(publicMenu(slug, `?table=${tokenOf(table)}`)).expect(404);
    });

    it('retires the old QR URL when the QR code is regenerated', async () => {
      const table = await createTable(headers, 'Table 09');
      const oldToken = tokenOf(table);

      const regenerated = await api(app).post(`${tables}/${table.id}/regenerate-qr`).set(headers).expect(200);
      const newToken = tokenOf(regenerated.body);

      expect(newToken).not.toBe(oldToken);
      expect(regenerated.body.name).toBe('Table 09');
      await api(app).get(publicMenu(slug, `?table=${oldToken}`)).expect(404);
      await api(app).get(publicMenu(slug, `?table=${newToken}`)).expect(200);

      const listed = (await api(app).get(tables).set(headers).expect(200)).body.find((t: { id: number }) => t.id === table.id);
      expect(listed.menuUrl).toBe(regenerated.body.menuUrl);
    });

    it('stops serving a deleted table', async () => {
      const table = await createTable(headers, 'Table 11');

      await api(app).delete(`${tables}/${table.id}`).set(headers).expect(204);
      await api(app).get(`${tables}/${table.id}`).set(headers).expect(404);
      await api(app).get(publicMenu(slug, `?table=${tokenOf(table)}`)).expect(404);
    });

    it.each([
      ['empty', '?table='],
      ['malformed', '?table=table-01'],
      ['too long', `?table=${'A'.repeat(64)}`],
      ['well-formed but unknown', `?table=${'A'.repeat(32)}`],
      ['repeated', `?table=${'A'.repeat(32)}&table=${'B'.repeat(32)}`],
    ])('returns 404 for a %s table identifier', async (_label, query) => {
      const response = await api(app).get(publicMenu(slug, query)).expect(404);
      expect(response.body.message).toBe('This table is not available.');
    });

    it('treats the token as case-sensitive', async () => {
      const table = await createTable(headers, 'Table 12');
      const token = tokenOf(table);
      const flipped = token.replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));

      // A token with no letters cannot be flipped; 32 random base64url chars always have some.
      expect(flipped).not.toBe(token);
      await api(app).get(publicMenu(slug, `?table=${flipped}`)).expect(404);
    });

    it('still returns the restaurant 404 for an unknown or suspended restaurant, even with a valid table', async () => {
      const table = await createTable(rivalHeaders, 'Suspended Table');
      const query = `?table=${tokenOf(table)}`;

      const unknown = await api(app).get(publicMenu('no-such-restaurant', query)).expect(404);
      expect(unknown.body.message).toBe('This menu is not available.');

      await dataSource.getRepository(Restaurant).update({ id: rival.restaurantId }, { status: RestaurantStatus.INACTIVE });
      try {
        const suspended = await api(app).get(publicMenu(rivalSlug, query)).expect(404);
        expect(suspended.body.message).toBe('This menu is not available.');
      } finally {
        await dataSource.getRepository(Restaurant).update({ id: rival.restaurantId }, { status: RestaurantStatus.ACTIVE });
      }
    });
  });

  describe('QR links survive a restaurant rename', () => {
    const rename = async (h: Record<string, string>, name: string) =>
      (await api(app).patch('/restaurants/me').set(h).send({ name }).expect(200)).body;
    const pathToApi = (menuPath: string) => {
      const url = new URL(menuPath, 'http://placeholder');
      return publicMenu(url.pathname.replace('/menu/', ''), url.search);
    };

    let cafe: Record<string, string>;
    let qr: { id: number; menuPath: string; menuUrl: string };

    beforeAll(async () => {
      cafe = auth((await registerOwner(app, { restaurantName: 'Old Name Coffee' })).accessToken);
      const category = (await api(app).post('/categories').set(cafe).send({ name: 'Brews' }).expect(201)).body;
      await api(app).post('/dishes').set(cafe).send({ name: 'Cold Brew', price: 180, categoryId: category.id }).expect(201);
      qr = await createTable(cafe, 'Table 01');
    });

    it('builds table URLs from the permanent public slug', async () => {
      const restaurant = (await api(app).get('/restaurants/me').set(cafe).expect(200)).body;
      expect(restaurant.publicSlug).toBe('old-name-coffee');
      expect(qr.menuPath).toBe(`/menu/old-name-coffee?table=${tokenOf(qr)}`);
    });

    it('keeps the printed URL unchanged and working after renames, showing the new name', async () => {
      const renamed = await rename(cafe, 'New Name Roasters');
      expect(renamed).toMatchObject({ slug: 'new-name-roasters', publicSlug: 'old-name-coffee' });

      const listed = (await api(app).get(tables).set(cafe).expect(200)).body.find((t: { id: number }) => t.id === qr.id);
      expect(listed.menuUrl).toBe(qr.menuUrl);

      const viaOldQr = await api(app).get(pathToApi(qr.menuPath)).expect(200);
      expect(viaOldQr.body.table).toEqual({ name: 'Table 01' });
      expect(viaOldQr.body.restaurant).toMatchObject({ name: 'New Name Roasters', slug: 'new-name-roasters' });
      expect(viaOldQr.body.categories[0].dishes[0].name).toBe('Cold Brew');

      await rename(cafe, 'Third Name Espresso Bar');
      const afterSecondRename = await api(app).get(pathToApi(qr.menuPath)).expect(200);
      expect(afterSecondRename.body.restaurant).toMatchObject({ name: 'Third Name Espresso Bar', slug: 'third-name-espresso-bar' });
      expect(afterSecondRename.body.table).toEqual({ name: 'Table 01' });
    });

    it('also serves the table under the current slug', async () => {
      const current = (await api(app).get('/restaurants/me').set(cafe).expect(200)).body.slug;
      const response = await api(app).get(publicMenu(current, `?table=${tokenOf(qr)}`)).expect(200);
      expect(response.body.table).toEqual({ name: 'Table 01' });
    });

    it('does not let another restaurant take over the old URL or use the table', async () => {
      const intruder = auth((await registerOwner(app, { restaurantName: 'Intruder Kitchen' })).accessToken);

      // Renaming onto the freed display name gets a suffix: the permanent slug is reserved.
      const intruderRestaurant = await rename(intruder, 'Old Name Coffee');
      expect(intruderRestaurant.slug).toBe('old-name-coffee-2');

      const viaOldQr = await api(app).get(pathToApi(qr.menuPath)).expect(200);
      expect(viaOldQr.body.restaurant.name).toBe('Third Name Espresso Bar');

      // The intruder cannot read, change or use the table.
      await api(app).get(`${tables}/${qr.id}`).set(intruder).expect(404);
      await api(app).post(`${tables}/${qr.id}/regenerate-qr`).set(intruder).expect(404);
      await api(app).get(publicMenu(intruderRestaurant.slug, `?table=${tokenOf(qr)}`)).expect(404);
      await api(app).get(publicMenu(intruderRestaurant.publicSlug, `?table=${tokenOf(qr)}`)).expect(404);
    });
  });

  describe('tenant isolation', () => {
    let rivalTable: { id: number; menuPath: string; menuUrl: string; name: string };

    beforeAll(async () => {
      rivalTable = await createTable(rivalHeaders, 'Rival Private Table');
    });

    it('does not list another restaurant table', async () => {
      const mine = (await api(app).get(tables).set(headers).expect(200)).body;
      expect(mine.map((t: { id: number }) => t.id)).not.toContain(rivalTable.id);
    });

    it.each([
      ['GET', ''],
      ['PATCH', ''],
      ['DELETE', ''],
      ['POST', '/regenerate-qr'],
    ])('answers %s on another restaurant table with 404', async (method, suffix) => {
      const path = `${tables}/${rivalTable.id}${suffix}`;
      const agent = api(app);
      const request =
        method === 'GET' ? agent.get(path) : method === 'PATCH' ? agent.patch(path).send({ name: 'Hijacked', isActive: false }) : method === 'DELETE' ? agent.delete(path) : agent.post(path);

      await request.set(headers).expect(404);
    });

    it('leaves the other restaurant table untouched after those attempts', async () => {
      const still = await api(app).get(`${tables}/${rivalTable.id}`).set(rivalHeaders).expect(200);
      expect(still.body).toMatchObject({ name: 'Rival Private Table', isActive: true, menuUrl: rivalTable.menuUrl });
    });

    it("refuses another restaurant's table token on this restaurant's menu", async () => {
      await api(app).get(publicMenu(slug, `?table=${tokenOf(rivalTable)}`)).expect(404);
      await api(app).get(publicMenu(rivalSlug, `?table=${tokenOf(rivalTable)}`)).expect(200);
    });
  });

  describe('authorisation', () => {
    async function memberWithRole(restaurantId: number, role: UserRole): Promise<Record<string, string>> {
      const member = await registerOwner(app);
      await dataSource.getRepository(User).update({ id: member.userId }, { role });
      await dataSource.getRepository(RestaurantUser).save({ userId: member.userId, restaurantId });
      const login = await api(app)
        .post('/auth/login')
        .send({ email: member.email, password: member.password, restaurantId })
        .expect(200);
      return auth(login.body.accessToken);
    }

    it('requires authentication for every owner endpoint', async () => {
      await api(app).get(tables).expect(401);
      await api(app).post(tables).send({ name: 'Anon' }).expect(401);
      await api(app).get(`${tables}/1`).expect(401);
      await api(app).patch(`${tables}/1`).send({ name: 'Anon' }).expect(401);
      await api(app).delete(`${tables}/1`).expect(401);
      await api(app).post(`${tables}/1/regenerate-qr`).expect(401);
    });

    it.each([UserRole.RESTAURANT_MANAGER, UserRole.KITCHEN_STAFF])('forbids %s from reading or managing tables', async (role) => {
      const memberHeaders = await memberWithRole(owner.restaurantId, role);

      await api(app).get(tables).set(memberHeaders).expect(403);
      await api(app).post(tables).set(memberHeaders).send({ name: `By ${role}` }).expect(403);
    });
  });

  (isMysqlTestRun ? describe : describe.skip)('MySQL specifics', () => {
    it('treats table names case-insensitively for uniqueness, like other menu names', async () => {
      await createTable(headers, 'Terrace');
      await api(app).post(tables).set(headers).send({ name: 'terrace' }).expect(409);
    });

    it('stores qr_token with a binary collation', async () => {
      const [column] = await dataSource.query(
        "SELECT COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'restaurant_tables' AND COLUMN_NAME = 'qr_token'",
      );
      expect(column.collation).toBe('ascii_bin');
    });
  });
});
