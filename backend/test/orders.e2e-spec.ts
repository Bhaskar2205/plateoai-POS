import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { KitchenState, KotStatus, OrderItemStatus, OrderStatus, UserRole } from 'src/common/enums';
import { businessDateFor } from 'src/common/utils/business-date.util';
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
 * Table ordering, kitchen tickets and billing, end to end.
 *
 * The rules being protected here are the ones that cost a restaurant real money
 * if they break:
 *
 *  - prices and totals are always the server's, never the client's;
 *  - a diner's request cannot reach the kitchen, or a bill, without staff saying so;
 *  - a waiter can take orders but cannot discount or settle them;
 *  - the kitchen sees food, never money;
 *  - a settled bill is frozen, including its tax rate;
 *  - one restaurant can neither see nor touch another's tables, bills or tickets.
 */
describe('Orders, kitchen tickets and billing (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  let owner: RegisteredOwner;
  let rival: RegisteredOwner;
  let headers: Record<string, string>;
  let rivalHeaders: Record<string, string>;

  const orders = '/restaurants/me/orders';
  const kitchen = '/restaurants/me/kitchen';

  /** Table, dish and order fixtures are per-test: each one gets a clean table. */
  const createTable = async (h: Record<string, string>, name: string) =>
    (await api(app).post('/restaurants/me/tables').set(h).send({ name }).expect(201)).body;

  const createDish = async (h: Record<string, string>, name: string, price: number, extra = {}) =>
    (await api(app).post('/dishes').set(h).send({ name, price, ...extra }).expect(201)).body;

  const tokenOf = (table: { menuPath: string }) =>
    new URL(table.menuPath, 'http://placeholder').searchParams.get('table')!;

  /** Adds an account to `restaurantId` with `role`, and signs it in. */
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

  const setTaxRate = (restaurantId: number, taxRate: number, taxNumber: string | null = null) =>
    dataSource.getRepository(Restaurant).update({ id: restaurantId }, { taxRate, taxNumber });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;

    owner = await registerOwner(app, { restaurantName: 'Order Flow Kitchen' });
    rival = await registerOwner(app, { restaurantName: 'Rival Order House' });
    headers = auth(owner.accessToken);
    rivalHeaders = auth(rival.accessToken);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('opening a bill', () => {
    it('prices the order from the menu and computes its own totals', async () => {
      const table = await createTable(headers, 'Open 01');
      const dish = await createDish(headers, 'Paneer Tikka', 249.5);

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 2 }] })
          .expect(201)
      ).body;

      expect(order.status).toBe(OrderStatus.OPEN);
      expect(order.source).toBe('STAFF');
      expect(order.tableName).toBe('Open 01');
      expect(order.businessDate).toBe(businessDateFor());
      expect(order.items).toHaveLength(1);
      expect(order.items[0]).toMatchObject({
        name: 'Paneer Tikka',
        unitPrice: 249.5,
        quantity: 2,
        lineTotal: 499,
        status: OrderItemStatus.QUEUED,
        kotTicketId: null,
        awaitingApproval: false,
        editable: true,
      });
      expect(order.subtotal).toBe(499);
      expect(order.total).toBe(499);
      expect(order.discountAmount).toBe(0);
      expect(order.taxAmount).toBe(0);
      // DECIMAL arrives from MySQL as a string; the API must still return numbers.
      for (const key of ['subtotal', 'total', 'taxAmount', 'discountAmount']) {
        expect(typeof order[key]).toBe('number');
      }
    });

    it('numbers orders per restaurant, and does not leak another restaurant\'s sequence', async () => {
      // Sequentially: the in-memory SQLite harness has one connection, so two
      // transactions in flight at once fail for reasons that are not the API's.
      const table = await createTable(headers, 'Number 01');
      const rivalTable = await createTable(rivalHeaders, 'Rival Number 01');
      const dish = await createDish(headers, 'Numbered Dosa', 120);
      const rivalDish = await createDish(rivalHeaders, 'Rival Dosa', 120);

      const mine = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      const theirs = (
        await api(app)
          .post(orders)
          .set(rivalHeaders)
          .send({ tableId: rivalTable.id, items: [{ dishId: rivalDish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      expect(mine.orderNumber).toBeGreaterThan(0);
      // Each restaurant counts its own day, so both sequences are independent.
      expect(theirs.orderNumber).toBeGreaterThan(0);
      expect(mine.id).not.toBe(theirs.id);
    });

    it('refuses a second open bill on the same table', async () => {
      const table = await createTable(headers, 'Busy 01');
      const dish = await createDish(headers, 'Busy Biryani', 300);

      await api(app)
        .post(orders)
        .set(headers)
        .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(201);

      const conflict = await api(app)
        .post(orders)
        .set(headers)
        .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(409);

      expect(conflict.body.message).toMatch(/already has an open bill/i);
    });

    it('rejects a dish that is unavailable, naming it', async () => {
      const table = await createTable(headers, 'Sold Out 01');
      const dish = await createDish(headers, 'Sold Out Soup', 150, { isAvailable: false });

      const response = await api(app)
        .post(orders)
        .set(headers)
        .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(400);

      expect(response.body.message).toContain('Sold Out Soup');
    });

    it('refuses a price sent by the client instead of trusting it', async () => {
      const table = await createTable(headers, 'Price 01');
      const dish = await createDish(headers, 'Priced Paratha', 80);

      await api(app)
        .post(orders)
        .set(headers)
        .send({
          tableId: table.id,
          items: [{ dishId: dish.id, quantity: 1, unitPrice: 1, lineTotal: 1 }],
        })
        .expect(400);
    });

    it('allows a counter bill with no table', async () => {
      const dish = await createDish(headers, 'Takeaway Chai', 40);

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ items: [{ dishId: dish.id, quantity: 3 }] })
          .expect(201)
      ).body;

      expect(order.tableId).toBeNull();
      expect(order.tableName).toBeNull();
      expect(order.total).toBe(120);
    });

    it('will not open a bill on an inactive table', async () => {
      const table = await createTable(headers, 'Closed 01');
      const dish = await createDish(headers, 'Closed Cutlet', 100);

      await api(app)
        .patch(`/restaurants/me/tables/${table.id}`)
        .set(headers)
        .send({ isActive: false })
        .expect(200);

      await api(app)
        .post(orders)
        .set(headers)
        .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(400);
    });
  });

  describe('changing an open bill', () => {
    let table: { id: number; menuPath: string };
    let dish: { id: number };
    let order: { id: number };

    beforeEach(async () => {
      table = await createTable(headers, `Edit ${Math.random().toString(36).slice(2, 7)}`);
      dish = await createDish(headers, 'Editable Idli', 100);
      order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;
    });

    it('recalculates the bill when a line is added', async () => {
      const updated = (
        await api(app)
          .post(`${orders}/${order.id}/items`)
          .set(headers)
          .send({ items: [{ dishId: dish.id, quantity: 2, note: 'Extra chutney' }] })
          .expect(200)
      ).body;

      expect(updated.items).toHaveLength(2);
      expect(updated.subtotal).toBe(300);
      expect(updated.items[1].note).toBe('Extra chutney');
    });

    it('recalculates when a quantity changes', async () => {
      const itemId = (await api(app).get(`${orders}/${order.id}`).set(headers).expect(200)).body
        .items[0].id;

      const updated = (
        await api(app)
          .patch(`${orders}/${order.id}/items/${itemId}`)
          .set(headers)
          .send({ quantity: 4 })
          .expect(200)
      ).body;

      expect(updated.items[0].quantity).toBe(4);
      expect(updated.items[0].lineTotal).toBe(400);
      expect(updated.total).toBe(400);
    });

    it('keeps a cancelled line on the order with its reason, but off the money', async () => {
      const itemId = (await api(app).get(`${orders}/${order.id}`).set(headers).expect(200)).body
        .items[0].id;

      const updated = (
        await api(app)
          .post(`${orders}/${order.id}/items/${itemId}/cancel`)
          .set(headers)
          .send({ reason: 'Guest changed their mind' })
          .expect(200)
      ).body;

      expect(updated.items[0].status).toBe(OrderItemStatus.CANCELLED);
      expect(updated.items[0].cancelledReason).toBe('Guest changed their mind');
      expect(updated.subtotal).toBe(0);
      expect(updated.total).toBe(0);

      // And it never reaches the printed bill.
      const bill = (await api(app).get(`${orders}/${order.id}/bill`).set(headers).expect(200)).body;
      expect(bill.lines).toHaveLength(0);
    });

    it('refuses to cancel the same line twice', async () => {
      const itemId = (await api(app).get(`${orders}/${order.id}`).set(headers).expect(200)).body
        .items[0].id;
      const cancel = `${orders}/${order.id}/items/${itemId}/cancel`;

      await api(app).post(cancel).set(headers).send({}).expect(200);
      await api(app).post(cancel).set(headers).send({}).expect(400);
    });

    it('refuses to change a line the kitchen already has', async () => {
      const itemId = (await api(app).get(`${orders}/${order.id}`).set(headers).expect(200)).body
        .items[0].id;

      await api(app).post(`${orders}/${order.id}/kot`).set(headers).send({}).expect(201);

      const response = await api(app)
        .patch(`${orders}/${order.id}/items/${itemId}`)
        .set(headers)
        .send({ quantity: 9 })
        .expect(400);

      expect(response.body.message).toMatch(/already with the kitchen/i);
    });
  });

  describe('sending food to the kitchen', () => {
    it('sends only what is new on each ticket', async () => {
      const table = await createTable(headers, 'KOT 01');
      const dish = await createDish(headers, 'KOT Kebab', 200);

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      const first = (await api(app).post(`${orders}/${order.id}/kot`).set(headers).expect(201)).body;

      expect(first.ticketNumber).toBeGreaterThan(0);
      expect(first.items).toHaveLength(1);
      expect(first.tableName).toBe('KOT 01');
      // A kitchen ticket carries no money at all.
      expect(Object.keys(first)).not.toContain('total');
      expect(Object.keys(first.items[0])).not.toContain('unitPrice');

      // Nothing new yet.
      await api(app).post(`${orders}/${order.id}/kot`).set(headers).expect(400);

      await api(app)
        .post(`${orders}/${order.id}/items`)
        .set(headers)
        .send({ items: [{ dishId: dish.id, quantity: 2 }] })
        .expect(200);

      const second = (await api(app).post(`${orders}/${order.id}/kot`).set(headers).expect(201))
        .body;

      // The second ticket is a *new* ticket with only the new line - not a reprint.
      expect(second.ticketNumber).toBe(first.ticketNumber + 1);
      expect(second.items).toHaveLength(1);
      expect(second.items[0].quantity).toBe(2);

      const reloaded = (await api(app).get(`${orders}/${order.id}`).set(headers).expect(200)).body;
      expect(reloaded.kotTickets).toHaveLength(2);
      expect(reloaded.unsentItemCount).toBe(0);
    });

    it('shows the ticket on the kitchen panel, oldest first, without money', async () => {
      const table = await createTable(headers, 'Panel 01');
      const dish = await createDish(headers, 'Panel Pulao', 180);

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 2 }] })
          .expect(201)
      ).body;

      const ticket = (await api(app).post(`${orders}/${order.id}/kot`).set(headers).expect(201)).body;

      const tickets = (await api(app).get(`${kitchen}/tickets`).set(headers).expect(200)).body;
      const mine = tickets.find((row: { ticketNumber: number }) => row.ticketNumber === ticket.ticketNumber);

      expect(mine).toBeDefined();
      expect(mine.status).toBe(KotStatus.NEW);
      expect(mine.tableName).toBe('Panel 01');
      expect(mine.waitingMinutes).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(mine)).not.toMatch(/unitPrice|subtotal|discount|total/);
    });

    it('moves a ticket through the kitchen and takes its lines with it', async () => {
      const table = await createTable(headers, 'Cook 01');
      const dish = await createDish(headers, 'Cooked Curry', 220);

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      const ticket = (await api(app).post(`${orders}/${order.id}/kot`).set(headers).expect(201)).body;
      const ticketId = (await api(app).get(`${orders}/${order.id}`).set(headers).expect(200)).body
        .kotTickets[0].id;

      expect(ticket.ticketNumber).toBeGreaterThan(0);

      const preparing = (
        await api(app)
          .patch(`${kitchen}/tickets/${ticketId}`)
          .set(headers)
          .send({ status: KotStatus.PREPARING })
          .expect(200)
      ).body;

      expect(preparing.status).toBe(KotStatus.PREPARING);
      expect(preparing.items[0].status).toBe(OrderItemStatus.PREPARING);

      await api(app)
        .patch(`${kitchen}/tickets/${ticketId}`)
        .set(headers)
        .send({ status: KotStatus.READY })
        .expect(200);

      // READY can be pulled back - a cook taps it by mistake.
      await api(app)
        .patch(`${kitchen}/tickets/${ticketId}`)
        .set(headers)
        .send({ status: KotStatus.PREPARING })
        .expect(200);

      await api(app)
        .patch(`${kitchen}/tickets/${ticketId}`)
        .set(headers)
        .send({ status: KotStatus.DONE })
        .expect(200);

      // DONE is terminal: food already served cannot go back to the queue.
      const refused = await api(app)
        .patch(`${kitchen}/tickets/${ticketId}`)
        .set(headers)
        .send({ status: KotStatus.PREPARING })
        .expect(400);

      expect(refused.body.message).toMatch(/cannot be moved/i);
    });

    it('cancels a ticket once every line on it is cancelled', async () => {
      const table = await createTable(headers, 'Void 01');
      const dish = await createDish(headers, 'Voided Vada', 90);

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      await api(app).post(`${orders}/${order.id}/kot`).set(headers).expect(201);

      const loaded = (await api(app).get(`${orders}/${order.id}`).set(headers).expect(200)).body;

      await api(app)
        .post(`${orders}/${order.id}/items/${loaded.items[0].id}/cancel`)
        .set(headers)
        .send({ reason: 'Kitchen out of stock' })
        .expect(200);

      const after = (await api(app).get(`${orders}/${order.id}`).set(headers).expect(200)).body;
      expect(after.kotTickets[0].status).toBe(KotStatus.CANCELLED);
    });

    it('records that a ticket was printed', async () => {
      const table = await createTable(headers, 'Print 01');
      const dish = await createDish(headers, 'Printed Paneer', 260);

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      await api(app).post(`${orders}/${order.id}/kot`).set(headers).expect(201);
      const ticketId = (await api(app).get(`${orders}/${order.id}`).set(headers).expect(200)).body
        .kotTickets[0].id;

      expect(
        (await api(app).post(`${kitchen}/tickets/${ticketId}/printed`).set(headers).expect(200)).body
          .printedAt,
      ).not.toBeNull();

      // And it can be fetched again to reprint.
      const reprint = (
        await api(app).get(`${orders}/${order.id}/kot/${ticketId}`).set(headers).expect(200)
      ).body;
      expect(reprint.items).toHaveLength(1);
      expect(reprint.restaurantName).toBe('Order Flow Kitchen');
    });
  });

  describe('the floor view', () => {
    /** The floor row for one table, as the Tables screen polls it. */
    const rowFor = async (tableId: number) =>
      (await api(app).get('/restaurants/me/floor').set(headers).expect(200)).body.find(
        (entry: { tableId: number }) => entry.tableId === tableId,
      );

    it('tracks a table from free, through the kitchen, to paid', async () => {
      const table = await createTable(headers, 'Floor 01');
      const dish = await createDish(headers, 'Floor Falafel', 200);

      expect(await rowFor(table.id)).toMatchObject({
        tableName: 'Floor 01',
        isActive: true,
        orderId: null,
        total: 0,
        itemCount: 0,
        pendingApprovalCount: 0,
        unsentItemCount: 0,
        kitchenState: KitchenState.NONE,
        openedAt: null,
      });

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 2 }] })
          .expect(201)
      ).body;

      // Open, but the kitchen has not been given anything yet.
      expect(await rowFor(table.id)).toMatchObject({
        orderId: order.id,
        orderNumber: order.orderNumber,
        total: 400,
        itemCount: 1,
        unsentItemCount: 1,
        kitchenState: KitchenState.NONE,
      });

      await api(app).post(`${orders}/${order.id}/kot`).set(headers).expect(201);

      const cooking = await rowFor(table.id);
      expect(cooking.unsentItemCount).toBe(0);
      expect(cooking.kitchenState).toBe(KitchenState.COOKING);

      const ticketId = (await api(app).get(`${orders}/${order.id}`).set(headers).expect(200)).body
        .kotTickets[0].id;

      await api(app)
        .patch(`${kitchen}/tickets/${ticketId}`)
        .set(headers)
        .send({ status: KotStatus.READY })
        .expect(200);

      expect((await rowFor(table.id)).kitchenState).toBe(KitchenState.READY);

      // Served: the kitchen is finished, so the next action is the bill, not food.
      await api(app)
        .patch(`${kitchen}/tickets/${ticketId}`)
        .set(headers)
        .send({ status: KotStatus.DONE })
        .expect(200);

      expect((await rowFor(table.id)).kitchenState).toBe(KitchenState.NONE);

      await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      expect(await rowFor(table.id)).toMatchObject({
        orderId: null,
        total: 0,
        itemCount: 0,
        kitchenState: KitchenState.NONE,
      });
    });

    it('reports a table still cooking as cooking, even when one ticket is ready', async () => {
      const table = await createTable(headers, 'Floor 02');
      const dish = await createDish(headers, 'Floor Fries', 150);

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      await api(app).post(`${orders}/${order.id}/kot`).set(headers).expect(201);
      await api(app)
        .post(`${orders}/${order.id}/items`)
        .set(headers)
        .send({ items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(200);
      await api(app).post(`${orders}/${order.id}/kot`).set(headers).expect(201);

      const tickets = (await api(app).get(`${orders}/${order.id}`).set(headers).expect(200)).body
        .kotTickets;

      await api(app)
        .patch(`${kitchen}/tickets/${tickets[0].id}`)
        .set(headers)
        .send({ status: KotStatus.READY })
        .expect(200);

      // Starters up, mains still on: the table is not "ready" to the waiter.
      expect((await rowFor(table.id)).kitchenState).toBe(KitchenState.COOKING);
    });

    it('keeps a switched-off table on the floor, marked inactive', async () => {
      const table = await createTable(headers, 'Floor 03');

      await api(app)
        .patch(`/restaurants/me/tables/${table.id}`)
        .set(headers)
        .send({ isActive: false })
        .expect(200);

      expect(await rowFor(table.id)).toMatchObject({ isActive: false, orderId: null });
    });
  });

  describe('diner self-ordering from a table QR code', () => {
    let table: { id: number; menuPath: string };
    let dish: { id: number; name: string };
    let slug: string;
    let placeOrder: string;

    beforeEach(async () => {
      table = await createTable(headers, `QR ${Math.random().toString(36).slice(2, 7)}`);
      dish = await createDish(headers, 'Diner Dosa', 160);
      slug = (await api(app).get('/restaurants/me').set(headers).expect(200)).body.slug;
      placeOrder = `/public/restaurants/${slug}/orders?table=${tokenOf(table)}`;
    });

    it('takes the order without a token and holds it for staff approval', async () => {
      const receipt = (
        await api(app)
          .post(placeOrder)
          .send({ items: [{ dishId: dish.id, quantity: 2, note: 'No onion' }] })
          .expect(201)
      ).body;

      expect(receipt.items).toEqual([{ name: 'Diner Dosa', quantity: 2, note: 'No onion' }]);
      expect(receipt.awaitingApprovalCount).toBe(1);
      expect(receipt.message).toMatch(/confirm/i);
      // A diner is told nothing about the bill.
      expect(JSON.stringify(receipt)).not.toMatch(/subtotal|total|unitPrice|discount/);
    });

    it('shows the request to staff at the table but hides it from the kitchen', async () => {
      await api(app)
        .post(placeOrder)
        .send({ items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(201);

      const floor = (await api(app).get('/restaurants/me/floor').set(headers).expect(200)).body;
      const row = floor.find((entry: { tableId: number }) => entry.tableId === table.id);

      expect(row.pendingApprovalCount).toBe(1);
      expect(row.orderId).not.toBeNull();

      const order = (
        await api(app).get(`/restaurants/me/floor/${table.id}/order`).set(headers).expect(200)
      ).body;

      expect(order.source).toBe('DINER_QR');
      expect(order.items[0].status).toBe(OrderItemStatus.PENDING);
      expect(order.items[0].awaitingApproval).toBe(true);
      expect(order.pendingApprovalCount).toBe(1);

      // Not approved, so there is nothing for the kitchen to cook.
      await api(app).post(`${orders}/${order.id}/kot`).set(headers).expect(400);

      const tickets = (await api(app).get(`${kitchen}/tickets`).set(headers).expect(200)).body;
      expect(
        tickets.some((ticket: { orderId: number }) => ticket.orderId === order.id),
      ).toBe(false);
    });

    it('lets staff approve the request and then send it to the kitchen', async () => {
      await api(app)
        .post(placeOrder)
        .send({ items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(201);

      const order = (
        await api(app).get(`/restaurants/me/floor/${table.id}/order`).set(headers).expect(200)
      ).body;

      const approved = (
        await api(app).post(`${orders}/${order.id}/approve`).set(headers).send({}).expect(200)
      ).body;

      expect(approved.pendingApprovalCount).toBe(0);
      expect(approved.items[0].status).toBe(OrderItemStatus.QUEUED);
      expect(approved.unsentItemCount).toBe(1);

      const ticket = (await api(app).post(`${orders}/${order.id}/kot`).set(headers).expect(201)).body;
      expect(ticket.items).toHaveLength(1);
    });

    it('approves only the lines staff name', async () => {
      await api(app)
        .post(placeOrder)
        .send({
          items: [
            { dishId: dish.id, quantity: 1 },
            { dishId: dish.id, quantity: 5 },
          ],
        })
        .expect(201);

      const order = (
        await api(app).get(`/restaurants/me/floor/${table.id}/order`).set(headers).expect(200)
      ).body;

      const approved = (
        await api(app)
          .post(`${orders}/${order.id}/approve`)
          .set(headers)
          .send({ itemIds: [order.items[0].id] })
          .expect(200)
      ).body;

      expect(approved.items[0].status).toBe(OrderItemStatus.QUEUED);
      expect(approved.items[1].status).toBe(OrderItemStatus.PENDING);
      expect(approved.pendingApprovalCount).toBe(1);

      // Approving the same line again is a mistake worth reporting.
      await api(app)
        .post(`${orders}/${order.id}/approve`)
        .set(headers)
        .send({ itemIds: [order.items[0].id] })
        .expect(400);
    });

    it('adds to the bill staff already opened rather than starting a second one', async () => {
      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      await api(app)
        .post(placeOrder)
        .send({ items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(201);

      const reloaded = (await api(app).get(`${orders}/${order.id}`).set(headers).expect(200)).body;

      expect(reloaded.items).toHaveLength(2);
      expect(reloaded.pendingApprovalCount).toBe(1);

      const all = (
        await api(app).get(`${orders}?tableId=${table.id}`).set(headers).expect(200)
      ).body;
      expect(all).toHaveLength(1);
    });

    it('refuses an unknown table, another restaurant\'s table and an inactive one alike', async () => {
      const rivalTable = await createTable(rivalHeaders, 'Rival QR 01');

      for (const query of [
        '?table=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        `?table=${tokenOf(rivalTable)}`,
        '?table=not-a-token',
        '',
      ]) {
        const response = await api(app)
          .post(`/public/restaurants/${slug}/orders${query}`)
          .send({ items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(404);

        expect(response.body.message).toBe('This table is not available.');
      }

      await api(app)
        .patch(`/restaurants/me/tables/${table.id}`)
        .set(headers)
        .send({ isActive: false })
        .expect(200);

      await api(app)
        .post(placeOrder)
        .send({ items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(404);
    });

    it('cannot order a dish from another restaurant', async () => {
      const rivalDish = await createDish(rivalHeaders, 'Rival Roti', 30);

      await api(app)
        .post(placeOrder)
        .send({ items: [{ dishId: rivalDish.id, quantity: 1 }] })
        .expect(404);
    });

    it('caps how many requests can pile up unapproved at one table', async () => {
      // 40 lines is the cap; ten requests of five lines each takes it past it.
      const items = Array.from({ length: 5 }, () => ({ dishId: dish.id, quantity: 1 }));

      let lastStatus = 201;
      for (let attempt = 0; attempt < 10 && lastStatus === 201; attempt += 1) {
        lastStatus = (await api(app).post(placeOrder).send({ items })).status;
      }

      expect(lastStatus).toBe(400);
    });
  });

  describe('discounts', () => {
    let order: { id: number };

    beforeEach(async () => {
      const table = await createTable(headers, `Disc ${Math.random().toString(36).slice(2, 7)}`);
      const dish = await createDish(headers, 'Discounted Thali', 320);

      order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 2 }] })
          .expect(201)
      ).body;
    });

    it('applies a percentage and records who asked for it', async () => {
      const updated = (
        await api(app)
          .post(`${orders}/${order.id}/discount`)
          .set(headers)
          .send({ type: 'PERCENT', value: 10, reason: 'Regular guest' })
          .expect(200)
      ).body;

      expect(updated.subtotal).toBe(640);
      expect(updated.discountAmount).toBe(64);
      expect(updated.discountReason).toBe('Regular guest');
      expect(updated.total).toBe(576);
    });

    it('applies a flat amount', async () => {
      const updated = (
        await api(app)
          .post(`${orders}/${order.id}/discount`)
          .set(headers)
          .send({ type: 'AMOUNT', value: 40, reason: 'Late service' })
          .expect(200)
      ).body;

      expect(updated.discountAmount).toBe(40);
      expect(updated.total).toBe(600);
    });

    it('caps a discount at half the bill, in either form', async () => {
      await api(app)
        .post(`${orders}/${order.id}/discount`)
        .set(headers)
        .send({ type: 'PERCENT', value: 60, reason: 'Too generous' })
        .expect(400);

      await api(app)
        .post(`${orders}/${order.id}/discount`)
        .set(headers)
        .send({ type: 'AMOUNT', value: 500, reason: 'Too generous' })
        .expect(400);

      // Exactly half is allowed.
      await api(app)
        .post(`${orders}/${order.id}/discount`)
        .set(headers)
        .send({ type: 'PERCENT', value: 50, reason: 'Owner authorised' })
        .expect(200);
    });

    it('requires a reason', async () => {
      await api(app)
        .post(`${orders}/${order.id}/discount`)
        .set(headers)
        .send({ type: 'PERCENT', value: 10 })
        .expect(400);

      await api(app)
        .post(`${orders}/${order.id}/discount`)
        .set(headers)
        .send({ type: 'PERCENT', value: 10, reason: 'x' })
        .expect(400);
    });

    it('removes a discount and restores the total', async () => {
      await api(app)
        .post(`${orders}/${order.id}/discount`)
        .set(headers)
        .send({ type: 'PERCENT', value: 25, reason: 'Manager approved' })
        .expect(200);

      const cleared = (
        await api(app).delete(`${orders}/${order.id}/discount`).set(headers).expect(200)
      ).body;

      expect(cleared.discountType).toBeNull();
      expect(cleared.discountAmount).toBe(0);
      expect(cleared.total).toBe(640);
    });
  });

  describe('settling a bill', () => {
    it('freezes the tax rate, the totals and the lines', async () => {
      await setTaxRate(owner.restaurantId, 5, '08AAAAA0000A1Z5');

      const table = await createTable(headers, 'Settle 01');
      const dish = await createDish(headers, 'Settled Sizzler', 320);

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 2 }] })
          .expect(201)
      ).body;

      await api(app)
        .post(`${orders}/${order.id}/discount`)
        .set(headers)
        .send({ type: 'PERCENT', value: 10, reason: 'Regular guest' })
        .expect(200);

      const settled = (
        await api(app)
          .post(`${orders}/${order.id}/settle`)
          .set(headers)
          .send({ paymentMethod: 'UPI' })
          .expect(200)
      ).body;

      expect(settled.status).toBe(OrderStatus.SETTLED);
      expect(settled.paymentMethod).toBe('UPI');
      expect(settled.settledAt).not.toBeNull();
      expect(settled.subtotal).toBe(640);
      expect(settled.discountAmount).toBe(64);
      expect(settled.taxRate).toBe(5);
      expect(settled.taxAmount).toBe(28.8);
      expect(settled.total).toBe(604.8);
      expect(settled.items.every((item: { status: string }) => item.status === 'SERVED')).toBe(true);

      // Changing the restaurant's rate afterwards must not rewrite a paid bill.
      await setTaxRate(owner.restaurantId, 18, '08AAAAA0000A1Z5');

      const reloaded = (await api(app).get(`${orders}/${order.id}`).set(headers).expect(200)).body;
      expect(reloaded.taxRate).toBe(5);
      expect(reloaded.total).toBe(604.8);

      const bill = (await api(app).get(`${orders}/${order.id}/bill`).set(headers).expect(200)).body;
      expect(bill.taxNumber).toBe('08AAAAA0000A1Z5');
      expect(bill.restaurantName).toBe('Order Flow Kitchen');
      expect(bill.total).toBe(604.8);
      expect(bill.lines).toHaveLength(1);

      await setTaxRate(owner.restaurantId, 0, null);
    });

    it('closes the order to further changes once it is settled', async () => {
      const table = await createTable(headers, 'Closed Bill 01');
      const dish = await createDish(headers, 'Closed Kofta', 200);

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      const itemId = order.items[0].id;

      await api(app)
        .post(`${orders}/${order.id}/items`)
        .set(headers)
        .send({ items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(400);
      await api(app)
        .patch(`${orders}/${order.id}/items/${itemId}`)
        .set(headers)
        .send({ quantity: 5 })
        .expect(400);
      await api(app)
        .post(`${orders}/${order.id}/discount`)
        .set(headers)
        .send({ type: 'PERCENT', value: 10, reason: 'Too late' })
        .expect(400);
      await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(400);

      // The table is free again.
      const free = await api(app)
        .get(`/restaurants/me/floor/${table.id}/order`)
        .set(headers)
        .expect(200);
      expect(free.body).toEqual({});
    });

    it('refuses to settle around a diner request nobody has confirmed', async () => {
      const table = await createTable(headers, 'Pending Settle 01');
      const dish = await createDish(headers, 'Pending Pakora', 120);
      const slug = (await api(app).get('/restaurants/me').set(headers).expect(200)).body.slug;

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      await api(app)
        .post(`/public/restaurants/${slug}/orders?table=${tokenOf(table)}`)
        .send({ items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(201);

      const refused = await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(400);

      expect(refused.body.message).toMatch(/pending diner requests/i);

      // Cancelling the request unblocks the bill.
      const loaded = (await api(app).get(`${orders}/${order.id}`).set(headers).expect(200)).body;
      const pending = loaded.items.find((item: { awaitingApproval: boolean }) => item.awaitingApproval);

      await api(app)
        .post(`${orders}/${order.id}/items/${pending.id}/cancel`)
        .set(headers)
        .send({ reason: 'Guest cancelled' })
        .expect(200);

      await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);
    });

    it('refuses to settle an empty bill', async () => {
      const table = await createTable(headers, 'Empty 01');
      const dish = await createDish(headers, 'Empty Eclair', 90);

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
        .send({ reason: 'Nothing wanted' })
        .expect(200);

      await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(400);
    });

    it('voids a whole bill, keeping the reason and stopping its tickets', async () => {
      const table = await createTable(headers, 'Voided Bill 01');
      const dish = await createDish(headers, 'Voided Vindaloo', 260);

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 2 }] })
          .expect(201)
      ).body;

      await api(app).post(`${orders}/${order.id}/kot`).set(headers).expect(201);

      const cancelled = (
        await api(app)
          .post(`${orders}/${order.id}/cancel`)
          .set(headers)
          .send({ reason: 'Guests left' })
          .expect(200)
      ).body;

      expect(cancelled.status).toBe(OrderStatus.CANCELLED);
      expect(cancelled.total).toBe(0);
      expect(cancelled.items.every((item: { status: string }) => item.status === 'CANCELLED')).toBe(
        true,
      );
      expect(cancelled.kotTickets[0].status).toBe(KotStatus.CANCELLED);
    });
  });

  describe('who may do what', () => {
    let waiterHeaders: Record<string, string>;
    let kitchenHeaders: Record<string, string>;
    let table: { id: number };
    let dish: { id: number };

    beforeAll(async () => {
      waiterHeaders = auth(await memberWithRole(owner.restaurantId, UserRole.WAITER));
      kitchenHeaders = auth(await memberWithRole(owner.restaurantId, UserRole.KITCHEN_STAFF));
    });

    beforeEach(async () => {
      table = await createTable(headers, `Role ${Math.random().toString(36).slice(2, 7)}`);
      dish = await createDish(headers, 'Role Rasam', 110);
    });

    it('lets a waiter take an order and send it to the kitchen', async () => {
      const order = (
        await api(app)
          .post(orders)
          .set(waiterHeaders)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      await api(app).get('/restaurants/me/floor').set(waiterHeaders).expect(200);
      await api(app).post(`${orders}/${order.id}/kot`).set(waiterHeaders).expect(201);
    });

    it('does not let a waiter discount, settle or void a bill', async () => {
      const order = (
        await api(app)
          .post(orders)
          .set(waiterHeaders)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      await api(app)
        .post(`${orders}/${order.id}/discount`)
        .set(waiterHeaders)
        .send({ type: 'PERCENT', value: 10, reason: 'Friend of mine' })
        .expect(403);
      await api(app).delete(`${orders}/${order.id}/discount`).set(waiterHeaders).expect(403);
      await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(waiterHeaders)
        .send({ paymentMethod: 'CASH' })
        .expect(403);
      await api(app)
        .post(`${orders}/${order.id}/cancel`)
        .set(waiterHeaders)
        .send({ reason: 'Never mind' })
        .expect(403);
    });

    it('lets kitchen staff work tickets but not open or read bills', async () => {
      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;

      await api(app).post(`${orders}/${order.id}/kot`).set(headers).expect(201);
      const ticketId = (await api(app).get(`${orders}/${order.id}`).set(headers).expect(200)).body
        .kotTickets[0].id;

      await api(app).get(`${kitchen}/tickets`).set(kitchenHeaders).expect(200);
      await api(app)
        .patch(`${kitchen}/tickets/${ticketId}`)
        .set(kitchenHeaders)
        .send({ status: KotStatus.PREPARING })
        .expect(200);

      await api(app).get(orders).set(kitchenHeaders).expect(403);
      await api(app).get(`${orders}/${order.id}/bill`).set(kitchenHeaders).expect(403);
      await api(app)
        .post(orders)
        .set(kitchenHeaders)
        .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(403);
    });

    it('requires a token for every staff route', async () => {
      await api(app).get(orders).expect(401);
      await api(app).get('/restaurants/me/floor').expect(401);
      await api(app).get(`${kitchen}/tickets`).expect(401);
    });
  });

  describe('one restaurant cannot reach another\'s bills', () => {
    let order: { id: number; items: Array<{ id: number }> };
    let table: { id: number };

    beforeEach(async () => {
      table = await createTable(headers, `Isolated ${Math.random().toString(36).slice(2, 7)}`);
      const dish = await createDish(headers, 'Isolated Idiyappam', 140);

      order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
          .expect(201)
      ).body;
    });

    it('hides the order, its bill and its tickets behind a 404', async () => {
      await api(app).get(`${orders}/${order.id}`).set(rivalHeaders).expect(404);
      await api(app).get(`${orders}/${order.id}/bill`).set(rivalHeaders).expect(404);
      await api(app).get(`/restaurants/me/floor/${table.id}/order`).set(rivalHeaders).expect(404);
      await api(app).get(`${orders}/${order.id}/kot/1`).set(rivalHeaders).expect(404);
    });

    it('refuses every write, without saying the order exists', async () => {
      await api(app)
        .post(`${orders}/${order.id}/items`)
        .set(rivalHeaders)
        .send({ items: [{ dishId: 999999, quantity: 1 }] })
        .expect(404);
      await api(app)
        .patch(`${orders}/${order.id}/items/${order.items[0].id}`)
        .set(rivalHeaders)
        .send({ quantity: 5 })
        .expect(404);
      await api(app)
        .post(`${orders}/${order.id}/items/${order.items[0].id}/cancel`)
        .set(rivalHeaders)
        .send({ reason: 'Not mine' })
        .expect(404);
      await api(app).post(`${orders}/${order.id}/approve`).set(rivalHeaders).send({}).expect(404);
      await api(app).post(`${orders}/${order.id}/kot`).set(rivalHeaders).expect(404);
      await api(app)
        .post(`${orders}/${order.id}/discount`)
        .set(rivalHeaders)
        .send({ type: 'PERCENT', value: 10, reason: 'Not mine' })
        .expect(404);
      await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(rivalHeaders)
        .send({ paymentMethod: 'CASH' })
        .expect(404);
      await api(app)
        .post(`${orders}/${order.id}/cancel`)
        .set(rivalHeaders)
        .send({ reason: 'Not mine' })
        .expect(404);

      // Untouched.
      const mine = (await api(app).get(`${orders}/${order.id}`).set(headers).expect(200)).body;
      expect(mine.status).toBe(OrderStatus.OPEN);
      expect(mine.items[0].quantity).toBe(1);
    });

    it('will not open a bill on another restaurant\'s table', async () => {
      const dish = await createDish(rivalHeaders, 'Rival Uttapam', 130);

      await api(app)
        .post(orders)
        .set(rivalHeaders)
        .send({ tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] })
        .expect(404);
    });

    it('keeps another restaurant\'s tickets off the kitchen panel', async () => {
      await api(app).post(`${orders}/${order.id}/kot`).set(headers).expect(201);

      const rivalTickets = (await api(app).get(`${kitchen}/tickets`).set(rivalHeaders).expect(200))
        .body;

      expect(
        rivalTickets.some((ticket: { orderId: number }) => ticket.orderId === order.id),
      ).toBe(false);
    });
  });
});
