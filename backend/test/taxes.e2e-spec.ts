import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TaxGroup, TaxKind } from 'src/common/enums';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import {
  api,
  auth,
  createTestApp,
  registerOwner,
  type RegisteredOwner,
  type TestContext,
} from './test-app';

/**
 * Tax on a bill, end to end.
 *
 * The arithmetic itself is covered in `tax.util.spec.ts`; what matters here is
 * that it reaches a bill correctly - that CGST and SGST arrive as separate lines
 * a tax invoice can print, that a settled bill keeps the rates it charged when
 * the restaurant later changes them, that one restaurant can never see or edit
 * another's rates, and that the day-end statement reports each component on its
 * own line, which is how they are filed.
 */
describe('Taxes and the day-end statement (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  let owner: RegisteredOwner;
  let headers: Record<string, string>;

  const taxes = '/restaurants/me/taxes';

  const createDish = async (h: Record<string, string>, name: string, price: number) =>
    (await api(app).post('/dishes').set(h).send({ name, price }).expect(201)).body;

  const openBill = async (h: Record<string, string>, items: Array<{ dishId: number; quantity: number }>) =>
    (await api(app).post('/restaurants/me/orders').set(h).send({ items }).expect(201)).body;

  const addComponent = (h: Record<string, string>, body: Record<string, unknown>) =>
    api(app).post(taxes).set(h).send(body).expect(201);

  const gstFive = async (h: Record<string, string>) => {
    await addComponent(h, { name: 'CGST', kind: TaxKind.CGST, rate: 2.5, sortOrder: 1 });
    await addComponent(h, { name: 'SGST', kind: TaxKind.SGST, rate: 2.5, sortOrder: 2 });
  };

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

  describe('the tax profile', () => {
    it('starts empty, and offers Indian starting points rather than guessing', async () => {
      const { body } = await api(app).get(taxes).set(headers).expect(200);

      expect(body.components).toEqual([]);
      expect(body.standardRate).toBe(0);
      // A restaurant that has configured nothing must not be charging anything.
      expect(body.suggested.map((p: { id: string }) => p.id)).toEqual(
        expect.arrayContaining(['restaurant-5', 'hotel-18', 'interstate-5']),
      );
    });

    it('applies a suggested profile as separate CGST and SGST lines', async () => {
      const { body } = await api(app)
        .post(`${taxes}/apply-profile`)
        .set(headers)
        .send({ profileId: 'restaurant-5' })
        .expect(200);

      expect(body.components.map((c: { kind: string; rate: number }) => [c.kind, c.rate])).toEqual([
        ['CGST', 2.5],
        ['SGST', 2.5],
      ]);
      expect(body.standardRate).toBe(5);
    });

    it('replaces rather than adds, so 5% to 18% never becomes 23%', async () => {
      await api(app).post(`${taxes}/apply-profile`).set(headers).send({ profileId: 'restaurant-5' }).expect(200);
      const { body } = await api(app)
        .post(`${taxes}/apply-profile`)
        .set(headers)
        .send({ profileId: 'hotel-18' })
        .expect(200);

      expect(body.standardRate).toBe(18);
      expect(body.components).toHaveLength(2);
    });

    it('refuses a rate above 100, which is a typo and not a tax', async () => {
      await api(app)
        .post(taxes)
        .set(headers)
        .send({ name: 'Oops', kind: TaxKind.CGST, rate: 150 })
        .expect(400);
    });

    it('refuses a second identical charge, which would tax twice', async () => {
      await api(app)
        .post(taxes)
        .set(headers)
        .send({ name: 'CGST', kind: TaxKind.CGST, rate: 2.5 })
        .expect(201);

      // The name is not what matters: the same kind at the same rate on the same
      // dishes charges twice whatever it is called.
      const { body } = await api(app)
        .post(taxes)
        .set(headers)
        .send({ name: 'Central GST', kind: TaxKind.CGST, rate: 2.5 })
        .expect(400);

      expect(body.message).toMatch(/already charged at 2.5%/i);
    });

    it('allows the same tax at a different rate, or on different dishes', async () => {
      await api(app).post(taxes).set(headers).send({ name: 'CGST', kind: TaxKind.CGST, rate: 2.5 }).expect(201);
      // A different rate is a different charge.
      await api(app).post(taxes).set(headers).send({ name: 'CGST', kind: TaxKind.CGST, rate: 9 }).expect(201);
      // The same rate on a different group is legitimate too.
      await api(app)
        .post(taxes)
        .set(headers)
        .send({ name: 'CGST', kind: TaxKind.CGST, rate: 2.5, appliesTo: TaxGroup.PACKAGED })
        .expect(201);
    });

    it('rejects an unknown suggested profile', async () => {
      await api(app)
        .post(`${taxes}/apply-profile`)
        .set(headers)
        .send({ profileId: 'not-a-profile' })
        .expect(404);
    });
  });

  describe('a bill', () => {
    it('carries each component as its own line', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Paneer Tikka', 400);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      expect(order.subtotal).toBe(400);
      expect(order.charges.map((c: { name: string; rate: number; amount: number }) => [c.name, c.rate, c.amount])).toEqual([
        ['CGST', 2.5, 10],
        ['SGST', 2.5, 10],
      ]);
      expect(order.taxAmount).toBe(20);
      expect(order.taxRate).toBe(5);
      expect(order.total).toBe(420);
      expect(order.amountPayable).toBe(420);
    });

    it('taxes a service charge along with the food, and never calls it tax', async () => {
      await addComponent(headers, {
        name: 'Service charge',
        kind: TaxKind.SERVICE_CHARGE,
        rate: 10,
        sortOrder: 1,
      });
      await gstFive(headers);

      const dish = await createDish(headers, 'Thali', 1000);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      expect(order.serviceChargeAmount).toBe(100);
      // GST is charged on 1100, and the service charge is not part of taxAmount.
      expect(order.taxAmount).toBe(55);
      expect(order.total).toBe(1155);
    });

    it('keeps alcohol out of GST and food out of VAT', async () => {
      await gstFive(headers);
      await addComponent(headers, {
        name: 'VAT',
        kind: TaxKind.VAT,
        rate: 20,
        appliesTo: TaxGroup.ALCOHOL,
        sortOrder: 3,
      });

      const food = await createDish(headers, 'Biryani', 1000);
      // Marked through the menu API, the way a restaurant marks it.
      const beer = (
        await api(app)
          .post('/dishes')
          .set(headers)
          .send({ name: 'Lager', price: 500, taxGroup: TaxGroup.ALCOHOL })
          .expect(201)
      ).body;

      expect(beer.taxGroup).toBe(TaxGroup.ALCOHOL);
      expect(food.taxGroup).toBe(TaxGroup.STANDARD);

      const order = await openBill(headers, [
        { dishId: food.id, quantity: 1 },
        { dishId: beer.id, quantity: 1 },
      ]);

      const byKind = Object.fromEntries(
        order.charges.map((c: { kind: string; taxableAmount: number; amount: number }) => [
          c.kind,
          { base: c.taxableAmount, amount: c.amount },
        ]),
      );

      expect(byKind.CGST).toEqual({ base: 1000, amount: 25 });
      expect(byKind.VAT).toEqual({ base: 500, amount: 100 });
      expect(order.total).toBe(1650);
    });

    it('can reclassify a dish afterwards without touching bills already settled', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Soda', 100);

      const before = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);
      expect(before.taxAmount).toBe(5);

      await api(app)
        .post(`/restaurants/me/orders/${before.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      // Now marked as alcohol, which GST does not apply to.
      await api(app).patch(`/dishes/${dish.id}`).set(headers).send({ taxGroup: TaxGroup.ALCOHOL }).expect(200);

      const after = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);
      expect(after.taxAmount).toBe(0);

      // The settled bill is untouched.
      const { body: bill } = await api(app)
        .get(`/restaurants/me/orders/${before.id}/bill`)
        .set(headers)
        .expect(200);
      expect(bill.taxAmount).toBe(5);
    });

    it('records TDS without changing the tax owed', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Platter', 1000);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      const { body } = await api(app)
        .post(`/restaurants/me/orders/${order.id}/tds`)
        .set(headers)
        .send({ rate: 2 })
        .expect(200);

      expect(body.total).toBe(1050);
      expect(body.taxAmount).toBe(50);
      // Withheld on the pre-GST value, so 2% of 1000.
      expect(body.tdsAmount).toBe(20);
      expect(body.amountPayable).toBe(1030);
    });

    it('clears TDS when it is sent back empty', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Platter', 1000);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      await api(app).post(`/restaurants/me/orders/${order.id}/tds`).set(headers).send({ rate: 2 }).expect(200);
      const { body } = await api(app)
        .post(`/restaurants/me/orders/${order.id}/tds`)
        .set(headers)
        .send({ rate: null })
        .expect(200);

      expect(body.tdsRate).toBeNull();
      expect(body.tdsAmount).toBe(0);
      expect(body.amountPayable).toBe(body.total);
    });

    it('keeps what it charged when the restaurant changes its rates afterwards', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Curry', 1000);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      await api(app)
        .post(`/restaurants/me/orders/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      // The restaurant moves to 18% the next morning.
      await api(app).post(`${taxes}/apply-profile`).set(headers).send({ profileId: 'hotel-18' }).expect(200);

      const { body: bill } = await api(app)
        .get(`/restaurants/me/orders/${order.id}/bill`)
        .set(headers)
        .expect(200);

      // Yesterday's settled bill still says 5%.
      expect(bill.taxAmount).toBe(50);
      expect(bill.total).toBe(1050);
      expect(bill.charges.map((c: { rate: number }) => c.rate)).toEqual([2.5, 2.5]);
    });

    it('bills nothing extra when no tax is configured', async () => {
      const dish = await createDish(headers, 'Plain', 200);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      expect(order.charges).toEqual([]);
      expect(order.taxAmount).toBe(0);
      expect(order.total).toBe(200);
    });
  });

  describe('the day-end statement', () => {
    it('reports each tax component on its own line, as they are filed', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Dosa', 100);

      for (let i = 0; i < 3; i += 1) {
        const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);
        await api(app)
          .post(`/restaurants/me/orders/${order.id}/settle`)
          .set(headers)
          .send({ paymentMethod: 'CASH' })
          .expect(200);
      }

      const { body } = await api(app).get('/restaurants/me/reports/day-end').set(headers).expect(200);

      expect(body.bills).toBe(3);
      expect(body.gross).toBe(300);
      expect(body.netSales).toBe(300);
      expect(body.taxes.map((t: { name: string; amount: number; bills: number }) => [t.name, t.amount, t.bills])).toEqual(
        expect.arrayContaining([
          ['CGST', 7.5, 3],
          ['SGST', 7.5, 3],
        ]),
      );
      expect(body.taxTotal).toBe(15);
      expect(body.total).toBe(315);
      expect(body.collected).toBe(315);
      expect(body.isClosed).toBe(true);
    });

    it('counts an open bill but never adds its money in', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Dosa', 100);
      await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      const { body } = await api(app).get('/restaurants/me/reports/day-end').set(headers).expect(200);

      expect(body.bills).toBe(0);
      expect(body.total).toBe(0);
      expect(body.openBills).toBe(1);
      expect(body.openValue).toBe(105);
      // The day cannot be closed while a table is still running.
      expect(body.isClosed).toBe(false);
    });

    it('separates what was withheld from what was billed', async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Banquet', 10000);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);

      await api(app).post(`/restaurants/me/orders/${order.id}/tds`).set(headers).send({ rate: 2 }).expect(200);
      await api(app)
        .post(`/restaurants/me/orders/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CARD' })
        .expect(200);

      const { body } = await api(app).get('/restaurants/me/reports/day-end').set(headers).expect(200);

      expect(body.total).toBe(10500);
      expect(body.tdsWithheld).toBe(200);
      expect(body.collected).toBe(10300);
      // The payment line is what actually arrives, not what was billed.
      expect(body.payments).toEqual([{ method: 'CARD', bills: 1, total: 10300 }]);
    });
  });

  describe('one restaurant cannot reach another', () => {
    it('keeps tax profiles apart', async () => {
      await gstFive(headers);
      const other = await registerOwner(app);
      const otherHeaders = auth(other.accessToken);

      const { body } = await api(app).get(taxes).set(otherHeaders).expect(200);

      expect(body.components).toEqual([]);
    });

    it('answers 404, not 403, for a charge belonging to someone else', async () => {
      const { body: mine } = await api(app)
        .post(taxes)
        .set(headers)
        .send({ name: 'CGST', kind: TaxKind.CGST, rate: 2.5 })
        .expect(201);

      const other = await registerOwner(app);
      const otherHeaders = auth(other.accessToken);

      // 404 rather than 403: a probe must not learn that the id exists.
      await api(app).patch(`${taxes}/${mine.id}`).set(otherHeaders).send({ rate: 9 }).expect(404);
      await api(app).delete(`${taxes}/${mine.id}`).set(otherHeaders).expect(404);
    });

    it("keeps one restaurant's takings out of another's day-end statement", async () => {
      await gstFive(headers);
      const dish = await createDish(headers, 'Dosa', 100);
      const order = await openBill(headers, [{ dishId: dish.id, quantity: 1 }]);
      await api(app)
        .post(`/restaurants/me/orders/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      const other = await registerOwner(app);
      const { body } = await api(app)
        .get('/restaurants/me/reports/day-end')
        .set(auth(other.accessToken))
        .expect(200);

      expect(body.bills).toBe(0);
      expect(body.taxes).toEqual([]);
      expect(body.total).toBe(0);
    });
  });
});
