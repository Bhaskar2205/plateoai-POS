import { Throttle, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { configuration } from 'src/config/configuration';

/**
 * Rate limiting, defined once and shared by `AppModule` and the test harness.
 *
 * There is deliberately a single named throttler. `@nestjs/throttler` v6
 * applies *every* named throttler to *every* route (tracked per route, per IP),
 * so a second "auth" throttler with a limit of 5 capped `GET /dishes`,
 * `PATCH /dishes/:id` and every other endpoint at 5 requests a minute - an
 * owner toggling availability a few times was rate limited. Tighter limits for
 * credential routes are expressed as per-route overrides of this throttler
 * instead, via `@CredentialThrottle()`.
 */
export const GENERAL_THROTTLE = {
  name: 'default',
  ttl: 60_000,
  limit: 120,
} as const;

export const buildThrottlerOptions = (): ThrottlerModuleOptions => ({
  throttlers: [{ ...GENERAL_THROTTLE }],
});

/**
 * Brute-force protection for login and registration: LOGIN_THROTTLE_LIMIT
 * attempts per LOGIN_THROTTLE_TTL seconds, per IP, per route.
 *
 * Resolved per request, so the environment values actually apply - they were
 * previously hardcoded in the decorator and the settings were ignored.
 */
export const CredentialThrottle = () =>
  Throttle({
    [GENERAL_THROTTLE.name]: {
      limit: () => configuration().throttle.loginLimit,
      ttl: () => configuration().throttle.loginTtlSeconds * 1000,
    },
  });

/**
 * The anonymous menu, which has to survive a whole restaurant scanning at once.
 *
 * Every diner on the restaurant's wifi reaches the API from one NAT address, so
 * a table of 150 scanning the QR code at the start of service is indistinguishable
 * from one client making 150 requests in a second. Under the general limit of 120
 * the last thirty got a 429 and a broken page - measured, not theorised.
 *
 * Expressed as a per-route override rather than by raising the general limit,
 * which would also loosen every authenticated write route. The endpoint is a
 * handful of indexed reads with no side effects, so a high ceiling here costs
 * little; it stays bounded so a scraper still meets a wall.
 */
export const PublicMenuThrottle = () =>
  Throttle({
    [GENERAL_THROTTLE.name]: {
      limit: () => configuration().throttle.publicMenuLimit,
      ttl: () => configuration().throttle.publicMenuTtlSeconds * 1000,
    },
  });
