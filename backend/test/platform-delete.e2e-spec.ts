import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from 'src/common/enums';
import { Order } from 'src/modules/orders/entities/order.entity';
import { RestaurantUser } from 'src/modules/restaurants/entities/restaurant-user.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
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
 * Deleting a restaurant.
 *
 * The most destructive thing in Plateo, and the only one with nothing behind it
 * to undo with. What these tests protect is not that it works - a DELETE almost
 * always works - but that it is hard to do by accident, that it takes everything
 * it claims to take, and that it never reaches past the restaurant it was aimed
 * at.
 */
describe('Deleting a restaurant (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;
  let platform: Record<string, string>;

  const unique = () => Math.random().toString(36).slice(2, 8);

  const account = (over: Record<string, unknown> = {}) => ({
    restaurantName: `Doomed ${unique()}`,
    ownerName: 'Doomed Owner',
    ownerEmail: `doomed-${unique()}@example.com`,
    ownerPassword: 'StrongPassword123!',
    ...over,
  });

  /** A restaurant with a bill on it, so there is something real to destroy. */
  async function restaurantWithTrade() {
    const created = (
      await api(app).post('/platform/restaurants').set(platform).send(account()).expect(201)
    ).body;

    const login = await api(app)
      .post('/auth/login')
      .send({
        email: created.owners[0].email,
        password: 'StrongPassword123!',
        restaurantId: created.id,
      })
      .expect(200);

    const h = auth(login.body.accessToken);
    const table = (
      await api(app).post('/restaurants/me/tables').set(h).send({ name: 'D1' }).expect(201)
    ).body;
    const dish = (
      await api(app).post('/dishes').set(h).send({ name: 'Doomed Dish', price: 200 }).expect(201)
    ).body;
    const order = (
      await api(app)
        .post('/restaurants/me/orders')
        .set(h)
        .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 2 }] })
        .expect(201)
    ).body;

    return { created, headers: h, orderId: order.id };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
    platform = auth(await platformAdminToken(app));
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('before anything is destroyed', () => {
    it('hands back a complete copy of the restaurant', async () => {
      const { created } = await restaurantWithTrade();

      const { body } = await api(app)
        .get(`/platform/restaurants/${created.id}/export`)
        .set(platform)
        .expect(200);

      expect(body.restaurant).toMatchObject({ id: created.id, name: created.name });
      expect(body.orders.length).toBeGreaterThan(0);
      expect(body.orderItems.length).toBeGreaterThan(0);
      expect(body.menu.dishes.length).toBeGreaterThan(0);
      expect(body.staff.length).toBeGreaterThan(0);
    });

    it('never puts a password hash in the export', async () => {
      const { created } = await restaurantWithTrade();

      const { text } = await api(app)
        .get(`/platform/restaurants/${created.id}/export`)
        .set(platform)
        .expect(200);

      expect(text).not.toMatch(/passwordHash|password_hash|\$argon2/i);
    });

    it('says what the deletion would destroy', async () => {
      const { created } = await restaurantWithTrade();

      const { body } = await api(app)
        .get(`/platform/restaurants/${created.id}/deletion-impact`)
        .set(platform)
        .expect(200);

      expect(body).toMatchObject({ name: created.name, bills: 1, staff: 1 });
      expect(body.alsoWorkElsewhere).toEqual([]);
    });

    it('names anyone who also works at another restaurant', async () => {
      // They lose that job too, and nobody should meet that fact afterwards.
      const { created } = await restaurantWithTrade();
      const other = await registerOwner(app, { restaurantName: `Other ${unique()}` });

      const ownerId = created.owners[0].id;
      await dataSource
        .getRepository(RestaurantUser)
        .save({ userId: ownerId, restaurantId: other.restaurantId });

      const { body } = await api(app)
        .get(`/platform/restaurants/${created.id}/deletion-impact`)
        .set(platform)
        .expect(200);

      expect(body.alsoWorkElsewhere).toEqual(['Doomed Owner']);
    });
  });

  describe('the deletion itself', () => {
    it('refuses when the name is not typed back exactly', async () => {
      const { created } = await restaurantWithTrade();

      await api(app)
        .post(`/platform/restaurants/${created.id}/delete`)
        .set(platform)
        .send({ confirmName: 'Not The Name' })
        .expect(400);

      // Still there.
      await api(app).get(`/platform/restaurants/${created.id}`).set(platform).expect(200);
    });

    it('refuses a name that differs only by case or spacing', async () => {
      const { created } = await restaurantWithTrade();

      await api(app)
        .post(`/platform/restaurants/${created.id}/delete`)
        .set(platform)
        .send({ confirmName: created.name.toUpperCase() })
        .expect(400);
    });

    it('takes the restaurant, its bills and its people', async () => {
      const { created, orderId } = await restaurantWithTrade();
      const ownerId = created.owners[0].id;

      const { body } = await api(app)
        .post(`/platform/restaurants/${created.id}/delete`)
        .set(platform)
        .send({ confirmName: created.name })
        .expect(200);

      expect(body).toMatchObject({ name: created.name, staffDeleted: 1 });

      expect(await dataSource.getRepository(Restaurant).findOne({ where: { id: created.id } })).toBeNull();
      expect(await dataSource.getRepository(Order).findOne({ where: { id: orderId } })).toBeNull();
      expect(await dataSource.getRepository(User).findOne({ where: { id: ownerId } })).toBeNull();
      expect(
        await dataSource.getRepository(RestaurantUser).findOne({ where: { restaurantId: created.id } }),
      ).toBeNull();
    });

    it('locks the owner out immediately', async () => {
      const { created, headers } = await restaurantWithTrade();

      await api(app).get('/restaurants/me').set(headers).expect(200);

      await api(app)
        .post(`/platform/restaurants/${created.id}/delete`)
        .set(platform)
        .send({ confirmName: created.name })
        .expect(200);

      await api(app).get('/restaurants/me').set(headers).expect(401);
      await api(app)
        .post('/auth/login')
        .send({ email: created.owners[0].email, password: 'StrongPassword123!' })
        .expect(401);
    });

    it('leaves every other restaurant untouched', async () => {
      const keep = await restaurantWithTrade();
      const doomed = await restaurantWithTrade();

      await api(app)
        .post(`/platform/restaurants/${doomed.created.id}/delete`)
        .set(platform)
        .send({ confirmName: doomed.created.name })
        .expect(200);

      await api(app).get(`/platform/restaurants/${keep.created.id}`).set(platform).expect(200);
      await api(app).get('/restaurants/me').set(keep.headers).expect(200);
      expect(
        await dataSource.getRepository(Order).findOne({ where: { id: keep.orderId } }),
      ).not.toBeNull();
    });

    it('frees the staff code so it can be used again', async () => {
      const { created, headers } = await restaurantWithTrade();
      const code = `gone-${unique()}`;

      await api(app)
        .post('/restaurants/me/staff')
        .set(headers)
        .send({ name: 'Doomed Captain', code, password: 'Shift2026!', role: UserRole.WAITER })
        .expect(201);

      await api(app)
        .post(`/platform/restaurants/${created.id}/delete`)
        .set(platform)
        .send({ confirmName: created.name })
        .expect(200);

      // A code is unique across Plateo, so a deleted one has to come back into
      // circulation or the namespace leaks with every closed account.
      const next = await restaurantWithTrade();
      await api(app)
        .post('/restaurants/me/staff')
        .set(next.headers)
        .send({ name: 'New Captain', code, password: 'Shift2026!', role: UserRole.WAITER })
        .expect(201);
    });

    it('is refused to a restaurant owner', async () => {
      const { created, headers } = await restaurantWithTrade();

      await api(app)
        .post(`/platform/restaurants/${created.id}/delete`)
        .set(headers)
        .send({ confirmName: created.name })
        .expect(403);

      await api(app).get(`/platform/restaurants/${created.id}`).set(platform).expect(200);
    });

    it('404s for a restaurant that does not exist', async () => {
      await api(app)
        .post('/platform/restaurants/99999999/delete')
        .set(platform)
        .send({ confirmName: 'Anything' })
        .expect(404);
    });
  });
});
