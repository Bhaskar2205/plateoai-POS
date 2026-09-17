import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { RestaurantUser } from 'src/modules/restaurants/entities/restaurant-user.entity';
import {
  api,
  auth,
  createTestApp,
  registerOwner,
  type RegisteredOwner,
  type TestContext,
} from './test-app';

/**
 * The security backbone of the platform: restaurant A must not be able to read,
 * change or delete anything belonging to restaurant B, even when it knows the
 * exact record ids.
 */
describe('Cross-restaurant isolation (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  let alice: RegisteredOwner;
  let bob: RegisteredOwner;
  let aliceHeaders: Record<string, string>;
  let bobHeaders: Record<string, string>;

  /** Ids owned by Alice that Bob will try to reach. */
  let aliceCategoryId: number;
  let aliceDishId: number;
  let aliceIngredientId: number;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    alice = await registerOwner(app, { restaurantName: 'Alice Kitchen' });
    bob = await registerOwner(app, { restaurantName: 'Bob Kitchen' });
    aliceHeaders = auth(alice.accessToken);
    bobHeaders = auth(bob.accessToken);

    const category = await api(app)
      .post('/categories')
      .set(aliceHeaders)
      .send({ name: 'Alice Bowls' })
      .expect(201);
    aliceCategoryId = category.body.id;

    const dish = await api(app)
      .post('/dishes')
      .set(aliceHeaders)
      .send({ categoryId: aliceCategoryId, name: 'Alice Signature Bowl', price: 349 })
      .expect(201);
    aliceDishId = dish.body.id;

    const ingredient = await api(app)
      .post('/ingredients')
      .set(aliceHeaders)
      .send({ name: 'Alice Secret Spice' })
      .expect(201);
    aliceIngredientId = ingredient.body.id;
  });

  describe('reads', () => {
    it('hides another restaurant records from list endpoints', async () => {
      const [categories, dishes, ingredients] = await Promise.all([
        api(app).get('/categories').set(bobHeaders).expect(200),
        api(app).get('/dishes').set(bobHeaders).expect(200),
        api(app).get('/ingredients').set(bobHeaders).expect(200),
      ]);

      expect(categories.body).toEqual([]);
      expect(dishes.body).toEqual([]);
      expect(ingredients.body).toEqual([]);
    });

    it.each([
      ['category', () => `/categories/${aliceCategoryId}`],
      ['dish', () => `/dishes/${aliceDishId}`],
      ['ingredient', () => `/ingredients/${aliceIngredientId}`],
      ['dish recipe', () => `/dishes/${aliceDishId}/ingredients`],
    ])('404s when fetching another restaurant %s by id', async (_label, path) => {
      await api(app).get(path()).set(bobHeaders).expect(404);
    });
  });

  describe('writes', () => {
    it.each([
      ['category', () => `/categories/${aliceCategoryId}`, { name: 'Hijacked' }],
      ['dish', () => `/dishes/${aliceDishId}`, { name: 'Hijacked', price: 1 }],
      ['ingredient', () => `/ingredients/${aliceIngredientId}`, { name: 'Hijacked' }],
    ])('404s when updating another restaurant %s', async (_label, path, payload) => {
      await api(app).patch(path()).set(bobHeaders).send(payload).expect(404);
    });

    it.each([
      ['category', () => `/categories/${aliceCategoryId}`],
      ['dish', () => `/dishes/${aliceDishId}`],
      ['ingredient', () => `/ingredients/${aliceIngredientId}`],
    ])('404s when deleting another restaurant %s', async (_label, path) => {
      await api(app).delete(path()).set(bobHeaders).expect(404);
    });

    it('leaves the target intact after a failed cross-restaurant delete', async () => {
      await api(app).delete(`/dishes/${aliceDishId}`).set(bobHeaders).expect(404);

      const stillThere = await api(app)
        .get(`/dishes/${aliceDishId}`)
        .set(aliceHeaders)
        .expect(200);
      expect(stillThere.body.name).toBe('Alice Signature Bowl');
    });

    it('refuses to attach another restaurant ingredient to a dish', async () => {
      const bobDish = await api(app)
        .post('/dishes')
        .set(bobHeaders)
        .send({ name: 'Bob Bowl', price: 199 })
        .expect(201);

      await api(app)
        .post(`/dishes/${bobDish.body.id}/ingredients`)
        .set(bobHeaders)
        .send({ ingredients: [{ ingredientId: aliceIngredientId, quantity: 10, unit: 'g' }] })
        .expect(400);
    });

    it('refuses to unmap an ingredient from another restaurant dish', async () => {
      await api(app)
        .delete(`/dishes/${aliceDishId}/ingredients/${aliceIngredientId}`)
        .set(bobHeaders)
        .expect(404);
    });

    it('cannot edit another restaurant profile - PATCH only ever hits your own', async () => {
      await api(app)
        .patch('/restaurants/me')
        .set(bobHeaders)
        .send({ name: 'Bob Renamed' })
        .expect(200);

      const aliceProfile = await api(app)
        .get('/restaurants/me')
        .set(aliceHeaders)
        .expect(200);
      expect(aliceProfile.body.name).toBe('Alice Kitchen');
    });
  });

  describe('token tampering', () => {
    it('rejects a validly signed token whose restaurant membership does not exist', async () => {
      // Worst case: an attacker who can mint tokens with our own signing key
      // still cannot reach a restaurant they are not a member of, because the
      // membership row is re-checked on every request.
      const jwtService = app.get(JwtService);
      const forged = await jwtService.signAsync({
        sub: bob.userId,
        email: bob.email,
        rid: alice.restaurantId,
      });

      await api(app).get('/restaurants/me').set(auth(forged)).expect(401);
    });

    it('stops honouring a token once the membership is revoked', async () => {
      await api(app).get('/restaurants/me').set(aliceHeaders).expect(200);

      await dataSource
        .getRepository(RestaurantUser)
        .delete({ userId: alice.userId, restaurantId: alice.restaurantId });

      await api(app).get('/restaurants/me').set(aliceHeaders).expect(401);
    });
  });

  describe('unauthenticated access', () => {
    it.each([
      ['GET', '/restaurants/me'],
      ['GET', '/restaurants/me/users'],
      ['GET', '/restaurants/me/stats'],
      ['GET', '/categories'],
      ['POST', '/categories'],
      ['GET', '/dishes'],
      ['POST', '/dishes'],
      ['GET', '/ingredients'],
      ['POST', '/ingredients'],
      ['GET', '/auth/me'],
    ])('rejects %s %s with 401', async (method, path) => {
      const request = api(app);
      const call =
        method === 'GET' ? request.get(path) : request.post(path).send({ name: 'x', price: 1 });

      await call.expect(401);
    });

    it('rejects a token with a valid shape but a bad signature', async () => {
      await api(app)
        .get('/categories')
        .set(auth('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.not-a-real-signature'))
        .expect(401);
    });

    it('rejects an Authorization header that is not a bearer token', async () => {
      await api(app)
        .get('/categories')
        .set({ Authorization: 'Basic dXNlcjpwYXNz' })
        .expect(401);
    });
  });
});
