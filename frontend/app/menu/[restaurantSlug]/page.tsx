import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { dishCount, getPublicMenu, type PublicDish, type PublicMenu } from '@/lib/public-menu';
import { PublicMenuView } from '@/components/public-menu/public-menu-view';

// Availability changes must show on the next load, so never prerender or cache.
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ restaurantSlug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { restaurantSlug } = await params;

  try {
    const result = await getPublicMenu(restaurantSlug);

    if (result.status === 'not-found') {
      return { title: 'Menu not available', robots: { index: false, follow: false } };
    }

    const { restaurant } = result.menu;
    const count = dishCount(result.menu);
    const description =
      restaurant.description ??
      `Browse ${count} ${count === 1 ? 'dish' : 'dishes'} at ${restaurant.name}` +
        `${restaurant.address ? `, ${restaurant.address}` : ''} — with prices, ingredients and allergens.`;

    return {
      title: `${restaurant.name} menu`,
      description,
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

export default async function PublicMenuPage({ params }: PageProps) {
  const { restaurantSlug } = await params;
  const result = await getPublicMenu(restaurantSlug);

  if (result.status === 'not-found') {
    notFound();
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
