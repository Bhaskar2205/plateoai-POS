import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  IngredientUnit,
  InventoryMode,
  InventoryMovementType,
  StockAdjustmentReason,
  UserRole,
} from 'src/common/enums';
import { Ingredient } from 'src/modules/ingredients/entities/ingredient.entity';
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
 * Stock, end to end.
 *
 * The arithmetic and the unit conversions are covered by `inventory-units.spec`
 * and `recipe-consumption.spec`. What these tests are for is the part that cannot
 * be checked in isolation: that selling a dish actually moves the figure, that it
 * moves once, that a restaurant which has not turned inventory on sees no change
 * at all, and that one restaurant can never touch another's shelves.
 */
describe('Inventory (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  let owner: RegisteredOwner;
  let headers: Record<string, string>;

  const inventory = '/restaurants/me/inventory';
  const orders = '/restaurants/me/orders';

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

  const enableInventory = (h: Record<string, string>, body: Record<string, unknown> = {}) =>
    api(app)
      .patch(`${inventory}/settings`)
      .set(h)
      .send({ inventoryMode: InventoryMode.TRACKING, ...body })
      .expect(200);

  const createIngredient = async (
    h: Record<string, string>,
    body: Record<string, unknown>,
  ): Promise<Ingredient> =>
    (await api(app).post('/ingredients').set(h).send(body).expect(201)).body;

  const createDish = async (h: Record<string, string>, name: string, price = 250) =>
    (await api(app).post('/dishes').set(h).send({ name, price }).expect(201)).body;

  const setRecipe = (
    h: Record<string, string>,
    dishId: number,
    lines: Array<{ ingredientId: number; quantity: number; unit: string }>,
  ) =>
    api(app)
      .post(`/dishes/${dishId}/ingredients`)
      .set(h)
      .send({ ingredients: lines })
      .expect(201);

  const sellAndSettle = async (
    h: Record<string, string>,
    items: Array<{ dishId: number; quantity: number }>,
  ) => {
    const order = (await api(app).post(orders).set(h).send({ items }).expect(201)).body;

    await api(app)
      .post(`${orders}/${order.id}/settle`)
      .set(h)
      .send({ paymentMethod: 'CASH' })
      .expect(200);

    return order;
  };

  const stockOf = async (h: Record<string, string>, ingredientId: number): Promise<number> => {
    const rows = (await api(app).get(`${inventory}/stock`).set(h).expect(200)).body as Ingredient[];
    const found = rows.find((row) => row.id === ingredientId);

    return Number(found?.currentQuantity ?? NaN);
  };

  const movementsOf = async (h: Record<string, string>, ingredientId: number) =>
    (await api(app).get(`${inventory}/movements?ingredientId=${ingredientId}`).set(h).expect(200))
      .body as Array<Record<string, unknown>>;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    owner = await registerOwner(app, { restaurantName: 'Stock Kitchen' });
    headers = auth(owner.accessToken);
  });

  describe('settings', () => {
    it('starts switched off for a brand new restaurant', async () => {
      // The default that matters most in this feature. A restaurant that has
      // never heard of inventory must behave exactly as it did before it shipped.
      const settings = (await api(app).get(`${inventory}/settings`).set(headers).expect(200)).body;

      expect(settings).toEqual({
        mode: InventoryMode.DISABLED,
        allowNegativeStock: false,
        autoDisableOutOfStockDishes: false,
      });
    });

    it('records who turned it on', async () => {
      await enableInventory(headers);

      const { body } = await api(app)
        .get('/restaurants/me/audit-logs?action=INVENTORY_MODE_CHANGED')
        .set(headers)
        .expect(200);

      expect(body.total).toBe(1);
      expect(body.rows[0]).toMatchObject({
        action: 'INVENTORY_MODE_CHANGED',
        oldValue: { mode: InventoryMode.DISABLED },
        newValue: { mode: InventoryMode.TRACKING },
      });
    });

    it('is owner-only', async () => {
      const waiter = auth(await memberWithRole(owner.restaurantId, UserRole.WAITER));

      await api(app)
        .patch(`${inventory}/settings`)
        .set(waiter)
        .send({ inventoryMode: InventoryMode.TRACKING })
        .expect(403);
    });
  });

  describe('an ingredient entering stock', () => {
    it('opens with a movement rather than a bare figure', async () => {
      await enableInventory(headers);

      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
        costPerUnitPaise: 32000,
        minimumQuantity: 2,
      });

      expect(Number(paneer.currentQuantity)).toBe(10);

      const movements = await movementsOf(headers, paneer.id);

      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        movementType: InventoryMovementType.OPENING_STOCK,
        quantity: 10,
        quantityBefore: 0,
        quantityAfter: 10,
      });
    });

    it('adds a delivery and leaves the arithmetic behind it', async () => {
      const paneer = await createIngredient(headers, { name: 'Paneer', unit: IngredientUnit.KG });

      await api(app)
        .post(`${inventory}/ingredients/${paneer.id}/stock-in`)
        .set(headers)
        .send({ quantity: 5, costPerUnitPaise: 34000, note: 'Shree Vegetables' })
        .expect(201);

      expect(await stockOf(headers, paneer.id)).toBe(5);

      const [movement] = await movementsOf(headers, paneer.id);

      expect(movement).toMatchObject({
        movementType: InventoryMovementType.STOCK_IN,
        quantity: 5,
        quantityBefore: 0,
        quantityAfter: 5,
        note: 'Shree Vegetables',
      });
      // 5 kg at the new ₹340/kg.
      expect(Number(movement.valuePaise)).toBe(170000);
    });

    it('leaves earlier movements worth what they were when the price changes', async () => {
      const onion = await createIngredient(headers, {
        name: 'Onion',
        unit: IngredientUnit.KG,
        costPerUnitPaise: 4000,
      });

      await api(app)
        .post(`${inventory}/ingredients/${onion.id}/stock-in`)
        .set(headers)
        .send({ quantity: 10 })
        .expect(201);

      await api(app)
        .post(`${inventory}/ingredients/${onion.id}/stock-in`)
        .set(headers)
        .send({ quantity: 10, costPerUnitPaise: 9000 })
        .expect(201);

      const movements = await movementsOf(headers, onion.id);

      // Newest first. The older delivery still says ₹400, not ₹900: a supplier
      // raising their price must not rewrite what last week cost.
      expect(Number(movements[0].valuePaise)).toBe(90000);
      expect(Number(movements[1].valuePaise)).toBe(40000);
    });

    it('refuses to take out more than is there', async () => {
      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 2,
      });

      const refused = await api(app)
        .post(`${inventory}/ingredients/${paneer.id}/wastage`)
        .set(headers)
        .send({ quantity: 3, reason: StockAdjustmentReason.SPOILAGE })
        .expect(400);

      expect(refused.body.message).toContain('2 kg');
      // Refused means refused: the figure has not moved and no movement exists.
      expect(await stockOf(headers, paneer.id)).toBe(2);
      expect(await movementsOf(headers, paneer.id)).toHaveLength(1);
    });

    it('allows it when the restaurant has said negative stock is acceptable', async () => {
      await enableInventory(headers, { allowNegativeStock: true });

      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 2,
      });

      await api(app)
        .post(`${inventory}/ingredients/${paneer.id}/wastage`)
        .set(headers)
        .send({ quantity: 3, reason: StockAdjustmentReason.SPOILAGE })
        .expect(201);

      expect(await stockOf(headers, paneer.id)).toBe(-1);
    });

    it('does not let a waiter change a stock figure', async () => {
      const waiter = auth(await memberWithRole(owner.restaurantId, UserRole.WAITER));
      const paneer = await createIngredient(headers, { name: 'Paneer', unit: IngredientUnit.KG });

      await api(app)
        .post(`${inventory}/ingredients/${paneer.id}/stock-in`)
        .set(waiter)
        .send({ quantity: 5 })
        .expect(403);

      // Reading is fine, though - a waiter who can see the paneer running out is
      // a waiter who stops promising it.
      await api(app).get(`${inventory}/stock`).set(waiter).expect(200);
    });
  });

  describe('selling a dish', () => {
    it('takes the recipe out of stock when the bill is settled', async () => {
      await enableInventory(headers);

      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
        costPerUnitPaise: 32000,
      });
      const dish = await createDish(headers, 'Paneer Tikka');
      await setRecipe(headers, dish.id, [
        { ingredientId: paneer.id, quantity: 150, unit: 'g' },
      ]);

      const order = await sellAndSettle(headers, [{ dishId: dish.id, quantity: 2 }]);

      // 10 kg less two lots of 150 g.
      expect(await stockOf(headers, paneer.id)).toBe(9.7);

      const [movement] = await movementsOf(headers, paneer.id);

      expect(movement).toMatchObject({
        movementType: InventoryMovementType.SALE_CONSUMPTION,
        quantity: 0.3,
        quantityBefore: 10,
        quantityAfter: 9.7,
        referenceType: 'ORDER',
        referenceId: order.id,
      });
      // 0.3 kg at ₹320/kg.
      expect(Number(movement.valuePaise)).toBe(9600);
    });

    it('deducts nothing until the bill is settled', async () => {
      await enableInventory(headers);

      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
      });
      const dish = await createDish(headers, 'Paneer Tikka');
      await setRecipe(headers, dish.id, [{ ingredientId: paneer.id, quantity: 150, unit: 'g' }]);

      await api(app)
        .post(orders)
        .set(headers)
        .send({ items: [{ dishId: dish.id, quantity: 2 }] })
        .expect(201);

      // An open bill can still change. Deducting now would mean a reversal for
      // every line a waiter removes.
      expect(await stockOf(headers, paneer.id)).toBe(10);
    });

    it('deducts once, however many times settlement is attempted', async () => {
      await enableInventory(headers);

      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
      });
      const dish = await createDish(headers, 'Paneer Tikka');
      await setRecipe(headers, dish.id, [{ ingredientId: paneer.id, quantity: 150, unit: 'g' }]);

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ items: [{ dishId: dish.id, quantity: 2 }] })
          .expect(201)
      ).body;

      await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      // A second settle is refused by the bill, not by inventory - but the
      // important part is that stock did not move again.
      await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(400);

      expect(await stockOf(headers, paneer.id)).toBe(9.7);
      expect(
        (await movementsOf(headers, paneer.id)).filter(
          (row) => row.movementType === InventoryMovementType.SALE_CONSUMPTION,
        ),
      ).toHaveLength(1);
    });

    it('ignores a cancelled line, which was never cooked', async () => {
      await enableInventory(headers);

      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
      });
      const dish = await createDish(headers, 'Paneer Tikka');
      await setRecipe(headers, dish.id, [{ ingredientId: paneer.id, quantity: 150, unit: 'g' }]);

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({
            items: [
              { dishId: dish.id, quantity: 1 },
              { dishId: dish.id, quantity: 1 },
            ],
          })
          .expect(201)
      ).body;

      await api(app)
        .post(`${orders}/${order.id}/items/${order.items[1].id}/cancel`)
        .set(headers)
        .send({ reason: 'Guest changed their mind' })
        .expect(200);

      await api(app)
        .post(`${orders}/${order.id}/settle`)
        .set(headers)
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      // One dish worth, not two.
      expect(await stockOf(headers, paneer.id)).toBe(9.85);
    });

    it('settles a dish that has no recipe without complaining', async () => {
      await enableInventory(headers);

      // Most restaurants will write recipes for their mains and never bother for
      // a bottle of water. That must not be an error.
      const water = await createDish(headers, 'Mineral Water', 40);

      await sellAndSettle(headers, [{ dishId: water.id, quantity: 2 }]);

      const movements = (await api(app).get(`${inventory}/movements`).set(headers).expect(200))
        .body as unknown[];

      expect(movements).toHaveLength(0);
    });

    it('settles the measurable lines and leaves an unmeasurable one alone', async () => {
      await enableInventory(headers);

      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
      });
      const masala = await createIngredient(headers, {
        name: 'Garam masala',
        unit: IngredientUnit.GRAM,
        openingQuantity: 500,
      });
      const dish = await createDish(headers, 'Paneer Tikka');

      await setRecipe(headers, dish.id, [
        { ingredientId: paneer.id, quantity: 150, unit: 'g' },
        // A real entry in a real menu, and not a fixed quantity of anything.
        { ingredientId: masala.id, quantity: 1, unit: 'tbsp' },
      ]);

      await sellAndSettle(headers, [{ dishId: dish.id, quantity: 1 }]);

      expect(await stockOf(headers, paneer.id)).toBe(9.85);
      expect(await stockOf(headers, masala.id)).toBe(500);
    });

    it('lets stock go negative on a sale, because the food has been eaten', async () => {
      // allowNegativeStock is false here, and it still goes through. A bill must
      // not be blocked by a stock figure that is almost certainly the thing that
      // is wrong; the negative reads as the warning it is.
      await enableInventory(headers);

      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 0.1,
      });
      const dish = await createDish(headers, 'Paneer Tikka');
      await setRecipe(headers, dish.id, [{ ingredientId: paneer.id, quantity: 150, unit: 'g' }]);

      await sellAndSettle(headers, [{ dishId: dish.id, quantity: 1 }]);

      expect(await stockOf(headers, paneer.id)).toBe(-0.05);
    });

    it('deducts nothing at all while inventory is switched off', async () => {
      // No enableInventory call. This is the state every existing restaurant is
      // in, and it is the single most important case in this file.
      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
      });
      const dish = await createDish(headers, 'Paneer Tikka');
      await setRecipe(headers, dish.id, [{ ingredientId: paneer.id, quantity: 150, unit: 'g' }]);

      await sellAndSettle(headers, [{ dishId: dish.id, quantity: 2 }]);

      expect(await stockOf(headers, paneer.id)).toBe(10);
      expect((await movementsOf(headers, paneer.id)).filter(
        (row) => row.movementType === InventoryMovementType.SALE_CONSUMPTION,
      )).toHaveLength(0);
    });
  });

  describe('the whole month, as a restaurant would live it', () => {
    it('follows 10 kg of paneer through sales, a delivery, wastage and a count', async () => {
      await enableInventory(headers);

      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
        costPerUnitPaise: 32000,
        minimumQuantity: 2,
      });
      const dish = await createDish(headers, 'Paneer Tikka');
      await setRecipe(headers, dish.id, [{ ingredientId: paneer.id, quantity: 150, unit: 'g' }]);

      // Two dishes sold: 10 - 0.3
      await sellAndSettle(headers, [{ dishId: dish.id, quantity: 2 }]);
      expect(await stockOf(headers, paneer.id)).toBe(9.7);

      // A delivery: + 5
      await api(app)
        .post(`${inventory}/ingredients/${paneer.id}/stock-in`)
        .set(headers)
        .send({ quantity: 5 })
        .expect(201);
      expect(await stockOf(headers, paneer.id)).toBe(14.7);

      // Half a kilo thrown away: - 0.5
      await api(app)
        .post(`${inventory}/ingredients/${paneer.id}/wastage`)
        .set(headers)
        .send({ quantity: 0.5, reason: StockAdjustmentReason.SPOILAGE, note: 'Left out overnight' })
        .expect(201);
      expect(await stockOf(headers, paneer.id)).toBe(14.2);

      // A count finds 14. The correction is the difference, not the total.
      await api(app)
        .post(`${inventory}/ingredients/${paneer.id}/adjust`)
        .set(headers)
        .send({
          quantity: 0.2,
          increase: false,
          reason: StockAdjustmentReason.COUNT_CORRECTION,
          note: 'Counted 14 at close',
        })
        .expect(201);
      expect(await stockOf(headers, paneer.id)).toBe(14);

      // Five movements, and every one of them explains a step.
      const movements = await movementsOf(headers, paneer.id);

      expect(movements.map((row) => row.movementType)).toEqual([
        InventoryMovementType.ADJUSTMENT_DECREASE,
        InventoryMovementType.WASTAGE,
        InventoryMovementType.STOCK_IN,
        InventoryMovementType.SALE_CONSUMPTION,
        InventoryMovementType.OPENING_STOCK,
      ]);

      // Read oldest first, each movement's "after" is the next one's "before",
      // which is what makes the ledger a chain rather than a pile.
      const chain = [...movements].reverse();
      for (let index = 1; index < chain.length; index += 1) {
        expect(chain[index].quantityBefore).toBe(chain[index - 1].quantityAfter);
      }
    });
  });

  describe('a physical count', () => {
    it('corrects by the difference and reports expected against actual', async () => {
      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
        costPerUnitPaise: 32000,
      });

      const { body } = await api(app)
        .post(`${inventory}/stock-count`)
        .set(headers)
        .send({ lines: [{ ingredientId: paneer.id, countedQuantity: 9.4 }], note: 'Monthly count' })
        .expect(201);

      expect(body.lines).toEqual([
        {
          ingredientId: paneer.id,
          ingredientName: 'Paneer',
          unit: IngredientUnit.KG,
          expected: 10,
          counted: 9.4,
          variance: -0.6,
          // 0.6 kg at 32000 paise is 19200 paise missing off the shelf.
          variancePaise: -19200,
        },
      ]);

      expect(await stockOf(headers, paneer.id)).toBe(9.4);

      const [movement] = await movementsOf(headers, paneer.id);

      expect(movement).toMatchObject({
        movementType: InventoryMovementType.ADJUSTMENT_DECREASE,
        quantity: 0.6,
        // The movement carries both halves of "expected versus actual" on its own.
        quantityBefore: 10,
        quantityAfter: 9.4,
        reason: StockAdjustmentReason.COUNT_CORRECTION,
        note: 'Monthly count',
      });
    });

    it('does nothing when the count agrees, however many times it is sent', async () => {
      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
      });

      const count = () =>
        api(app)
          .post(`${inventory}/stock-count`)
          .set(headers)
          .send({ lines: [{ ingredientId: paneer.id, countedQuantity: 10 }] })
          .expect(201);

      await count();
      await count();

      expect(await stockOf(headers, paneer.id)).toBe(10);
      // Only the opening movement. A count that agrees is not a change.
      expect(await movementsOf(headers, paneer.id)).toHaveLength(1);
    });

    it('leaves an ingredient that was not counted alone', async () => {
      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
      });
      const onion = await createIngredient(headers, {
        name: 'Onion',
        unit: IngredientUnit.KG,
        openingQuantity: 8,
      });

      await api(app)
        .post(`${inventory}/stock-count`)
        .set(headers)
        .send({ lines: [{ ingredientId: paneer.id, countedQuantity: 9 }] })
        .expect(201);

      // Not counted is not the same as counted as zero.
      expect(await stockOf(headers, onion.id)).toBe(8);
      expect(await stockOf(headers, paneer.id)).toBe(9);
    });

    it('counts up as well as down', async () => {
      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
      });

      const { body } = await api(app)
        .post(`${inventory}/stock-count`)
        .set(headers)
        .send({ lines: [{ ingredientId: paneer.id, countedQuantity: 11.5 }] })
        .expect(201);

      expect(body.lines[0].variance).toBe(1.5);
      expect(await stockOf(headers, paneer.id)).toBe(11.5);
    });

    it('cannot count another restaurant shelf', async () => {
      const other = await registerOwner(app, { restaurantName: 'Someone Else' });
      const theirs = await createIngredient(auth(other.accessToken), {
        name: 'Their Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
      });

      await api(app)
        .post(`${inventory}/stock-count`)
        .set(headers)
        .send({ lines: [{ ingredientId: theirs.id, countedQuantity: 1 }] })
        .expect(404);

      expect(await stockOf(auth(other.accessToken), theirs.id)).toBe(10);
    });
  });

  describe('the report', () => {
    it('separates what was sold, wasted, received and corrected', async () => {
      await enableInventory(headers);

      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
        costPerUnitPaise: 32000,
        minimumQuantity: 2,
      });
      const dish = await createDish(headers, 'Paneer Tikka');
      await setRecipe(headers, dish.id, [{ ingredientId: paneer.id, quantity: 150, unit: 'g' }]);

      await sellAndSettle(headers, [{ dishId: dish.id, quantity: 2 }]);

      await api(app)
        .post(`${inventory}/ingredients/${paneer.id}/stock-in`)
        .set(headers)
        .send({ quantity: 5 })
        .expect(201);

      await api(app)
        .post(`${inventory}/ingredients/${paneer.id}/wastage`)
        .set(headers)
        .send({ quantity: 0.5, reason: StockAdjustmentReason.SPOILAGE })
        .expect(201);

      const { body } = await api(app).get(`${inventory}/report`).set(headers).expect(200);

      expect(body.lines).toHaveLength(1);
      expect(body.lines[0]).toMatchObject({
        ingredientName: 'Paneer',
        consumed: 0.3,
        consumedPaise: 9600,
        wasted: 0.5,
        wastedPaise: 16000,
        // Opening stock counts as received: it is how the 10 kg got there.
        received: 15,
        adjusted: 0,
        onHand: 14.2,
      });

      expect(body.totals).toMatchObject({ consumedPaise: 9600, wastedPaise: 16000 });
    });

    it('names what is running low, worst first', async () => {
      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 1.8,
        minimumQuantity: 2,
        reorderQuantity: 10,
      });
      const onion = await createIngredient(headers, {
        name: 'Onion',
        unit: IngredientUnit.KG,
        openingQuantity: 0.5,
        minimumQuantity: 5,
      });
      // No minimum set, and almost empty: not a warning, because nobody asked to
      // be warned about it.
      await createIngredient(headers, {
        name: 'Saffron',
        unit: IngredientUnit.GRAM,
        openingQuantity: 1,
      });

      const { body } = await api(app).get(`${inventory}/report`).set(headers).expect(200);

      expect(body.lowStock).toEqual([
        {
          ingredientId: onion.id,
          ingredientName: 'Onion',
          unit: IngredientUnit.KG,
          onHand: 0.5,
          minimum: 5,
          reorderQuantity: 0,
        },
        {
          ingredientId: paneer.id,
          ingredientName: 'Paneer',
          unit: IngredientUnit.KG,
          onHand: 1.8,
          minimum: 2,
          reorderQuantity: 10,
        },
      ]);
    });

    it('shows nothing from another restaurant', async () => {
      const other = await registerOwner(app, { restaurantName: 'Someone Else' });
      await createIngredient(auth(other.accessToken), {
        name: 'Their Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
        costPerUnitPaise: 32000,
      });

      const { body } = await api(app).get(`${inventory}/report`).set(headers).expect(200);

      expect(body.lines).toEqual([]);
      expect(body.totals.onHandPaise).toBe(0);
    });

    it('reports a range with no movements as empty rather than failing', async () => {
      await createIngredient(headers, { name: 'Paneer', unit: IngredientUnit.KG });

      const { body } = await api(app)
        .get(`${inventory}/report?from=2020-01-01&to=2020-01-31`)
        .set(headers)
        .expect(200);

      expect(body.lines[0]).toMatchObject({ consumed: 0, wasted: 0, received: 0 });
    });
  });

  describe('tenancy', () => {
    it('cannot touch another restaurant stock, and cannot tell it exists', async () => {
      const other = await registerOwner(app, { restaurantName: 'Someone Else' });
      const otherHeaders = auth(other.accessToken);

      const theirs = await createIngredient(otherHeaders, {
        name: 'Their Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
      });

      // 404 rather than 403. A 403 would confirm the ingredient exists.
      await api(app)
        .post(`${inventory}/ingredients/${theirs.id}/stock-in`)
        .set(headers)
        .send({ quantity: 5 })
        .expect(404);

      await api(app)
        .post(`${inventory}/ingredients/${theirs.id}/wastage`)
        .set(headers)
        .send({ quantity: 1, reason: StockAdjustmentReason.SPOILAGE })
        .expect(404);

      expect(await stockOf(otherHeaders, theirs.id)).toBe(10);

      const mine = (await api(app).get(`${inventory}/stock`).set(headers).expect(200))
        .body as Ingredient[];
      expect(mine.map((row) => row.name)).not.toContain('Their Paneer');

      const theirMovements = (
        await api(app).get(`${inventory}/movements`).set(headers).expect(200)
      ).body as unknown[];
      expect(theirMovements).toHaveLength(0);
    });

    it('refuses a recipe line pointing at another restaurant ingredient', async () => {
      // Refused at the mapping endpoint, so no such row can exist for consumption
      // to follow. 400 rather than 404 here, and that is fine: the answer is the
      // same whether the ingredient belongs to someone else or does not exist, so
      // it still gives nothing away.
      const other = await registerOwner(app, { restaurantName: 'Someone Else' });
      const theirs = await createIngredient(auth(other.accessToken), {
        name: 'Their Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
      });

      const dish = await createDish(headers, 'Paneer Tikka');

      await api(app)
        .post(`/dishes/${dish.id}/ingredients`)
        .set(headers)
        .send({ ingredients: [{ ingredientId: theirs.id, quantity: 150, unit: 'g' }] })
        .expect(400);

      expect(await stockOf(auth(other.accessToken), theirs.id)).toBe(10);
    });
  });

  // SQLite serialises writers, so a race here proves nothing. These only mean
  // something against the engine production runs on.
  (isMysqlTestRun ? describe : describe.skip)('under concurrency (MySQL only)', () => {
    it('counts both of two deliveries that land at the same moment', async () => {
      const paneer = await createIngredient(headers, { name: 'Paneer', unit: IngredientUnit.KG });

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          api(app)
            .post(`${inventory}/ingredients/${paneer.id}/stock-in`)
            .set(headers)
            .send({ quantity: 2 }),
        ),
      );

      expect(results.every((response) => response.status === 201)).toBe(true);
      // The whole point of moving the figure by arithmetic in the database. A
      // read-modify-write would land on 2 and lose four deliveries silently.
      expect(await stockOf(headers, paneer.id)).toBe(10);
      expect(await movementsOf(headers, paneer.id)).toHaveLength(5);
    });

    it('never lets concurrent decreases overdraw the shelf', async () => {
      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 5,
      });

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          api(app)
            .post(`${inventory}/ingredients/${paneer.id}/wastage`)
            .set(headers)
            .send({ quantity: 2, reason: StockAdjustmentReason.SPOILAGE }),
        ),
      );

      const taken = results.filter((response) => response.status === 201).length;
      const refused = results.filter((response) => response.status === 400).length;

      // Two can succeed at most out of 5 kg in 2 kg lots, and the rest must be
      // told so rather than quietly driving the figure negative.
      expect(taken).toBe(2);
      expect(refused).toBe(3);
      expect(await stockOf(headers, paneer.id)).toBe(1);
    });

    it('deducts a bill once when two tills settle it at the same moment', async () => {
      await enableInventory(headers);

      const paneer = await createIngredient(headers, {
        name: 'Paneer',
        unit: IngredientUnit.KG,
        openingQuantity: 10,
      });
      const dish = await createDish(headers, 'Paneer Tikka');
      await setRecipe(headers, dish.id, [{ ingredientId: paneer.id, quantity: 150, unit: 'g' }]);

      const order = (
        await api(app)
          .post(orders)
          .set(headers)
          .send({ items: [{ dishId: dish.id, quantity: 2 }] })
          .expect(201)
      ).body;

      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          api(app)
            .post(`${orders}/${order.id}/settle`)
            .set(headers)
            .send({ paymentMethod: 'CASH' }),
        ),
      );

      expect(results.filter((response) => response.status === 200)).toHaveLength(1);
      expect(await stockOf(headers, paneer.id)).toBe(9.7);
      expect(
        (await movementsOf(headers, paneer.id)).filter(
          (row) => row.movementType === InventoryMovementType.SALE_CONSUMPTION,
        ),
      ).toHaveLength(1);
    });
  });
});
