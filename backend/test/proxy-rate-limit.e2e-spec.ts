import { INestApplication } from '@nestjs/common';
import {
  FORWARDED_CLIENT_IP_HEADER,
  INTERNAL_PROXY_SECRET_HEADER,
} from 'src/common/guards/client-ip-throttler.guard';
import { api, createTestApp, registerOwner, type TestContext } from './test-app';

/**
 * Rate limiting behind proxies.
 *
 * In production the API sits behind a load balancer, and server-rendered public
 * menus are fetched by the Next.js server rather than by diners' browsers. Both
 * would otherwise make every visitor share one IP - and one rate-limit budget.
 */
describe('Rate limiting behind proxies (e2e)', () => {
  const SECRET = 'p'.repeat(48);
  const savedEnv = { ...process.env };

  /** Runs `body` against a throttled app created with `env` applied. */
  async function withApp(env: Record<string, string | undefined>, body: (app: INestApplication) => Promise<void>) {
    Object.assign(process.env, env);
    for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key];

    const ctx: TestContext = await createTestApp({ throttle: true });
    try {
      await body(ctx.app);
    } finally {
      await ctx.close();
      process.env = { ...savedEnv };
    }
  }

  const login = (app: INestApplication, forwardedFor?: string) => {
    const req = api(app).post('/auth/login');
    if (forwardedFor) req.set('X-Forwarded-For', forwardedFor);
    return req.send({ email: 'proxy-brute-force@example.com', password: 'WrongPassword123!' });
  };

  const burnLoginBudget = async (app: INestApplication, forwardedFor?: string) => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await login(app, forwardedFor)).status);
    return statuses;
  };

  describe('TRUST_PROXY', () => {
    it('without TRUST_PROXY, X-Forwarded-For is ignored so clients cannot dodge the login limit', async () => {
      await withApp({ TRUST_PROXY: undefined, INTERNAL_PROXY_SECRET: undefined }, async (app) => {
        const statuses = await burnLoginBudget(app, '198.51.100.1');
        expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
        expect(statuses[5]).toBe(429);

        // A different spoofed address shares the same (real) bucket.
        expect((await login(app, '198.51.100.2')).status).toBe(429);
      });
    });

    it('with TRUST_PROXY=1, each real client behind the proxy gets its own login budget', async () => {
      await withApp({ TRUST_PROXY: '1', INTERNAL_PROXY_SECRET: undefined }, async (app) => {
        const first = await burnLoginBudget(app, '198.51.100.10');
        expect(first[5]).toBe(429);

        // Another client behind the same proxy is not blocked by the first one.
        expect((await login(app, '198.51.100.11')).status).toBe(401);
        // ...and the first client stays blocked.
        expect((await login(app, '198.51.100.10')).status).toBe(429);
      });
    });
  });

  describe('public menu fetched by the frontend server (INTERNAL_PROXY_SECRET)', () => {
    /**
     * The menu carries its own, much higher budget - a restaurant's diners share
     * one NAT address, so the general limit cut off the 121st person to scan. What
     * these tests are about is *which bucket* a request counts against, not how
     * big the bucket is, so the limit is turned down to keep them quick. Setting it
     * here also proves the environment variable is actually read.
     */
    const limit = 5;
    const env = {
      TRUST_PROXY: undefined,
      INTERNAL_PROXY_SECRET: SECRET,
      PUBLIC_MENU_THROTTLE_LIMIT: String(limit),
    };

    it('rate-limits each diner separately when the frontend forwards their IP with the secret', async () => {
      await withApp(env, async (app) => {
        await registerOwner(app, { restaurantName: 'Busy Proxy Diner' });
        const menu = '/public/restaurants/busy-proxy-diner/menu';
        const asDiner = (ip: string, secret = SECRET) =>
          api(app).get(menu).set(INTERNAL_PROXY_SECRET_HEADER, secret).set(FORWARDED_CLIENT_IP_HEADER, ip);

        // One diner uses up their own budget...
        for (let i = 0; i < limit; i += 1) await asDiner('203.0.113.50').expect(200);
        await asDiner('203.0.113.50').expect(429);

        // ...while other diners, arriving through the same frontend server, are unaffected.
        await asDiner('203.0.113.51').expect(200);
        await asDiner('2001:db8::51').expect(200);
      });
    });

    it('ignores forwarded IPs without the correct secret, so clients cannot pick their own bucket', async () => {
      await withApp(env, async (app) => {
        await registerOwner(app, { restaurantName: 'Spoof Proof Diner' });
        const menu = '/public/restaurants/spoof-proof-diner/menu';

        // Every request claims a fresh IP, but the secret is wrong: they all count against one bucket.
        for (let i = 0; i < limit; i += 1) {
          await api(app)
            .get(menu)
            .set(INTERNAL_PROXY_SECRET_HEADER, 'q'.repeat(48))
            .set(FORWARDED_CLIENT_IP_HEADER, `198.51.100.${i % 250}`)
            .expect(200);
        }
        await api(app).get(menu).set(FORWARDED_CLIENT_IP_HEADER, '198.51.100.251').expect(429);
      });
    });
  });
});
