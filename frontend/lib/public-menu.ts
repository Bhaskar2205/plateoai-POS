import { headers } from 'next/headers';
import { cache } from 'react';

/**
 * Public menu data, fetched on the server.
 *
 * Deliberately separate from `lib/api.ts`: that client attaches the admin's
 * access token, and the public page must never send one. These types mirror
 * the backend's `PublicMenuDto` allow-list.
 *
 * Server-only: it reads request headers and `INTERNAL_PROXY_SECRET`. Client
 * components may only `import type` from here.
 */

export type PublicDietType = 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN';

export interface PublicIngredient {
  name: string;
  quantity: number;
  unit: string;
  allergenInfo: string | null;
}

export interface PublicNutrition {
  calories: number | null;
  proteinGrams: number | null;
  carbsGrams: number | null;
  fatGrams: number | null;
  source: 'RESTAURANT_DECLARED';
}

export interface PublicDish {
  id: number;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  preparationTimeMinutes: number | null;
  dietType: PublicDietType | null;
  nutrition: PublicNutrition | null;
  ingredients: PublicIngredient[];
  allergens: string[];
}

export interface PublicCategory {
  id: number;
  name: string;
  dishes: PublicDish[];
}

export interface PublicMenu {
  restaurant: {
    name: string;
    slug: string;
    description: string | null;
    address: string | null;
    logoUrl: string | null;
  };
  /** The table from the QR code, or null for the plain restaurant menu. */
  table: { name: string } | null;
  currency: string;
  categories: PublicCategory[];
  uncategorisedDishes: PublicDish[];
  disclaimer: string;
}

export type PublicMenuResult =
  | { status: 'ok'; menu: PublicMenu }
  | { status: 'not-found' }
  /** The restaurant is fine but the table from the QR code is unknown, replaced or inactive. */
  | { status: 'table-unavailable'; restaurant: PublicMenu['restaurant'] };

/** Server-side base URL; falls back to the browser-facing one for local dev. */
const API_BASE_URL = (
  process.env.PLATEO_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4000'
).replace(/\/$/, '');

/**
 * Loads a menu by slug. Memoised per request with React `cache`, so
 * `generateMetadata` and the page share one fetch.
 *
 * `no-store` matches the API's `Cache-Control: no-store`: a dish the kitchen
 * marks unavailable must vanish from the next page load, not a cache cycle later.
 */
export const getPublicMenu = cache(async (slug: string, table?: string): Promise<PublicMenuResult> => {
  const query = table === undefined ? '' : `?table=${encodeURIComponent(table)}`;
  const response = await fetchMenu(slug, query);

  if (response.status === 404) {
    if (table === undefined) {
      return { status: 'not-found' };
    }

    // The API gives one 404 for "no such restaurant" and "no such table". Ask
    // again without the table: if the restaurant exists, it is the table that is
    // unavailable, and the diner can be told so under the restaurant's branding.
    const restaurantOnly = await getPublicMenu(slug);
    return restaurantOnly.status === 'ok'
      ? { status: 'table-unavailable', restaurant: restaurantOnly.menu.restaurant }
      : restaurantOnly;
  }

  if (!response.ok) {
    // Surfaces in the route's error boundary; the message is not shown to diners.
    throw new Error(`Menu request failed with status ${response.status}`);
  }

  return { status: 'ok', menu: (await response.json()) as PublicMenu };
});

async function fetchMenu(slug: string, query: string): Promise<Response> {
  return fetch(`${API_BASE_URL}/public/restaurants/${encodeURIComponent(slug)}/menu${query}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json', ...(await dinerIpHeaders()) },
  });
}

/** IPv4 / IPv6 characters only; the API validates the address properly. */
const IP_LIKE = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * This request is made by the Next.js server, so the API would otherwise see the
 * server's IP for every diner and rate-limit them all as one visitor. With
 * `INTERNAL_PROXY_SECRET` (server-only - never `NEXT_PUBLIC_`) set to the same
 * value as on the API, the diner's IP is forwarded and trusted for rate limiting.
 *
 * The IP comes from headers set by the hosting platform's edge (Vercel sets both
 * `x-real-ip` and `x-forwarded-for` itself). When self-hosting, the reverse proxy
 * must overwrite these headers rather than pass client-supplied values through.
 */
async function dinerIpHeaders(): Promise<Record<string, string>> {
  const secret = process.env.INTERNAL_PROXY_SECRET?.trim();
  if (!secret) return {};

  const incoming = await headers();
  const ip = (incoming.get('x-real-ip') ?? incoming.get('x-forwarded-for')?.split(',')[0] ?? '').trim();

  return IP_LIKE.test(ip) ? { 'x-plateo-proxy-secret': secret, 'x-plateo-client-ip': ip } : {};
}

export const dishCount = (menu: PublicMenu): number =>
  menu.categories.reduce((total, category) => total + category.dishes.length, 0) +
  menu.uncategorisedDishes.length;
