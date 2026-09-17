import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from 'src/common/enums';
import { User } from 'src/modules/users/entities/user.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantUser } from 'src/modules/restaurants/entities/restaurant-user.entity';
import { api, auth, createTestApp, registerOwner, type TestContext } from './test-app';

describe('Authentication (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('POST /auth/register', () => {
    it('creates the owner, the restaurant and the membership, and returns a token', async () => {
      const response = await api(app)
        .post('/auth/register')
        .send({
          name: 'Restaurant Owner',
          email: 'register-flow@example.com',
          password: 'StrongPassword123!',
          restaurantName: 'The Green Bowl',
          address: 'Jaipur, Rajasthan',
        })
        .expect(201);

      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.tokenType).toBe('Bearer');
      expect(response.body.user).toMatchObject({
        name: 'Restaurant Owner',
        email: 'register-flow@example.com',
        role: UserRole.RESTAURANT_OWNER,
      });
      expect(response.body.restaurant).toMatchObject({
        name: 'The Green Bowl',
        slug: 'the-green-bowl',
        address: 'Jaipur, Rajasthan',
        status: 'ACTIVE',
      });

      const membership = await dataSource.getRepository(RestaurantUser).findOne({
        where: {
          userId: response.body.user.id,
          restaurantId: response.body.restaurant.id,
        },
      });
      expect(membership).not.toBeNull();
    });

    it('never returns the password hash', async () => {
      const response = await api(app)
        .post('/auth/register')
        .send({
          name: 'Hash Hider',
          email: 'no-hash@example.com',
          password: 'StrongPassword123!',
          restaurantName: 'Hash Hider Cafe',
        })
        .expect(201);

      expect(JSON.stringify(response.body)).not.toContain('argon2');
      expect(response.body.user).not.toHaveProperty('passwordHash');
      expect(response.body.user).not.toHaveProperty('password');
    });

    it('stores an Argon2id hash rather than the raw password', async () => {
      await api(app)
        .post('/auth/register')
        .send({
          name: 'Argon User',
          email: 'argon@example.com',
          password: 'StrongPassword123!',
          restaurantName: 'Argon Bistro',
        })
        .expect(201);

      const user = await dataSource
        .getRepository(User)
        .findOne({ where: { email: 'argon@example.com' } });

      expect(user!.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user!.passwordHash).not.toContain('StrongPassword123!');
    });

    it('rejects a duplicate email with 409 and creates no second restaurant', async () => {
      const payload = {
        name: 'First Owner',
        email: 'duplicate@example.com',
        password: 'StrongPassword123!',
        restaurantName: 'First Restaurant',
      };

      await api(app).post('/auth/register').send(payload).expect(201);

      const response = await api(app)
        .post('/auth/register')
        .send({ ...payload, restaurantName: 'Second Restaurant' })
        .expect(409);

      expect(response.body).toMatchObject({
        statusCode: 409,
        error: 'Conflict',
        message: 'An account with this email already exists.',
      });

      // The transaction must not have left an orphan restaurant behind.
      const orphan = await dataSource
        .getRepository(Restaurant)
        .findOne({ where: { name: 'Second Restaurant' } });
      expect(orphan).toBeNull();
    });

    it('treats emails case-insensitively when detecting duplicates', async () => {
      await api(app)
        .post('/auth/register')
        .send({
          name: 'Case Owner',
          email: 'CaseTest@Example.com',
          password: 'StrongPassword123!',
          restaurantName: 'Case Cafe',
        })
        .expect(201);

      await api(app)
        .post('/auth/register')
        .send({
          name: 'Case Owner 2',
          email: 'casetest@example.com',
          password: 'StrongPassword123!',
          restaurantName: 'Case Cafe Two',
        })
        .expect(409);
    });

    it('gives restaurants with the same name distinct slugs', async () => {
      const first = await api(app)
        .post('/auth/register')
        .send({
          name: 'Owner A',
          email: 'slug-a@example.com',
          password: 'StrongPassword123!',
          restaurantName: 'Spice Route',
        })
        .expect(201);

      const second = await api(app)
        .post('/auth/register')
        .send({
          name: 'Owner B',
          email: 'slug-b@example.com',
          password: 'StrongPassword123!',
          restaurantName: 'Spice Route',
        })
        .expect(201);

      expect(first.body.restaurant.slug).toBe('spice-route');
      expect(second.body.restaurant.slug).toBe('spice-route-2');
    });

    describe('validation', () => {
      const base = {
        name: 'Valid Name',
        email: 'validation@example.com',
        password: 'StrongPassword123!',
        restaurantName: 'Valid Restaurant',
      };

      it.each([
        ['a malformed email', { email: 'not-an-email' }],
        ['a password under 8 characters', { password: 'Ab1!' }],
        ['a password with no uppercase letter', { password: 'weakpassword123' }],
        ['a password with no digit', { password: 'WeakPassword!' }],
        ['a blank restaurant name', { restaurantName: '' }],
        ['a missing name', { name: undefined }],
      ])('rejects %s with 400', async (_label, override) => {
        const response = await api(app)
          .post('/auth/register')
          .send({ ...base, ...override })
          .expect(400);

        expect(response.body.message).toBe('Validation failed');
        expect(Array.isArray(response.body.details)).toBe(true);
      });

      it('rejects unknown properties instead of silently ignoring them', async () => {
        const response = await api(app)
          .post('/auth/register')
          .send({ ...base, role: UserRole.SUPER_ADMIN })
          .expect(400);

        expect(response.body.details.join(' ')).toContain('role');
      });
    });
  });

  describe('POST /auth/login', () => {
    it('returns a token and the restaurant for valid credentials', async () => {
      const owner = await registerOwner(app, { email: 'login-ok@example.com' });

      const response = await api(app)
        .post('/auth/login')
        .send({ email: owner.email, password: owner.password })
        .expect(200);

      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.user.email).toBe(owner.email);
      expect(response.body.restaurant.id).toBe(owner.restaurantId);
      expect(response.body.restaurants).toHaveLength(1);
    });

    it('rejects a wrong password with 401 and a non-specific message', async () => {
      const owner = await registerOwner(app, { email: 'login-badpass@example.com' });

      const response = await api(app)
        .post('/auth/login')
        .send({ email: owner.email, password: 'WrongPassword123!' })
        .expect(401);

      expect(response.body.message).toBe('Invalid email or password.');
    });

    it('rejects an unknown email with the same 401 message', async () => {
      const response = await api(app)
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: 'StrongPassword123!' })
        .expect(401);

      expect(response.body.message).toBe('Invalid email or password.');
    });

    it('rejects a login for a restaurant the user does not belong to', async () => {
      const owner = await registerOwner(app, { email: 'login-scope@example.com' });
      const other = await registerOwner(app, { email: 'login-other@example.com' });

      await api(app)
        .post('/auth/login')
        .send({
          email: owner.email,
          password: owner.password,
          restaurantId: other.restaurantId,
        })
        .expect(403);
    });

    it('rejects a malformed login payload with 400', async () => {
      await api(app).post('/auth/login').send({ email: 'nope', password: '' }).expect(400);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the user and their restaurant context', async () => {
      const owner = await registerOwner(app, { email: 'me@example.com' });

      const response = await api(app)
        .get('/auth/me')
        .set(auth(owner.accessToken))
        .expect(200);

      expect(response.body.user).toMatchObject({ id: owner.userId, email: owner.email });
      expect(response.body.user).not.toHaveProperty('passwordHash');
      expect(response.body.restaurant.id).toBe(owner.restaurantId);
    });

    it('rejects a request with no token', async () => {
      await api(app).get('/auth/me').expect(401);
    });

    it('rejects a token signed with the wrong secret', async () => {
      const forged =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsImVtYWlsIjoiYUBiLmNvbSIsInJpZCI6MX0.' +
        'invalid-signature';

      await api(app).get('/auth/me').set(auth(forged)).expect(401);
    });
  });

  describe('POST /auth/switch-restaurant', () => {
    it('re-issues a token for another restaurant the user belongs to', async () => {
      const owner = await registerOwner(app, { email: 'multi@example.com' });
      const second = await registerOwner(app, { email: 'multi-second@example.com' });

      // Grant the first owner membership of the second restaurant directly.
      await dataSource.getRepository(RestaurantUser).save({
        userId: owner.userId,
        restaurantId: second.restaurantId,
      });

      const response = await api(app)
        .post('/auth/switch-restaurant')
        .set(auth(owner.accessToken))
        .send({ restaurantId: second.restaurantId })
        .expect(200);

      expect(response.body.restaurant.id).toBe(second.restaurantId);
      expect(response.body.restaurants).toHaveLength(2);

      // The new token really is scoped to the second restaurant.
      const me = await api(app)
        .get('/auth/me')
        .set(auth(response.body.accessToken))
        .expect(200);
      expect(me.body.restaurant.id).toBe(second.restaurantId);
    });

    it('refuses to switch to a restaurant the user is not a member of', async () => {
      const owner = await registerOwner(app, { email: 'switch-denied@example.com' });
      const stranger = await registerOwner(app, { email: 'switch-stranger@example.com' });

      await api(app)
        .post('/auth/switch-restaurant')
        .set(auth(owner.accessToken))
        .send({ restaurantId: stranger.restaurantId })
        .expect(403);
    });
  });

  describe('POST /auth/logout', () => {
    it('acknowledges the logout for an authenticated caller', async () => {
      const owner = await registerOwner(app, { email: 'logout@example.com' });

      const response = await api(app)
        .post('/auth/logout')
        .set(auth(owner.accessToken))
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('requires authentication', async () => {
      await api(app).post('/auth/logout').expect(401);
    });
  });

  it('exposes an unauthenticated health probe', async () => {
    const response = await api(app).get('/health').expect(200);
    expect(response.body.status).toBe('ok');
  });
});
