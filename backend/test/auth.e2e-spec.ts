import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from 'src/common/enums';
import { User } from 'src/modules/users/entities/user.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantUser } from 'src/modules/restaurants/entities/restaurant-user.entity';
import {
  api,
  auth,
  createTestApp,
  platformAdminToken,
  registerOwner,
  type TestContext,
} from './test-app';

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

  /**
   * Opening a restaurant account.
   *
   * Every assertion here used to sit on `POST /auth/register`. Registration is
   * gone - a restaurant exists because somebody at Plateo opened it - but none of
   * the properties stopped mattering: the password is still hashed with Argon2id,
   * the hash still never leaves the server, duplicate emails are still refused,
   * and two restaurants with the same name still get distinct slugs.
   */
  describe('POST /platform/restaurants', () => {
    let platform: Record<string, string>;

    const open = (body: Record<string, unknown>) =>
      api(app).post('/platform/restaurants').set(platform).send(body);

    const account = (over: Record<string, unknown> = {}) => ({
      restaurantName: 'The Green Bowl',
      address: 'Jaipur, Rajasthan',
      ownerName: 'Restaurant Owner',
      ownerEmail: `owner-${Math.random().toString(36).slice(2, 8)}@example.com`,
      ownerPassword: 'StrongPassword123!',
      ...over,
    });

    beforeAll(async () => {
      platform = auth(await platformAdminToken(app));
    });

    it('there is no public registration any more', async () => {
      // The whole point: a stranger cannot bring a tenant into existence, and so
      // cannot take a restaurant's name or public slug by getting there first.
      await api(app)
        .post('/auth/register')
        .send({
          name: 'Nobody',
          email: 'nobody@example.com',
          password: 'StrongPassword123!',
          restaurantName: 'Squatted Name',
        })
        .expect(404);
    });

    it('refuses anyone who is not a Plateo administrator', async () => {
      const owner = await registerOwner(app);

      await api(app)
        .post('/platform/restaurants')
        .set(auth(owner.accessToken))
        .send(account())
        .expect(403);
    });

    it('refuses an unauthenticated caller', async () => {
      await api(app).post('/platform/restaurants').send(account()).expect(401);
    });

    it('creates the restaurant, the owner and the membership', async () => {
      const email = `register-flow-${Date.now()}@example.com`;
      const response = await open(account({ ownerEmail: email })).expect(201);

      expect(response.body).toMatchObject({
        name: 'The Green Bowl',
        slug: 'the-green-bowl',
        address: 'Jaipur, Rajasthan',
        status: 'ACTIVE',
      });
      expect(response.body.owners[0]).toMatchObject({
        name: 'Restaurant Owner',
        email,
        role: UserRole.RESTAURANT_OWNER,
      });

      const membership = await dataSource.getRepository(RestaurantUser).findOne({
        where: { userId: response.body.owners[0].id, restaurantId: response.body.id },
      });
      expect(membership).not.toBeNull();
    });

    it('lets the owner sign in with exactly the credentials they were given', async () => {
      // The thing the whole change rests on: an owner who never registered can
      // still get in.
      const email = `handover-${Date.now()}@example.com`;
      const created = await open(account({ ownerEmail: email })).expect(201);

      const login = await api(app)
        .post('/auth/login')
        .send({ email, password: 'StrongPassword123!', restaurantId: created.body.id })
        .expect(200);

      expect(login.body.user.email).toBe(email);
      expect(login.body.restaurant.id).toBe(created.body.id);
    });

    it('never returns the password hash', async () => {
      const response = await open(account()).expect(201);

      expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|\$argon2/i);
    });

    it('stores an Argon2id hash rather than the raw password', async () => {
      const email = `hashed-${Date.now()}@example.com`;
      await open(account({ ownerEmail: email, ownerPassword: 'StrongPassword123!' })).expect(201);

      const user = await dataSource.getRepository(User).findOne({ where: { email } });

      expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user?.passwordHash).not.toContain('StrongPassword123!');
    });

    it('gives restaurants with the same name distinct slugs', async () => {
      const first = await open(account({ restaurantName: 'Twin Kitchen' })).expect(201);
      const second = await open(account({ restaurantName: 'Twin Kitchen' })).expect(201);

      expect(first.body.slug).not.toBe(second.body.slug);
    });

    it('rejects a duplicate email with 409 and creates no second restaurant', async () => {
      const email = `duplicate-${Date.now()}@example.com`;
      await open(account({ ownerEmail: email })).expect(201);

      const before = await dataSource.getRepository(Restaurant).count();
      await open(account({ ownerEmail: email })).expect(409);
      const after = await dataSource.getRepository(Restaurant).count();

      // The restaurant is created in the same transaction as the owner, so a
      // refused owner must leave no restaurant behind.
      expect(after).toBe(before);
    });

    it('treats emails case-insensitively when detecting duplicates', async () => {
      const email = `case-${Date.now()}@example.com`;
      await open(account({ ownerEmail: email })).expect(201);
      await open(account({ ownerEmail: email.toUpperCase() })).expect(409);
    });

    describe('validation', () => {
      it('rejects a blank restaurant name with 400', async () => {
        await open(account({ restaurantName: '' })).expect(400);
      });

      it('rejects a malformed email with 400', async () => {
        await open(account({ ownerEmail: 'not-an-email' })).expect(400);
      });

      it('rejects a missing owner name with 400', async () => {
        const body = account();
        delete (body as Record<string, unknown>).ownerName;
        await open(body).expect(400);
      });

      it('rejects a password under 8 characters with 400', async () => {
        await open(account({ ownerPassword: 'Ab1!' })).expect(400);
      });

      it('rejects a password with no digit with 400', async () => {
        await open(account({ ownerPassword: 'NoDigitsHere!' })).expect(400);
      });

      it('rejects a password with no uppercase letter with 400', async () => {
        await open(account({ ownerPassword: 'nouppercase1!' })).expect(400);
      });

      it('rejects unknown properties instead of silently ignoring them', async () => {
        // Notably `role`: an administrator must not be able to mint another
        // administrator by adding a field.
        const response = await open(account({ role: 'SUPER_ADMIN' })).expect(400);

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
