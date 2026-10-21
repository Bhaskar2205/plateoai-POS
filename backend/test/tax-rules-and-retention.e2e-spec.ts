import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditAction, TaxGroup, TaxKind, UserRole } from 'src/common/enums';
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
 * Deciding what is taxed, getting the figures out, and erasing them.
 *
 * Three features that meet at the same place: the bill. A dish's tax group
 * decides what it is charged, the statement is how those charges leave the
 * building, and the deletion is what happens to them afterwards. Each has one
 * property worth more than the rest of its surface:
 *
 *  - a reclassification must never rewrite a bill a guest has already paid;
 *  - a month total must equal the sum of its days, or an accountant finds it
 *    before we do;
 *  - a deletion must take everything it said it would and leave the record that
 *    it happened.
 */
describe('Tax rules, statements and data retention (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  let owner: RegisteredOwner;
  let headers: Record<string, string>;

  const orders = '/restaurants/me/orders';
  const unique = () => Math.random().toString(36).slice(2, 7);

  const createTable = async (name: string, token = owner.accessToken) =>
    (await api(app).post('/restaurants/me/tables').set(auth(token)).send({ name }).expect(201)).body;

  const createDish = async (name: string, price: number, taxGroup?: TaxGroup) =>
    (
      await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name, price, ...(taxGroup ? { taxGroup } : {}) })
        .expect(201)
    ).body;

  const addComponent = async (name: string, kind: TaxKind, rate: number, appliesTo: TaxGroup) =>
    (
      await api(app)
        .post('/restaurants/me/taxes')
        .set(headers)
        .send({ name, kind, rate, appliesTo })
        .expect(201)
    ).body;

  /** A bill with one dish on it, settled. Returns the settled bill. */
  async function sell(dishId: number, quantity = 1, token = owner.accessToken) {
    const head = auth(token);
    const table = await createTable(`T${unique()}`, token);
    const order = (
      await api(app)
        .post(orders)
        .set(head)
        .send({ tableId: table.id, items: [{ dishId, quantity }] })
        .expect(201)
    ).body;

    await api(app)
      .post(`${orders}/${order.id}/settle`)
      .set(head)
      .send({ paymentMethod: 'CASH' })
      .expect(200);

    return (await api(app).get(`${orders}/${order.id}/bill`).set(head).expect(200)).body;
  }

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

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;

    owner = await registerOwner(app, { restaurantName: 'Rule House' });
    headers = auth(owner.accessToken);

    // A within-state GST profile on food only. Nothing applies to EXEMPT, which
    // is the whole point of the group.
    await dataSource.getRepository(Restaurant).update({ id: owner.restaurantId }, { taxRate: 0 });
    await addComponent('CGST', TaxKind.CGST, 2.5, TaxGroup.STANDARD);
    await addComponent('SGST', TaxKind.SGST, 2.5, TaxGroup.STANDARD);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('which items are taxed', () => {
    it('charges GST on an ordinary dish', async () => {
      const dish = await createDish(`Curry ${unique()}`, 200);
      const bill = await sell(dish.id);

      expect(bill.subtotal).toBe(200);
      expect(bill.taxAmount).toBe(10);
      expect(bill.total).toBe(210);
      expect(bill.charges.map((charge: { kind: string }) => charge.kind).sort()).toEqual([
        'CGST',
        'SGST',
      ]);
    });

    it('charges nothing on a dish put outside tax', async () => {
      const dish = await createDish(`Water ${unique()}`, 200, TaxGroup.EXEMPT);
      const bill = await sell(dish.id);

      // The reason the feature exists: same price, no tax, and no tax line on
      // the printed bill either.
      expect(bill.subtotal).toBe(200);
      expect(bill.taxAmount).toBe(0);
      expect(bill.total).toBe(200);
      expect(bill.charges).toEqual([]);
    });

    it('taxes only the taxed half of a mixed bill', async () => {
      // The realistic case, and the one most likely to be got wrong: a plate of
      // food and a sealed bottle on the same bill. GST is owed on the food and
      // not on the bottle, so the taxable value is less than the subtotal.
      const food = await createDish(`Mixed curry ${unique()}`, 400);
      const water = await createDish(`Mixed water ${unique()}`, 100, TaxGroup.EXEMPT);
      const table = await createTable(`Mix${unique()}`);

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({
            tableId: table.id,
            items: [
              { dishId: food.id, quantity: 1 },
              { dishId: water.id, quantity: 2 },
            ],
          })
          .expect(201)
      ).body;

      const bill = (await api(app).get(`${orders}/${order.id}/bill`).set(headers).expect(200)).body;

      expect(bill.subtotal).toBe(600);
      expect(bill.taxAmount).toBe(20);
      expect(bill.total).toBe(620);

      // Each component has to name what it was charged on, not the whole bill -
      // this is the figure that goes on a return.
      expect(bill.charges).toHaveLength(2);
      expect(bill.charges.map((charge: { taxableAmount: number }) => charge.taxableAmount)).toEqual([
        400, 400,
      ]);
    });

    it('moves a batch of dishes in one call', async () => {
      const a = await createDish(`Bottle ${unique()}`, 40);
      const b = await createDish(`Packet ${unique()}`, 60);

      const result = (
        await api(app)
          .patch('/dishes/tax-group')
          .set(headers)
          .send({ dishIds: [a.id, b.id], taxGroup: TaxGroup.EXEMPT })
          .expect(200)
      ).body;

      expect(result).toEqual({ updated: 2, unchanged: 0, notFound: 0 });

      const bill = await sell(a.id);
      expect(bill.taxAmount).toBe(0);
    });

    it('reports what it did rather than failing on a stale id', async () => {
      const dish = await createDish(`Stale ${unique()}`, 10, TaxGroup.EXEMPT);

      const result = (
        await api(app)
          .patch('/dishes/tax-group')
          .set(headers)
          .send({ dishIds: [dish.id, 9_999_999], taxGroup: TaxGroup.EXEMPT })
          .expect(200)
      ).body;

      // Already in that group, plus one id that is not ours. Neither is an error:
      // one dead id in a selection must not lose the rest of it.
      expect(result).toEqual({ updated: 0, unchanged: 1, notFound: 1 });
    });

    it('never reaches another restaurant’s menu', async () => {
      const other = await registerOwner(app, { restaurantName: 'Other Rule House' });
      const theirDish = (
        await api(app)
          .post('/dishes')
          .set(auth(other.accessToken))
          .send({ name: `Theirs ${unique()}`, price: 100 })
          .expect(201)
      ).body;

      const result = (
        await api(app)
          .patch('/dishes/tax-group')
          .set(headers)
          .send({ dishIds: [theirDish.id], taxGroup: TaxGroup.EXEMPT })
          .expect(200)
      ).body;

      expect(result.notFound).toBe(1);
      expect(result.updated).toBe(0);

      const theirs = (
        await api(app).get(`/dishes/${theirDish.id}`).set(auth(other.accessToken)).expect(200)
      ).body;
      expect(theirs.taxGroup).toBe(TaxGroup.STANDARD);
    });

    it('does not rewrite a bill that was already settled', async () => {
      const dish = await createDish(`Settled ${unique()}`, 200);
      const bill = await sell(dish.id);

      expect(bill.taxAmount).toBe(10);

      await api(app)
        .patch('/dishes/tax-group')
        .set(headers)
        .send({ dishIds: [dish.id], taxGroup: TaxGroup.EXEMPT })
        .expect(200);

      const again = (
        await api(app).get(`${orders}/${bill.orderId}/bill`).set(headers).expect(200)
      ).body;

      // What a guest paid is history. Only the next bill is charged the new way.
      expect(again.taxAmount).toBe(10);
      expect(again.total).toBe(210);
    });

    it('refuses a waiter', async () => {
      const waiter = await memberWithRole(owner.restaurantId, UserRole.WAITER);
      const dish = await createDish(`Guarded ${unique()}`, 100);

      await api(app)
        .patch('/dishes/tax-group')
        .set(auth(waiter))
        .send({ dishIds: [dish.id], taxGroup: TaxGroup.EXEMPT })
        .expect(403);
    });

    it('writes one audit row per dish that changed', async () => {
      const dish = await createDish(`Audited ${unique()}`, 100);

      await api(app)
        .patch('/dishes/tax-group')
        .set(headers)
        .send({ dishIds: [dish.id], taxGroup: TaxGroup.ALCOHOL })
        .expect(200);

      const logs = (
        await api(app)
          .get(`/restaurants/me/audit-logs?action=${AuditAction.DISH_TAX_GROUP_CHANGED}`)
          .set(headers)
          .expect(200)
      ).body;

      const rows = logs.rows;
      expect(rows.some((row: { entityId: number }) => row.entityId === dish.id)).toBe(true);
    });
  });

  describe('the month statement', () => {
    it('totals equal the sum of the days', async () => {
      const series = (
        await api(app)
          .get('/restaurants/me/reports/day-end/series?from=2000-01-01&to=2100-01-01')
          .set(headers)
          .expect(400)
      ).body;

      // Over a year is an export, not a report. Proves the guard before the maths.
      expect(series.message).toMatch(/at most/i);

      const today = new Date().toISOString().slice(0, 10);
      const real = (
        await api(app)
          .get(`/restaurants/me/reports/day-end/series?from=${today}&to=${today}`)
          .set(headers)
          .expect(200)
      ).body;

      const summed = real.days.reduce(
        (total: number, day: { collected: number }) => total + Math.round(day.collected * 100),
        0,
      );

      expect(summed).toBe(Math.round(real.totals.collected * 100));
      expect(real.totals.tradingDays).toBe(real.days.length);
    });

    it('agrees with the single-day statement it repeats', async () => {
      const today = new Date().toISOString().slice(0, 10);

      const day = (
        await api(app)
          .get(`/restaurants/me/reports/day-end?from=${today}&to=${today}`)
          .set(headers)
          .expect(200)
      ).body;
      const series = (
        await api(app)
          .get(`/restaurants/me/reports/day-end/series?from=${today}&to=${today}`)
          .set(headers)
          .expect(200)
      ).body;

      const row = series.days.find(
        (entry: { businessDate: string }) => entry.businessDate === today,
      );

      expect(row.bills).toBe(day.bills);
      expect(row.netSales).toBe(day.netSales);
      expect(row.collected).toBe(day.collected);
      // The breakdown is the part a return is filed from, so it has to match
      // line for line, not just in total.
      expect(row.taxes).toEqual(day.taxes);
    });

    it('leaves out days that never traded', async () => {
      const series = (
        await api(app)
          .get('/restaurants/me/reports/day-end/series?from=2019-01-01&to=2019-01-31')
          .set(headers)
          .expect(200)
      ).body;

      expect(series.days).toEqual([]);
      expect(series.totals.tradingDays).toBe(0);
      expect(series.totals.collected).toBe(0);
    });
  });

  describe('erasing trading history', () => {
    let victim: RegisteredOwner;
    let victimHeaders: Record<string, string>;
    let today: string;

    beforeAll(async () => {
      // Its own restaurant, because the test deletes everything in it.
      victim = await registerOwner(app, { restaurantName: 'Shredder Cafe' });
      victimHeaders = auth(victim.accessToken);
      today = new Date().toISOString().slice(0, 10);

      const dish = (
        await api(app)
          .post('/dishes')
          .set(victimHeaders)
          .send({ name: `Shred ${unique()}`, price: 150 })
          .expect(201)
      ).body;

      await sell(dish.id, 2, victim.accessToken);
      await sell(dish.id, 1, victim.accessToken);
    });

    it('says what it would destroy', async () => {
      const summary = (
        await api(app)
          .get(`/restaurants/me/data/summary?from=${today}&to=${today}`)
          .set(victimHeaders)
          .expect(200)
      ).body;

      expect(summary.settledBills).toBe(2);
      expect(summary.items).toBe(2);
      expect(summary.collected).toBe(450);
      expect(summary.canDelete).toBe(true);
    });

    it('refuses a name that is not the restaurant', async () => {
      await api(app)
        .delete('/restaurants/me/data')
        .set(victimHeaders)
        .send({ from: today, to: today, confirmName: 'Shredder Cafeteria' })
        .expect(400);
    });

    it('refuses while a bill in the range is still open', async () => {
      const table = await createTable(`Open${unique()}`, victim.accessToken);
      const dish = (
        await api(app)
          .post('/dishes')
          .set(victimHeaders)
          .send({ name: `Open ${unique()}`, price: 90 })
          .expect(201)
      ).body;
      const open = (
        await api(app)
          .post('/restaurants/me/orders')
          .set(victimHeaders)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      await api(app)
        .delete('/restaurants/me/data')
        .set(victimHeaders)
        .send({ from: today, to: today, confirmName: 'Shredder Cafe' })
        .expect(409);

      // Settle it so the rest of the suite can proceed.
      await api(app)
        .post(`/restaurants/me/orders/${open.id}/settle`)
        .set(victimHeaders)
        .send({ paymentMethod: 'CASH' })
        .expect(200);
    });

    it('refuses a manager', async () => {
      const manager = await memberWithRole(victim.restaurantId, UserRole.RESTAURANT_MANAGER);

      await api(app)
        .delete('/restaurants/me/data')
        .set(auth(manager))
        .send({ from: today, to: today, confirmName: 'Shredder Cafe' })
        .expect(403);
      await api(app)
        .get(`/restaurants/me/data/summary?from=${today}&to=${today}`)
        .set(auth(manager))
        .expect(403);
    });

    it('erases the range, and everything hanging off it', async () => {
      const before = (
        await api(app)
          .get(`/restaurants/me/data/summary?from=${today}&to=${today}`)
          .set(victimHeaders)
          .expect(200)
      ).body;

      const result = (
        await api(app)
          .delete('/restaurants/me/data')
          .set(victimHeaders)
          // Case and spacing forgiven; the words have to be right.
          .send({ from: today, to: today, confirmName: '  shredder cafe ' })
          .expect(200)
      ).body;

      expect(result.deletedBills).toBe(before.settledBills + before.voidedBills + before.ncBills);
      expect(result.deletedItems).toBe(before.items);

      const after = (
        await api(app)
          .get(`/restaurants/me/data/summary?from=${today}&to=${today}`)
          .set(victimHeaders)
          .expect(200)
      ).body;

      expect(after.settledBills).toBe(0);
      expect(after.items).toBe(0);

      // Gone from the reports too, not merely hidden from the summary.
      const series = (
        await api(app)
          .get(`/restaurants/me/reports/day-end/series?from=${today}&to=${today}`)
          .set(victimHeaders)
          .expect(200)
      ).body;
      expect(series.days).toEqual([]);

      const bills = (
        await api(app).get('/restaurants/me/orders').set(victimHeaders).expect(200)
      ).body;
      expect(bills).toEqual([]);
    });

    it('leaves the record that it happened', async () => {
      const logs = (
        await api(app)
          .get(`/restaurants/me/audit-logs?action=${AuditAction.TRADING_DATA_DELETED}`)
          .set(victimHeaders)
          .expect(200)
      ).body;

      const rows = logs.rows;
      expect(rows.length).toBeGreaterThan(0);

      // The point of keeping it: afterwards this is the only account of what was
      // there, so it has to carry the totals, not just the fact.
      expect(rows[0].oldValue).toMatchObject({ from: today, to: today });
      expect(rows[0].oldValue.collected).toBeGreaterThan(0);
    });

    it('did not touch anybody else', async () => {
      const mine = (await api(app).get('/restaurants/me/orders').set(headers).expect(200)).body;

      expect(mine.length).toBeGreaterThan(0);
    });
  });
});
