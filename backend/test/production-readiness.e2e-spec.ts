import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TaxGroup, TaxKind, UserRole } from 'src/common/enums';
import { RestaurantUser } from 'src/modules/restaurants/entities/restaurant-user.entity';
import { User } from 'src/modules/users/entities/user.entity';
import {
  api,
  auth,
  createTestApp,
  isMysqlTestRun,
  registerOwner,
  type RegisteredOwner,
  type TestContext,
} from './test-app';

/**
 * The production readiness gate.
 *
 * Every other spec proves one module. This one proves the modules agree with
 * each other: that the figure a bill charges is the figure the day-end statement
 * files, that a regenerated QR code really stops the old one ordering, and that
 * the arithmetic a restaurant will be audited on is exact rather than
 * approximately right.
 *
 * The named scenarios are written as a restaurant would describe them, with the
 * expected rupee amounts spelled out, so a disagreement reads as "the bill should
 * have been 1,155" rather than as a failed assertion about a float.
 */
describe('Production readiness (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  let owner: RegisteredOwner;
  let headers: Record<string, string>;

  const taxes = '/restaurants/me/taxes';

  const addCharge = (h: Record<string, string>, body: Record<string, unknown>) =>
    api(app).post(taxes).set(h).send(body).expect(201);

  const gstFive = async (h: Record<string, string>) => {
    await addCharge(h, { name: 'CGST', kind: TaxKind.CGST, rate: 2.5, sortOrder: 2 });
    await addCharge(h, { name: 'SGST', kind: TaxKind.SGST, rate: 2.5, sortOrder: 3 });
  };

  const createDish = async (
    h: Record<string, string>,
    name: string,
    price: number,
    taxGroup?: TaxGroup,
  ) =>
    (
      await api(app)
        .post('/dishes')
        .set(h)
        .send({ name, price, ...(taxGroup ? { taxGroup } : {}) })
        .expect(201)
    ).body;

  const openBill = async (
    h: Record<string, string>,
    items: Array<{ dishId: number; quantity: number }>,
    tableId?: number,
  ) =>
    (
      await api(app)
        .post('/restaurants/me/orders')
        .set(h)
        .send({ ...(tableId ? { tableId } : {}), items })
        .expect(201)
    ).body;

  const settle = (h: Record<string, string>, orderId: number, paymentMethod = 'CASH') =>
    api(app)
      .post(`/restaurants/me/orders/${orderId}/settle`)
      .set(h)
      .send({ paymentMethod })
      .expect(200);

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
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    owner = await registerOwner(app);
    headers = auth(owner.accessToken);
  });

  /** Gate section 3: the four tax scenarios, with their stated amounts. */
  describe('tax scenarios', () => {
    it('Scenario A: 1,000 of food at 2.5 + 2.5 bills 1,050', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Thali', 1000);
      const bill = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      expect(bill.subtotal).toBe(1000);
      expect(bill.charges.find((c: { kind: string }) => c.kind === 'CGST').amount).toBe(25);
      expect(bill.charges.find((c: { kind: string }) => c.kind === 'SGST').amount).toBe(25);
      expect(bill.total).toBe(1050);
    });

    it('Scenario B: a 10% service charge is taxed with the food, billing 1,155', async () => {
      await addCharge(headers, {
        name: 'Service charge',
        kind: TaxKind.SERVICE_CHARGE,
        rate: 10,
        sortOrder: 1,
      });
      await gstFive(headers);

      const dish = await createDish(headers, 'Thali', 1000);
      const bill = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      expect(bill.subtotal).toBe(1000);
      expect(bill.serviceChargeAmount).toBe(100);
      // The taxable base is the food plus the service charge, and is visible.
      expect(bill.charges.find((c: { kind: string }) => c.kind === 'CGST').taxableAmount).toBe(1100);
      expect(bill.charges.find((c: { kind: string }) => c.kind === 'CGST').amount).toBe(27.5);
      expect(bill.charges.find((c: { kind: string }) => c.kind === 'SGST').amount).toBe(27.5);
      expect(bill.total).toBe(1155);
    });

    it('Scenario C: discount, then service charge, then GST - in that order', async () => {
      await addCharge(headers, {
        name: 'Service charge',
        kind: TaxKind.SERVICE_CHARGE,
        rate: 10,
        sortOrder: 1,
      });
      await gstFive(headers);

      const dish = await createDish(headers, 'Thali', 1000);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      const { body: bill } = await api(app)
        .post(`/restaurants/me/orders/${order.id}/discount`)
        .set(headers)
        .send({ type: 'AMOUNT', value: 100, reason: 'Readiness check' })
        .expect(200);

      // 1000 - 100 = 900, +10% service = 990, +5% GST = 1039.50.
      expect(bill.discountAmount).toBe(100);
      expect(bill.serviceChargeAmount).toBe(90);
      expect(bill.charges.find((c: { kind: string }) => c.kind === 'CGST').taxableAmount).toBe(990);
      expect(bill.taxAmount).toBe(49.5);
      expect(bill.total).toBe(1039.5);
    });

    it('Scenario D: each tax group is charged only what applies to it', async () => {
      await gstFive(headers);
      await addCharge(headers, {
        name: 'VAT',
        kind: TaxKind.VAT,
        rate: 20,
        appliesTo: TaxGroup.ALCOHOL,
        sortOrder: 4,
      });
      await addCharge(headers, {
        name: 'Packaged GST',
        kind: TaxKind.IGST,
        rate: 12,
        appliesTo: TaxGroup.PACKAGED,
        sortOrder: 5,
      });

      const food = await createDish(headers, 'Biryani', 1000);
      const beer = await createDish(headers, 'Lager', 500, TaxGroup.ALCOHOL);
      const crisps = await createDish(headers, 'Crisps', 100, TaxGroup.PACKAGED);
      const water = await createDish(headers, 'Tap water', 50, TaxGroup.EXEMPT);

      const bill = await openBill(headers, [
        { dishId: food.id, quantity: 1 },
        { dishId: beer.id, quantity: 1 },
        { dishId: crisps.id, quantity: 1 },
        { dishId: water.id, quantity: 1 },
      ]);

      const by = (kind: string) =>
        bill.charges.find((c: { kind: string }) => c.kind === kind) as {
          taxableAmount: number;
          amount: number;
        };

      expect(bill.subtotal).toBe(1650);
      expect(by('CGST')).toMatchObject({ taxableAmount: 1000, amount: 25 });
      expect(by('VAT')).toMatchObject({ taxableAmount: 500, amount: 100 });
      expect(by('IGST')).toMatchObject({ taxableAmount: 100, amount: 12 });
      // 1650 + 25 + 25 + 100 + 12, and the exempt line is taxed by nothing.
      expect(bill.total).toBe(1812);
    });
  });

  /** Gate section 4: money is exact, never approximately right. */
  describe('rounding', () => {
    it('keeps CGST and SGST equal on a base that does not halve cleanly', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Odd', 333.33);
      const bill = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      const [a, b] = bill.charges;
      expect(a.amount).toBe(b.amount);
      expect(bill.taxAmount).toBe(a.amount + b.amount);
      expect(bill.total).toBe(Number((bill.subtotal + bill.taxAmount).toFixed(2)));
    });

    it('does not drift across a hundred-line bill', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Chai', 33.33);
      const bill = await openBill(headers, [{ dishId: dish.id, quantity: 99 }]);

      expect(bill.subtotal).toBe(3299.67);
      expect(bill.total).toBe(Number((bill.subtotal + bill.taxAmount).toFixed(2)));
    });

    it('is deterministic: the same bill computes the same figures twice', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Odd', 333.33);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 3 }]);

      const first = (await api(app).get(`/restaurants/me/orders/${order.id}`).set(headers).expect(200))
        .body;
      // Any change re-runs the whole calculation; it must land on the same numbers.
      await api(app)
        .post(`/restaurants/me/orders/${order.id}/discount`)
        .set(headers)
        .send({ type: 'PERCENT', value: 10, reason: 'Readiness check' })
        .expect(200);
      await api(app)
        .delete(`/restaurants/me/orders/${order.id}/discount`)
        .set(headers)
        .expect(200);

      const second = (
        await api(app).get(`/restaurants/me/orders/${order.id}`).set(headers).expect(200)
      ).body;

      expect(second.total).toBe(first.total);
      expect(second.taxAmount).toBe(first.taxAmount);
    });

    it('stores money as fixed-scale decimals, never a float type', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Odd', 333.33);
      const bill = await openBill(headers, [{ dishId: dish.id, quantity: 7 }]);

      for (const value of [bill.subtotal, bill.taxAmount, bill.total]) {
        // Two decimal places exactly: a float artefact such as 2333.3100000000004
        // would fail here.
        expect(Number(value.toFixed(2))).toBe(value);
      }
    });
  });

  /** Gate section 5. */
  describe('TDS on a 10,000 bill', () => {
    it('leaves GST and the grand total alone, and reduces only what is collected', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Banquet', 10000);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      const before = (await api(app).get(`/restaurants/me/orders/${order.id}`).set(headers)).body;

      const { body: after } = await api(app)
        .post(`/restaurants/me/orders/${order.id}/tds`)
        .set(headers)
        .send({ rate: 2 })
        .expect(200);

      expect(after.taxAmount).toBe(before.taxAmount);
      expect(after.total).toBe(before.total);
      expect(after.total).toBe(10500);
      expect(after.tdsAmount).toBe(200);
      expect(after.amountPayable).toBe(10300);
    });

    it('appears on the bill and in the day-end statement', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Banquet', 10000);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      await api(app).post(`/restaurants/me/orders/${order.id}/tds`).set(headers).send({ rate: 2 }).expect(200);
      await settle(headers, order.id, 'CARD');

      const { body: bill } = await api(app)
        .get(`/restaurants/me/orders/${order.id}/bill`)
        .set(headers)
        .expect(200);
      expect(bill.tdsAmount).toBe(200);
      expect(bill.amountPayable).toBe(10300);

      const { body: day } = await api(app)
        .get('/restaurants/me/reports/day-end')
        .set(headers)
        .expect(200);
      expect(day.tdsWithheld).toBe(200);
      expect(day.collected).toBe(10300);
      // Reconciliation treats the payment line as what actually arrived.
      expect(day.payments).toEqual([{ method: 'CARD', bills: 1, total: 10300 }]);
    });
  });

  /** Gate section 18: the reports must agree with each other. */
  describe('report reconciliation', () => {
    it('day-end collected equals settled totals less TDS, and matches the other reports', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Dosa', 120);

      const methods = ['CASH', 'UPI', 'CARD', 'OTHER'];
      let expectedTotal = 0;
      let expectedTds = 0;

      for (const [index, method] of methods.entries()) {
        const order = await openBill(headers, [{ dishId: dish.id, quantity: index + 1 }]);

        if (method === 'CARD') {
          await api(app).post(`/restaurants/me/orders/${order.id}/tds`).set(headers).send({ rate: 2 }).expect(200);
        }

        const settled = (await settle(headers, order.id, method)).body;
        expectedTotal += settled.total;
        expectedTds += settled.tdsAmount;
      }

      const round = (value: number) => Number(value.toFixed(2));

      const { body: day } = await api(app).get('/restaurants/me/reports/day-end').set(headers).expect(200);
      const { body: sales } = await api(app).get('/restaurants/me/reports/sales').set(headers).expect(200);
      const { body: register } = await api(app).get('/restaurants/me/reports/orders').set(headers).expect(200);

      // The documented equation: collected = billed - TDS withheld.
      expect(round(day.total)).toBe(round(expectedTotal));
      expect(round(day.tdsWithheld)).toBe(round(expectedTds));
      expect(round(day.collected)).toBe(round(expectedTotal - expectedTds));

      // Day-end agrees with the sales summary on what was billed.
      expect(round(sales.net)).toBe(round(day.total));
      expect(sales.bills).toBe(day.bills);

      // And with the bill register, bill for bill.
      const settledRows = register.filter((row: { status: string }) => row.status === 'SETTLED');
      expect(settledRows).toHaveLength(day.bills);
      expect(round(settledRows.reduce((sum: number, row: { total: number }) => sum + row.total, 0))).toBe(
        round(day.total),
      );

      // Payments add up to what was collected, not to what was billed.
      expect(round(day.payments.reduce((sum: number, p: { total: number }) => sum + p.total, 0))).toBe(
        round(day.collected),
      );

      // Every tax line sums to the tax total.
      expect(round(day.taxes.reduce((sum: number, t: { amount: number }) => sum + t.amount, 0))).toBe(
        round(day.taxTotal),
      );
    });

    it('never counts an open or voided bill as takings', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Dosa', 100);

      const settledOrder = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);
      await settle(headers, settledOrder.id);

      await openBill(headers, [{ dishId: dish.id, quantity: 5 }]);

      const voided = await openBill(headers, [{ dishId: dish.id, quantity: 3 }]);
      await api(app)
        .post(`/restaurants/me/orders/${voided.id}/cancel`)
        .set(headers)
        .send({ reason: 'Guests left' })
        .expect(200);

      const { body: day } = await api(app).get('/restaurants/me/reports/day-end').set(headers).expect(200);

      expect(day.bills).toBe(1);
      expect(day.total).toBe(105);
      expect(day.openBills).toBe(1);
      expect(day.isClosed).toBe(false);
      expect(day.voidedBills).toBe(1);
      expect(day.voidedValue).toBe(300);

      // A voided bill still has to be findable, with its reason.
      const { body: adjustments } = await api(app)
        .get('/restaurants/me/reports/adjustments')
        .set(headers)
        .expect(200);
      expect(JSON.stringify(adjustments)).toMatch(/Guests left/);
    });
  });

  /** Gate section 11: a regenerated or deactivated table must stop taking orders. */
  describe('QR security', () => {
    const tokenOf = (menuUrl: string) => new URL(menuUrl).searchParams.get('table') ?? '';

    it('stops the old QR ordering once it is regenerated, and lets the new one through', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Dosa', 100);
      const { body: restaurant } = await api(app).get('/restaurants/me').set(headers).expect(200);
      const { body: table } = await api(app)
        .post('/restaurants/me/tables')
        .set(headers)
        .send({ name: 'QR-1' })
        .expect(201);

      const oldToken = tokenOf(table.menuUrl);
      const place = (token: string) =>
        api(app)
          .post(`/public/restaurants/${restaurant.slug}/orders?table=${encodeURIComponent(token)}`)
          .send({ items: [{ dishId: dish.id, quantity: 1 }] });

      await place(oldToken).expect(201);

      const { body: regenerated } = await api(app)
        .post(`/restaurants/me/tables/${table.id}/regenerate-qr`)
        .set(headers)
        .expect(200);
      const newToken = tokenOf(regenerated.menuUrl);

      expect(newToken).not.toBe(oldToken);
      // The printed card that was replaced must stop working immediately.
      await place(oldToken).expect(404);
      await place(newToken).expect(201);
    });

    it('refuses ordering at a deactivated table and allows it again once reactivated', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Dosa', 100);
      const { body: restaurant } = await api(app).get('/restaurants/me').set(headers).expect(200);
      const { body: table } = await api(app)
        .post('/restaurants/me/tables')
        .set(headers)
        .send({ name: 'QR-2' })
        .expect(201);
      const token = tokenOf(table.menuUrl);

      const place = () =>
        api(app)
          .post(`/public/restaurants/${restaurant.slug}/orders?table=${encodeURIComponent(token)}`)
          .send({ items: [{ dishId: dish.id, quantity: 1 }] });

      await place().expect(201);

      await api(app)
        .patch(`/restaurants/me/tables/${table.id}`)
        .set(headers)
        .send({ isActive: false })
        .expect(200);
      await place().expect(404);

      await api(app)
        .patch(`/restaurants/me/tables/${table.id}`)
        .set(headers)
        .send({ isActive: true })
        .expect(200);
      await place().expect(201);
    });
  });

  /** Gate section 8: the discount ceiling is enforced on the server. */
  describe('discount limits', () => {
    it('accepts 10, 25 and 50 percent but refuses 51', async () => {
      const dish = await createDish(headers, 'Thali', 1000);

      for (const value of [10, 25, 50]) {
        const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);
        await api(app)
          .post(`/restaurants/me/orders/${order.id}/discount`)
          .set(headers)
          .send({ type: 'PERCENT', value, reason: 'Readiness check' })
          .expect(200);
        await settle(headers, order.id);
      }

      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);
      await api(app)
        .post(`/restaurants/me/orders/${order.id}/discount`)
        .set(headers)
        .send({ type: 'PERCENT', value: 51, reason: 'Too much' })
        .expect(400);
    });

    it('always requires a reason', async () => {
      const dish = await createDish(headers, 'Thali', 1000);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      await api(app)
        .post(`/restaurants/me/orders/${order.id}/discount`)
        .set(headers)
        .send({ type: 'PERCENT', value: 10 })
        .expect(400);
    });

    it('refuses a waiter entirely', async () => {
      const dish = await createDish(headers, 'Thali', 1000);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);
      const waiter = auth(await memberWithRole(owner.restaurantId, UserRole.WAITER));

      await api(app)
        .post(`/restaurants/me/orders/${order.id}/discount`)
        .set(waiter)
        .send({ type: 'PERCENT', value: 10, reason: 'Nope' })
        .expect(403);
    });
  });

  /** Gate section 9: who may touch the tax profile. */
  describe('tax configuration is owner-only', () => {
    it('refuses a manager, a waiter and kitchen staff', async () => {
      for (const role of [UserRole.RESTAURANT_MANAGER, UserRole.WAITER, UserRole.KITCHEN_STAFF]) {
        const member = auth(await memberWithRole(owner.restaurantId, role));

        await api(app).get(taxes).set(member).expect(403);
        await api(app)
          .post(taxes)
          .set(member)
          .send({ name: 'CGST', kind: TaxKind.CGST, rate: 2.5 })
          .expect(403);
      }
    });
  });

  /** Gate section 14: settling records everything the day-end needs. */
  describe('settlement', () => {
    it('records each payment method with its amount and timestamp', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Dosa', 100);

      for (const method of ['CASH', 'UPI', 'CARD', 'OTHER']) {
        const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);
        const { body } = await settle(headers, order.id, method);

        expect(body.status).toBe('SETTLED');
        expect(body.paymentMethod).toBe(method);
        expect(body.settledAt).not.toBeNull();
        expect(body.orderNumber).toBeGreaterThan(0);
        expect(body.total).toBe(105);
      }

      const { body: day } = await api(app).get('/restaurants/me/reports/day-end').set(headers).expect(200);
      expect(day.payments.map((p: { method: string }) => p.method).sort()).toEqual([
        'CARD',
        'CASH',
        'OTHER',
        'UPI',
      ]);
    });

    it('refuses to settle twice', async () => {
      const dish = await createDish(headers, 'Dosa', 100);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      await settle(headers, order.id);
      await api(app)
        .post(`/restaurants/me/orders/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(400);
    });
  });

  /**
   * Gate section 13: order duplication.
   *
   * Recorded as the gate asks, with no frontend-only patch: these tests describe
   * what the system does today so the idempotency phase has a baseline to change.
   */
  describe('order duplication (baseline for the idempotency phase)', () => {
    it('a repeated diner submission creates a second set of lines, with no idempotency key yet', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Dosa', 100);
      const { body: restaurant } = await api(app).get('/restaurants/me').set(headers).expect(200);
      const { body: table } = await api(app)
        .post('/restaurants/me/tables')
        .set(headers)
        .send({ name: 'Dup-1' })
        .expect(201);
      const token = new URL(table.menuUrl).searchParams.get('table') ?? '';

      const submit = () =>
        api(app)
          .post(`/public/restaurants/${restaurant.slug}/orders?table=${encodeURIComponent(token)}`)
          .send({ items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201);

      await submit();
      await submit();

      const { body: open } = await api(app)
        .get('/restaurants/me/orders?status=OPEN')
        .set(headers)
        .expect(200);

      // One bill, which is the important half: a second submission joins the
      // table's existing bill rather than opening a rival one.
      expect(open).toHaveLength(1);

      const { body: bill } = await api(app)
        .get(`/restaurants/me/orders/${open[0].id}`)
        .set(headers)
        .expect(200);

      // Two lines, because nothing yet tells the server these were the same tap.
      // Documented, not asserted as correct - see the readiness report.
      expect(bill.items).toHaveLength(2);
      expect(bill.pendingApprovalCount).toBe(2);
    });

    it('settling the same bill twice cannot take the money twice', async () => {
      const dish = await createDish(headers, 'Dosa', 100);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      const [first, second] = await Promise.all([
        api(app)
          .post(`/restaurants/me/orders/${order.id}/settle`)
          .set(headers)
          .send({ paymentMethod: 'CASH' }),
        api(app)
          .post(`/restaurants/me/orders/${order.id}/settle`)
          .set(headers)
          .send({ paymentMethod: 'CASH' }),
      ]);

      // At most one caller may ever be told it settled the bill. Two successes
      // would mean two payment captures the day a provider is wired in.
      const successes = [first.status, second.status].filter((code) => code === 200);
      expect(successes.length).toBeLessThanOrEqual(1);

      const { body: bill } = await api(app)
        .get(`/restaurants/me/orders/${order.id}`)
        .set(headers)
        .expect(200);
      const { body: day } = await api(app).get('/restaurants/me/reports/day-end').set(headers).expect(200);

      if (isMysqlTestRun) {
        // MySQL lets both requests run, so the guard is what decides: one wins.
        expect(successes).toHaveLength(1);
        expect(bill.status).toBe('SETTLED');
        expect(day.bills).toBe(1);
        expect(day.total).toBe(bill.total);
      } else {
        // SQLite serialises writers and may fail both before either commits, so
        // the only thing this driver can prove is that nothing half-happened.
        expect(['OPEN', 'SETTLED']).toContain(bill.status);
        expect(day.bills).toBe(bill.status === 'SETTLED' ? 1 : 0);
      }
    });

    it('a void racing a settle cannot zero a bill that was just paid', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Dosa', 100);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      const [settled, voided] = await Promise.all([
        api(app)
          .post(`/restaurants/me/orders/${order.id}/settle`)
          .set(headers)
          .send({ paymentMethod: 'CASH' }),
        api(app)
          .post(`/restaurants/me/orders/${order.id}/cancel`)
          .set(headers)
          .send({ reason: 'Racing the till' }),
      ]);

      // Both winning would mean a bill that was paid and is also worth nothing.
      const successes = [settled.status, voided.status].filter((code) => code === 200);
      expect(successes.length).toBeLessThanOrEqual(1);

      const { body: bill } = await api(app)
        .get(`/restaurants/me/orders/${order.id}`)
        .set(headers)
        .expect(200);

      if (isMysqlTestRun) expect(['SETTLED', 'CANCELLED']).toContain(bill.status);
      else expect(['OPEN', 'SETTLED', 'CANCELLED']).toContain(bill.status);

      // Whatever state it reached, it is internally consistent: a settled bill
      // keeps its money and a voided one is zeroed.
      if (bill.status === 'SETTLED') expect(bill.total).toBe(105);
      if (bill.status === 'CANCELLED') expect(bill.total).toBe(0);
    });
  });

  /** Gate section 10, against the newest surfaces. */
  describe('multi-tenant isolation on the new endpoints', () => {
    it('keeps tax profiles, day-end figures and bills apart', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Dosa', 100);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);
      await settle(headers, order.id);

      const other = await registerOwner(app);
      const otherHeaders = auth(other.accessToken);

      const { body: theirTaxes } = await api(app).get(taxes).set(otherHeaders).expect(200);
      expect(theirTaxes.components).toEqual([]);

      const { body: theirDay } = await api(app)
        .get('/restaurants/me/reports/day-end')
        .set(otherHeaders)
        .expect(200);
      expect(theirDay.bills).toBe(0);
      expect(theirDay.total).toBe(0);

      // Another restaurant's bill is absent, not forbidden.
      await api(app).get(`/restaurants/me/orders/${order.id}`).set(otherHeaders).expect(404);
      await api(app)
        .post(`/restaurants/me/orders/${order.id}/tds`)
        .set(otherHeaders)
        .send({ rate: 2 })
        .expect(404);
    });
  });
});
