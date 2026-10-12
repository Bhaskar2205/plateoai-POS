import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from 'src/common/enums';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantUser } from 'src/modules/restaurants/entities/restaurant-user.entity';
import { User } from 'src/modules/users/entities/user.entity';
import {
  api,
  auth,
  createTestApp,
  registerOwner,
  type RegisteredOwner,
  type TestContext,
} from './test-app';

/**
 * Food the restaurant gave away.
 *
 * The property this suite exists to protect is the one that is easy to get wrong
 * and expensive to discover late: a comped dish is free to the guest and not
 * free to the restaurant. It must leave stock exactly as a sold one does, while
 * never appearing in a single revenue figure. Everything else here is about who
 * may give food away, and what survives when an owner deletes the evidence.
 */
describe('No-charge bills (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  let owner: RegisteredOwner;
  let headers: Record<string, string>;

  const orders = '/restaurants/me/orders';

  const createTable = async (name: string) =>
    (await api(app).post('/restaurants/me/tables').set(headers).send({ name }).expect(201)).body;

  const createDish = async (name: string, price: number) =>
    (await api(app).post('/dishes').set(headers).send({ name, price }).expect(201)).body;

  async function memberWithRole(restaurantId: number, role: UserRole): Promise<string> {
    const member = await registerOwner(app);

    await dataSource.getRepository(User).update({ id: member.userId }, { role });
    await dataSource.getRepository(RestaurantUser).save({ userId: member.userId, restaurantId });

    const login = await api(app)
      .post('/auth/login')
      .send({ email: member.email, password: member.password, restaurantId })
      .expect(200);

    return login.body.accessToken as string;
  }

  const unique = () => Math.random().toString(36).slice(2, 7);

  /** A bill with one dish on it, already sent to the kitchen. */
  async function billWithKot(price = 200, quantity = 1) {
    const table = await createTable(`T${unique()}`);
    const dish = await createDish(`Dish ${unique()}`, price);

    const order = (
      await api(app)
        .post(orders)
        .set(headers)
        .send({ tableId: table.id, items: [{ dishId: dish.id, quantity }] })
        .expect(201)
    ).body;

    await api(app).post(`${orders}/${order.id}/kot`).set(headers).send({}).expect(201);

    const refreshed = (await api(app).get(`${orders}/${order.id}`).set(headers).expect(200)).body;

    return { order: refreshed, dish, table };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;

    owner = await registerOwner(app, { restaurantName: 'Giveaway House' });
    headers = auth(owner.accessToken);
    await dataSource.getRepository(Restaurant).update({ id: owner.restaurantId }, { taxRate: 0 });
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('taking a line off a bill the kitchen has already cooked', () => {
    it('refuses without a reason, because that is a write-off', async () => {
      const { order } = await billWithKot();

      await api(app)
        .post(`${orders}/${order.id}/items/${order.items[0].id}/cancel`)
        .set(headers)
        .send({})
        .expect(400);
    });

    it('allows it with one, and keeps the reason on the line', async () => {
      const { order } = await billWithKot();

      const after = (
        await api(app)
          .post(`${orders}/${order.id}/items/${order.items[0].id}/cancel`)
          .set(headers)
          .send({ reason: 'Guest sent it back - too salty' })
          .expect(200)
      ).body;

      expect(after.items[0]).toMatchObject({
        status: 'CANCELLED',
        cancelledReason: 'Guest sent it back - too salty',
      });
      expect(after.subtotal).toBe(0);
    });

    it('still lets a line the kitchen has not seen go without ceremony', async () => {
      // A mis-tap corrected before anyone cooked it is not a write-off.
      const table = await createTable(`Untouched ${unique()}`);
      const dish = await createDish(`Quick Fix ${unique()}`, 100);
      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      await api(app)
        .post(`${orders}/${order.id}/items/${order.items[0].id}/cancel`)
        .set(headers)
        .send({})
        .expect(200);
    });
  });

  describe('comping one line inside a paying bill', () => {
    it('takes it out of the total but leaves it on the bill at full value', async () => {
      const table = await createTable(`Comp ${unique()}`);
      const paid = await createDish(`Paid ${unique()}`, 300);
      const comped = await createDish(`Comped ${unique()}`, 200);

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({
            tableId: table.id,
            items: [
              { dishId: paid.id, quantity: 1 },
              { dishId: comped.id, quantity: 1 },
            ],
          })
          .expect(201)
      ).body;

      const line = order.items.find((item: { dishId: number }) => item.dishId === comped.id);

      const after = (
        await api(app)
          .post(`${orders}/${order.id}/items/${line.id}/nc`)
          .set(headers)
          .send({ reason: 'Guest sent it back - comped' })
          .expect(200)
      ).body;

      expect(after.subtotal).toBe(300);

      // The line keeps its price: what the giveaway was worth is the number an
      // owner wants at the end of the month.
      const kept = after.items.find((item: { id: number }) => item.id === line.id);
      expect(kept).toMatchObject({ isNonChargeable: true, lineTotal: 200 });
    });

    it('shows the comped line on the printed bill at zero, rather than hiding it', async () => {
      const table = await createTable(`Shown ${unique()}`);
      const paid = await createDish(`VisiblePaid ${unique()}`, 300);
      const comped = await createDish(`VisibleComped ${unique()}`, 150);

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({
            tableId: table.id,
            items: [
              { dishId: paid.id, quantity: 1 },
              { dishId: comped.id, quantity: 1 },
            ],
          })
          .expect(201)
      ).body;

      const line = order.items.find((item: { dishId: number }) => item.dishId === comped.id);
      await api(app)
        .post(`${orders}/${order.id}/items/${line.id}/nc`)
        .set(headers)
        .send({ reason: 'On the house' })
        .expect(200);

      const bill = (await api(app).get(`${orders}/${order.id}/bill`).set(headers).expect(200)).body;

      const shown = bill.lines.find((l: { name: string }) => l.name === comped.name);
      expect(shown).toMatchObject({ isNonChargeable: true, lineTotal: 0, ncReason: 'On the house' });
      expect(bill.subtotal).toBe(300);
    });

    it('can be put back on the bill', async () => {
      const { order } = await billWithKot(250);
      const itemId = order.items[0].id;

      await api(app)
        .post(`${orders}/${order.id}/items/${itemId}/nc`)
        .set(headers)
        .send({ reason: 'Comped by mistake' })
        .expect(200);

      const after = (
        await api(app).delete(`${orders}/${order.id}/items/${itemId}/nc`).set(headers).expect(200)
      ).body;

      expect(after.subtotal).toBe(250);
      expect(after.items[0].isNonChargeable).toBe(false);
    });

    it('will not comp a line that was cancelled, because it was never served', async () => {
      const { order } = await billWithKot();
      const itemId = order.items[0].id;

      await api(app)
        .post(`${orders}/${order.id}/items/${itemId}/cancel`)
        .set(headers)
        .send({ reason: 'Out of stock on the night' })
        .expect(200);

      await api(app)
        .post(`${orders}/${order.id}/items/${itemId}/nc`)
        .set(headers)
        .send({ reason: 'Trying to comp a cancelled line' })
        .expect(400);
    });

    it('requires a reason', async () => {
      const { order } = await billWithKot();

      await api(app)
        .post(`${orders}/${order.id}/items/${order.items[0].id}/nc`)
        .set(headers)
        .send({})
        .expect(400);
    });
  });

  describe('a whole bill given away', () => {
    it('settles, and charges nothing', async () => {
      const { order } = await billWithKot(400);

      const marked = (
        await api(app)
          .post(`${orders}/${order.id}/nc`)
          .set(headers)
          .send({ forWhom: 'Owner family', reason: 'Sunday lunch' })
          .expect(200)
      ).body;

      expect(marked).toMatchObject({ isNonChargeable: true, ncFor: 'Owner family' });

      // It still settles: that is what frees the table and closes the tickets.
      await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);
    });

    it('settles even when every single line is comped', async () => {
      // Nothing to charge for, everything to settle. An emptiness check written
      // against the billable lines would refuse this and strand the table.
      const { order } = await billWithKot(180);

      await api(app)
        .post(`${orders}/${order.id}/items/${order.items[0].id}/nc`)
        .set(headers)
        .send({ reason: 'Whole plate comped' })
        .expect(200);

      await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);
    });

    it('cannot be marked once it has settled, because the day has been read off it', async () => {
      const { order } = await billWithKot(120);

      await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      await api(app)
        .post(`${orders}/${order.id}/nc`)
        .set(headers)
        .send({ forWhom: 'Too late', reason: 'After the fact' })
        .expect(400);
    });

    it('requires both who ate and why', async () => {
      const { order } = await billWithKot();

      await api(app).post(`${orders}/${order.id}/nc`).set(headers).send({}).expect(400);
      await api(app)
        .post(`${orders}/${order.id}/nc`)
        .set(headers)
        .send({ forWhom: 'Owner family' })
        .expect(400);
    });
  });

  describe('who may give food away', () => {
    it('refuses a waiter, because it is a money decision', async () => {
      const waiter = auth(await memberWithRole(owner.restaurantId, UserRole.WAITER));
      const { order } = await billWithKot();

      await api(app)
        .post(`${orders}/${order.id}/items/${order.items[0].id}/nc`)
        .set(waiter)
        .send({ reason: 'Waiter trying to comp' })
        .expect(403);

      await api(app)
        .post(`${orders}/${order.id}/nc`)
        .set(waiter)
        .send({ forWhom: 'A friend', reason: 'Waiter giving the table away' })
        .expect(403);
    });

    it('allows a manager', async () => {
      const manager = auth(await memberWithRole(owner.restaurantId, UserRole.RESTAURANT_MANAGER));
      const { order } = await billWithKot();

      await api(app)
        .post(`${orders}/${order.id}/items/${order.items[0].id}/nc`)
        .set(manager)
        .send({ reason: 'Manager comping a plate' })
        .expect(200);
    });
  });

  describe('deleting a giveaway', () => {
    async function settledNcBill(price = 500) {
      const { order } = await billWithKot(price);

      await api(app)
        .post(`${orders}/${order.id}/nc`)
        .set(headers)
        .send({ forWhom: 'Owner family', reason: 'Dinner' })
        .expect(200);

      await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      return order;
    }

    it('lets the owner erase it, and it is gone', async () => {
      const order = await settledNcBill();

      await api(app).delete(`${orders}/${order.id}`).set(headers).expect(204);
      await api(app).get(`${orders}/${order.id}`).set(headers).expect(404);
    });

    it('refuses to delete a real sale, whoever asks', async () => {
      const { order } = await billWithKot(300);

      await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      await api(app).delete(`${orders}/${order.id}`).set(headers).expect(400);
      await api(app).get(`${orders}/${order.id}`).set(headers).expect(200);
    });

    it('refuses a manager: erasing a record belongs to the owner alone', async () => {
      const manager = auth(await memberWithRole(owner.restaurantId, UserRole.RESTAURANT_MANAGER));
      const order = await settledNcBill(260);

      await api(app).delete(`${orders}/${order.id}`).set(manager).expect(403);
      await api(app).get(`${orders}/${order.id}`).set(headers).expect(200);
    });

    it('will not reach another restaurant bill', async () => {
      const rival = await registerOwner(app, { restaurantName: 'Rival Giveaway' });
      const order = await settledNcBill(210);

      // 404, not 403: another restaurant's bill should not be distinguishable
      // from one that does not exist.
      await api(app).delete(`${orders}/${order.id}`).set(auth(rival.accessToken)).expect(404);
      await api(app).get(`${orders}/${order.id}`).set(headers).expect(200);
    });
  });

  describe('what the reports say', () => {
    it('keeps giveaways out of takings, and still shows what they cost', async () => {
      const fresh = await registerOwner(app, { restaurantName: 'Reporting Giveaways' });
      const h = auth(fresh.accessToken);
      await dataSource.getRepository(Restaurant).update({ id: fresh.restaurantId }, { taxRate: 0 });

      const table = (
        await api(app).post('/restaurants/me/tables').set(h).send({ name: 'R1' }).expect(201)
      ).body;
      const dish = (
        await api(app).post('/dishes').set(h).send({ name: 'Report Dish', price: 100 }).expect(201)
      ).body;

      const open = async (quantity: number) =>
        (
          await api(app)
            .post(orders)
            .set(h)
            .send({ tableId: table.id, items: [{ dishId: dish.id, quantity }] })
            .expect(201)
        ).body;

      // One real sale of 500.
      const sale = await open(5);
      await api(app)
        .post(`${orders}/${sale.id}/settle`)
        .set(h)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      // One giveaway worth 300.
      const comp = await open(3);
      await api(app)
        .post(`${orders}/${comp.id}/nc`)
        .set(h)
        .send({ forWhom: 'Owner family', reason: 'Lunch' })
        .expect(200);
      await api(app)
        .post(`${orders}/${comp.id}/settle`)
        .set(h)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      const today = new Date().toISOString().slice(0, 10);
      const sales = (
        await api(app)
          .get(`/restaurants/me/reports/sales?from=${today}&to=${today}`)
          .set(h)
          .expect(200)
      ).body;

      expect(sales.bills).toBe(1);
      expect(sales.net).toBe(500);
      expect(sales.ncBills).toBe(1);
      expect(sales.ncValue).toBe(300);

      const dayEnd = (
        await api(app)
          .get(`/restaurants/me/reports/day-end?from=${today}`)
          .set(h)
          .expect(200)
      ).body;

      expect(dayEnd.ncBills).toBe(1);
      expect(dayEnd.ncValue).toBe(300);
      // The till should match the drawer, and nobody put 300 in it.
      expect(dayEnd.collected).toBe(500);
    });
  });
});
