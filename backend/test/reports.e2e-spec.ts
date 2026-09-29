import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from 'src/common/enums';
import { businessDateFor } from 'src/common/utils/business-date.util';
import { Order } from 'src/modules/orders/entities/order.entity';
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
 * Reports.
 *
 * These are the numbers an owner reconciles a cash drawer against, so the tests
 * are mostly arithmetic: the totals have to match the bills exactly, only settled
 * bills may count as sales, and one restaurant's takings must never appear in
 * another's report.
 */
describe('Reports (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  let owner: RegisteredOwner;
  let headers: Record<string, string>;
  let today: string;

  const reports = '/restaurants/me/reports';

  const createDish = async (h: Record<string, string>, name: string, price: number, categoryId?: number) =>
    (
      await api(app)
        .post('/dishes')
        .set(h)
        .send({ name, price, ...(categoryId ? { categoryId } : {}) })
        .expect(201)
    ).body;

  const createTable = async (h: Record<string, string>, name: string) =>
    (await api(app).post('/restaurants/me/tables').set(h).send({ name }).expect(201)).body;

  /** Opens a bill, then settles it, and returns the settled order. */
  async function sellBill(
    h: Record<string, string>,
    items: Array<{ dishId: number; quantity: number }>,
    options: { tableId?: number; paymentMethod?: string; discount?: { value: number; reason: string } } = {},
  ) {
    const order = (
      await api(app)
        .post('/restaurants/me/orders')
        .set(h)
        .send({ ...(options.tableId ? { tableId: options.tableId } : {}), items })
        .expect(201)
    ).body;

    if (options.discount) {
      await api(app)
        .post(`/restaurants/me/orders/${order.id}/discount`)
        .set(h)
        .send({ type: 'PERCENT', value: options.discount.value, reason: options.discount.reason })
        .expect(200);
    }

    return (
      await api(app)
        .post(`/restaurants/me/orders/${order.id}/settle`)
        .set(h)
        .send({ paymentMethod: options.paymentMethod ?? 'CASH' })
        .expect(200)
    ).body;
  }

  async function memberWithRole(restaurantId: number, role: UserRole): Promise<string> {
    const member = await registerOwner(app);

    await dataSource.getRepository(User).update({ id: member.userId }, { role });
    await dataSource.getRepository(RestaurantUser).save({ userId: member.userId, restaurantId });

    const login = await api(app)
      .post('/auth/login')
      .send({ email: member.email, password: member.password, restaurantId })
      .expect(200);

    return login.body.accessToken;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
    today = businessDateFor();

    owner = await registerOwner(app, { restaurantName: 'Reporting Kitchen' });
    headers = auth(owner.accessToken);

    // No tax, so the arithmetic in these tests is the arithmetic of the bills.
    await dataSource.getRepository(Restaurant).update({ id: owner.restaurantId }, { taxRate: 0 });

    const mains = (await api(app).post('/categories').set(headers).send({ name: 'Mains' }).expect(201)).body;
    const drinks = (await api(app).post('/categories').set(headers).send({ name: 'Drinks' }).expect(201)).body;

    const curry = await createDish(headers, 'Report Curry', 300, mains.id);
    const rice = await createDish(headers, 'Report Rice', 100, mains.id);
    const lassi = await createDish(headers, 'Report Lassi', 80, drinks.id);

    const table = await createTable(headers, 'R-1');

    // Three settled bills: 700 cash, 480 UPI (10% off 400... see below), 160 cash.
    await sellBill(headers, [
      { dishId: curry.id, quantity: 2 },
      { dishId: rice.id, quantity: 1 },
    ], { tableId: table.id, paymentMethod: 'CASH' }); // 700

    await sellBill(headers, [{ dishId: curry.id, quantity: 1 }, { dishId: lassi.id, quantity: 1 }], {
      paymentMethod: 'UPI',
      discount: { value: 10, reason: 'Regular guest' },
    }); // 380 - 38 = 342

    await sellBill(headers, [{ dishId: lassi.id, quantity: 2 }], { paymentMethod: 'CASH' }); // 160

    // One bill left open, and one voided - neither is a sale.
    const openOrder = (
      await api(app)
        .post('/restaurants/me/orders')
        .set(headers)
        .send({ items: [{ dishId: rice.id, quantity: 1 }] })
        .expect(201)
    ).body;
    expect(openOrder.total).toBe(100);

    const voidedOrder = (
      await api(app)
        .post('/restaurants/me/orders')
        .set(headers)
        .send({ items: [{ dishId: curry.id, quantity: 1 }] })
        .expect(201)
    ).body;
    await api(app)
      .post(`/restaurants/me/orders/${voidedOrder.id}/cancel`)
      .set(headers)
      .send({ reason: 'Guests left' })
      .expect(200);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('sales summary', () => {
    it('counts only settled bills, and the totals match them exactly', async () => {
      const { body } = await api(app).get(`${reports}/sales`).set(headers).expect(200);

      expect(body.period).toEqual({ from: today, to: today, days: 1 });
      expect(body.bills).toBe(3);
      // 700 + 380 + 160
      expect(body.gross).toBe(1240);
      expect(body.discounts).toBe(38);
      expect(body.tax).toBe(0);
      // 1240 - 38
      expect(body.net).toBe(1202);
      expect(body.averageBill).toBe(400.67);
      expect(body.itemsSold).toBe(7);
    });

    it('reports open and voided bills without counting them as takings', async () => {
      const { body } = await api(app).get(`${reports}/sales`).set(headers).expect(200);

      expect(body.openBills).toBe(1);
      expect(body.voidedBills).toBe(1);
      // A voided bill zeroes its stored totals, so its worth comes from its lines.
      expect(body.voidedValue).toBe(300);
      expect(body.net).toBe(1202);
    });

    it('splits the takings by payment method', async () => {
      const { body } = await api(app).get(`${reports}/sales`).set(headers).expect(200);
      const byMethod = Object.fromEntries(
        body.payments.map((row: { method: string; total: number; bills: number }) => [
          row.method,
          row,
        ]),
      );

      expect(byMethod.CASH).toMatchObject({ bills: 2, total: 860 });
      expect(byMethod.UPI).toMatchObject({ bills: 1, total: 342 });
      expect(body.payments.reduce((sum: number, row: { total: number }) => sum + row.total, 0)).toBe(
        body.net,
      );
    });

    it('gives a row for every day in the range, including quiet ones', async () => {
      const from = new Date(Date.parse(`${today}T00:00:00Z`) - 2 * 86_400_000)
        .toISOString()
        .slice(0, 10);

      const { body } = await api(app)
        .get(`${reports}/sales`)
        .query({ from, to: today })
        .set(headers)
        .expect(200);

      expect(body.period.days).toBe(3);
      expect(body.daily).toHaveLength(3);
      expect(body.daily[0]).toEqual({ businessDate: from, bills: 0, net: 0 });
      expect(body.daily[2]).toEqual({ businessDate: today, bills: 3, net: 1202 });
    });

    it('buckets takings by hour for a short range', async () => {
      const { body } = await api(app).get(`${reports}/sales`).set(headers).expect(200);

      expect(body.hourly.length).toBeGreaterThan(0);
      expect(body.hourly.reduce((sum: number, row: { total: number }) => sum + row.total, 0)).toBe(
        body.net,
      );
      expect(body.hourly.every((row: { hour: number }) => row.hour >= 0 && row.hour <= 23)).toBe(true);
    });

    it('leaves the hourly breakdown out of a long range, where it says nothing', async () => {
      const from = new Date(Date.parse(`${today}T00:00:00Z`) - 60 * 86_400_000)
        .toISOString()
        .slice(0, 10);

      const { body } = await api(app)
        .get(`${reports}/sales`)
        .query({ from, to: today })
        .set(headers)
        .expect(200);

      expect(body.hourly).toEqual([]);
      expect(body.net).toBe(1202);
    });

    it('answers with zeroes for a day with no trade, rather than an error', async () => {
      const { body } = await api(app)
        .get(`${reports}/sales`)
        .query({ from: '2020-01-01', to: '2020-01-01' })
        .set(headers)
        .expect(200);

      expect(body).toMatchObject({ bills: 0, gross: 0, net: 0, averageBill: 0, itemsSold: 0 });
      expect(body.payments).toEqual([]);
    });
  });

  describe('item and section summaries', () => {
    it('ranks dishes by what they earned, with their share', async () => {
      const { body } = await api(app).get(`${reports}/items`).set(headers).expect(200);
      const byName = Object.fromEntries(body.map((row: { name: string }) => [row.name, row]));

      expect(byName['Report Curry']).toMatchObject({ quantity: 3, total: 900, section: 'Mains' });
      expect(byName['Report Rice']).toMatchObject({ quantity: 1, total: 100, section: 'Mains' });
      expect(byName['Report Lassi']).toMatchObject({ quantity: 3, total: 240, section: 'Drinks' });
      expect(body[0].name).toBe('Report Curry');

      // Shares are of gross, so they add up to about 100%.
      const share = body.reduce((sum: number, row: { share: number }) => sum + row.share, 0);
      expect(share).toBeGreaterThan(99);
      expect(share).toBeLessThan(101);
    });

    it('gathers the same sales into menu sections', async () => {
      const { body } = await api(app).get(`${reports}/sections`).set(headers).expect(200);
      const byName = Object.fromEntries(body.map((row: { name: string }) => [row.name, row]));

      expect(byName.Mains).toMatchObject({ dishes: 2, quantity: 4, total: 1000 });
      expect(byName.Drinks).toMatchObject({ dishes: 1, quantity: 3, total: 240 });
      expect(body.reduce((sum: number, row: { total: number }) => sum + row.total, 0)).toBe(1240);
    });
  });

  describe('bill register', () => {
    it('lists every bill, whatever its state', async () => {
      const { body } = await api(app).get(`${reports}/orders`).set(headers).expect(200);

      expect(body).toHaveLength(5);
      expect(body.filter((row: { status: string }) => row.status === 'SETTLED')).toHaveLength(3);
      expect(body.filter((row: { status: string }) => row.status === 'OPEN')).toHaveLength(1);
      expect(body.filter((row: { status: string }) => row.status === 'CANCELLED')).toHaveLength(1);

      const settled = body.find((row: { status: string; total: number }) => row.total === 700);
      expect(settled).toMatchObject({
        tableName: 'R-1',
        paymentMethod: 'CASH',
        items: 2,
        settledBy: 'Test Owner',
      });
    });
  });

  describe('staff and table summaries', () => {
    it('credits the bills to whoever settled them', async () => {
      const { body } = await api(app).get(`${reports}/staff`).set(headers).expect(200);
      const me = body.find((row: { userId: number }) => row.userId === owner.userId);

      expect(me).toMatchObject({ billsOpened: 5, billsSettled: 3, settledValue: 1202, discountsGiven: 38 });
    });

    it('reports what each table earned and how long it held a bill', async () => {
      const { body } = await api(app).get(`${reports}/tables`).set(headers).expect(200);
      const table = body.find((row: { name: string }) => row.name === 'R-1');
      const counter = body.find((row: { name: string }) => row.name === 'Counter / takeaway');

      expect(table).toMatchObject({ bills: 1, total: 700, averageBill: 700 });
      expect(table.averageMinutes).toBeGreaterThanOrEqual(0);
      // The two bills with no table are reported together, not dropped.
      expect(counter).toMatchObject({ bills: 2, total: 502 });
    });
  });

  describe('discounts, voids and cancellations', () => {
    it('shows every discount with its reason and who gave it', async () => {
      const { body } = await api(app).get(`${reports}/adjustments`).set(headers).expect(200);

      expect(body.discountTotal).toBe(38);
      expect(body.discounts).toHaveLength(1);
      expect(body.discounts[0]).toMatchObject({
        amount: 38,
        reason: 'Regular guest',
        billTotal: 342,
        settledBy: 'Test Owner',
      });
    });

    it('shows voided bills with what they were worth', async () => {
      const { body } = await api(app).get(`${reports}/adjustments`).set(headers).expect(200);

      expect(body.voidedTotal).toBe(300);
      expect(body.voided).toHaveLength(1);
      expect(body.voided[0]).toMatchObject({ value: 300, reason: 'Guests left' });
    });

    it('reports items struck off a bill, with their reasons', async () => {
      const dish = await createDish(headers, 'Struck Off Soup', 150);
      const order = (
        await api(app)
          .post('/restaurants/me/orders')
          .set(headers)
          .send({ items: [{ dishId: dish.id, quantity: 2 }] })
          .expect(201)
      ).body;

      await api(app)
        .post(`/restaurants/me/orders/${order.id}/items/${order.items[0].id}/cancel`)
        .set(headers)
        .send({ reason: 'Out of stock' })
        .expect(200);

      const { body } = await api(app).get(`${reports}/adjustments`).set(headers).expect(200);
      const row = body.cancelledItems.find((item: { name: string }) => item.name === 'Struck Off Soup');

      expect(row).toMatchObject({ times: 1, quantity: 2, value: 300 });
      expect(row.reasons).toContain('Out of stock');

      // Cancelling a line must not have changed what was reported as sold.
      const sales = await api(app).get(`${reports}/sales`).set(headers).expect(200);
      expect(sales.body.net).toBe(1202);
    });
  });

  describe('who may read them, and whose numbers they are', () => {
    it('refuses a waiter and kitchen staff, and anonymous callers', async () => {
      const waiter = auth(await memberWithRole(owner.restaurantId, UserRole.WAITER));
      const kitchen = auth(await memberWithRole(owner.restaurantId, UserRole.KITCHEN_STAFF));

      for (const path of ['sales', 'items', 'sections', 'orders', 'staff', 'tables', 'adjustments']) {
        await api(app).get(`${reports}/${path}`).set(waiter).expect(403);
        await api(app).get(`${reports}/${path}`).set(kitchen).expect(403);
        await api(app).get(`${reports}/${path}`).expect(401);
      }
    });

    it('lets a manager read them', async () => {
      const manager = auth(await memberWithRole(owner.restaurantId, UserRole.RESTAURANT_MANAGER));

      await api(app).get(`${reports}/sales`).set(manager).expect(200);
    });

    it('never mixes another restaurant takings in', async () => {
      const rival = await registerOwner(app, { restaurantName: 'Rival Reporting House' });
      const rivalHeaders = auth(rival.accessToken);
      const rivalDish = await createDish(rivalHeaders, 'Rival Roti', 5000);

      await sellBill(rivalHeaders, [{ dishId: rivalDish.id, quantity: 1 }]);

      const mine = await api(app).get(`${reports}/sales`).set(headers).expect(200);
      const theirs = await api(app).get(`${reports}/sales`).set(rivalHeaders).expect(200);

      expect(mine.body.net).toBe(1202);
      expect(theirs.body.net).toBe(5000);

      const myItems = await api(app).get(`${reports}/items`).set(headers).expect(200);
      expect(myItems.body.some((row: { name: string }) => row.name === 'Rival Roti')).toBe(false);
    });
  });

  describe('the date range itself', () => {
    it('rejects a malformed date', async () => {
      await api(app).get(`${reports}/sales`).query({ from: 'last-tuesday' }).set(headers).expect(400);
      await api(app).get(`${reports}/sales`).query({ to: '28-09-2026' }).set(headers).expect(400);
    });

    it('rejects a range that runs backwards', async () => {
      const response = await api(app)
        .get(`${reports}/sales`)
        .query({ from: '2026-09-30', to: '2026-09-01' })
        .set(headers)
        .expect(400);

      expect(response.body.message).toMatch(/after its end/i);
    });

    it('refuses a range longer than a year', async () => {
      const response = await api(app)
        .get(`${reports}/sales`)
        .query({ from: '2020-01-01', to: '2026-01-01' })
        .set(headers)
        .expect(400);

      expect(response.body.message).toMatch(/at most 366 days/i);
    });

    it('rejects an unknown query parameter rather than ignoring it', async () => {
      await api(app).get(`${reports}/sales`).query({ restaurantId: 1 }).set(headers).expect(400);
    });
  });

  describe('business days, not calendar days', () => {
    it('reports a bill settled after midnight under the day it was served', async () => {
      // A bill that belongs to yesterday's service, as the till would file it.
      const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
        .toISOString()
        .slice(0, 10);

      const dish = await createDish(headers, 'Late Night Biryani', 500);
      const order = (
        await api(app)
          .post('/restaurants/me/orders')
          .set(headers)
          .send({ items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      await api(app)
        .post(`/restaurants/me/orders/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      // Re-file it on yesterday's business day, the way a 01:30 settle would be.
      await dataSource.getRepository(Order).update({ id: order.id }, { businessDate: yesterday });

      const todayReport = await api(app).get(`${reports}/sales`).set(headers).expect(200);
      const yesterdayReport = await api(app)
        .get(`${reports}/sales`)
        .query({ from: yesterday, to: yesterday })
        .set(headers)
        .expect(200);

      expect(todayReport.body.net).toBe(1202);
      expect(yesterdayReport.body.net).toBe(500);
      expect(yesterdayReport.body.bills).toBe(1);
    });
  });
});
