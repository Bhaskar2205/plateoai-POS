import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from 'src/common/enums';
import { User } from 'src/modules/users/entities/user.entity';
import { RestaurantUser } from 'src/modules/restaurants/entities/restaurant-user.entity';
import {
  api,
  auth,
  createTestApp,
  registerOwner,
  type RegisteredOwner,
  type TestContext,
} from './test-app';

describe('Restaurant profile (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;
  let owner: RegisteredOwner;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    owner = await registerOwner(app, { restaurantName: 'Profile Test Kitchen' });
  });

  describe('GET /restaurants/me', () => {
    it('returns the authenticated restaurant', async () => {
      const response = await api(app)
        .get('/restaurants/me')
        .set(auth(owner.accessToken))
        .expect(200);

      expect(response.body.id).toBe(owner.restaurantId);
      expect(response.body.slug).toEqual(expect.any(String));
    });

    it('requires authentication', async () => {
      await api(app).get('/restaurants/me').expect(401);
    });
  });

  describe('PATCH /restaurants/me', () => {
    it('updates every editable profile field', async () => {
      const response = await api(app)
        .patch('/restaurants/me')
        .set(auth(owner.accessToken))
        .send({
          name: 'Renamed Bowl Co',
          description: 'Seasonal bowls, made fresh every morning.',
          address: 'C-12, Malviya Nagar, Jaipur 302017',
          phone: '+919876543210',
          logoUrl: 'https://cdn.example.com/logo.png',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        id: owner.restaurantId,
        name: 'Renamed Bowl Co',
        description: 'Seasonal bowls, made fresh every morning.',
        address: 'C-12, Malviya Nagar, Jaipur 302017',
        phone: '+919876543210',
        logoUrl: 'https://cdn.example.com/logo.png',
      });
    });

    it('regenerates the slug when the name changes', async () => {
      const response = await api(app)
        .patch('/restaurants/me')
        .set(auth(owner.accessToken))
        .send({ name: 'Slug Regeneration Cafe' })
        .expect(200);

      expect(response.body.slug).toBe('slug-regeneration-cafe');
    });

    it('keeps slugs unique when renaming onto an existing name', async () => {
      const other = await registerOwner(app, { restaurantName: 'Contested Name' });
      expect(other.restaurantId).not.toBe(owner.restaurantId);

      const response = await api(app)
        .patch('/restaurants/me')
        .set(auth(owner.accessToken))
        .send({ name: 'Contested Name' })
        .expect(200);

      expect(response.body.slug).toBe('contested-name-2');
    });

    it.each([
      ['a name shorter than 2 characters', { name: 'A' }],
      ['a non-URL logo', { logoUrl: 'not-a-url' }],
      ['a nonsense phone number', { phone: 'call-me-maybe' }],
      ['an unknown status value', { status: 'PENDING' }],
    ])('rejects %s with 400', async (_label, payload) => {
      const response = await api(app)
        .patch('/restaurants/me')
        .set(auth(owner.accessToken))
        .send(payload)
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
    });

    it('refuses a client-supplied slug rather than trusting it', async () => {
      await api(app)
        .patch('/restaurants/me')
        .set(auth(owner.accessToken))
        .send({ slug: 'hijacked-slug' })
        .expect(400);
    });

    it('is closed to kitchen staff', async () => {
      const staffToken = await promoteToRole(
        app,
        dataSource,
        owner.restaurantId,
        UserRole.KITCHEN_STAFF,
      );

      await api(app)
        .patch('/restaurants/me')
        .set(auth(staffToken))
        .send({ name: 'Staff Rename Attempt' })
        .expect(403);
    });
  });

  describe('GET /restaurants/me/users', () => {
    it('lists members without exposing password hashes', async () => {
      const response = await api(app)
        .get('/restaurants/me/users')
        .set(auth(owner.accessToken))
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({
        id: owner.userId,
        email: owner.email,
        role: UserRole.RESTAURANT_OWNER,
      });
      expect(response.body[0]).not.toHaveProperty('passwordHash');
    });

    it('does not list members of other restaurants', async () => {
      const other = await registerOwner(app);

      const response = await api(app)
        .get('/restaurants/me/users')
        .set(auth(owner.accessToken))
        .expect(200);

      const ids = response.body.map((member: { id: number }) => member.id);
      expect(ids).not.toContain(other.userId);
    });
  });

  describe('GET /restaurants/me/stats', () => {
    it('counts only the authenticated restaurant data', async () => {
      const headers = auth(owner.accessToken);

      const category = await api(app)
        .post('/categories')
        .set(headers)
        .send({ name: 'Bowls' })
        .expect(201);

      await api(app)
        .post('/dishes')
        .set(headers)
        .send({ categoryId: category.body.id, name: 'Available Bowl', price: 249 })
        .expect(201);

      await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name: 'Sold Out Bowl', price: 199, isAvailable: false })
        .expect(201);

      await api(app).post('/ingredients').set(headers).send({ name: 'Paneer' }).expect(201);

      // Noise in a different restaurant must not appear in these counters.
      const stranger = await registerOwner(app);
      await api(app)
        .post('/categories')
        .set(auth(stranger.accessToken))
        .send({ name: 'Stranger Category' })
        .expect(201);

      const response = await api(app).get('/restaurants/me/stats').set(headers).expect(200);

      expect(response.body).toMatchObject({
        restaurantId: owner.restaurantId,
        status: 'ACTIVE',
        totalCategories: 1,
        activeCategories: 1,
        totalDishes: 2,
        availableDishes: 1,
        totalIngredients: 1,
        totalUsers: 1,
      });
    });
  });
});

/**
 * Creates a second account in the same restaurant with the given role and
 * returns its access token, so role-based rules can be tested end to end.
 */
async function promoteToRole(
  app: INestApplication,
  dataSource: DataSource,
  restaurantId: number,
  role: UserRole,
): Promise<string> {
  const staff = await registerOwner(app);

  await dataSource.getRepository(User).update({ id: staff.userId }, { role });
  await dataSource
    .getRepository(RestaurantUser)
    .save({ userId: staff.userId, restaurantId });

  const login = await api(app)
    .post('/auth/login')
    .send({ email: staff.email, password: staff.password, restaurantId })
    .expect(200);

  return login.body.accessToken;
}
