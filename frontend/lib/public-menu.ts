import { cache } from 'react';

/**
 * Public menu data, fetched on the server.
 *
 * Deliberately separate from `lib/api.ts`: that client attaches the admin's
 * access token, and the public page must never send one. These types mirror
 * the backend's `PublicMenuDto` allow-list.
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
  currency: string;
  categories: PublicCategory[];
  uncategorisedDishes: PublicDish[];
  disclaimer: string;
}

export type PublicMenuResult = { status: 'ok'; menu: PublicMenu } | { status: 'not-found' };

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
export const getPublicMenu = cache(async (slug: string): Promise<PublicMenuResult> => {
  const response = await fetch(
    `${API_BASE_URL}/public/restaurants/${encodeURIComponent(slug)}/menu`,
    { cache: 'no-store', headers: { Accept: 'application/json' } },
  );

  if (response.status === 404) {
    return { status: 'not-found' };
  }

  if (!response.ok) {
    // Surfaces in the route's error boundary; the message is not shown to diners.
    throw new Error(`Menu request failed with status ${response.status}`);
  }

  return { status: 'ok', menu: (await response.json()) as PublicMenu };
});

export const dishCount = (menu: PublicMenu): number =>
  menu.categories.reduce((total, category) => total + category.dishes.length, 0) +
  menu.uncategorisedDishes.length;
