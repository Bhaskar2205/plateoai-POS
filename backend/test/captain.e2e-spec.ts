import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from 'src/common/enums';
import { Order } from 'src/modules/orders/entities/order.entity';
import {
  api,
  auth,
  createTestApp,
  registerOwner,
  type RegisteredOwner,
  type TestContext,
} from './test-app';

/**
 * The captain app: a waiter taking orders from their own phone.
 *
 * Two properties carry the weight here. A captain signs in with a short code
 * rather than an address, and that code is unique across all of Plateo - every
 * restaurant's floor shares one sign-in page, so a code that only identified
 * somebody within their own restaurant would not identify them at all.
 *
 * And a captain is still a waiter. The whole point of giving them their own
 * account is that orders are attributable, which is worth nothing if the account
 * can also discount and settle - so the existing floor limits are asserted here
 * rather than assumed.
 */
describe('Captain app (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  let owner: RegisteredOwner;
  let headers: Record<string, string>;

  const staff = '/restaurants/me/staff';
  const orders = '/restaurants/me/orders';

  const unique = () => Math.random().toString(36).slice(2, 8);

  const captainPayload = (over: Record<string, unknown> = {}) => ({
    name: 'Ramesh Kumar',
    code: `ramesh-${unique()}`,
    password: 'Shift2026!',
    role: UserRole.WAITER,
    ...over,
  });

  /** Creates a captain and signs them in, returning their token. */
  async function captain(over: Record<string, unknown> = {}) {
    const payload = captainPayload(over);
    const created = (await api(app).post(staff).set(headers).send(payload).expect(201)).body;

    const login = await api(app)
      .post('/auth/staff/login')
      .send({ code: payload.code, password: payload.password })
      .expect(200);

    return { ...payload, id: created.id, token: login.body.accessToken as string };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;

    owner = await registerOwner(app, { restaurantName: 'Captain House' });
    headers = auth(owner.accessToken);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('putting somebody on the floor', () => {
    it('creates an account that signs in with a code and no email', async () => {
      const payload = captainPayload();

      const created = (await api(app).post(staff).set(headers).send(payload).expect(201)).body;

      expect(created).toMatchObject({
        name: 'Ramesh Kumar',
        code: payload.code,
        role: UserRole.WAITER,
        isActive: true,
      });
      // Whatever address the account carries internally is not the restaurant's
      // business and is never sent back.
      expect(created).not.toHaveProperty('email');
      expect(created).not.toHaveProperty('passwordHash');
    });

    it('refuses a code that another restaurant is already using', async () => {
      // Codes are global because every restaurant shares one sign-in page.
      const payload = captainPayload();
      await api(app).post(staff).set(headers).send(payload).expect(201);

      const rival = await registerOwner(app, { restaurantName: 'Rival Floor' });

      await api(app)
        .post(staff)
        .set(auth(rival.accessToken))
        .send(captainPayload({ code: payload.code }))
        .expect(409);
    });

    it('folds case, so RAMESH and ramesh are the same code', async () => {
      const code = `case-${unique()}`;
      await api(app).post(staff).set(headers).send(captainPayload({ code })).expect(201);

      await api(app)
        .post(staff)
        .set(headers)
        .send(captainPayload({ code: code.toUpperCase() }))
        .expect(409);
    });

    it('refuses a code with a space in it', async () => {
      await api(app)
        .post(staff)
        .set(headers)
        .send(captainPayload({ code: 'ram esh' }))
        .expect(400);
    });

    it('refuses a weak password', async () => {
      await api(app)
        .post(staff)
        .set(headers)
        .send(captainPayload({ password: 'short' }))
        .expect(400);
    });

    it('will not let a restaurant mint an owner', async () => {
      await api(app)
        .post(staff)
        .set(headers)
        .send(captainPayload({ role: UserRole.RESTAURANT_OWNER }))
        .expect(400);
    });

    it('lists the floor without ever returning a hash', async () => {
      await api(app).post(staff).set(headers).send(captainPayload()).expect(201);

      const { text, body } = await api(app).get(staff).set(headers).expect(200);

      expect(body.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/passwordHash|\$argon2/i);
    });

    it('is refused to a waiter: who may punch is an owner decision', async () => {
      const ramesh = await captain();

      await api(app).get(staff).set(auth(ramesh.token)).expect(403);
      await api(app).post(staff).set(auth(ramesh.token)).send(captainPayload()).expect(403);
    });
  });

  describe('signing in', () => {
    it('gives one message for a wrong code and a wrong password alike', async () => {
      const ramesh = await captain();

      const unknown = await api(app)
        .post('/auth/staff/login')
        .send({ code: `nobody-${unique()}`, password: 'Shift2026!' })
        .expect(401);

      const wrong = await api(app)
        .post('/auth/staff/login')
        .send({ code: ramesh.code, password: 'WrongPassword1!' })
        .expect(401);

      // Telling them apart tells somebody probing when they have found a real
      // code, and codes are short enough to guess at.
      expect(unknown.body.message).toBe(wrong.body.message);
    });

    it('lands the captain in their own restaurant', async () => {
      const ramesh = await captain();

      const me = (await api(app).get('/auth/me').set(auth(ramesh.token)).expect(200)).body;

      expect(me.user).toMatchObject({ name: 'Ramesh Kumar', role: UserRole.WAITER });
      expect(me.restaurant.id).toBe(owner.restaurantId);
    });

    it('stops working the moment the captain is switched off', async () => {
      const ramesh = await captain();
      const token = auth(ramesh.token);

      await api(app).get('/restaurants/me/floor').set(token).expect(200);

      await api(app).patch(`${staff}/${ramesh.id}`).set(headers).send({ isActive: false }).expect(200);

      // Not when the token expires - on the next request.
      await api(app).get('/restaurants/me/floor').set(token).expect(401);

      await api(app)
        .post('/auth/staff/login')
        .send({ code: ramesh.code, password: ramesh.password })
        .expect(401);
    });

    it('works again with a new password after a reset', async () => {
      const ramesh = await captain();

      await api(app)
        .post(`${staff}/${ramesh.id}/password`)
        .set(headers)
        .send({ password: 'BrandNewShift1!' })
        .expect(204);

      await api(app)
        .post('/auth/staff/login')
        .send({ code: ramesh.code, password: ramesh.password })
        .expect(401);

      await api(app)
        .post('/auth/staff/login')
        .send({ code: ramesh.code, password: 'BrandNewShift1!' })
        .expect(200);
    });
  });

  describe('punching an order', () => {
    it('opens a bill at a table and records who took it', async () => {
      const ramesh = await captain();
      const token = auth(ramesh.token);

      const table = (
        await api(app).post('/restaurants/me/tables').set(headers).send({ name: `C${unique()}` }).expect(201)
      ).body;
      const dish = (
        await api(app).post('/dishes').set(headers).send({ name: `Dish ${unique()}`, price: 250 }).expect(201)
      ).body;

      const order = (
        await api(app)
          .post(orders)
          .set(token)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 2 }] })
          .expect(201)
      ).body;

      expect(order.amountPayable).toBeGreaterThan(0);

      // The whole reason a captain has their own account. Read from the row
      // rather than the response: attribution is a fact about the bill, and the
      // API has no reason to tell a diner-facing payload who served them.
      const row = await dataSource
        .getRepository(Order)
        .findOne({ where: { id: order.id }, select: { id: true, openedByUserId: true } });
      expect(row?.openedByUserId).toBe(ramesh.id);

      await api(app).post(`${orders}/${order.id}/kot`).set(token).send({}).expect(201);
    });

    it('can take a line off before the kitchen has it', async () => {
      const ramesh = await captain();
      const token = auth(ramesh.token);

      const table = (
        await api(app).post('/restaurants/me/tables').set(headers).send({ name: `C${unique()}` }).expect(201)
      ).body;
      const dish = (
        await api(app).post('/dishes').set(headers).send({ name: `Dish ${unique()}`, price: 100 }).expect(201)
      ).body;

      const order = (
        await api(app)
          .post(orders)
          .set(token)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      await api(app)
        .post(`${orders}/${order.id}/items/${order.items[0].id}/cancel`)
        .set(token)
        .send({ reason: 'Guest changed their mind' })
        .expect(200);
    });

    it('still cannot discount, settle or comp - a captain is a waiter', async () => {
      const ramesh = await captain();
      const token = auth(ramesh.token);

      const table = (
        await api(app).post('/restaurants/me/tables').set(headers).send({ name: `C${unique()}` }).expect(201)
      ).body;
      const dish = (
        await api(app).post('/dishes').set(headers).send({ name: `Dish ${unique()}`, price: 400 }).expect(201)
      ).body;

      const order = (
        await api(app)
          .post(orders)
          .set(token)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      await api(app)
        .post(`${orders}/${order.id}/discount`)
        .set(token)
        .send({ type: 'PERCENT', value: 10, reason: 'Trying it on' })
        .expect(403);

      await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(token)
        .send({ paymentMethod: 'CASH' })
        .expect(403);

      await api(app)
        .post(`${orders}/${order.id}/nc`)
        .set(token)
        .send({ forWhom: 'A friend', reason: 'Trying it on' })
        .expect(403);
    });

    it('cannot reach another restaurant floor', async () => {
      const ramesh = await captain();
      const rival = await registerOwner(app, { restaurantName: 'Other Floor' });

      const rivalTable = (
        await api(app)
          .post('/restaurants/me/tables')
          .set(auth(rival.accessToken))
          .send({ name: 'Theirs 1' })
          .expect(201)
      ).body;

      const ourDish = (
        await api(app)
          .post('/dishes')
          .set(headers)
          .send({ name: `Ours ${unique()}`, price: 120 })
          .expect(201)
      ).body;

      // Their own floor is fine; the other restaurant's table is not theirs to
      // open a bill on. A real line, so the tenant check is what refuses it
      // rather than validation stopping first.
      await api(app).get('/restaurants/me/floor').set(auth(ramesh.token)).expect(200);
      await api(app)
        .post(orders)
        .set(auth(ramesh.token))
        .send({ tableId: rivalTable.id, items: [{ dishId: ourDish.id, quantity: 1 }] })
        .expect(404);
    });
  });

  describe('the order board', () => {
    it('gives a captain names and prices, and nothing a waiter does not need', async () => {
      const ramesh = await captain();

      await api(app)
        .post('/dishes')
        .set(headers)
        .send({
          name: `Board ${unique()}`,
          price: 180,
          description: 'A long description a captain never reads at a table',
          preparationTimeMinutes: 12,
        })
        .expect(201);

      const { body } = await api(app).get('/dishes/board').set(auth(ramesh.token)).expect(200);

      expect(body.length).toBeGreaterThan(0);
      const sample = body[0];
      expect(Object.keys(sample).sort()).toEqual(
        ['categoryName', 'dietType', 'id', 'name', 'price'].sort(),
      );
    });

    it('leaves out a dish that is off the menu tonight', async () => {
      const ramesh = await captain();

      const dish = (
        await api(app)
          .post('/dishes')
          .set(headers)
          .send({ name: `Sold Out ${unique()}`, price: 200 })
          .expect(201)
      ).body;

      await api(app).patch(`/dishes/${dish.id}`).set(headers).send({ isAvailable: false }).expect(200);

      const { body } = await api(app).get('/dishes/board').set(auth(ramesh.token)).expect(200);

      // A captain cannot order it, so showing it can only disappoint a guest who
      // has already asked.
      expect(body.find((d: { id: number }) => d.id === dish.id)).toBeUndefined();
    });

    it('shows only this restaurant dishes', async () => {
      const ramesh = await captain();
      const rival = await registerOwner(app, { restaurantName: 'Board Rival' });

      const theirs = (
        await api(app)
          .post('/dishes')
          .set(auth(rival.accessToken))
          .send({ name: `Rival Dish ${unique()}`, price: 100 })
          .expect(201)
      ).body;

      const { body } = await api(app).get('/dishes/board').set(auth(ramesh.token)).expect(200);

      expect(body.find((d: { id: number }) => d.id === theirs.id)).toBeUndefined();
    });
  });

  describe('what the owner sees', () => {
    it('counts each captain separately in the staff report', async () => {
      const fresh = await registerOwner(app, { restaurantName: 'Reporting Floor' });
      const h = auth(fresh.accessToken);

      const table = (
        await api(app).post('/restaurants/me/tables').set(h).send({ name: 'R1' }).expect(201)
      ).body;
      const dish = (
        await api(app).post('/dishes').set(h).send({ name: 'Report Dish', price: 100 }).expect(201)
      ).body;

      const make = async (name: string) => {
        const payload = captainPayload({ name, code: `rep-${unique()}` });
        await api(app).post(staff).set(h).send(payload).expect(201);
        const login = await api(app)
          .post('/auth/staff/login')
          .send({ code: payload.code, password: payload.password })
          .expect(200);
        return auth(login.body.accessToken);
      };

      const one = await make('Captain One');
      const two = await make('Captain Two');

      await api(app)
        .post(orders)
        .set(one)
        .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(201);
      await api(app)
        .post(orders)
        .set(two)
        .send({ items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(201);

      const today = new Date().toISOString().slice(0, 10);
      const report = (
        await api(app)
          .get(`/restaurants/me/reports/staff?from=${today}&to=${today}`)
          .set(h)
          .expect(200)
      ).body;

      const names = report.map((row: { name: string }) => row.name);
      expect(names).toEqual(expect.arrayContaining(['Captain One', 'Captain Two']));
    });
  });
});
