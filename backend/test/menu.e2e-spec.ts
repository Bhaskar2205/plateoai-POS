import { INestApplication } from '@nestjs/common';
import {
  api,
  auth,
  createTestApp,
  registerOwner,
  type RegisteredOwner,
  type TestContext,
} from './test-app';

describe('Menu management (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let owner: RegisteredOwner;
  let headers: Record<string, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    owner = await registerOwner(app);
    headers = auth(owner.accessToken);
  });

  describe('Categories', () => {
    it('creates a category scoped to the authenticated restaurant', async () => {
      const response = await api(app)
        .post('/categories')
        .set(headers)
        .send({ name: 'Signature Bowls', sortOrder: 1 })
        .expect(201);

      expect(response.body).toMatchObject({
        name: 'Signature Bowls',
        sortOrder: 1,
        isActive: true,
        restaurantId: owner.restaurantId,
      });
    });

    it('ignores a restaurantId supplied in the body', async () => {
      // `forbidNonWhitelisted` means smuggling the tenant in is a hard 400,
      // not a silently ignored field.
      await api(app)
        .post('/categories')
        .set(headers)
        .send({ name: 'Smuggled', restaurantId: 9999 })
        .expect(400);
    });

    it('rejects a duplicate category name in the same restaurant', async () => {
      await api(app).post('/categories').set(headers).send({ name: 'Starters' }).expect(201);

      const response = await api(app)
        .post('/categories')
        .set(headers)
        .send({ name: 'Starters' })
        .expect(409);

      expect(response.body.error).toBe('Conflict');
    });

    it('allows the same category name in a different restaurant', async () => {
      await api(app).post('/categories').set(headers).send({ name: 'Starters' }).expect(201);

      const other = await registerOwner(app);
      await api(app)
        .post('/categories')
        .set(auth(other.accessToken))
        .send({ name: 'Starters' })
        .expect(201);
    });

    it('returns categories ordered by sortOrder then name', async () => {
      await api(app)
        .post('/categories')
        .set(headers)
        .send({ name: 'Desserts', sortOrder: 3 })
        .expect(201);
      await api(app)
        .post('/categories')
        .set(headers)
        .send({ name: 'Mains', sortOrder: 2 })
        .expect(201);
      await api(app)
        .post('/categories')
        .set(headers)
        .send({ name: 'Starters', sortOrder: 1 })
        .expect(201);

      const response = await api(app).get('/categories').set(headers).expect(200);

      expect(response.body.map((c: { name: string }) => c.name)).toEqual([
        'Starters',
        'Mains',
        'Desserts',
      ]);
    });

    it('filters by active status', async () => {
      await api(app).post('/categories').set(headers).send({ name: 'Live' }).expect(201);
      await api(app)
        .post('/categories')
        .set(headers)
        .send({ name: 'Hidden', isActive: false })
        .expect(201);

      const active = await api(app)
        .get('/categories')
        .query({ isActive: 'true' })
        .set(headers)
        .expect(200);

      expect(active.body).toHaveLength(1);
      expect(active.body[0].name).toBe('Live');
    });

    it('updates and deletes a category', async () => {
      const created = await api(app)
        .post('/categories')
        .set(headers)
        .send({ name: 'Temporary' })
        .expect(201);

      const updated = await api(app)
        .patch(`/categories/${created.body.id}`)
        .set(headers)
        .send({ name: 'Renamed', isActive: false, sortOrder: 7 })
        .expect(200);

      expect(updated.body).toMatchObject({ name: 'Renamed', isActive: false, sortOrder: 7 });

      await api(app).delete(`/categories/${created.body.id}`).set(headers).expect(204);
      await api(app).get(`/categories/${created.body.id}`).set(headers).expect(404);
    });

    it('keeps dishes when their category is deleted', async () => {
      const category = await api(app)
        .post('/categories')
        .set(headers)
        .send({ name: 'Doomed' })
        .expect(201);

      const dish = await api(app)
        .post('/dishes')
        .set(headers)
        .send({ categoryId: category.body.id, name: 'Survivor', price: 100 })
        .expect(201);

      await api(app).delete(`/categories/${category.body.id}`).set(headers).expect(204);

      const survivor = await api(app).get(`/dishes/${dish.body.id}`).set(headers).expect(200);
      expect(survivor.body.categoryId).toBeNull();
    });

    it('rejects an invalid payload with 400', async () => {
      await api(app).post('/categories').set(headers).send({ name: '' }).expect(400);
      await api(app)
        .post('/categories')
        .set(headers)
        .send({ name: 'Bad Sort', sortOrder: -1 })
        .expect(400);
    });
  });

  describe('Dishes', () => {
    let categoryId: number;

    beforeEach(async () => {
      const category = await api(app)
        .post('/categories')
        .set(headers)
        .send({ name: 'Bowls' })
        .expect(201);
      categoryId = category.body.id;
    });

    it('creates a dish with nutrition as entered by the restaurant', async () => {
      const response = await api(app)
        .post('/dishes')
        .set(headers)
        .send({
          categoryId,
          name: 'Paneer Tikka Bowl',
          description: 'Grilled paneer with fresh vegetables and mint dressing',
          price: 299,
          proteinGrams: 22,
          calories: 380,
          carbsGrams: 24,
          fatGrams: 19,
          isAvailable: true,
        })
        .expect(201);

      expect(response.body).toMatchObject({
        restaurantId: owner.restaurantId,
        categoryId,
        name: 'Paneer Tikka Bowl',
        price: 299,
        proteinGrams: 22,
        calories: 380,
        carbsGrams: 24,
        fatGrams: 19,
        isAvailable: true,
      });
    });

    it('stores prices exactly, without float drift', async () => {
      const response = await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name: 'Precise Price', price: 199.99 })
        .expect(201);

      const fetched = await api(app).get(`/dishes/${response.body.id}`).set(headers).expect(200);
      expect(fetched.body.price).toBe(199.99);
    });

    it('accepts a dish with no category', async () => {
      const response = await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name: 'Uncategorised', price: 149 })
        .expect(201);

      expect(response.body.categoryId).toBeNull();
    });

    it('records vegetarian / non-vegetarian classification', async () => {
      const response = await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name: 'Chicken Bowl', price: 349, dietType: 'NON_VEG' })
        .expect(201);

      expect(response.body.dietType).toBe('NON_VEG');
    });

    it.each([
      ['a negative price', { name: 'Bad', price: -1 }],
      ['a price with 3 decimal places', { name: 'Bad', price: 10.555 }],
      ['a missing price', { name: 'Bad' }],
      ['negative protein', { name: 'Bad', price: 10, proteinGrams: -5 }],
      ['implausible calories', { name: 'Bad', price: 10, calories: 999999 }],
      ['an invalid image URL', { name: 'Bad', price: 10, imageUrl: 'not-a-url' }],
      ['an unknown diet type', { name: 'Bad', price: 10, dietType: 'PESCATARIAN' }],
      ['a blank name', { name: '', price: 10 }],
    ])('rejects %s with 400', async (_label, payload) => {
      await api(app).post('/dishes').set(headers).send(payload).expect(400);
    });

    it('rejects a category belonging to another restaurant', async () => {
      const stranger = await registerOwner(app);
      const strangerCategory = await api(app)
        .post('/categories')
        .set(auth(stranger.accessToken))
        .send({ name: 'Stranger Category' })
        .expect(201);

      const response = await api(app)
        .post('/dishes')
        .set(headers)
        .send({ categoryId: strangerCategory.body.id, name: 'Cross Tenant', price: 100 })
        .expect(400);

      expect(response.body.message).toContain('does not belong to this restaurant');
    });

    it('filters by category, availability and name', async () => {
      await api(app)
        .post('/dishes')
        .set(headers)
        .send({ categoryId, name: 'Paneer Bowl', price: 100 })
        .expect(201);
      await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name: 'Mango Lassi', price: 80, isAvailable: false })
        .expect(201);

      const byCategory = await api(app)
        .get('/dishes')
        .query({ categoryId })
        .set(headers)
        .expect(200);
      expect(byCategory.body).toHaveLength(1);

      const available = await api(app)
        .get('/dishes')
        .query({ isAvailable: 'false' })
        .set(headers)
        .expect(200);
      expect(available.body.map((d: { name: string }) => d.name)).toEqual(['Mango Lassi']);

      const search = await api(app)
        .get('/dishes')
        .query({ search: 'lassi' })
        .set(headers)
        .expect(200);
      expect(search.body).toHaveLength(1);
    });

    it('toggles availability and corrects nutrition through PATCH', async () => {
      const dish = await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name: 'Adjustable', price: 200, calories: 500 })
        .expect(201);

      const updated = await api(app)
        .patch(`/dishes/${dish.body.id}`)
        .set(headers)
        .send({ isAvailable: false, calories: 420, proteinGrams: 18.5 })
        .expect(200);

      expect(updated.body).toMatchObject({
        isAvailable: false,
        calories: 420,
        proteinGrams: 18.5,
      });
    });

    it('deletes a dish', async () => {
      const dish = await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name: 'Doomed Dish', price: 100 })
        .expect(201);

      await api(app).delete(`/dishes/${dish.body.id}`).set(headers).expect(204);
      await api(app).get(`/dishes/${dish.body.id}`).set(headers).expect(404);
    });

    it('rejects a non-numeric id with 400', async () => {
      await api(app).get('/dishes/not-a-number').set(headers).expect(400);
    });
  });

  describe('Ingredients', () => {
    it('creates an ingredient with allergen information', async () => {
      const response = await api(app)
        .post('/ingredients')
        .set(headers)
        .send({
          name: 'Paneer',
          description: 'Fresh cottage cheese, made in house.',
          allergenInfo: 'Contains milk',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        restaurantId: owner.restaurantId,
        name: 'Paneer',
        allergenInfo: 'Contains milk',
      });
    });

    it('rejects a duplicate ingredient name so entries stay reusable', async () => {
      await api(app).post('/ingredients').set(headers).send({ name: 'Tomato' }).expect(201);
      await api(app).post('/ingredients').set(headers).send({ name: 'Tomato' }).expect(409);
    });

    it('lists ingredients alphabetically and supports search', async () => {
      await api(app).post('/ingredients').set(headers).send({ name: 'Zucchini' }).expect(201);
      await api(app).post('/ingredients').set(headers).send({ name: 'Almond' }).expect(201);

      const all = await api(app).get('/ingredients').set(headers).expect(200);
      expect(all.body.map((i: { name: string }) => i.name)).toEqual(['Almond', 'Zucchini']);

      const search = await api(app)
        .get('/ingredients')
        .query({ search: 'zuc' })
        .set(headers)
        .expect(200);
      expect(search.body).toHaveLength(1);
    });

    it('updates and deletes an ingredient', async () => {
      const created = await api(app)
        .post('/ingredients')
        .set(headers)
        .send({ name: 'Cashew' })
        .expect(201);

      const updated = await api(app)
        .patch(`/ingredients/${created.body.id}`)
        .set(headers)
        .send({ allergenInfo: 'Contains tree nuts' })
        .expect(200);
      expect(updated.body.allergenInfo).toBe('Contains tree nuts');

      await api(app).delete(`/ingredients/${created.body.id}`).set(headers).expect(204);
      await api(app).get(`/ingredients/${created.body.id}`).set(headers).expect(404);
    });

    it('rejects an invalid payload with 400', async () => {
      await api(app).post('/ingredients').set(headers).send({ name: '' }).expect(400);
      await api(app).post('/ingredients').set(headers).send({}).expect(400);
    });
  });

  describe('Dish ingredient mapping', () => {
    let dishId: number;
    let paneerId: number;
    let spinachId: number;

    beforeEach(async () => {
      const dish = await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name: 'Recipe Bowl', price: 299 })
        .expect(201);
      dishId = dish.body.id;

      const paneer = await api(app)
        .post('/ingredients')
        .set(headers)
        .send({ name: 'Paneer', allergenInfo: 'Contains milk' })
        .expect(201);
      paneerId = paneer.body.id;

      const spinach = await api(app)
        .post('/ingredients')
        .set(headers)
        .send({ name: 'Spinach' })
        .expect(201);
      spinachId = spinach.body.id;
    });

    it('maps ingredients to a dish', async () => {
      const response = await api(app)
        .post(`/dishes/${dishId}/ingredients`)
        .set(headers)
        .send({
          ingredients: [
            { ingredientId: paneerId, quantity: 100, unit: 'g' },
            { ingredientId: spinachId, quantity: 40, unit: 'g' },
          ],
        })
        .expect(201);

      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toMatchObject({
        dishId,
        ingredientId: paneerId,
        ingredientName: 'Paneer',
        allergenInfo: 'Contains milk',
        quantity: 100,
        unit: 'g',
      });
    });

    it('updates the quantity when the same ingredient is added again', async () => {
      await api(app)
        .post(`/dishes/${dishId}/ingredients`)
        .set(headers)
        .send({ ingredients: [{ ingredientId: paneerId, quantity: 100, unit: 'g' }] })
        .expect(201);

      const response = await api(app)
        .post(`/dishes/${dishId}/ingredients`)
        .set(headers)
        .send({ ingredients: [{ ingredientId: paneerId, quantity: 150, unit: 'g' }] })
        .expect(201);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].quantity).toBe(150);
    });

    it('replaces the full recipe on PATCH', async () => {
      await api(app)
        .post(`/dishes/${dishId}/ingredients`)
        .set(headers)
        .send({
          ingredients: [
            { ingredientId: paneerId, quantity: 100, unit: 'g' },
            { ingredientId: spinachId, quantity: 40, unit: 'g' },
          ],
        })
        .expect(201);

      const replaced = await api(app)
        .patch(`/dishes/${dishId}/ingredients`)
        .set(headers)
        .send({ ingredients: [{ ingredientId: spinachId, quantity: 60, unit: 'g' }] })
        .expect(200);

      expect(replaced.body).toHaveLength(1);
      expect(replaced.body[0]).toMatchObject({ ingredientId: spinachId, quantity: 60 });
    });

    it('clears the recipe when PATCH is given an empty list', async () => {
      await api(app)
        .post(`/dishes/${dishId}/ingredients`)
        .set(headers)
        .send({ ingredients: [{ ingredientId: paneerId, quantity: 100, unit: 'g' }] })
        .expect(201);

      const cleared = await api(app)
        .patch(`/dishes/${dishId}/ingredients`)
        .set(headers)
        .send({ ingredients: [] })
        .expect(200);

      expect(cleared.body).toEqual([]);
    });

    it('unmaps a single ingredient', async () => {
      await api(app)
        .post(`/dishes/${dishId}/ingredients`)
        .set(headers)
        .send({
          ingredients: [
            { ingredientId: paneerId, quantity: 100, unit: 'g' },
            { ingredientId: spinachId, quantity: 40, unit: 'g' },
          ],
        })
        .expect(201);

      await api(app)
        .delete(`/dishes/${dishId}/ingredients/${paneerId}`)
        .set(headers)
        .expect(204);

      const remaining = await api(app)
        .get(`/dishes/${dishId}/ingredients`)
        .set(headers)
        .expect(200);
      expect(remaining.body).toHaveLength(1);
      expect(remaining.body[0].ingredientId).toBe(spinachId);
    });

    it('404s when unmapping an ingredient that is not on the dish', async () => {
      await api(app)
        .delete(`/dishes/${dishId}/ingredients/${paneerId}`)
        .set(headers)
        .expect(404);
    });

    it('rejects an ingredient from another restaurant and writes nothing', async () => {
      const stranger = await registerOwner(app);
      const strangerIngredient = await api(app)
        .post('/ingredients')
        .set(auth(stranger.accessToken))
        .send({ name: 'Secret Sauce' })
        .expect(201);

      const response = await api(app)
        .post(`/dishes/${dishId}/ingredients`)
        .set(headers)
        .send({
          ingredients: [
            { ingredientId: paneerId, quantity: 100, unit: 'g' },
            { ingredientId: strangerIngredient.body.id, quantity: 10, unit: 'g' },
          ],
        })
        .expect(400);

      expect(response.body.message).toContain('do not belong to this restaurant');

      // The valid half of the payload must not have been written either.
      const current = await api(app)
        .get(`/dishes/${dishId}/ingredients`)
        .set(headers)
        .expect(200);
      expect(current.body).toEqual([]);
    });

    it('rejects the same ingredient listed twice', async () => {
      await api(app)
        .post(`/dishes/${dishId}/ingredients`)
        .set(headers)
        .send({
          ingredients: [
            { ingredientId: paneerId, quantity: 100, unit: 'g' },
            { ingredientId: paneerId, quantity: 50, unit: 'g' },
          ],
        })
        .expect(400);
    });

    it.each([
      ['a negative quantity', { ingredientId: 1, quantity: -5, unit: 'g' }],
      ['a missing unit', { ingredientId: 1, quantity: 5 }],
      ['a missing ingredientId', { quantity: 5, unit: 'g' }],
      ['too many decimal places', { ingredientId: 1, quantity: 1.23456, unit: 'g' }],
    ])('rejects %s with 400', async (_label, line) => {
      await api(app)
        .post(`/dishes/${dishId}/ingredients`)
        .set(headers)
        .send({ ingredients: [line] })
        .expect(400);
    });
  });
});
