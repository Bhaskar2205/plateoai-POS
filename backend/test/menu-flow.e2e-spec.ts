import { INestApplication } from '@nestjs/common';
import { DishIngredient } from 'src/modules/dishes/entities/dish-ingredient.entity';
import { api, auth, createTestApp, registerOwner, type TestContext } from './test-app';

/**
 * Menu management end to end: the owner journey the admin menu screen drives,
 * plus the guarantees behind saving a dish and its recipe in one request.
 */
describe('Menu management flow (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** Registers an owner, then signs in the way the admin UI does. */
  async function loginAsOwner(): Promise<Record<string, string>> {
    const owner = await registerOwner(app);

    const login = await api(app)
      .post('/auth/login')
      .send({ email: owner.email, password: owner.password })
      .expect(200);

    return auth(login.body.accessToken);
  }

  it('login → category → ingredient → dish → attach → edit → toggle → delete', async () => {
    // 1. Log in as a restaurant owner.
    const headers = await loginAsOwner();

    // 2. Create a category.
    const category = await api(app)
      .post('/categories')
      .set(headers)
      .send({ name: 'Signature Bowls', sortOrder: 1 })
      .expect(201);

    // 3. Create an ingredient.
    const ingredient = await api(app)
      .post('/ingredients')
      .set(headers)
      .send({ name: 'Paneer', allergenInfo: 'Contains milk' })
      .expect(201);

    // 4. Create a dish.
    const dish = await api(app)
      .post('/dishes')
      .set(headers)
      .send({
        categoryId: category.body.id,
        name: 'Paneer Tikka Bowl',
        description: 'Grilled paneer with fresh vegetables and mint dressing',
        price: 299,
        preparationTimeMinutes: 15,
        proteinGrams: 22,
        calories: 380,
      })
      .expect(201);

    expect(dish.body).toMatchObject({
      name: 'Paneer Tikka Bowl',
      price: 299,
      preparationTimeMinutes: 15,
      isAvailable: true,
      category: { id: category.body.id, name: 'Signature Bowls' },
    });

    // 5. Attach the ingredient to the dish.
    const recipe = await api(app)
      .post(`/dishes/${dish.body.id}/ingredients`)
      .set(headers)
      .send({ ingredients: [{ ingredientId: ingredient.body.id, quantity: 120, unit: 'g' }] })
      .expect(201);

    expect(recipe.body).toEqual([
      expect.objectContaining({
        ingredientId: ingredient.body.id,
        ingredientName: 'Paneer',
        quantity: 120,
        unit: 'g',
      }),
    ]);

    // 6. Edit the dish.
    const edited = await api(app)
      .patch(`/dishes/${dish.body.id}`)
      .set(headers)
      .send({ name: 'Paneer Tikka Power Bowl', price: 329, preparationTimeMinutes: 18 })
      .expect(200);

    expect(edited.body).toMatchObject({
      name: 'Paneer Tikka Power Bowl',
      price: 329,
      preparationTimeMinutes: 18,
    });

    // Editing the dish without an `ingredients` key leaves the recipe alone.
    const recipeAfterEdit = await api(app)
      .get(`/dishes/${dish.body.id}/ingredients`)
      .set(headers)
      .expect(200);
    expect(recipeAfterEdit.body).toHaveLength(1);

    // 7. Toggle dish availability.
    const toggled = await api(app)
      .patch(`/dishes/${dish.body.id}`)
      .set(headers)
      .send({ isAvailable: false })
      .expect(200);
    expect(toggled.body.isAvailable).toBe(false);

    const unavailable = await api(app)
      .get('/dishes')
      .query({ isAvailable: 'false' })
      .set(headers)
      .expect(200);
    expect(unavailable.body.map((row: { id: number }) => row.id)).toEqual([dish.body.id]);

    // 8. Delete the dish.
    await api(app).delete(`/dishes/${dish.body.id}`).set(headers).expect(204);
    await api(app).get(`/dishes/${dish.body.id}`).set(headers).expect(404);

    // The recipe lines go with the dish; the reusable ingredient and category stay.
    const orphanLines = await ctx.dataSource
      .getRepository(DishIngredient)
      .count({ where: { dishId: dish.body.id } });
    expect(orphanLines).toBe(0);
    await api(app).get(`/ingredients/${ingredient.body.id}`).set(headers).expect(200);
    await api(app).get(`/categories/${category.body.id}`).set(headers).expect(200);
  });

  describe('dish and recipe in one request', () => {
    let headers: Record<string, string>;
    let paneerId: number;
    let spinachId: number;

    beforeEach(async () => {
      headers = await loginAsOwner();

      paneerId = (
        await api(app).post('/ingredients').set(headers).send({ name: 'Paneer' }).expect(201)
      ).body.id;
      spinachId = (
        await api(app).post('/ingredients').set(headers).send({ name: 'Spinach' }).expect(201)
      ).body.id;
    });

    it('creates the dish with its recipe', async () => {
      const dish = await api(app)
        .post('/dishes')
        .set(headers)
        .send({
          name: 'Palak Paneer',
          price: 279,
          ingredients: [
            { ingredientId: paneerId, quantity: 100, unit: 'g' },
            { ingredientId: spinachId, quantity: 150, unit: 'g' },
          ],
        })
        .expect(201);

      const recipe = await api(app)
        .get(`/dishes/${dish.body.id}/ingredients`)
        .set(headers)
        .expect(200);

      expect(recipe.body.map((line: { ingredientId: number }) => line.ingredientId).sort()).toEqual(
        [paneerId, spinachId].sort(),
      );
    });

    it('creates nothing when the recipe references another restaurant ingredient', async () => {
      const strangerHeaders = await loginAsOwner();
      const foreign = await api(app)
        .post('/ingredients')
        .set(strangerHeaders)
        .send({ name: 'Secret Masala' })
        .expect(201);

      const response = await api(app)
        .post('/dishes')
        .set(headers)
        .send({
          name: 'Should Not Exist',
          price: 199,
          ingredients: [
            { ingredientId: paneerId, quantity: 100, unit: 'g' },
            { ingredientId: foreign.body.id, quantity: 5, unit: 'g' },
          ],
        })
        .expect(400);

      expect(response.body.message).toContain('do not belong to this restaurant');

      const dishes = await api(app).get('/dishes').set(headers).expect(200);
      expect(dishes.body).toEqual([]);
    });

    it('replaces the recipe on update, and leaves dish fields untouched when that fails', async () => {
      const dish = await api(app)
        .post('/dishes')
        .set(headers)
        .send({
          name: 'Original Name',
          price: 250,
          ingredients: [{ ingredientId: paneerId, quantity: 100, unit: 'g' }],
        })
        .expect(201);

      await api(app)
        .patch(`/dishes/${dish.body.id}`)
        .set(headers)
        .send({ ingredients: [{ ingredientId: spinachId, quantity: 80, unit: 'g' }] })
        .expect(200);

      const replaced = await api(app)
        .get(`/dishes/${dish.body.id}/ingredients`)
        .set(headers)
        .expect(200);
      expect(replaced.body).toEqual([
        expect.objectContaining({ ingredientId: spinachId, quantity: 80 }),
      ]);

      // A bad recipe must not let the rename through either.
      await api(app)
        .patch(`/dishes/${dish.body.id}`)
        .set(headers)
        .send({
          name: 'Half-Applied Rename',
          ingredients: [{ ingredientId: 999999, quantity: 1, unit: 'g' }],
        })
        .expect(400);

      const unchanged = await api(app).get(`/dishes/${dish.body.id}`).set(headers).expect(200);
      expect(unchanged.body.name).toBe('Original Name');
    });

    it('clears the recipe when updated with an empty list', async () => {
      const dish = await api(app)
        .post('/dishes')
        .set(headers)
        .send({
          name: 'Clearable',
          price: 150,
          ingredients: [{ ingredientId: paneerId, quantity: 50, unit: 'g' }],
        })
        .expect(201);

      await api(app)
        .patch(`/dishes/${dish.body.id}`)
        .set(headers)
        .send({ ingredients: [] })
        .expect(200);

      const recipe = await api(app)
        .get(`/dishes/${dish.body.id}/ingredients`)
        .set(headers)
        .expect(200);
      expect(recipe.body).toEqual([]);
    });

    it('rejects an ingredient listed twice', async () => {
      await api(app)
        .post('/dishes')
        .set(headers)
        .send({
          name: 'Double Paneer',
          price: 300,
          ingredients: [
            { ingredientId: paneerId, quantity: 50, unit: 'g' },
            { ingredientId: paneerId, quantity: 60, unit: 'g' },
          ],
        })
        .expect(400);
    });
  });

  describe('preparation time', () => {
    let headers: Record<string, string>;

    beforeEach(async () => {
      headers = await loginAsOwner();
    });

    it.each([
      ['zero minutes', 0],
      ['more than ten hours', 601],
      ['a fractional value', 12.5],
      ['a string', 'soon'],
    ])('rejects %s with 400', async (_label, value) => {
      const response = await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name: 'Timed', price: 100, preparationTimeMinutes: value })
        .expect(400);

      expect(response.body.details.join(' ')).toContain('preparationTimeMinutes');
    });

    it('is optional, and can be cleared with null', async () => {
      const created = await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name: 'No Timer', price: 100 })
        .expect(201);
      expect(created.body.preparationTimeMinutes).toBeNull();

      await api(app)
        .patch(`/dishes/${created.body.id}`)
        .set(headers)
        .send({ preparationTimeMinutes: 20 })
        .expect(200);

      const cleared = await api(app)
        .patch(`/dishes/${created.body.id}`)
        .set(headers)
        .send({ preparationTimeMinutes: null })
        .expect(200);
      expect(cleared.body.preparationTimeMinutes).toBeNull();
    });
  });

  describe('clearing optional fields on edit', () => {
    it('clears dish fields sent as null, as the admin form does for blank inputs', async () => {
      const headers = await loginAsOwner();

      const dish = await api(app)
        .post('/dishes')
        .set(headers)
        .send({
          name: 'Fully Described',
          price: 200,
          description: 'Something tasty',
          imageUrl: 'https://cdn.example.com/dish.jpg',
          dietType: 'VEG',
          calories: 450,
          preparationTimeMinutes: 10,
        })
        .expect(201);

      const cleared = await api(app)
        .patch(`/dishes/${dish.body.id}`)
        .set(headers)
        .send({
          description: null,
          imageUrl: null,
          dietType: null,
          calories: null,
          preparationTimeMinutes: null,
          categoryId: null,
        })
        .expect(200);

      expect(cleared.body).toMatchObject({
        description: null,
        imageUrl: null,
        dietType: null,
        calories: null,
        preparationTimeMinutes: null,
        categoryId: null,
      });
    });

    it('clears ingredient text fields sent as empty strings', async () => {
      const headers = await loginAsOwner();

      const ingredient = await api(app)
        .post('/ingredients')
        .set(headers)
        .send({ name: 'Cashew', description: 'Roasted', allergenInfo: 'Contains tree nuts' })
        .expect(201);

      const cleared = await api(app)
        .patch(`/ingredients/${ingredient.body.id}`)
        .set(headers)
        .send({ name: 'Cashew', description: '', allergenInfo: '' })
        .expect(200);

      expect(cleared.body).toMatchObject({ description: null, allergenInfo: null });
    });
  });

  it('rejects unauthenticated menu writes', async () => {
    await api(app).post('/categories').send({ name: 'Nope' }).expect(401);
    await api(app).post('/dishes').send({ name: 'Nope', price: 1 }).expect(401);
    await api(app).patch('/dishes/1').send({ isAvailable: false }).expect(401);
    await api(app).delete('/dishes/1').expect(401);
  });
});
