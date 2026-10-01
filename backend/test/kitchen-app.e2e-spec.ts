import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { KotStatus, OrderItemStatus, RestaurantStatus, UserRole } from 'src/common/enums';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantUser } from 'src/modules/restaurants/entities/restaurant-user.entity';
import { KITCHEN_CODE_PATTERN } from 'src/modules/restaurants/kitchen-code';
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
 * The standalone kitchen screen.
 *
 * A kitchen signs in with a code rather than an account, so the tests cover both
 * halves of that bargain: the code has to be easy and the screen has to be
 * boxed in - it may work tickets and see nothing else. The rest covers what a
 * chef actually needs on the board: which table, what was asked for, what goes
 * into it, and a second round arriving at a table already being cooked for.
 */
describe('Kitchen app (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  let owner: RegisteredOwner;
  let headers: Record<string, string>;
  let code: string;
  let kitchen: Record<string, string>;

  let table: { id: number; name: string };
  let paneer: { id: number };
  let naan: { id: number };

  const kitchenApi = '/restaurants/me/kitchen';

  const createDish = async (name: string, price: number, ingredients?: Array<{ ingredientId: number; quantity: number; unit: string }>) =>
    (
      await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name, price, ...(ingredients ? { ingredients } : {}) })
        .expect(201)
    ).body;

  /**
   * Opens a bill at the table and sends it to the kitchen.
   *
   * A table holds one open bill at a time, so anything a previous test left
   * running is settled first - which is what a restaurant would do anyway.
   */
  async function sendToKitchen(items: Array<{ dishId: number; quantity: number; note?: string }>) {
    const running = (
      await api(app).get(`/restaurants/me/floor/${table.id}/order`).set(headers).expect(200)
    ).body;

    if (running?.id) {
      await api(app)
        .post(`/restaurants/me/orders/${running.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);
    }

    const order = (
      await api(app)
        .post('/restaurants/me/orders')
        .set(headers)
        .send({ tableId: table.id, items })
        .expect(201)
    ).body;

    await api(app).post(`/restaurants/me/orders/${order.id}/kot`).set(headers).expect(201);

    return order;
  }

  const kitchenTickets = async (h = kitchen) =>
    (await api(app).get(`${kitchenApi}/tickets`).set(h).expect(200)).body;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;

    owner = await registerOwner(app, { restaurantName: 'Kitchen Screen Cafe' });
    headers = auth(owner.accessToken);

    const milk = (
      await api(app)
        .post('/ingredients')
        .set(headers)
        .send({ name: 'Paneer', allergenInfo: 'Contains milk' })
        .expect(201)
    ).body;
    const nuts = (
      await api(app)
        .post('/ingredients')
        .set(headers)
        .send({ name: 'Cashew', allergenInfo: 'Contains tree nuts' })
        .expect(201)
    ).body;
    const chilli = (
      await api(app).post('/ingredients').set(headers).send({ name: 'Green chilli' }).expect(201)
    ).body;

    paneer = await createDish('Paneer Tikka', 320, [
      { ingredientId: milk.id, quantity: 180, unit: 'g' },
      { ingredientId: nuts.id, quantity: 25, unit: 'g' },
      { ingredientId: chilli.id, quantity: 4, unit: 'g' },
    ]);
    naan = await createDish('Butter Naan', 60);

    table = (
      await api(app).post('/restaurants/me/tables').set(headers).send({ name: 'T-7' }).expect(201)
    ).body;

    code = (await api(app).get('/restaurants/me/kitchen-code').set(headers).expect(200)).body.code;
    kitchen = auth(
      (await api(app).post('/auth/kitchen').send({ code }).expect(200)).body.accessToken,
    );
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('the kitchen code', () => {
    it('is generated for every restaurant, in a form a cook can type', async () => {
      const { body } = await api(app).get('/restaurants/me/kitchen-code').set(headers).expect(200);

      expect(body.code).toMatch(KITCHEN_CODE_PATTERN);
      expect(body.display).toBe(`${body.code.slice(0, 3)}-${body.code.slice(3)}`);
      // No characters that are misread off a sticker.
      expect(body.code).not.toMatch(/[O0I1LB8SZ]/);
    });

    it('is never included in an ordinary restaurant response', async () => {
      const profile = await api(app).get('/restaurants/me').set(headers).expect(200);

      expect(JSON.stringify(profile.body)).not.toContain(code);
      expect(profile.body.kitchenCode).toBeUndefined();
    });

    it('is owner-only to read', async () => {
      const member = await registerOwner(app);
      await dataSource
        .getRepository(User)
        .update({ id: member.userId }, { role: UserRole.RESTAURANT_MANAGER });
      await dataSource
        .getRepository(RestaurantUser)
        .save({ userId: member.userId, restaurantId: owner.restaurantId });

      const manager = (
        await api(app)
          .post('/auth/login')
          .send({ email: member.email, password: member.password, restaurantId: owner.restaurantId })
          .expect(200)
      ).body.accessToken;

      await api(app).get('/restaurants/me/kitchen-code').set(auth(manager)).expect(403);
      await api(app).get('/restaurants/me/kitchen-code').expect(401);
    });

    it('signs a screen in however the cook types it', async () => {
      for (const typed of [code, code.toLowerCase(), ` ${code} `, `${code.slice(0, 3)}-${code.slice(3)}`]) {
        const { body } = await api(app).post('/auth/kitchen').send({ code: typed }).expect(200);

        expect(body.accessToken).toEqual(expect.any(String));
        expect(body.restaurantName).toBe('Kitchen Screen Cafe');
      }
    });

    it('refuses an unknown code with nothing that identifies a restaurant', async () => {
      const response = await api(app).post('/auth/kitchen').send({ code: 'K7F2QX' });

      expect([401, 429]).toContain(response.status);
      if (response.status === 401) {
        expect(response.body.message).toBe('That kitchen code was not recognised.');
      }
    });

    it('rejects a malformed code before it reaches the database', async () => {
      for (const bad of ['', 'ABC', 'ABCDEFGH', 'K7F2Q!', 'K7F2Q0']) {
        const response = await api(app).post('/auth/kitchen').send({ code: bad });
        expect([400, 429]).toContain(response.status);
      }
    });
  });

  describe('what a kitchen screen may reach', () => {
    it('works the kitchen board', async () => {
      await api(app).get(`${kitchenApi}/tickets`).set(kitchen).expect(200);
    });

    it('cannot see bills, the floor, reports, the menu or the takings', async () => {
      for (const path of [
        '/restaurants/me/orders',
        '/restaurants/me/floor',
        '/restaurants/me/reports/sales',
        '/restaurants/me/tables',
        '/restaurants/me/kitchen-code',
      ]) {
        await api(app).get(path).set(kitchen).expect(403);
      }

      await api(app).get('/dishes').set(kitchen).expect(403);
    });

    it('cannot change the menu or settle anything', async () => {
      await api(app)
        .post('/dishes')
        .set(kitchen)
        .send({ name: 'Kitchen Cannot Add This', price: 10 })
        .expect(403);

      const order = await sendToKitchen([{ dishId: naan.id, quantity: 1 }]);

      await api(app)
        .post(`/restaurants/me/orders/${order.id}/settle`)
        .set(kitchen)
        .send({ paymentMethod: 'CASH' })
        .expect(403);
    });

    it('is turned away from routes that were never opened to it', async () => {
      // /auth/me carries no @Roles at all, so it would be open to any signed-in
      // caller. A kitchen screen is refused anyway: it may only reach the board.
      const response = await api(app).get('/auth/me').set(kitchen).expect(403);

      expect(response.body.message).toMatch(/kitchen screen can only use the kitchen board/i);
    });

    it('stops working the moment the code is regenerated', async () => {
      const spare = await registerOwner(app, { restaurantName: 'Regenerating Kitchen' });
      const spareHeaders = auth(spare.accessToken);

      const first = (
        await api(app).get('/restaurants/me/kitchen-code').set(spareHeaders).expect(200)
      ).body.code;

      await api(app).post('/auth/kitchen').send({ code: first }).expect(200);

      const second = (
        await api(app)
          .post('/restaurants/me/kitchen-code/regenerate')
          .set(spareHeaders)
          .expect(200)
      ).body.code;

      expect(second).not.toBe(first);

      const refused = await api(app).post('/auth/kitchen').send({ code: first });
      expect([401, 429]).toContain(refused.status);

      await api(app).post('/auth/kitchen').send({ code: second }).expect(200);
    });

    it('signs out screens that were already open on the old code', async () => {
      const spare = await registerOwner(app, { restaurantName: 'Rotating Kitchen' });
      const spareHeaders = auth(spare.accessToken);

      const first = (
        await api(app).get('/restaurants/me/kitchen-code').set(spareHeaders).expect(200)
      ).body.code;

      const screen = auth(
        (await api(app).post('/auth/kitchen').send({ code: first }).expect(200)).body.accessToken,
      );

      // Working fine, right up until the code is replaced.
      await api(app).get(`${kitchenApi}/tickets`).set(screen).expect(200);

      await api(app).post('/restaurants/me/kitchen-code/regenerate').set(spareHeaders).expect(200);

      const response = await api(app).get(`${kitchenApi}/tickets`).set(screen).expect(401);
      expect(response.body.message).toMatch(/enter the new kitchen code/i);
    });

    it('is refused for a suspended restaurant', async () => {
      const suspended = await registerOwner(app, { restaurantName: 'Suspended Kitchen' });
      const suspendedCode = (
        await api(app).get('/restaurants/me/kitchen-code').set(auth(suspended.accessToken)).expect(200)
      ).body.code;

      const screen = auth(
        (await api(app).post('/auth/kitchen').send({ code: suspendedCode }).expect(200)).body
          .accessToken,
      );

      await dataSource
        .getRepository(Restaurant)
        .update({ id: suspended.restaurantId }, { status: RestaurantStatus.INACTIVE });

      // Both the existing screen and a fresh sign-in stop immediately.
      await api(app).get(`${kitchenApi}/tickets`).set(screen).expect(403);
      const response = await api(app).post('/auth/kitchen').send({ code: suspendedCode });
      expect([401, 429]).toContain(response.status);
    });
  });

  describe('what the chef sees on a ticket', () => {
    it('shows the table, the quantities, the instruction and what goes into the dish', async () => {
      await sendToKitchen([
        { dishId: paneer.id, quantity: 2, note: 'Jain, no onion no garlic' },
        { dishId: naan.id, quantity: 3 },
      ]);

      const tickets = await kitchenTickets();
      const ticket = tickets[tickets.length - 1];

      expect(ticket.tableName).toBe('T-7');
      expect(ticket.orderNumber).toBeGreaterThan(0);
      expect(ticket.waitingMinutes).toBeGreaterThanOrEqual(0);

      const tikka = ticket.items.find((item: { name: string }) => item.name === 'Paneer Tikka');
      expect(tikka).toMatchObject({ quantity: 2, note: 'Jain, no onion no garlic' });
      expect(tikka.ingredients).toEqual(['Paneer', 'Cashew', 'Green chilli']);
      expect(tikka.allergens).toEqual(['Contains milk', 'Contains tree nuts']);

      // A dish with no recipe says so with an empty list, not a missing field.
      const bread = ticket.items.find((item: { name: string }) => item.name === 'Butter Naan');
      expect(bread).toMatchObject({ quantity: 3, ingredients: [], allergens: [] });
    });

    it('never shows the kitchen a price', async () => {
      const tickets = await kitchenTickets();

      expect(JSON.stringify(tickets)).not.toMatch(/unitPrice|lineTotal|subtotal|"total"|discount/);
    });

    it('lists the oldest ticket first, so the queue reads top to bottom', async () => {
      const tickets = await kitchenTickets();
      const times = tickets.map((ticket: { createdAt: string }) => Date.parse(ticket.createdAt));

      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });
  });

  describe('a second round at a table already being cooked for', () => {
    it('arrives as its own ticket carrying only the new items', async () => {
      const order = await sendToKitchen([{ dishId: paneer.id, quantity: 1 }]);
      const before = await kitchenTickets();
      const firstTicket = before[before.length - 1];

      // A few minutes later the table asks for bread.
      await api(app)
        .post(`/restaurants/me/orders/${order.id}/items`)
        .set(headers)
        .send({ items: [{ dishId: naan.id, quantity: 2, note: 'Extra butter' }] })
        .expect(200);

      // Nothing reaches the kitchen until it is sent.
      const between = await kitchenTickets();
      expect(between.filter((t: { orderId: number }) => t.orderId === order.id)).toHaveLength(1);

      await api(app).post(`/restaurants/me/orders/${order.id}/kot`).set(headers).expect(201);

      const after = await kitchenTickets();
      const forOrder = after.filter((ticket: { orderId: number }) => ticket.orderId === order.id);

      expect(forOrder).toHaveLength(2);

      const second = forOrder[1];
      expect(second.ticketNumber).toBe(firstTicket.ticketNumber + 1);
      expect(second.items).toHaveLength(1);
      expect(second.items[0]).toMatchObject({ name: 'Butter Naan', quantity: 2, note: 'Extra butter' });
      // The first ticket is untouched: the cook is not asked to re-read it.
      expect(after.find((t: { id: number }) => t.id === firstTicket.id).items).toHaveLength(1);
      expect(second.tableName).toBe('T-7');
    });
  });

  describe('serving, and what the admin sees', () => {
    it('moves the ticket through, and the bill shows the food as served', async () => {
      const order = await sendToKitchen([{ dishId: paneer.id, quantity: 1 }]);
      const tickets = await kitchenTickets();
      const ticket = tickets.find((t: { orderId: number }) => t.orderId === order.id);

      await api(app)
        .patch(`${kitchenApi}/tickets/${ticket.id}`)
        .set(kitchen)
        .send({ status: KotStatus.PREPARING })
        .expect(200);

      let bill = (
        await api(app).get(`/restaurants/me/orders/${order.id}`).set(headers).expect(200)
      ).body;
      expect(bill.items[0].status).toBe(OrderItemStatus.PREPARING);
      expect(bill.kotTickets[0].status).toBe(KotStatus.PREPARING);

      await api(app)
        .patch(`${kitchenApi}/tickets/${ticket.id}`)
        .set(kitchen)
        .send({ status: KotStatus.READY })
        .expect(200);

      bill = (await api(app).get(`/restaurants/me/orders/${order.id}`).set(headers).expect(200)).body;
      expect(bill.items[0].status).toBe(OrderItemStatus.READY);

      // The floor tells the waiter the food is ready to run.
      const floor = (await api(app).get('/restaurants/me/floor').set(headers).expect(200)).body;
      expect(floor.find((row: { tableId: number }) => row.tableId === table.id).kitchenState).toBe(
        'READY',
      );

      await api(app)
        .patch(`${kitchenApi}/tickets/${ticket.id}`)
        .set(kitchen)
        .send({ status: KotStatus.DONE })
        .expect(200);

      bill = (await api(app).get(`/restaurants/me/orders/${order.id}`).set(headers).expect(200)).body;
      expect(bill.items[0].status).toBe(OrderItemStatus.SERVED);
      expect(bill.kotTickets[0].status).toBe(KotStatus.DONE);

      // Served food leaves the kitchen board.
      const remaining = await kitchenTickets();
      expect(remaining.some((t: { id: number }) => t.id === ticket.id)).toBe(false);
    });

    it('takes a line off the kitchen board when the till cancels it', async () => {
      const order = await sendToKitchen([
        { dishId: paneer.id, quantity: 1 },
        { dishId: naan.id, quantity: 1 },
      ]);
      const tickets = await kitchenTickets();
      const ticket = tickets.find((t: { orderId: number }) => t.orderId === order.id);
      expect(ticket.items).toHaveLength(2);

      const bill = (
        await api(app).get(`/restaurants/me/orders/${order.id}`).set(headers).expect(200)
      ).body;
      const naanLine = bill.items.find((item: { name: string }) => item.name === 'Butter Naan');

      await api(app)
        .post(`/restaurants/me/orders/${order.id}/items/${naanLine.id}/cancel`)
        .set(headers)
        .send({ reason: 'Guest changed their mind' })
        .expect(200);

      const after = await kitchenTickets();
      const updated = after.find((t: { id: number }) => t.id === ticket.id);

      expect(updated.items).toHaveLength(1);
      expect(updated.items[0].name).toBe('Paneer Tikka');
    });

    it('drops the whole ticket when the bill is voided', async () => {
      const order = await sendToKitchen([{ dishId: naan.id, quantity: 1 }]);
      const tickets = await kitchenTickets();
      const ticket = tickets.find((t: { orderId: number }) => t.orderId === order.id);

      await api(app)
        .post(`/restaurants/me/orders/${order.id}/cancel`)
        .set(headers)
        .send({ reason: 'Guests left' })
        .expect(200);

      const after = await kitchenTickets();
      expect(after.some((t: { id: number }) => t.id === ticket.id)).toBe(false);
    });

    it('refuses to reopen a finished ticket, or to skip straight to served', async () => {
      const order = await sendToKitchen([{ dishId: naan.id, quantity: 1 }]);
      const tickets = await kitchenTickets();
      const ticket = tickets.find((t: { orderId: number }) => t.orderId === order.id);

      // A ticket has to be started before it can be finished.
      await api(app)
        .patch(`${kitchenApi}/tickets/${ticket.id}`)
        .set(kitchen)
        .send({ status: KotStatus.DONE })
        .expect(400);

      await api(app)
        .patch(`${kitchenApi}/tickets/${ticket.id}`)
        .set(kitchen)
        .send({ status: KotStatus.PREPARING })
        .expect(200);

      await api(app)
        .patch(`${kitchenApi}/tickets/${ticket.id}`)
        .set(kitchen)
        .send({ status: KotStatus.DONE })
        .expect(200);

      await api(app)
        .patch(`${kitchenApi}/tickets/${ticket.id}`)
        .set(kitchen)
        .send({ status: KotStatus.PREPARING })
        .expect(400);
    });

    it('lets a cook take READY back to cooking, because it gets tapped by mistake', async () => {
      const order = await sendToKitchen([{ dishId: paneer.id, quantity: 1 }]);
      const tickets = await kitchenTickets();
      const ticket = tickets.find((t: { orderId: number }) => t.orderId === order.id);

      await api(app)
        .patch(`${kitchenApi}/tickets/${ticket.id}`)
        .set(kitchen)
        .send({ status: KotStatus.READY })
        .expect(200);
      await api(app)
        .patch(`${kitchenApi}/tickets/${ticket.id}`)
        .set(kitchen)
        .send({ status: KotStatus.PREPARING })
        .expect(200);

      const bill = (
        await api(app).get(`/restaurants/me/orders/${order.id}`).set(headers).expect(200)
      ).body;
      expect(bill.items[0].status).toBe(OrderItemStatus.PREPARING);
    });
  });

  describe('one kitchen never sees another restaurant', () => {
    it('shows only its own tickets', async () => {
      const rival = await registerOwner(app, { restaurantName: 'Rival Kitchen House' });
      const rivalHeaders = auth(rival.accessToken);
      const rivalDish = (
        await api(app).post('/dishes').set(rivalHeaders).send({ name: 'Rival Roti', price: 40 }).expect(201)
      ).body;
      const rivalTable = (
        await api(app).post('/restaurants/me/tables').set(rivalHeaders).send({ name: 'R-1' }).expect(201)
      ).body;

      const rivalOrder = (
        await api(app)
          .post('/restaurants/me/orders')
          .set(rivalHeaders)
          .send({ tableId: rivalTable.id, items: [{ dishId: rivalDish.id, quantity: 1 }] })
          .expect(201)
      ).body;
      await api(app)
        .post(`/restaurants/me/orders/${rivalOrder.id}/kot`)
        .set(rivalHeaders)
        .expect(201);

      const mine = await kitchenTickets();

      expect(mine.every((ticket: { tableName: string }) => ticket.tableName !== 'R-1')).toBe(true);
      expect(JSON.stringify(mine)).not.toContain('Rival Roti');
    });
  });
});
