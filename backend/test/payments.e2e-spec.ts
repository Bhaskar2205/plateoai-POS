import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  AuditAction,
  OrderStatus,
  PaymentProviderName,
  PaymentStatus,
  ReconciliationIssue,
  TaxKind,
  UserRole,
} from 'src/common/enums';
import { PaymentIntent } from 'src/modules/payments/entities/payment-intent.entity';
import { PaymentsService } from 'src/modules/payments/payments.service';
import { PaymentReconciliationService } from 'src/modules/payments/payment-reconciliation.service';
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
 * Provider-independent payment tests.
 *
 * **These are not Razorpay integration tests.** No Razorpay credentials exist in
 * this project, no sandbox call has been made, and no real Razorpay signature has
 * ever been verified. Everything below exercises Plateo's own payment domain -
 * the state machine, the amount check, idempotency, settlement and reconciliation
 * - by driving the service directly, which is exactly the part that must be
 * correct before any provider is wired to it.
 */
describe('Payment foundation (e2e, provider-independent)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;
  let payments: PaymentsService;
  let reconciliation: PaymentReconciliationService;

  let owner: RegisteredOwner;
  let headers: Record<string, string>;

  const base = '/restaurants/me/payments';

  const keyed = (key: string) => ({ ...headers, 'Idempotency-Key': key });

  /**
   * Configures 5% GST once per restaurant.
   *
   * Idempotent because a test may want two bills: asking for CGST 2.5% twice is
   * correctly refused by the duplicate-charge guard, which exists so a restaurant
   * cannot accidentally charge its guests twice.
   */
  const gstFive = async () => {
    const { body } = await api(app).get('/restaurants/me/taxes').set(headers).expect(200);
    if (body.components.length > 0) return;

    await api(app).post('/restaurants/me/taxes').set(headers).send({ name: 'CGST', kind: TaxKind.CGST, rate: 2.5 }).expect(201);
    await api(app).post('/restaurants/me/taxes').set(headers).send({ name: 'SGST', kind: TaxKind.SGST, rate: 2.5 }).expect(201);
  };

  const createDish = async (name: string, price: number) =>
    (await api(app).post('/dishes').set(headers).send({ name, price }).expect(201)).body;

  const openBill = async (dishId: number, quantity = 1) =>
    (
      await api(app)
        .post('/restaurants/me/orders')
        .set(headers)
        .send({ items: [{ dishId, quantity }] })
        .expect(201)
    ).body;

  /** A bill worth exactly 1,050.00 — 1,000 of food plus 5% GST. */
  const billWorth1050 = async () => {
    await gstFive();
    const dish = await createDish(`Thali ${randomUUID().slice(0, 6)}`, 1000);
    return openBill(dish.id);
  };

  const createIntent = async (orderId: number, key?: string) =>
    (
      await api(app)
        .post(`${base}/intents`)
        .set(key ? keyed(key) : headers)
        .send({ orderId, provider: PaymentProviderName.PLATEO_INTERNAL })
        .expect(201)
    ).body;

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
    payments = app.get(PaymentsService);
    reconciliation = app.get(PaymentReconciliationService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    owner = await registerOwner(app);
    headers = auth(owner.accessToken);
  });

  describe('creating a payment', () => {
    it('takes the amount from the bill, never from the request', async () => {
      const order = await billWorth1050();
      const intent = await createIntent(order.id);

      expect(intent.amountPaise).toBe('105000');
      expect(intent.amount).toBe('₹1,050.00');
      expect(intent.status).toBe(PaymentStatus.CREATED);
    });

    it('ignores an amount a caller tries to supply', async () => {
      const order = await billWorth1050();

      // The DTO forbids unknown properties, so an attempt to name the amount is
      // refused outright rather than quietly ignored.
      await api(app)
        .post(`${base}/intents`)
        .set(headers)
        .send({ orderId: order.id, provider: PaymentProviderName.PLATEO_INTERNAL, amountPaise: '1' })
        .expect(400);
    });

    it('refuses a bill that is already settled', async () => {
      const order = await billWorth1050();
      await api(app)
        .post(`/restaurants/me/orders/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      await api(app)
        .post(`${base}/intents`)
        .set(headers)
        .send({ orderId: order.id, provider: PaymentProviderName.PLATEO_INTERNAL })
        .expect(400);
    });

    it('refuses a provider with no credentials rather than using another', async () => {
      const order = await billWorth1050();

      // Razorpay has no keys in this project, so it must refuse — and must not
      // quietly fall back to the internal provider and mark the bill paid.
      const { body } = await api(app)
        .post(`${base}/intents`)
        .set(headers)
        .send({ orderId: order.id, provider: PaymentProviderName.RAZORPAY })
        .expect(400);

      expect(body.message).toMatch(/not configured/i);
    });

    it("answers 404 for another restaurant's bill", async () => {
      const order = await billWorth1050();
      const other = await registerOwner(app);

      await api(app)
        .post(`${base}/intents`)
        .set(auth(other.accessToken))
        .send({ orderId: order.id, provider: PaymentProviderName.PLATEO_INTERNAL })
        .expect(404);
    });

    it('hands back the attempt already in flight instead of opening a second', async () => {
      const order = await billWorth1050();

      const first = await createIntent(order.id);
      const second = await createIntent(order.id);

      // Two live attempts would let a guest pay twice.
      expect(second.id).toBe(first.id);
    });

    it('records the creation in the audit log', async () => {
      const order = await billWorth1050();
      await createIntent(order.id);

      const { body } = await api(app)
        .get('/restaurants/me/audit-logs?action=PAYMENT_INTENT_CREATED')
        .set(headers)
        .expect(200);

      expect(body.total).toBe(1);
      expect(body.rows[0].newValue).toMatchObject({ amount: '₹1,050.00' });
    });
  });

  describe('idempotency', () => {
    it('creates one payment when the same key is sent twice', async () => {
      const order = await billWorth1050();
      const key = randomUUID();

      const first = await createIntent(order.id, key);
      const second = await createIntent(order.id, key);

      expect(second.id).toBe(first.id);
    });

    it('refuses the same key with a different payload', async () => {
      const first = await billWorth1050();
      const second = await billWorth1050();
      const key = randomUUID();

      await createIntent(first.id, key);

      await api(app)
        .post(`${base}/intents`)
        .set(keyed(key))
        .send({ orderId: second.id, provider: PaymentProviderName.PLATEO_INTERNAL })
        .expect(409);
    });
  });

  describe('the state machine, through the service', () => {
    it('captures, and settles the bill exactly once', async () => {
      const order = await billWorth1050();
      const intent = await createIntent(order.id);

      await payments.markStatus(intent.id, PaymentStatus.PENDING);
      const result = await payments.markStatus(intent.id, PaymentStatus.CAPTURED, {
        providerPaymentId: `test_${randomUUID()}`,
        amountPaise: '105000',
      });

      expect(result.changed).toBe(true);
      expect(result.settledOrderId).toBe(order.id);

      const { body: bill } = await api(app)
        .get(`/restaurants/me/orders/${order.id}`)
        .set(headers)
        .expect(200);
      expect(bill.status).toBe(OrderStatus.SETTLED);

      const { body: day } = await api(app)
        .get('/restaurants/me/reports/day-end')
        .set(headers)
        .expect(200);
      expect(day.bills).toBe(1);
    });

    it('refuses a payment whose amount disagrees with the bill, and does not settle', async () => {
      const order = await billWorth1050();
      const intent = await createIntent(order.id);
      await payments.markStatus(intent.id, PaymentStatus.PENDING);

      await expect(
        payments.markStatus(intent.id, PaymentStatus.CAPTURED, { amountPaise: '100000' }),
      ).rejects.toThrow(/1,050\.00/);

      const { body: bill } = await api(app)
        .get(`/restaurants/me/orders/${order.id}`)
        .set(headers)
        .expect(200);

      // Still open: a mismatch must never close a bill.
      expect(bill.status).toBe(OrderStatus.OPEN);

      const stored = await dataSource.getRepository(PaymentIntent).findOne({ where: { id: intent.id } });
      // And the payment is not left looking captured.
      expect(stored?.status).toBe(PaymentStatus.PENDING);
    });

    it('treats a repeated capture as a no-op, with no second settlement or audit record', async () => {
      const order = await billWorth1050();
      const intent = await createIntent(order.id);
      await payments.markStatus(intent.id, PaymentStatus.PENDING);
      await payments.markStatus(intent.id, PaymentStatus.CAPTURED, { amountPaise: '105000' });

      const again = await payments.markStatus(intent.id, PaymentStatus.CAPTURED, {
        amountPaise: '105000',
      });

      expect(again.changed).toBe(false);
      expect(again.settledOrderId).toBeNull();

      const { body: captured } = await api(app)
        .get('/restaurants/me/audit-logs?action=PAYMENT_CAPTURED')
        .set(headers)
        .expect(200);
      expect(captured.total).toBe(1);

      const { body: day } = await api(app).get('/restaurants/me/reports/day-end').set(headers).expect(200);
      expect(day.bills).toBe(1);
    });

    it('refuses to capture a failed payment', async () => {
      const order = await billWorth1050();
      const intent = await createIntent(order.id);

      await payments.markStatus(intent.id, PaymentStatus.PENDING);
      await payments.markStatus(intent.id, PaymentStatus.FAILED, {
        failureReason: 'Card declined by issuing bank',
      });

      await expect(payments.markStatus(intent.id, PaymentStatus.CAPTURED)).rejects.toThrow(/final/i);
    });

    it('lets a guest retry on the same bill after a failure', async () => {
      const order = await billWorth1050();
      const first = await createIntent(order.id);

      await payments.markStatus(first.id, PaymentStatus.PENDING);
      await payments.markStatus(first.id, PaymentStatus.FAILED, { failureReason: 'Declined' });

      // The bill is unchanged, so a second attempt opens against the same order.
      const second = await createIntent(order.id);
      expect(second.id).not.toBe(first.id);
      expect(second.orderId).toBe(order.id);

      await payments.markStatus(second.id, PaymentStatus.PENDING);
      const captured = await payments.markStatus(second.id, PaymentStatus.CAPTURED, {
        amountPaise: '105000',
      });

      expect(captured.settledOrderId).toBe(order.id);
    });

    it('records a reconciliation exception when money lands on a closed bill', async () => {
      const order = await billWorth1050();
      const intent = await createIntent(order.id);
      await payments.markStatus(intent.id, PaymentStatus.PENDING);

      // The till takes cash before the online payment lands.
      await api(app)
        .post(`/restaurants/me/orders/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      const result = await payments.markStatus(intent.id, PaymentStatus.CAPTURED, {
        amountPaise: '105000',
      });

      // The money is captured either way; what must not happen is silence.
      expect(result.changed).toBe(true);
      expect(result.settledOrderId).toBeNull();

      const { body: exceptions } = await api(app).get(`${base}/exceptions`).set(headers).expect(200);
      expect(exceptions[0].issue).toBe(ReconciliationIssue.WEBHOOK_AFTER_UNEXPECTED_STATE);
    });
  });

  describe('reconciliation', () => {
    it('finds a captured payment whose bill is still open', async () => {
      const order = await billWorth1050();
      const intent = await createIntent(order.id);

      // Forced directly into the database, which is what a half-finished
      // transaction or a provider-side capture we never processed looks like.
      await dataSource
        .getRepository(PaymentIntent)
        .update({ id: intent.id }, { status: PaymentStatus.CAPTURED, capturedAt: new Date() });

      const result = await reconciliation.sweep(owner.restaurantId);

      expect(result.found.map((f) => f.issue)).toContain(
        ReconciliationIssue.PAYMENT_CAPTURED_BILL_OPEN,
      );
    });

    it('does not raise the same exception twice', async () => {
      const order = await billWorth1050();
      const intent = await createIntent(order.id);
      await dataSource
        .getRepository(PaymentIntent)
        .update({ id: intent.id }, { status: PaymentStatus.CAPTURED });

      await reconciliation.sweep(owner.restaurantId);
      const second = await reconciliation.sweep(owner.restaurantId);

      expect(second.found).toHaveLength(0);
    });

    it('repairs nothing', async () => {
      const order = await billWorth1050();
      const intent = await createIntent(order.id);
      await dataSource
        .getRepository(PaymentIntent)
        .update({ id: intent.id }, { status: PaymentStatus.CAPTURED });

      await reconciliation.sweep(owner.restaurantId);

      const { body: bill } = await api(app)
        .get(`/restaurants/me/orders/${order.id}`)
        .set(headers)
        .expect(200);

      // Still open. Reconciliation reports; a person decides.
      expect(bill.status).toBe(OrderStatus.OPEN);
    });

    it('can be marked as dealt with, and the record stays', async () => {
      const order = await billWorth1050();
      const intent = await createIntent(order.id);
      await dataSource
        .getRepository(PaymentIntent)
        .update({ id: intent.id }, { status: PaymentStatus.CAPTURED });
      await reconciliation.sweep(owner.restaurantId);

      const { body: open } = await api(app).get(`${base}/exceptions`).set(headers).expect(200);
      await api(app)
        .post(`${base}/exceptions/${open[0].id}/resolve`)
        .set(headers)
        .send({ note: 'Guest paid in cash; attempt abandoned.' })
        .expect(200);

      const { body: after } = await api(app).get(`${base}/exceptions`).set(headers).expect(200);
      expect(after).toHaveLength(0);
    });

    it('writes an audit record for every exception', async () => {
      const order = await billWorth1050();
      const intent = await createIntent(order.id);
      await dataSource
        .getRepository(PaymentIntent)
        .update({ id: intent.id }, { status: PaymentStatus.CAPTURED });
      await reconciliation.sweep(owner.restaurantId);

      const { body } = await api(app)
        .get('/restaurants/me/audit-logs?action=PAYMENT_RECONCILIATION_EXCEPTION')
        .set(headers)
        .expect(200);

      expect(body.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('provider settings', () => {
    it('reports Razorpay as not configured, never as connected', async () => {
      const { body } = await api(app).get(`${base}/settings`).set(headers).expect(200);
      const razorpay = body.providers.find(
        (p: { provider: string }) => p.provider === PaymentProviderName.RAZORPAY,
      );

      expect(razorpay.status).toBe('NOT_CONFIGURED');
      expect(razorpay.usable).toBe(false);
      expect(body.onlinePaymentsAvailable).toBe(false);
    });

    it('never returns a key or a secret, even an empty one', async () => {
      const { text } = await api(app).get(`${base}/settings`).set(headers).expect(200);

      expect(text.toLowerCase()).not.toMatch(/secret|key_id|keysecret|webhooksecret/);
    });
  });

  describe('who may see payments', () => {
    it('refuses waiters and kitchen staff', async () => {
      for (const role of [UserRole.WAITER, UserRole.KITCHEN_STAFF]) {
        const member = auth(await memberWithRole(owner.restaurantId, role));

        await api(app).get(base).set(member).expect(403);
        await api(app).get(`${base}/exceptions`).set(member).expect(403);
      }
    });

    it('allows a manager to see payments but not to configure providers', async () => {
      const manager = auth(await memberWithRole(owner.restaurantId, UserRole.RESTAURANT_MANAGER));

      await api(app).get(base).set(manager).expect(200);
      await api(app).get(`${base}/settings`).set(manager).expect(403);
    });

    it("never shows another restaurant's payments", async () => {
      const order = await billWorth1050();
      const intent = await createIntent(order.id);

      const other = await registerOwner(app);
      const otherHeaders = auth(other.accessToken);

      const { body: list } = await api(app).get(base).set(otherHeaders).expect(200);
      expect(list).toHaveLength(0);

      await api(app).get(`${base}/${intent.id}`).set(otherHeaders).expect(404);
    });
  });

  describe('refunds', () => {
    it('are explicitly not implemented rather than half-working', async () => {
      const order = await billWorth1050();
      const intent = await createIntent(order.id);

      const { body } = await api(app).post(`${base}/${intent.id}/refund`).set(headers).expect(400);

      expect(body.message).toMatch(/not implemented/i);
    });
  });

  describe('manual settlement is untouched', () => {
    it('still settles by cash with no payment record at all', async () => {
      const order = await billWorth1050();

      const { body: settled } = await api(app)
        .post(`/restaurants/me/orders/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      expect(settled.status).toBe(OrderStatus.SETTLED);
      expect(settled.paymentMethod).toBe('CASH');

      const { body: list } = await api(app).get(base).set(headers).expect(200);
      expect(list).toHaveLength(0);

      const { body: day } = await api(app).get('/restaurants/me/reports/day-end').set(headers).expect(200);
      expect(day.bills).toBe(1);
      expect(day.payments).toEqual([{ method: 'CASH', bills: 1, total: 1050 }]);
    });
  });

  describe('under concurrency', () => {
    it('creates one payment when two identical requests arrive at once', async () => {
      const order = await billWorth1050();
      const key = randomUUID();
      const body = { orderId: order.id, provider: PaymentProviderName.PLATEO_INTERNAL };

      const [a, b] = await Promise.all([
        api(app).post(`${base}/intents`).set(keyed(key)).send(body),
        api(app).post(`${base}/intents`).set(keyed(key)).send(body),
      ]);

      const intents = await dataSource
        .getRepository(PaymentIntent)
        .find({ where: { restaurantId: owner.restaurantId } });

      expect(intents).toHaveLength(1);

      if (isMysqlTestRun) {
        const created = [a, b].filter((r) => r.status === 201);
        expect(created.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('settles once when two captures race', async () => {
      const order = await billWorth1050();
      const intent = await createIntent(order.id);
      await payments.markStatus(intent.id, PaymentStatus.PENDING);

      const results = await Promise.allSettled([
        payments.markStatus(intent.id, PaymentStatus.CAPTURED, { amountPaise: '105000' }),
        payments.markStatus(intent.id, PaymentStatus.CAPTURED, { amountPaise: '105000' }),
      ]);

      const settled = results.filter(
        (r) => r.status === 'fulfilled' && r.value.settledOrderId !== null,
      );

      // At most one of them may settle the bill.
      expect(settled.length).toBeLessThanOrEqual(1);

      const { body: day } = await api(app).get('/restaurants/me/reports/day-end').set(headers).expect(200);
      expect(day.bills).toBeLessThanOrEqual(1);

      const { body: captured } = await api(app)
        .get('/restaurants/me/audit-logs?action=PAYMENT_CAPTURED')
        .set(headers)
        .expect(200);
      expect(captured.total).toBeLessThanOrEqual(1);
    });
  });
});
