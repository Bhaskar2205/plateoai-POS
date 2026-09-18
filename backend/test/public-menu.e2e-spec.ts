import { INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { RestaurantStatus } from 'src/common/enums';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import {
  api,
  auth,
  createTestApp,
  registerOwner,
  type RegisteredOwner,
  type TestContext,
} from './test-app';

/** Every key the public menu is allowed to contain, at any depth. */
const ALLOWED_KEYS = new Set([
  // PublicMenuDto
  'restaurant', 'table', 'currency', 'categories', 'uncategorisedDishes', 'disclaimer',
  // PublicRestaurantDto
  'name', 'slug', 'description', 'address', 'logoUrl',
  // PublicCategoryDto
  'id', 'dishes',
  // PublicDishDto
  'price', 'imageUrl', 'preparationTimeMinutes', 'dietType', 'nutrition', 'ingredients', 'allergens',
  // PublicNutritionDto
  'calories', 'proteinGrams', 'carbsGrams', 'fatGrams', 'source',
  // PublicIngredientDto
  'quantity', 'unit', 'allergenInfo',
]);

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

describe('Public menu (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;

  let owner: RegisteredOwner;
  let rival: RegisteredOwner;
  let slug: string;
  let rivalSlug: string;
  let unavailableDishId: number;

  const menuPath = (restaurantSlug: string) => `/public/restaurants/${restaurantSlug}/menu`;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;

    owner = await registerOwner(app, {
      restaurantName: 'Public Menu Kitchen',
      email: 'public-owner@example.com',
    });
    rival = await registerOwner(app, {
      restaurantName: 'Rival Diner',
      email: 'rival-owner@example.com',
    });

    const headers = auth(owner.accessToken);
    const post = async (path: string, body: object) =>
      (await api(app).post(path).set(headers).send(body).expect(201)).body;

    await api(app)
      .patch('/restaurants/me')
      .set(headers)
      .send({
        description: 'Seasonal bowls.',
        phone: '+919876543210',
        logoUrl: 'https://cdn.example.com/logo.png',
      })
      .expect(200);
    slug = (await api(app).get('/restaurants/me').set(headers).expect(200)).body.slug;

    const bowls = await post('/categories', { name: 'Bowls', sortOrder: 1 });
    const drinks = await post('/categories', { name: 'Drinks', sortOrder: 2 });
    const hidden = await post('/categories', { name: 'Staff Specials', sortOrder: 3, isActive: false });
    await post('/categories', { name: 'Empty Section', sortOrder: 4 });

    const paneer = await post('/ingredients', { name: 'Paneer', allergenInfo: 'Contains milk' });
    const cashew = await post('/ingredients', { name: 'Cashew', allergenInfo: 'Contains tree nuts' });
    const spinach = await post('/ingredients', { name: 'Spinach' });
    const cream = await post('/ingredients', { name: 'Cream', allergenInfo: 'Contains milk' });

    await post('/dishes', {
      categoryId: bowls.id,
      name: 'Palak Paneer Bowl',
      description: 'Spinach, paneer and cashew cream',
      price: 299.5,
      imageUrl: 'https://cdn.example.com/palak.jpg',
      preparationTimeMinutes: 15,
      dietType: 'VEG',
      calories: 420,
      proteinGrams: 21.5,
      ingredients: [
        { ingredientId: paneer.id, quantity: 120, unit: 'g' },
        { ingredientId: spinach.id, quantity: 80.5, unit: 'g' },
        { ingredientId: cashew.id, quantity: 15, unit: 'g' },
        { ingredientId: cream.id, quantity: 20, unit: 'ml' },
      ],
    });

    unavailableDishId = (
      await post('/dishes', { categoryId: bowls.id, name: 'Sold Out Bowl', price: 250, isAvailable: false })
    ).id;
    await post('/dishes', { categoryId: hidden.id, name: 'Secret Staff Curry', price: 100 });
    await post('/dishes', { categoryId: drinks.id, name: 'Mango Lassi', price: 129 });
    await post('/dishes', { name: 'Chef Surprise', price: 350 });

    const rivalHeaders = auth(rival.accessToken);
    const rivalIngredient = (
      await api(app).post('/ingredients').set(rivalHeaders).send({ name: 'Rival Sauce' }).expect(201)
    ).body;
    await api(app)
      .post('/dishes')
      .set(rivalHeaders)
      .send({
        name: 'Rival Special',
        price: 500,
        ingredients: [{ ingredientId: rivalIngredient.id, quantity: 10, unit: 'g' }],
      })
      .expect(201);
    rivalSlug = (await api(app).get('/restaurants/me').set(rivalHeaders).expect(200)).body.slug;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('is reachable without any authentication', async () => {
    const response = await api(app).get(menuPath(slug)).expect(200);

    expect(response.body.restaurant).toEqual({
      name: 'Public Menu Kitchen',
      slug,
      description: 'Seasonal bowls.',
      address: 'Jaipur, Rajasthan',
      logoUrl: 'https://cdn.example.com/logo.png',
    });
    expect(response.body.currency).toBe('INR');
    expect(response.body.disclaimer).toContain('has not been verified by Plateo');
  });

  it('lists active categories with available dishes, in sort order', async () => {
    const { body } = await api(app).get(menuPath(slug)).expect(200);

    expect(body.categories.map((category: { name: string }) => category.name)).toEqual([
      'Bowls',
      'Drinks',
    ]);
  });

  it('never includes unavailable dishes', async () => {
    const { body } = await api(app).get(menuPath(slug)).expect(200);
    const serialised = JSON.stringify(body);

    expect(serialised).not.toContain('Sold Out Bowl');
    expect(body.categories[0].dishes.map((dish: { name: string }) => dish.name)).toEqual([
      'Palak Paneer Bowl',
    ]);
  });

  it('hides inactive categories together with their dishes, and omits empty categories', async () => {
    const serialised = JSON.stringify((await api(app).get(menuPath(slug)).expect(200)).body);

    expect(serialised).not.toContain('Staff Specials');
    expect(serialised).not.toContain('Secret Staff Curry');
    expect(serialised).not.toContain('Empty Section');
  });

  it('returns available uncategorised dishes separately', async () => {
    const { body } = await api(app).get(menuPath(slug)).expect(200);

    expect(body.uncategorisedDishes.map((dish: { name: string }) => dish.name)).toEqual([
      'Chef Surprise',
    ]);
  });

  it('returns full dish detail: price, prep time, diet, nutrition, ingredients and allergens', async () => {
    const { body } = await api(app).get(menuPath(slug)).expect(200);
    const dish = body.categories[0].dishes[0];

    expect(dish).toEqual({
      id: expect.any(Number),
      name: 'Palak Paneer Bowl',
      description: 'Spinach, paneer and cashew cream',
      price: 299.5,
      imageUrl: 'https://cdn.example.com/palak.jpg',
      preparationTimeMinutes: 15,
      dietType: 'VEG',
      nutrition: {
        calories: 420,
        proteinGrams: 21.5,
        carbsGrams: null,
        fatGrams: null,
        source: 'RESTAURANT_DECLARED',
      },
      ingredients: [
        { name: 'Paneer', quantity: 120, unit: 'g', allergenInfo: 'Contains milk' },
        { name: 'Spinach', quantity: 80.5, unit: 'g', allergenInfo: null },
        { name: 'Cashew', quantity: 15, unit: 'g', allergenInfo: 'Contains tree nuts' },
        { name: 'Cream', quantity: 20, unit: 'ml', allergenInfo: 'Contains milk' },
      ],
      // Deduplicated ("Contains milk" appears on two ingredients) and sorted.
      allergens: ['Contains milk', 'Contains tree nuts'],
    });
  });

  it('reports nutrition as null when none was entered', async () => {
    const { body } = await api(app).get(menuPath(slug)).expect(200);

    expect(body.categories[1].dishes[0]).toMatchObject({ name: 'Mango Lassi', nutrition: null, ingredients: [], allergens: [] });
  });

  it('contains only allow-listed fields - no tenant ids, contact details, members or audit data', async () => {
    const { body } = await api(app).get(menuPath(slug)).expect(200);

    const unexpected = [...collectKeys(body)].filter((key) => !ALLOWED_KEYS.has(key));
    expect(unexpected).toEqual([]);

    const serialised = JSON.stringify(body);
    for (const forbidden of [
      'restaurantId',
      'categoryId',
      'passwordHash',
      'argon2',
      'public-owner@example.com',
      '+919876543210',
      'createdAt',
      'updatedAt',
      'ACTIVE',
      'isAvailable',
      'isActive',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('never leaks another restaurant data into a menu', async () => {
    const own = JSON.stringify((await api(app).get(menuPath(slug)).expect(200)).body);
    expect(own).not.toContain('Rival');

    const rivalMenu = (await api(app).get(menuPath(rivalSlug)).expect(200)).body;
    expect(rivalMenu.restaurant.name).toBe('Rival Diner');
    const rivalSerialised = JSON.stringify(rivalMenu);
    expect(rivalSerialised).toContain('Rival Special');
    expect(rivalSerialised).toContain('Rival Sauce');
    expect(rivalSerialised).not.toContain('Palak Paneer Bowl');
    expect(rivalSerialised).not.toContain('Public Menu Kitchen');
  });

  it('ignores any bearer token: the result depends only on the slug', async () => {
    const anonymous = (await api(app).get(menuPath(slug)).expect(200)).body;

    const withRivalToken = (
      await api(app).get(menuPath(slug)).set(auth(rival.accessToken)).expect(200)
    ).body;
    const withGarbageToken = (
      await api(app).get(menuPath(slug)).set(auth('not.a.real.token')).expect(200)
    ).body;

    expect(withRivalToken).toEqual(anonymous);
    expect(withGarbageToken).toEqual(anonymous);
  });

  it('reflects availability changes on the very next request', async () => {
    await api(app)
      .patch(`/dishes/${unavailableDishId}`)
      .set(auth(owner.accessToken))
      .send({ isAvailable: true })
      .expect(200);

    const shown = JSON.stringify((await api(app).get(menuPath(slug)).expect(200)).body);
    expect(shown).toContain('Sold Out Bowl');

    await api(app)
      .patch(`/dishes/${unavailableDishId}`)
      .set(auth(owner.accessToken))
      .send({ isAvailable: false })
      .expect(200);

    const hiddenAgain = JSON.stringify((await api(app).get(menuPath(slug)).expect(200)).body);
    expect(hiddenAgain).not.toContain('Sold Out Bowl');
  });

  it('is not cached, so hidden dishes cannot linger in a cache', async () => {
    const response = await api(app).get(menuPath(slug)).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  describe('not found', () => {
    it('returns 404 for an unknown slug', async () => {
      const response = await api(app).get(menuPath('no-such-restaurant')).expect(404);
      expect(response.body.message).toBe('This menu is not available.');
    });

    it.each([
      ['uppercase and spaces', 'Public%20Menu'],
      ['path-like input', '..%2F..%2Fauth'],
      ['SQL-like input', "x'%20OR%20'1'%3D'1"],
      ['an overlong slug', 'a'.repeat(191)],
    ])('returns the same 404 for %s', async (_label, bad) => {
      const response = await api(app).get(menuPath(bad)).expect(404);
      expect(response.body.message).toBe('This menu is not available.');
    });

    it('treats a suspended restaurant exactly like an unknown one', async () => {
      await ctx.dataSource
        .getRepository(Restaurant)
        .update({ id: rival.restaurantId }, { status: RestaurantStatus.INACTIVE });

      const suspended = await api(app).get(menuPath(rivalSlug)).expect(404);
      const unknown = await api(app).get(menuPath('no-such-restaurant')).expect(404);
      expect(suspended.body.message).toBe(unknown.body.message);

      await ctx.dataSource
        .getRepository(Restaurant)
        .update({ id: rival.restaurantId }, { status: RestaurantStatus.ACTIVE });
    });

    it('returns an empty but valid menu for a restaurant with nothing available', async () => {
      const fresh = await registerOwner(app, { restaurantName: 'Brand New Place' });
      const freshSlug = (
        await api(app).get('/restaurants/me').set(auth(fresh.accessToken)).expect(200)
      ).body.slug;

      const { body } = await api(app).get(menuPath(freshSlug)).expect(200);
      expect(body.categories).toEqual([]);
      expect(body.uncategorisedDishes).toEqual([]);
    });
  });

  it('is read-only: other methods on the path are not routed', async () => {
    await api(app).post(menuPath(slug)).send({}).expect(404);
    await api(app).patch(menuPath(slug)).send({}).expect(404);
    await api(app).delete(menuPath(slug)).expect(404);
  });

  it('is documented in Swagger as unauthenticated', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth(undefined, 'access-token').build(),
    );
    const operation = document.paths['/public/restaurants/{slug}/menu']?.get;

    expect(operation).toBeDefined();
    expect(operation!.security).toBeUndefined();
    expect(operation!.responses['200']).toBeDefined();
    expect(operation!.responses['404']).toBeDefined();
  });
});
