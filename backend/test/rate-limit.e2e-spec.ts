import { INestApplication } from '@nestjs/common';
import { api, auth, createTestApp, registerOwner, type TestContext } from './test-app';

/**
 * Login is the platform's brute-force surface, so it carries a tighter budget
 * than the rest of the API (LOGIN_THROTTLE_LIMIT per LOGIN_THROTTLE_TTL, per IP).
 * Everything else gets the general 120 requests a minute per route.
 */
describe('Rate limiting (e2e)', () => {
  describe('credential routes', () => {
    let ctx: TestContext;
    let app: INestApplication;

    beforeAll(async () => {
      ctx = await createTestApp({ throttle: true });
      app = ctx.app;
    });

    afterAll(async () => {
      await ctx.close();
    });

    it('returns 429 once the login attempt budget is exhausted', async () => {
      const attempt = () =>
        api(app)
          .post('/auth/login')
          .send({ email: 'brute-force@example.com', password: 'WrongPassword123!' });

      const statuses: number[] = [];

      for (let i = 0; i < 7; i += 1) {
        const response = await attempt();
        statuses.push(response.status);
      }

      expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(statuses.slice(5)).toEqual([429, 429]);
    });
  });

  /**
   * Regression: a second named throttler for credential routes was applied by
   * @nestjs/throttler to every route, capping the whole API at 5 requests a
   * minute per route. Found in browser testing, where toggling a dish's
   * availability a few times started returning 429.
   */
  describe('ordinary routes', () => {
    let ctx: TestContext;
    let app: INestApplication;

    beforeAll(async () => {
      ctx = await createTestApp({ throttle: true });
      app = ctx.app;
    });

    afterAll(async () => {
      await ctx.close();
    });

    it('does not apply the login limit to public non-credential routes', async () => {
      for (let i = 0; i < 20; i += 1) {
        await api(app).get('/health').expect(200);
      }
    });

    it('lets an owner make repeated menu requests without hitting 429', async () => {
      const owner = await registerOwner(app);
      const headers = auth(owner.accessToken);

      const dish = await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name: 'Toggled Often', price: 100 })
        .expect(201);

      for (let i = 0; i < 12; i += 1) {
        await api(app)
          .patch(`/dishes/${dish.body.id}`)
          .set(headers)
          .send({ isAvailable: i % 2 === 0 })
          .expect(200);
        await api(app).get('/dishes').set(headers).expect(200);
      }
    });
  });

  describe('LOGIN_THROTTLE_LIMIT', () => {
    let ctx: TestContext;
    let app: INestApplication;
    const original = process.env.LOGIN_THROTTLE_LIMIT;

    beforeAll(async () => {
      process.env.LOGIN_THROTTLE_LIMIT = '2';
      ctx = await createTestApp({ throttle: true });
      app = ctx.app;
    });

    afterAll(async () => {
      await ctx.close();
      if (original === undefined) delete process.env.LOGIN_THROTTLE_LIMIT;
      else process.env.LOGIN_THROTTLE_LIMIT = original;
    });

    it('is honoured instead of a hardcoded limit', async () => {
      const statuses: number[] = [];

      for (let i = 0; i < 3; i += 1) {
        const response = await api(app)
          .post('/auth/login')
          .send({ email: 'configured-limit@example.com', password: 'WrongPassword123!' });
        statuses.push(response.status);
      }

      expect(statuses).toEqual([401, 401, 429]);
    });
  });
});
