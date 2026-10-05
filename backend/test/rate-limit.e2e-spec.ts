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

  /**
   * The start of service: a restaurant's worth of diners scan the QR code at once.
   *
   * Every one of them is behind the restaurant's wifi, so the API sees one address
   * making every request. That is the case this guards - under the general limit of
   * 120 a minute, the 121st diner got a 429 and a broken page.
   */
  describe('a whole restaurant scanning at once', () => {
    let rushCtx: TestContext;
    let rushApp: INestApplication;
    let rushSlug: string;

    beforeAll(async () => {
      rushCtx = await createTestApp({ throttle: true });
      rushApp = rushCtx.app;

      const owner = await registerOwner(rushApp, { restaurantName: 'Rush Hour Kitchen' });
      const headers = auth(owner.accessToken);

      const profile = await api(rushApp).get('/restaurants/me').set(headers).expect(200);
      rushSlug = profile.body.slug;

      await api(rushApp)
        .post('/dishes')
        .set(headers)
        .send({ name: 'Rush Thali', price: 220 })
        .expect(201);
    });

    afterAll(async () => {
      await rushCtx.close();
    });

    it('serves 200 simultaneous scans from one address without a single failure', async () => {
      const responses = await Promise.all(
        Array.from({ length: 200 }, () =>
          api(rushApp).get(`/public/restaurants/${rushSlug}/menu`),
        ),
      );

      const statuses = responses.map((response) => response.status);

      // Not "mostly 200". A 429 here is a diner who scanned the code and was shown
      // an error, and there is no acceptable number of those.
      expect(statuses.filter((status) => status !== 200)).toEqual([]);
      // Every one of them got the real menu, not an empty shell.
      expect(responses[199].body.restaurant.slug).toBe(rushSlug);
      expect(responses[199].body.categories.length + responses[199].body.uncategorisedDishes.length)
        .toBeGreaterThan(0);
    });

    it('still shows a dish going out of stock on the very next scan, mid-rush', async () => {
      // The cache behind the burst above must not outlive a menu change. This is
      // the same guarantee as the single-request case, checked after a rush has
      // definitely populated the cache.
      const owner = await registerOwner(rushApp, { restaurantName: 'Mid Rush Kitchen' });
      const headers = auth(owner.accessToken);

      const profile = await api(rushApp).get('/restaurants/me').set(headers).expect(200);
      const slug = profile.body.slug;

      const dish = await api(rushApp)
        .post('/dishes')
        .set(headers)
        .send({ name: 'Last One Left', price: 180 })
        .expect(201);

      await Promise.all(
        Array.from({ length: 40 }, () =>
          api(rushApp).get(`/public/restaurants/${slug}/menu`).expect(200),
        ),
      );

      const named = (body: { uncategorisedDishes: Array<{ name: string }> }) =>
        body.uncategorisedDishes.map((entry) => entry.name);

      expect(named((await api(rushApp).get(`/public/restaurants/${slug}/menu`).expect(200)).body))
        .toContain('Last One Left');

      await api(rushApp)
        .patch(`/dishes/${dish.body.id}`)
        .set(headers)
        .send({ isAvailable: false })
        .expect(200);

      expect(named((await api(rushApp).get(`/public/restaurants/${slug}/menu`).expect(200)).body))
        .not.toContain('Last One Left');
    });

    it('gives every diner in a rush the same menu', async () => {
      // Single-flight means most of these share one build. They must all come back
      // with the whole menu - a shared promise that resolved to a partial result
      // would hand the same wrong answer to everybody at once.
      const bodies = await Promise.all(
        Array.from({ length: 50 }, async () =>
          JSON.stringify((await api(rushApp).get(`/public/restaurants/${rushSlug}/menu`).expect(200)).body),
        ),
      );

      expect(new Set(bodies).size).toBe(1);
    });
  });
});
