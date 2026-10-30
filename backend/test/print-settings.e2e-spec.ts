import { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import { DataSource } from 'typeorm';
import { UserRole } from 'src/common/enums';
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
 * The payment QR a restaurant prints on its bills.
 *
 * Two properties are worth a suite of their own, because both are about money
 * leaving a guest's phone:
 *
 *  - **who may change the code.** Anyone who can swap it can quietly redirect
 *    every payment a restaurant takes, so it is owner-only and the endpoint
 *    never accepts a URL - only a file it stores itself.
 *  - **which bills carry it.** A settled bill is a receipt, not a request.
 *    Printing "scan to pay" across something already paid is how a restaurant
 *    gets paid twice and has to refund one of them.
 */
describe('Printed bill settings (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  let owner: RegisteredOwner;
  let headers: Record<string, string>;

  const settings = '/restaurants/me/print-settings';
  const qr = '/restaurants/me/payment-qr';
  const logo = '/restaurants/me/logo';
  const orders = '/restaurants/me/orders';

  const unique = () => Math.random().toString(36).slice(2, 7);

  /** A real PNG, so the upload meets a decoder rather than a mocked one. */
  const pngBytes = (size = 64): Promise<Buffer> =>
    sharp({
      create: { width: size, height: size, channels: 3, background: '#000000' },
    })
      .png()
      .toBuffer();

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

  /** An open bill with one dish on it. */
  async function openBill(token = owner.accessToken) {
    const head = auth(token);
    const table = (
      await api(app).post('/restaurants/me/tables').set(head).send({ name: `T${unique()}` }).expect(201)
    ).body;
    const dish = (
      await api(app).post('/dishes').set(head).send({ name: `Dish ${unique()}`, price: 200 }).expect(201)
    ).body;

    return (
      await api(app)
        .post(orders)
        .set(head)
        .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(201)
    ).body;
  }

  const billOf = async (orderId: number, token = owner.accessToken) =>
    (await api(app).get(`${orders}/${orderId}/bill`).set(auth(token)).expect(200)).body;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;

    owner = await registerOwner(app, { restaurantName: 'QR House' });
    headers = auth(owner.accessToken);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('before anything is uploaded', () => {
    it('reports no code and no printing', async () => {
      const body = (await api(app).get(settings).set(headers).expect(200)).body;

      expect(body).toEqual({
        logoUrl: null,
        paymentQrUrl: null,
        paymentQrLabel: null,
        printPaymentQr: false,
      });
    });

    it('refuses to switch printing on, rather than silently printing nothing', async () => {
      await api(app).patch(settings).set(headers).send({ printPaymentQr: true }).expect(409);
    });

    it('leaves the bill without a QR', async () => {
      const bill = await billOf((await openBill()).id);

      expect(bill.paymentQrUrl).toBeNull();
      expect(bill.paymentQrLabel).toBeNull();
    });
  });

  describe('uploading the code', () => {
    it('refuses a file that is not an image, whatever it claims to be', async () => {
      await api(app)
        .post(qr)
        .set(headers)
        .attach('file', Buffer.from('<?php echo 1; ?>'), { filename: 'qr.png', contentType: 'image/png' })
        .expect(400);
    });

    it('stores it, and does not start printing on its own', async () => {
      const body = (
        await api(app)
          .post(qr)
          .set(headers)
          .attach('file', await pngBytes(), { filename: 'qr.png', contentType: 'image/png' })
          .expect(200)
      ).body;

      expect(body.paymentQrUrl).toEqual(expect.stringContaining('/uploads/payment-qr/'));
      // Re-encoded by us, whatever arrived: the stored bytes are never the
      // uploader's.
      expect(body.paymentQrUrl).toEqual(expect.stringMatching(/\.png$/));
      // Uploading is not consent to print - that is a separate, deliberate tick.
      expect(body.printPaymentQr).toBe(false);
    });

    it('keeps the file out of the menu photo folder', async () => {
      const body = (await api(app).get(settings).set(headers).expect(200)).body;

      expect(body.paymentQrUrl).not.toContain('/uploads/dishes/');
    });
  });

  describe('the logo printed on bills', () => {
    it('refuses a file that is not an image', async () => {
      await api(app)
        .post(logo)
        .set(headers)
        .attach('file', Buffer.from('not an image'), {
          filename: 'logo.png',
          contentType: 'image/png',
        })
        .expect(400);
    });

    it('stores it, re-encoded as a PNG of our own', async () => {
      const body = (
        await api(app)
          .post(logo)
          .set(headers)
          .attach('file', await pngBytes(120), { filename: 'logo.png', contentType: 'image/png' })
          .expect(200)
      ).body;

      expect(body.logoUrl).toEqual(expect.stringContaining('/uploads/logo/'));
      expect(body.logoUrl).toEqual(expect.stringMatching(/\.png$/));
    });

    it('keeps it out of the menu photo and payment folders', async () => {
      const body = (await api(app).get(settings).set(headers).expect(200)).body;

      expect(body.logoUrl).not.toContain('/uploads/dishes/');
      expect(body.logoUrl).not.toContain('/uploads/payment-qr/');
    });

    it('prints it on the bill', async () => {
      const bill = await billOf((await openBill()).id);

      expect(bill.logoUrl).toEqual(expect.stringContaining('/uploads/logo/'));
    });

    it('refuses a manager', async () => {
      const manager = await memberWithRole(owner.restaurantId, UserRole.RESTAURANT_MANAGER);

      await api(app)
        .post(logo)
        .set(auth(manager))
        .attach('file', await pngBytes(), { filename: 'logo.png', contentType: 'image/png' })
        .expect(403);
      await api(app).delete(logo).set(auth(manager)).expect(403);
    });

    it('can be removed, and the bill falls back to the name alone', async () => {
      const body = (await api(app).delete(logo).set(headers).expect(200)).body;

      expect(body.logoUrl).toBeNull();

      const bill = await billOf((await openBill()).id);

      expect(bill.logoUrl).toBeNull();
      // The name is not optional - it is what identifies the invoice.
      expect(bill.restaurantName).toBe('QR House');
    });
  });

  describe('switching printing on', () => {
    it('takes a caption and starts printing', async () => {
      const body = (
        await api(app)
          .patch(settings)
          .set(headers)
          .send({ printPaymentQr: true, paymentQrLabel: 'qrhouse@okaxis' })
          .expect(200)
      ).body;

      expect(body.printPaymentQr).toBe(true);
      expect(body.paymentQrLabel).toBe('qrhouse@okaxis');
    });

    it('puts the code on an open bill', async () => {
      const bill = await billOf((await openBill()).id);

      expect(bill.paymentQrUrl).toEqual(expect.stringContaining('/uploads/payment-qr/'));
      expect(bill.paymentQrLabel).toBe('qrhouse@okaxis');
    });

    it('takes it off again once the bill is settled', async () => {
      const order = await openBill();

      await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      const bill = await billOf(order.id);

      // A receipt, not a request. This is the line that stops a guest paying a
      // second time against a bill they have already settled.
      expect(bill.status).toBe('SETTLED');
      expect(bill.paymentQrUrl).toBeNull();
    });
  });

  describe('who may change it', () => {
    it('refuses a manager', async () => {
      const manager = await memberWithRole(owner.restaurantId, UserRole.RESTAURANT_MANAGER);

      await api(app)
        .post(qr)
        .set(auth(manager))
        .attach('file', await pngBytes(), { filename: 'qr.png', contentType: 'image/png' })
        .expect(403);
      await api(app).patch(settings).set(auth(manager)).send({ printPaymentQr: false }).expect(403);
      await api(app).delete(qr).set(auth(manager)).expect(403);
    });

    it('never shows one restaurant the code of another', async () => {
      const other = await registerOwner(app, { restaurantName: 'Other House' });

      const theirs = (await api(app).get(settings).set(auth(other.accessToken)).expect(200)).body;

      expect(theirs.paymentQrUrl).toBeNull();

      // And their bills carry their own nothing, not our code.
      const bill = await billOf((await openBill(other.accessToken)).id, other.accessToken);

      expect(bill.paymentQrUrl).toBeNull();
    });
  });

  describe('removing it', () => {
    it('clears the code and stops printing in one step', async () => {
      const body = (await api(app).delete(qr).set(headers).expect(200)).body;

      expect(body.paymentQrUrl).toBeNull();
      // Leaving `printPaymentQr` true with nothing to print would be a setting
      // that lies about what the next bill will look like.
      expect(body.printPaymentQr).toBe(false);
    });

    it('leaves bills without a QR again', async () => {
      const bill = await billOf((await openBill()).id);

      expect(bill.paymentQrUrl).toBeNull();
    });
  });
});
