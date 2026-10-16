import type { NextConfig } from 'next';

/**
 * The host Plateo's own administration is served on.
 *
 * Kept in one place because it appears twice: the rewrite below, and the API's
 * CORS_ORIGINS, which must list the same origin or the browser blocks every call
 * the panel makes.
 */
const ADMIN_HOST = process.env.NEXT_PUBLIC_ADMIN_HOST ?? 'admin.plateoai.in';

/**
 * The host the floor signs in on.
 *
 * Its own address rather than a path on the restaurant app, because a captain
 * types it into a phone at the start of a shift and "captain.plateoai.in" is
 * something you can say across a kitchen.
 */
const CAPTAIN_HOST = process.env.NEXT_PUBLIC_CAPTAIN_HOST ?? 'captain.plateoai.in';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,

  /**
   * `admin.plateoai.in/` opens the platform panel.
   *
   * A rewrite rather than a redirect, so the address bar keeps saying
   * admin.plateoai.in instead of bouncing somebody to app.plateoai.in/platform -
   * the point of the subdomain is that it reads as its own thing.
   *
   * `beforeFiles` because it has to win against the app's own `/` route, which
   * would otherwise match first and serve the marketing page.
   *
   * Only the root is mapped. Everything under it already works at its own path,
   * including /platform/login, which is where the panel sends anyone signed out.
   * This is presentation, not a security boundary: the panel is protected by its
   * own token and a SUPER_ADMIN check on every request, and would be just as safe
   * served from app.plateoai.in/platform.
   */
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/',
          has: [{ type: 'host', value: ADMIN_HOST }],
          destination: '/platform',
        },
        {
          source: '/',
          has: [{ type: 'host', value: CAPTAIN_HOST }],
          destination: '/captain',
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
