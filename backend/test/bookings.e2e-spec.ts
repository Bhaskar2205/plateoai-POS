import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DiscountType, TableBookingStatus, UserRole } from 'src/common/enums';
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
 * Table bookings, end to end.
 *
 * They arrive from the Plateo guest app, which is not connected yet - so these
 * tests are the only thing standing between the intake endpoint and the day
 * somebody points a phone at it. What they check hardest is the two places where
 * trusting the caller would cost real money: one restaurant reading another's
 * bookings, and a discount the till could never honour.
 */
describe('Table bookings (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  let owner: RegisteredOwner;
  let headers: Record<string, string>;
  let slug: string;
  let dish: { id: number; price: number };

  const bookings = '/restaurants/me/bookings';

  const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const requestBooking = (body: Record<string, unknown> = {}) =>
    api(app)
      .post(`/public/restaurants/${slug}/bookings`)
      .send({
        guestName: 'Ananya Rao',
        guestPhone: '+919876543210',
        partySize: 4,
        bookedFor: inAnHour(),
        ...body,
      });

  /** The newest live booking, which is the one a test just made. */
  const latestBooking = async () => {
    const { body } = await api(app).get(bookings).set(headers).expect(200);

    return body[body.length - 1];
  };

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
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    owner = await registerOwner(app, { restaurantName: 'Booking House' });
    headers = auth(owner.accessToken);
    slug = (await api(app).get('/restaurants/me').set(headers).expect(200)).body.slug;
    dish = (
      await api(app).post('/dishes').set(headers).send({ name: 'Thali', price: 250 }).expect(201)
    ).body;
  });

  describe('a guest asking for a table', () => {
    it('arrives as a request, not a reservation', async () => {
      const { body } = await requestBooking().expect(201);

      // A table is not held until a person says so. The guest is told that.
      expect(body).toEqual({
        reference: expect.any(Number),
        status: TableBookingStatus.REQUESTED,
        bookedFor: expect.any(String),
        partySize: 4,
        restaurantName: 'Booking House',
      });
    });

    it('tells the guest nothing about the restaurant beyond their own booking', async () => {
      const { body } = await requestBooking().expect(201);

      // No ids, no tables, no other bookings: the caller is a stranger.
      expect(Object.keys(body).sort()).toEqual([
        'bookedFor',
        'partySize',
        'reference',
        'restaurantName',
        'status',
      ]);
    });

    it('refuses a booking for a time that has already passed', async () => {
      await requestBooking({ bookedFor: new Date(Date.now() - 3_600_000).toISOString() }).expect(400);
    });

    it('refuses a party nobody could seat', async () => {
      await requestBooking({ partySize: 500 }).expect(400);
    });

    it('is not accepted for an unknown restaurant', async () => {
      await api(app)
        .post('/public/restaurants/no-such-restaurant/bookings')
        .send({
          guestName: 'A',
          guestPhone: '+910000000000',
          partySize: 2,
          bookedFor: inAnHour(),
        })
        .expect(404);
    });

    it('numbers bookings per restaurant per day, so staff can call one out', async () => {
      await requestBooking().expect(201);
      const second = await requestBooking().expect(201);

      expect(second.body.reference).toBe(1 + (await latestBooking()).referenceNumber - 1);
      expect(second.body.reference).toBeGreaterThan(0);
    });
  });

  describe('the restaurant answering a booking', () => {
    it('confirms, seats and closes out, recording who did each', async () => {
      await requestBooking().expect(201);
      const booking = await latestBooking();

      const confirmed = (
        await api(app).post(`${bookings}/${booking.id}/confirm`).set(headers).send({}).expect(201)
      ).body;
      expect(confirmed.status).toBe(TableBookingStatus.CONFIRMED);
      expect(confirmed.respondedAt).not.toBeNull();
      expect(confirmed.handledByUserId).toBe(owner.userId);

      const seated = (
        await api(app).post(`${bookings}/${booking.id}/seat`).set(headers).send({}).expect(201)
      ).body;
      expect(seated.status).toBe(TableBookingStatus.SEATED);
      expect(seated.seatedAt).not.toBeNull();

      const done = (
        await api(app).post(`${bookings}/${booking.id}/complete`).set(headers).send({}).expect(201)
      ).body;
      expect(done.status).toBe(TableBookingStatus.COMPLETED);
    });

    it('refuses a move the booking cannot make', async () => {
      await requestBooking().expect(201);
      const booking = await latestBooking();

      // Seating somebody whose booking nobody has confirmed yet.
      const refused = await api(app)
        .post(`${bookings}/${booking.id}/seat`)
        .set(headers)
        .send({})
        .expect(400);

      expect(refused.body.message).toMatch(/cannot become seated/i);
    });

    it('cannot reopen a booking that is over', async () => {
      await requestBooking().expect(201);
      const booking = await latestBooking();

      await api(app).post(`${bookings}/${booking.id}/decline`).set(headers).send({}).expect(201);
      await api(app).post(`${bookings}/${booking.id}/confirm`).set(headers).send({}).expect(400);
    });

    it('will not seat a booking on another restaurant table', async () => {
      const rival = await registerOwner(app, { restaurantName: 'Rival Diner' });
      const theirTable = (
        await api(app)
          .post('/restaurants/me/tables')
          .set(auth(rival.accessToken))
          .send({ name: 'Theirs' })
          .expect(201)
      ).body;

      await requestBooking().expect(201);
      const booking = await latestBooking();

      await api(app)
        .post(`${bookings}/${booking.id}/confirm`)
        .set(headers)
        .send({ tableId: theirTable.id })
        .expect(404);
    });

    it('never shows one restaurant another restaurant bookings', async () => {
      await requestBooking().expect(201);

      const rival = await registerOwner(app, { restaurantName: 'Rival Diner' });
      const { body } = await api(app).get(bookings).set(auth(rival.accessToken)).expect(200);

      expect(body).toEqual([]);
    });

    it('lets a waiter answer a booking, because saying yes is part of taking orders', async () => {
      const waiter = auth(await memberWithRole(owner.restaurantId, UserRole.WAITER));

      await requestBooking().expect(201);
      const booking = await latestBooking();

      await api(app).post(`${bookings}/${booking.id}/confirm`).set(waiter).send({}).expect(201);
    });
  });

  describe('a discount promised on a booking', () => {
    const discount = { type: DiscountType.PERCENT, value: 10, reason: 'Birthday party of eight' };

    it('arrives with the booking and is there for the restaurant to read', async () => {
      await requestBooking({ discount }).expect(201);

      const booking = await latestBooking();

      expect(booking).toMatchObject({
        discountType: DiscountType.PERCENT,
        discountValue: 10,
        discountReason: 'Birthday party of eight',
      });
    });

    it('carries no amount, because a booking has no bill to take it off', async () => {
      await requestBooking({ discount }).expect(201);

      // The amount is worked out on the order, once there is a subtotal. A number
      // here would be a guess, and staff would read it as a promise.
      expect(await latestBooking()).not.toHaveProperty('discountAmount');
    });

    it('is left alone when the restaurant confirms without mentioning it', async () => {
      await requestBooking({ discount }).expect(201);
      const booking = await latestBooking();

      await api(app).post(`${bookings}/${booking.id}/confirm`).set(headers).send({}).expect(201);

      expect(await latestBooking()).toMatchObject({ discountType: DiscountType.PERCENT, discountValue: 10 });
    });

    it('can be replaced by the restaurant when it confirms', async () => {
      await requestBooking({ discount }).expect(201);
      const booking = await latestBooking();

      await api(app)
        .post(`${bookings}/${booking.id}/confirm`)
        .set(headers)
        .send({ discount: { type: DiscountType.AMOUNT, value: 150, reason: 'Apology for the wait' } })
        .expect(201);

      expect(await latestBooking()).toMatchObject({
        discountType: DiscountType.AMOUNT,
        discountValue: 150,
        discountReason: 'Apology for the wait',
      });
    });

    it('can be taken back, which is the whole reason null is not the same as absent', async () => {
      await requestBooking({ discount }).expect(201);
      const booking = await latestBooking();

      await api(app)
        .post(`${bookings}/${booking.id}/confirm`)
        .set(headers)
        .send({ discount: null })
        .expect(201);

      expect(await latestBooking()).toMatchObject({
        discountType: null,
        discountValue: null,
        discountReason: null,
      });
    });

    it('refuses a percentage the till would never honour', async () => {
      // A bill caps any discount at half its subtotal, so 60% is a promise that
      // gets refused at the counter - in front of the guest.
      await requestBooking({ discount: { ...discount, value: 60 } }).expect(400);
    });

    it('refuses one with no reason given', async () => {
      await requestBooking({ discount: { type: DiscountType.PERCENT, value: 10 } }).expect(400);
    });

    it('refuses a type without a value, so the three can never disagree', async () => {
      await requestBooking({ discount: { type: DiscountType.PERCENT, reason: 'No value sent' } }).expect(400);
    });

    it('is absent on a booking that never had one', async () => {
      await requestBooking().expect(201);

      expect(await latestBooking()).toMatchObject({ discountType: null, discountValue: null });
    });
  });

});
