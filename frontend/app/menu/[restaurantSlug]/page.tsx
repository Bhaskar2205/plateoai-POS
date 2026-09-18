import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { dishCount, getPublicMenu, type PublicDish, type PublicMenu } from '@/lib/public-menu';
import { PublicMenuView } from '@/components/public-menu/public-menu-view';
import { TableUnavailable } from '@/components/public-menu/table-unavailable';

// Availability changes must show on the next load, so never prerender or cache.
export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ restaurantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * The table identifier from a QR code URL (`?table=`). A repeated parameter is
 * passed through joined, so the API rejects it instead of us guessing which one.
 */
const tableParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value.join(',') : value;

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { restaurantSlug } = await params;
  const table = tableParam((await searchParams).table);

  try {
    const result = await getPublicMenu(restaurantSlug, table);

    if (result.status === 'not-found') {
      return { title: 'Menu not available', robots: { index: false, follow: false } };
    }

    if (result.status === 'table-unavailable') {
      return {
        title: `${result.restaurant.name} - table not available`,
        robots: { index: false, follow: false },
        referrer: 'strict-origin-when-cross-origin',
      };
    }

    const { restaurant } = result.menu;
    const count = dishCount(result.menu);
    const description =
      restaurant.description ??
      `Browse ${count} ${count === 1 ? 'dish' : 'dishes'} at ${restaurant.name}` +
        `${restaurant.address ? `, ${restaurant.address}` : ''} — with prices, ingredients and allergens.`;

    return {
      title: result.menu.table ? `${restaurant.name} menu · ${result.menu.table.name}` : `${restaurant.name} menu`,
      description,
      // Table URLs carry the table identifier: keep them out of search results and
      // out of Referer headers sent to image hosts; the canonical is the plain menu.
      ...(table !== undefined
        ? { robots: { index: false, follow: false }, referrer: 'strict-origin-when-cross-origin' as const }
        : {}),
      alternates: { canonical: `/menu/${restaurant.slug}` },
      openGraph: {
        type: 'website',
        title: `${restaurant.name} menu`,
        description,
        url: `/menu/${restaurant.slug}`,
        ...(restaurant.logoUrl ? { images: [{ url: restaurant.logoUrl, alt: restaurant.name }] } : {}),
      },
    };
  } catch {
    // The page's error boundary reports the failure; metadata just stays generic.
    return { title: 'Menu' };
  }
}

export default async function PublicMenuPage({ params, searchParams }: PageProps) {
  const { restaurantSlug } = await params;
  const table = tableParam((await searchParams).table);
  const result = await getPublicMenu(restaurantSlug, table);

  if (result.status === 'not-found') {
    notFound();
  }

  if (result.status === 'table-unavailable') {
    return <TableUnavailable restaurant={result.restaurant} />;
  }

  // Reached through the permanent public slug (a shared link from before a
  // rename): send plain menu visits to the current, canonical URL. Temporary
  // (307), because the canonical slug changes again if the restaurant is renamed.
  // Table QR links are served in place, so the printed URL is never rewritten.
  const canonicalSlug = result.menu.restaurant.slug;
  // Any segment that reached here passed the API's slug check ([a-z0-9-], case-folded),
  // so it needs no decoding - decodeURIComponent could throw on a malformed escape.
  if (table === undefined && restaurantSlug !== canonicalSlug) {
    redirect(`/menu/${canonicalSlug}`);
  }

  return (
    <>
      <script
        type="application/ld+json"
        // Restaurant-entered text: escape "<" so a dish name can never close the script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(toStructuredData(result.menu)).replace(/</g, '\\u003c') }}
      />
      <PublicMenuView menu={result.menu} />
    </>
  );
}

/** schema.org Restaurant + Menu, so search engines can read dishes and prices. */
function toStructuredData(menu: PublicMenu) {
  const item = (dish: PublicDish) => ({
    '@type': 'MenuItem',
    name: dish.name,
    ...(dish.description ? { description: dish.description } : {}),
    ...(dish.imageUrl ? { image: dish.imageUrl } : {}),
    offers: { '@type': 'Offer', price: dish.price.toFixed(2), priceCurrency: menu.currency },
    ...(dish.dietType === 'VEG'
      ? { suitableForDiet: 'https://schema.org/VegetarianDiet' }
      : dish.dietType === 'VEGAN'
        ? { suitableForDiet: 'https://schema.org/VeganDiet' }
        : {}),
    ...(dish.nutrition?.calories != null
      ? { nutrition: { '@type': 'NutritionInformation', calories: `${dish.nutrition.calories} calories` } }
      : {}),
  });

  const sections = [
    ...menu.categories.map((category) => ({
      '@type': 'MenuSection',
      name: category.name,
      hasMenuItem: category.dishes.map(item),
    })),
    ...(menu.uncategorisedDishes.length > 0
      ? [{ '@type': 'MenuSection', name: 'More dishes', hasMenuItem: menu.uncategorisedDishes.map(item) }]
      : []),
  ];

  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: menu.restaurant.name,
    ...(menu.restaurant.description ? { description: menu.restaurant.description } : {}),
    ...(menu.restaurant.address ? { address: menu.restaurant.address } : {}),
    ...(menu.restaurant.logoUrl ? { logo: menu.restaurant.logoUrl } : {}),
    hasMenu: { '@type': 'Menu', hasMenuSection: sections },
  };
}
