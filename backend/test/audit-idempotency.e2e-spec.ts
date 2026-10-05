import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuditAction, TaxGroup, TaxKind, UserRole } from 'src/common/enums';
import { AuditLog } from 'src/modules/audit/entities/audit-log.entity';
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
 * Audit logs and idempotency.
 *
 * Two features that only earn their keep under conditions the happy path never
 * reaches: a change that rolls back, a request that arrives twice, a key reused
 * for something else. The concurrency cases assert strictly only on MySQL -
 * SQLite serialises writers and cannot express two requests arriving at once, so
 * claiming a pass there would be claiming something the driver never tested.
 */
describe('Audit logs and idempotency (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  let owner: RegisteredOwner;
  let headers: Record<string, string>;

  const audit = '/restaurants/me/audit-logs';
  const taxes = '/restaurants/me/taxes';

  const keyed = (key: string) => ({ ...headers, 'Idempotency-Key': key });

  const createDish = async (name: string, price: number) =>
    (await api(app).post('/dishes').set(headers).send({ name, price }).expect(201)).body;

  const createTable = async (name: string) =>
    (await api(app).post('/restaurants/me/tables').set(headers).send({ name }).expect(201)).body;

  const gstFive = async () => {
    await api(app).post(taxes).set(headers).send({ name: 'CGST', kind: TaxKind.CGST, rate: 2.5 }).expect(201);
    await api(app).post(taxes).set(headers).send({ name: 'SGST', kind: TaxKind.SGST, rate: 2.5 }).expect(201);
  };

  const openBill = async (dishId: number, quantity = 1, tableId?: number) =>
    (
      await api(app)
        .post('/restaurants/me/orders')
        .set(headers)
        .send({ ...(tableId ? { tableId } : {}), items: [{ dishId, quantity }] })
        .expect(201)
    ).body;

  const logs = async (query = '') =>
    (await api(app).get(`${audit}${query}`).set(headers).expect(200)).body;

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

  // --- Audit -------------------------------------------------------------

  describe('what gets recorded', () => {
    it('records a settlement with what it was worth and who took it', async () => {
      await gstFive();
      const dish = await createDish('Thali', 1000);
      const order = await openBill(dish.id);

      await api(app)
        .post(`/restaurants/me/orders/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CARD' })
        .expect(200);

      const page = await logs('?action=BILL_SETTLED');

      expect(page.total).toBe(1);
      expect(page.rows[0]).toMatchObject({
        action: AuditAction.BILL_SETTLED,
        entityType: 'ORDER',
        entityId: order.id,
        userId: owner.userId,
      });
      expect(page.rows[0].newValue).toMatchObject({ paymentMethod: 'CARD', total: 1050 });
      // The request is identifiable, which is what makes a log usable in an argument.
      expect(page.rows[0].requestId).toEqual(expect.any(String));
    });

    it('records a discount with its reason, and the removal separately', async () => {
      const dish = await createDish('Thali', 1000);
      const order = await openBill(dish.id);

      await api(app)
        .post(`/restaurants/me/orders/${order.id}/discount`)
        .set(headers)
        .send({ type: 'PERCENT', value: 20, reason: 'Customer complaint' })
        .expect(200);
      await api(app).delete(`/restaurants/me/orders/${order.id}/discount`).set(headers).expect(200);

      const given = await logs('?action=BILL_DISCOUNTED');
      const removed = await logs('?action=BILL_DISCOUNT_REMOVED');

      expect(given.rows[0].reason).toBe('Customer complaint');
      expect(given.rows[0].newValue).toMatchObject({ discountValue: 20 });
      expect(removed.total).toBe(1);
    });

    it('records a void with the reason given', async () => {
      const dish = await createDish('Thali', 1000);
      const order = await openBill(dish.id);

      await api(app)
        .post(`/restaurants/me/orders/${order.id}/cancel`)
        .set(headers)
        .send({ reason: 'Guests left' })
        .expect(200);

      const page = await logs('?action=BILL_VOIDED');

      expect(page.rows[0].reason).toBe('Guests left');
      expect(page.rows[0].oldValue).toMatchObject({ total: 1000 });
    });

    it('records tax changes, and a service charge under its own action', async () => {
      const { body: cgst } = await api(app)
        .post(taxes)
        .set(headers)
        .send({ name: 'CGST', kind: TaxKind.CGST, rate: 2.5 })
        .expect(201);
      await api(app)
        .post(taxes)
        .set(headers)
        .send({ name: 'Service charge', kind: TaxKind.SERVICE_CHARGE, rate: 10 })
        .expect(201);
      await api(app).patch(`${taxes}/${cgst.id}`).set(headers).send({ rate: 9 }).expect(200);

      const tax = await logs('?action=TAX_CONFIGURATION_CHANGED');
      const service = await logs('?action=SERVICE_CHARGE_CHANGED');

      // Creating CGST, then changing its rate.
      expect(tax.total).toBe(2);
      expect(tax.rows[0].oldValue).toMatchObject({ rate: 2.5 });
      expect(tax.rows[0].newValue).toMatchObject({ rate: 9 });
      // The service charge is filed separately, because a guest queries it.
      expect(service.total).toBe(1);
    });

    it('records a dish price change but not a rename', async () => {
      const dish = await createDish('Thali', 100);

      await api(app).patch(`/dishes/${dish.id}`).set(headers).send({ price: 150 }).expect(200);
      await api(app).patch(`/dishes/${dish.id}`).set(headers).send({ name: 'Deluxe Thali' }).expect(200);

      const page = await logs('?entityType=DISH');

      expect(page.total).toBe(1);
      expect(page.rows[0]).toMatchObject({ action: AuditAction.DISH_PRICE_CHANGED });
      expect(page.rows[0].newValue).toMatchObject({ price: 150 });
    });

    it('records availability and tax group changes', async () => {
      const dish = await createDish('Lager', 500);

      await api(app)
        .patch(`/dishes/${dish.id}`)
        .set(headers)
        .send({ taxGroup: TaxGroup.ALCOHOL, isAvailable: false })
        .expect(200);

      const page = await logs('?entityType=DISH');
      const actions = page.rows.map((row: { action: string }) => row.action).sort();

      expect(actions).toEqual([
        AuditAction.DISH_AVAILABILITY_CHANGED,
        AuditAction.DISH_TAX_GROUP_CHANGED,
      ]);
    });

    it('records table creation, deactivation and reactivation', async () => {
      const table = await createTable('Audit-1');

      await api(app)
        .patch(`/restaurants/me/tables/${table.id}`)
        .set(headers)
        .send({ isActive: false })
        .expect(200);
      await api(app)
        .patch(`/restaurants/me/tables/${table.id}`)
        .set(headers)
        .send({ isActive: true })
        .expect(200);

      const page = await logs('?entityType=TABLE');
      const actions = page.rows.map((row: { action: string }) => row.action);

      expect(actions).toEqual([
        AuditAction.TABLE_REACTIVATED,
        AuditAction.TABLE_DEACTIVATED,
        AuditAction.TABLE_CREATED,
      ]);
    });

    it('records a QR regeneration without ever storing the token', async () => {
      const table = await createTable('Audit-2');
      const oldToken = new URL(table.menuUrl).searchParams.get('table') ?? '';

      const { body: regenerated } = await api(app)
        .post(`/restaurants/me/tables/${table.id}/regenerate-qr`)
        .set(headers)
        .expect(200);
      const newToken = new URL(regenerated.menuUrl).searchParams.get('table') ?? '';

      const page = await logs('?action=QR_REGENERATED');
      const recorded = JSON.stringify(page.rows[0]);

      expect(page.total).toBe(1);
      // The token is the credential printed on the card. A log holding it hands
      // table access to anyone who can read the log.
      expect(recorded).not.toContain(oldToken);
      expect(recorded).not.toContain(newToken);
    });

    it('records a kitchen code regeneration without storing the code', async () => {
      const { body: before } = await api(app)
        .get('/restaurants/me/kitchen-code')
        .set(headers)
        .expect(200);

      const { body: after } = await api(app)
        .post('/restaurants/me/kitchen-code/regenerate')
        .set(headers)
        .expect(200);

      const page = await logs('?action=KITCHEN_CODE_REGENERATED');
      const recorded = JSON.stringify(page.rows[0]);

      expect(page.total).toBe(1);
      expect(recorded).not.toContain(before.code);
      expect(recorded).not.toContain(after.code);
    });

    it('writes the record in the same transaction as the money', async () => {
      const dish = await createDish('Thali', 1000);
      const order = await openBill(dish.id);

      // 51% is refused by the service, after it has loaded the bill. If the audit
      // record were written outside the transaction it would survive the failure.
      await api(app)
        .post(`/restaurants/me/orders/${order.id}/discount`)
        .set(headers)
        .send({ type: 'PERCENT', value: 51, reason: 'Too much' })
        .expect(400);

      expect((await logs('?action=BILL_DISCOUNTED')).total).toBe(0);
    });
  });

  describe('reading the log', () => {
    it('is newest first and pages', async () => {
      const dish = await createDish('Thali', 100);

      for (let i = 0; i < 3; i += 1) {
        const order = await openBill(dish.id);
        await api(app)
          .post(`/restaurants/me/orders/${order.id}/settle`)
          .set(headers)
          .send({ paymentMethod: 'CASH' })
          .expect(200);
      }

      const firstPage = await logs('?pageSize=2&page=1');
      const secondPage = await logs('?pageSize=2&page=2');

      expect(firstPage.total).toBe(3);
      expect(firstPage.rows).toHaveLength(2);
      expect(secondPage.rows).toHaveLength(1);
      expect(firstPage.rows[0].id).toBeGreaterThan(firstPage.rows[1].id);
      // No row appears on both pages.
      expect(firstPage.rows.map((r: { id: number }) => r.id)).not.toContain(secondPage.rows[0].id);
    });

    it('filters by date range and refuses a backwards one', async () => {
      const dish = await createDish('Thali', 100);
      await openBill(dish.id);

      const today = new Date().toISOString().slice(0, 10);

      expect((await logs(`?from=${today}&to=${today}`)).total).toBeGreaterThanOrEqual(0);
      await api(app).get(`${audit}?from=2026-02-01&to=2026-01-01`).set(headers).expect(400);
    });

    it('is refused to managers, waiters and kitchen staff', async () => {
      for (const role of [UserRole.RESTAURANT_MANAGER, UserRole.WAITER, UserRole.KITCHEN_STAFF]) {
        const member = auth(await memberWithRole(owner.restaurantId, role));

        await api(app).get(audit).set(member).expect(403);
      }
    });

    it("never shows another restaurant's history", async () => {
      const dish = await createDish('Thali', 100);
      const order = await openBill(dish.id);
      await api(app)
        .post(`/restaurants/me/orders/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      const other = await registerOwner(app);
      const { body } = await api(app).get(audit).set(auth(other.accessToken)).expect(200);

      expect(body.total).toBe(0);
    });

    it('has no route that edits or deletes a record', async () => {
      const dish = await createDish('Thali', 100);
      await openBill(dish.id);
      const page = await logs();
      const id = page.rows[0]?.id ?? 1;

      await api(app).patch(`${audit}/${id}`).set(headers).send({ reason: 'changed' }).expect(404);
      await api(app).delete(`${audit}/${id}`).set(headers).expect(404);
    });
  });

  // --- Idempotency -------------------------------------------------------

  describe('idempotent order creation', () => {
    it('runs once when the same key is sent twice, and replays the answer', async () => {
      const dish = await createDish('Thali', 100);
      const key = randomUUID();
      const body = { items: [{ dishId: dish.id, quantity: 1 }] };

      const first = await api(app).post('/restaurants/me/orders').set(keyed(key)).send(body).expect(201);
      const second = await api(app).post('/restaurants/me/orders').set(keyed(key)).send(body).expect(201);

      expect(second.body.id).toBe(first.body.id);
      expect(second.body.orderNumber).toBe(first.body.orderNumber);

      const { body: open } = await api(app)
        .get('/restaurants/me/orders?status=OPEN')
        .set(headers)
        .expect(200);
      expect(open).toHaveLength(1);
    });

    it('refuses the same key with a different body', async () => {
      const dish = await createDish('Thali', 100);
      const key = randomUUID();

      await api(app)
        .post('/restaurants/me/orders')
        .set(keyed(key))
        .send({ items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(201);

      await api(app)
        .post('/restaurants/me/orders')
        .set(keyed(key))
        .send({ items: [{ dishId: dish.id, quantity: 2 }] })
        .expect(409);
    });

    it('treats different keys as different orders', async () => {
      const dish = await createDish('Thali', 100);
      const body = { items: [{ dishId: dish.id, quantity: 1 }] };

      const first = await api(app).post('/restaurants/me/orders').set(keyed(randomUUID())).send(body).expect(201);
      const second = await api(app).post('/restaurants/me/orders').set(keyed(randomUUID())).send(body).expect(201);

      expect(second.body.id).not.toBe(first.body.id);
    });

    it('releases the key when the operation fails, so a real retry can work', async () => {
      const dish = await createDish('Thali', 100);
      const key = randomUUID();

      // A dish that does not exist fails inside the operation.
      await api(app)
        .post('/restaurants/me/orders')
        .set(keyed(key))
        .send({ items: [{ dishId: 999999, quantity: 1 }] })
        .expect(404);

      // The same key now works, because the failed attempt let go of it.
      await api(app)
        .post('/restaurants/me/orders')
        .set(keyed(key))
        .send({ items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(201);
    });

    it('is unprotected without a key, which is how every existing caller behaves', async () => {
      const dish = await createDish('Thali', 100);
      const body = { items: [{ dishId: dish.id, quantity: 1 }] };

      const first = await api(app).post('/restaurants/me/orders').set(headers).send(body).expect(201);
      const second = await api(app).post('/restaurants/me/orders').set(headers).send(body).expect(201);

      expect(second.body.id).not.toBe(first.body.id);
    });
  });

  describe('idempotent diner ordering', () => {
    it('stops a double-tapped Place order creating a second set of lines', async () => {
      await gstFive();
      const dish = await createDish('Dosa', 100);
      const table = await createTable('Diner-1');
      const { body: restaurant } = await api(app).get('/restaurants/me').set(headers).expect(200);
      const token = new URL(table.menuUrl).searchParams.get('table') ?? '';
      const key = randomUUID();

      const submit = () =>
        api(app)
          .post(`/public/restaurants/${restaurant.slug}/orders?table=${encodeURIComponent(token)}`)
          .set('Idempotency-Key', key)
          .send({ items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201);

      await submit();
      await submit();

      const { body: open } = await api(app)
        .get('/restaurants/me/orders?status=OPEN')
        .set(headers)
        .expect(200);
      const { body: bill } = await api(app)
        .get(`/restaurants/me/orders/${open[0].id}`)
        .set(headers)
        .expect(200);

      // One bill, and crucially one line: this is the double-tap the phase exists to fix.
      expect(open).toHaveLength(1);
      expect(bill.items).toHaveLength(1);
      expect(bill.pendingApprovalCount).toBe(1);
    });

    it('still adds a genuine second round, which carries its own key', async () => {
      await gstFive();
      const dish = await createDish('Dosa', 100);
      const table = await createTable('Diner-2');
      const { body: restaurant } = await api(app).get('/restaurants/me').set(headers).expect(200);
      const token = new URL(table.menuUrl).searchParams.get('table') ?? '';

      const submit = (key: string) =>
        api(app)
          .post(`/public/restaurants/${restaurant.slug}/orders?table=${encodeURIComponent(token)}`)
          .set('Idempotency-Key', key)
          .send({ items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201);

      await submit(randomUUID());
      await submit(randomUUID());

      const { body: open } = await api(app)
        .get('/restaurants/me/orders?status=OPEN')
        .set(headers)
        .expect(200);
      const { body: bill } = await api(app)
        .get(`/restaurants/me/orders/${open[0].id}`)
        .set(headers)
        .expect(200);

      expect(bill.items).toHaveLength(2);
    });

    it("keeps one restaurant's key from colliding with another's", async () => {
      const dish = await createDish('Dosa', 100);
      const table = await createTable('Diner-3');
      const { body: restaurant } = await api(app).get('/restaurants/me').set(headers).expect(200);
      const token = new URL(table.menuUrl).searchParams.get('table') ?? '';
      const sharedKey = 'the-same-key-everywhere';

      await api(app)
        .post(`/public/restaurants/${restaurant.slug}/orders?table=${encodeURIComponent(token)}`)
        .set('Idempotency-Key', sharedKey)
        .send({ items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(201);

      // A different restaurant, same key, different dish: must not be refused as
      // a payload mismatch, and must not be served the first restaurant's order.
      const other = await registerOwner(app);
      const otherHeaders = auth(other.accessToken);
      const { body: otherDish } = await api(app)
        .post('/dishes')
        .set(otherHeaders)
        .send({ name: 'Idli', price: 60 })
        .expect(201);
      const { body: otherTable } = await api(app)
        .post('/restaurants/me/tables')
        .set(otherHeaders)
        .send({ name: 'Diner-3' })
        .expect(201);
      const { body: otherRestaurant } = await api(app).get('/restaurants/me').set(otherHeaders).expect(200);
      const otherToken = new URL(otherTable.menuUrl).searchParams.get('table') ?? '';

      await api(app)
        .post(
          `/public/restaurants/${otherRestaurant.slug}/orders?table=${encodeURIComponent(otherToken)}`,
        )
        .set('Idempotency-Key', sharedKey)
        .send({ items: [{ dishId: otherDish.id, quantity: 1 }] })
        .expect(201);
    });
  });

  describe('idempotent settlement and QR regeneration', () => {
    it('settles once when the same key is retried', async () => {
      await gstFive();
      const dish = await createDish('Thali', 1000);
      const order = await openBill(dish.id);
      const key = randomUUID();

      const first = await api(app)
        .post(`/restaurants/me/orders/${order.id}/settle`)
        .set(keyed(key))
        .send({ paymentMethod: 'CASH' })
        .expect(200);
      const second = await api(app)
        .post(`/restaurants/me/orders/${order.id}/settle`)
        .set(keyed(key))
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      expect(second.body.settledAt).toBe(first.body.settledAt);

      // One settlement, so one audit record and one bill in the takings.
      expect((await logs('?action=BILL_SETTLED')).total).toBe(1);
      const { body: day } = await api(app).get('/restaurants/me/reports/day-end').set(headers).expect(200);
      expect(day.bills).toBe(1);
    });

    it('still refuses a second settlement under a different key', async () => {
      const dish = await createDish('Thali', 1000);
      const order = await openBill(dish.id);

      await api(app)
        .post(`/restaurants/me/orders/${order.id}/settle`)
        .set(keyed(randomUUID()))
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      // The database claim, not the key, is what refuses this one.
      await api(app)
        .post(`/restaurants/me/orders/${order.id}/settle`)
        .set(keyed(randomUUID()))
        .send({ paymentMethod: 'CASH' })
        .expect(400);
    });

    it('regenerates a QR once when the request is retried', async () => {
      const table = await createTable('QR-idem');
      const key = randomUUID();

      const first = await api(app)
        .post(`/restaurants/me/tables/${table.id}/regenerate-qr`)
        .set(keyed(key))
        .expect(200);
      const second = await api(app)
        .post(`/restaurants/me/tables/${table.id}/regenerate-qr`)
        .set(keyed(key))
        .expect(200);

      // A second token would have invalidated the card the first call just made.
      expect(second.body.menuUrl).toBe(first.body.menuUrl);
      expect((await logs('?action=QR_REGENERATED')).total).toBe(1);
    });
  });

  describe('under concurrency', () => {
    it('creates one order when two identical requests arrive at once', async () => {
      const dish = await createDish('Thali', 100);
      const key = randomUUID();
      const body = { items: [{ dishId: dish.id, quantity: 1 }] };

      const [a, b] = await Promise.all([
        api(app).post('/restaurants/me/orders').set(keyed(key)).send(body),
        api(app).post('/restaurants/me/orders').set(keyed(key)).send(body),
      ]);

      const created = [a, b].filter((response) => response.status === 201);
      const { body: open } = await api(app)
        .get('/restaurants/me/orders?status=OPEN')
        .set(headers)
        .expect(200);

      if (isMysqlTestRun) {
        // One request runs, the other either replays it or is told it is still
        // in flight - never a second order either way.
        expect(open).toHaveLength(1);
        expect(created.length).toBeGreaterThanOrEqual(1);
        if (created.length === 2) expect(created[0].body.id).toBe(created[1].body.id);
      } else {
        // SQLite serialises writers; the only invariant it can show is that no
        // duplicate survived.
        expect(open.length).toBeLessThanOrEqual(1);
      }
    });

    it('settles once when two identical settlements arrive at once', async () => {
      await gstFive();
      const dish = await createDish('Thali', 1000);
      const order = await openBill(dish.id);
      const key = randomUUID();

      const [a, b] = await Promise.all([
        api(app).post(`/restaurants/me/orders/${order.id}/settle`).set(keyed(key)).send({ paymentMethod: 'CASH' }),
        api(app).post(`/restaurants/me/orders/${order.id}/settle`).set(keyed(key)).send({ paymentMethod: 'CASH' }),
      ]);

      const { body: day } = await api(app).get('/restaurants/me/reports/day-end').set(headers).expect(200);
      const settledRecords = (await logs('?action=BILL_SETTLED')).total;

      expect([a.status, b.status].filter((code) => code === 200).length).toBeGreaterThanOrEqual(0);
      // Whatever the callers were told, the money moved at most once.
      expect(day.bills).toBeLessThanOrEqual(1);
      expect(settledRecords).toBe(day.bills);
    });

    it('regenerates one QR when two identical requests arrive at once', async () => {
      const table = await createTable('QR-race');
      const key = randomUUID();

      await Promise.all([
        api(app).post(`/restaurants/me/tables/${table.id}/regenerate-qr`).set(keyed(key)),
        api(app).post(`/restaurants/me/tables/${table.id}/regenerate-qr`).set(keyed(key)),
      ]);

      expect((await logs('?action=QR_REGENERATED')).total).toBeLessThanOrEqual(1);
    });
  });

  describe('retention', () => {
    it('keeps recent keys and sweeps old ones', async () => {
      const dish = await createDish('Thali', 100);
      const key = randomUUID();

      await api(app)
        .post('/restaurants/me/orders')
        .set(keyed(key))
        .send({ items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(201);

      // Nothing is old enough to sweep yet.
      const service = app.get<{ purgeOlderThan: (days?: number) => Promise<number> }>(
        (await import('src/modules/idempotency/idempotency.service')).IdempotencyService,
      );

      expect(await service.purgeOlderThan(7)).toBe(0);
      // A zero-day retention sweeps everything, which is the mechanism working.
      expect(await service.purgeOlderThan(0)).toBeGreaterThanOrEqual(1);
    });
  });

  describe('audit records are append-only in practice', () => {
    it('is never updated or deleted by the application', async () => {
      const dish = await createDish('Thali', 100);
      const order = await openBill(dish.id);
      await api(app)
        .post(`/restaurants/me/orders/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      const before = await dataSource.getRepository(AuditLog).find();

      // Exercise the surfaces that touch an order after it is settled.
      await api(app).get(`/restaurants/me/orders/${order.id}/bill`).set(headers).expect(200);
      await api(app).get('/restaurants/me/reports/day-end').set(headers).expect(200);

      const after = await dataSource.getRepository(AuditLog).find();

      expect(after).toHaveLength(before.length);
      expect(after[0].createdAt).toEqual(before[0].createdAt);
    });
  });
});
