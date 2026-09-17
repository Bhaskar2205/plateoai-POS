'use client';

import { ChevronDown, Clock, MapPin, Search, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { PublicDietType, PublicDish, PublicMenu } from '@/lib/public-menu';

interface Section {
  key: string;
  name: string;
  dishes: PublicDish[];
}

const quantityFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

/**
 * The diner-facing menu: restaurant header, sticky search + section navigation,
 * and one list of dish cards per section. Read-only - no ordering yet.
 */
export function PublicMenuView({ menu }: { menu: PublicMenu }) {
  const [query, setQuery] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());

  const money = useMemo(() => {
    const whole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: menu.currency, maximumFractionDigits: 0 });
    const exact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: menu.currency, minimumFractionDigits: 2 });
    return (value: number) => (Number.isInteger(value) ? whole : exact).format(value);
  }, [menu.currency]);

  const sections = useMemo<Section[]>(
    () => [
      ...menu.categories.map((category) => ({
        key: `section-${category.id}`,
        name: category.name,
        dishes: category.dishes,
      })),
      ...(menu.uncategorisedDishes.length > 0
        ? [{ key: 'section-more', name: 'More dishes', dishes: menu.uncategorisedDishes }]
        : []),
    ],
    [menu],
  );

  const term = query.trim().toLowerCase();
  const visibleSections = useMemo(() => {
    if (!term) return sections;

    return sections
      .map((section) => ({
        ...section,
        dishes: section.dishes.filter(
          (dish) =>
            dish.name.toLowerCase().includes(term) ||
            dish.description?.toLowerCase().includes(term) ||
            dish.ingredients.some((ingredient) => ingredient.name.toLowerCase().includes(term)),
        ),
      }))
      .filter((section) => section.dishes.length > 0);
  }, [sections, term]);

  const totalDishes = sections.reduce((total, section) => total + section.dishes.length, 0);
  const matchCount = visibleSections.reduce((total, section) => total + section.dishes.length, 0);

  // Highlight the section chip for whichever section is under the sticky bar.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) {
          visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          setActiveKey(visible[0].target.id);
        }
      },
      { rootMargin: '-140px 0px -55% 0px' },
    );

    sectionRefs.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [visibleSections]);

  return (
    <div className="min-h-dvh bg-ground">
      <RestaurantHeader menu={menu} totalDishes={totalDishes} />

      {totalDishes === 0 ? (
        <main className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
          <p className="text-lg font-semibold text-ink">The menu is being prepared</p>
          <p className="mt-2 text-sm text-muted">
            {menu.restaurant.name} hasn’t published any dishes yet. Please check back soon or ask a member of staff.
          </p>
        </main>
      ) : (
        <>
          <div className="sticky top-0 z-20 border-b border-line bg-ground/95 backdrop-blur supports-[backdrop-filter]:bg-ground/80">
            <div className="mx-auto max-w-3xl space-y-3 px-4 pt-3 pb-2 sm:px-6">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <input
                  id="menu-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search dishes or ingredients"
                  aria-label="Search dishes or ingredients"
                  className="h-11 w-full rounded-full border border-line bg-surface pr-10 pl-9 text-sm text-ink shadow-sm placeholder:text-muted/80 focus:border-brand-500 focus:outline-none"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-ground hover:text-ink"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                )}
              </div>

              {visibleSections.length > 0 && (
                <nav aria-label="Menu sections" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6">
                  <ul className="flex w-max gap-2 pb-1">
                    {visibleSections.map((section) => {
                      const active = activeKey === section.key;
                      return (
                        <li key={section.key}>
                          <a
                            href={`#${section.key}`}
                            aria-current={active ? 'true' : undefined}
                            className={cn(
                              'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap transition-colors',
                              active
                                ? 'border-brand-600 bg-brand-600 text-white'
                                : 'border-line bg-surface text-ink hover:border-brand-500',
                            )}
                          >
                            {section.name}
                            <span className={cn('text-xs tabular-nums', active ? 'text-white/80' : 'text-muted')}>
                              {section.dishes.length}
                            </span>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              )}
            </div>
          </div>

          <main className="mx-auto max-w-3xl px-4 pt-4 pb-10 sm:px-6">
            {term && (
              <p className="mb-4 text-sm text-muted" aria-live="polite">
                {matchCount === 0
                  ? `No dishes match “${query.trim()}”.`
                  : `${matchCount} ${matchCount === 1 ? 'dish matches' : 'dishes match'} “${query.trim()}”.`}
              </p>
            )}

            {visibleSections.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-12 text-center">
                <p className="font-medium text-ink">Nothing on the menu matches that</p>
                <p className="mt-1 text-sm text-muted">Try another dish name or ingredient.</p>
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="mt-4 inline-flex h-9 items-center rounded-full bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
                >
                  Show the full menu
                </button>
              </div>
            ) : (
              <div className="space-y-10">
                {visibleSections.map((section) => (
                  <section
                    key={section.key}
                    id={section.key}
                    ref={(element) => {
                      if (element) sectionRefs.current.set(section.key, element);
                      else sectionRefs.current.delete(section.key);
                    }}
                    aria-labelledby={`${section.key}-title`}
                    className="scroll-mt-32"
                  >
                    <h2 id={`${section.key}-title`} className="mb-3 flex items-baseline gap-2 text-xl font-semibold tracking-tight text-ink text-balance">
                      {section.name}
                      <span className="text-sm font-normal text-muted tabular-nums">{section.dishes.length}</span>
                    </h2>
                    <ul className="space-y-3">
                      {section.dishes.map((dish) => (
                        <li key={dish.id}>
                          <DishCard dish={dish} money={money} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </main>
        </>
      )}

      <footer className="border-t border-line">
        <div className="mx-auto max-w-3xl space-y-2 px-4 py-6 text-xs text-muted sm:px-6">
          <p className="flex items-start gap-1.5">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-warn-600" aria-hidden />
            <span>{menu.disclaimer} Nutrition values are not medical or dietary advice.</span>
          </p>
          <p>
            Menu powered by <span className="font-semibold text-brand-700">Plateo</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

function RestaurantHeader({ menu, totalDishes }: { menu: PublicMenu; totalDishes: number }) {
  const { restaurant } = menu;
  const [logoFailed, setLogoFailed] = useState(false);
  const initials = restaurant.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-3xl items-start gap-4 px-4 py-6 sm:px-6 sm:py-8">
        {restaurant.logoUrl && !logoFailed ? (
          // Restaurant-supplied URL on an arbitrary host; next/image would need every host allow-listed.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={restaurant.logoUrl}
            alt={`${restaurant.name} logo`}
            onError={() => setLogoFailed(true)}
            className="size-16 shrink-0 rounded-2xl border border-line object-cover sm:size-20"
          />
        ) : (
          <div
            aria-hidden
            className="grid size-16 shrink-0 place-items-center rounded-2xl bg-brand-600 text-xl font-semibold text-white sm:size-20 sm:text-2xl"
          >
            {initials}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-[0.14em] text-brand-600 uppercase">Menu</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink text-balance sm:text-3xl">{restaurant.name}</h1>
          {restaurant.description && (
            <p className="mt-1.5 max-w-prose text-sm text-muted">{restaurant.description}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
            {restaurant.address && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4 shrink-0" aria-hidden />
                {restaurant.address}
              </span>
            )}
            {totalDishes > 0 && (
              <span className="tabular-nums">
                {totalDishes} {totalDishes === 1 ? 'dish' : 'dishes'} available
              </span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function DishCard({ dish, money }: { dish: PublicDish; money: (value: number) => string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const nutrition = dish.nutrition;
  const macros = nutrition
    ? [
        nutrition.calories !== null ? { label: 'kcal', value: nutrition.calories } : null,
        nutrition.proteinGrams !== null ? { label: 'g protein', value: nutrition.proteinGrams } : null,
        nutrition.carbsGrams !== null ? { label: 'g carbs', value: nutrition.carbsGrams } : null,
        nutrition.fatGrams !== null ? { label: 'g fat', value: nutrition.fatGrams } : null,
      ].filter((entry): entry is { label: string; value: number } => entry !== null)
    : [];

  return (
    <article className="rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-labelledby={`dish-${dish.id}`}>
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <DietMark diet={dish.dietType} />
            <h3 id={`dish-${dish.id}`} className="font-semibold leading-snug text-ink">
              {dish.name}
            </h3>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-base font-semibold text-ink tabular-nums">{money(dish.price)}</span>
            {dish.preparationTimeMinutes !== null && (
              <span className="inline-flex items-center gap-1 text-xs text-muted">
                <Clock className="size-3.5" aria-hidden />
                {dish.preparationTimeMinutes} min
              </span>
            )}
            {dish.dietType === 'VEGAN' && <Tag>Vegan</Tag>}
            {dish.dietType === 'EGG' && <Tag>Contains egg</Tag>}
          </div>

          {dish.description && <p className="mt-2 text-sm text-muted">{dish.description}</p>}

          {macros.length > 0 && (
            <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {macros.map((macro) => (
                <div key={macro.label} className="flex items-baseline gap-1">
                  <dt className="sr-only">{macro.label}</dt>
                  <dd className="font-semibold text-ink tabular-nums">{quantityFormat.format(macro.value)}</dd>
                  <span aria-hidden>{macro.label}</span>
                </div>
              ))}
            </dl>
          )}

          {dish.allergens.length > 0 && (
            <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-warn-50 px-2.5 py-1.5 text-xs font-medium text-warn-600">
              <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>
                <span className="sr-only">Allergens: </span>
                {dish.allergens.join(' · ')}
              </span>
            </p>
          )}
        </div>

        {dish.imageUrl && !imageFailed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dish.imageUrl}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="size-24 shrink-0 rounded-xl border border-line object-cover sm:size-28"
          />
        )}
      </div>

      {dish.ingredients.length > 0 && (
        <details className="group mt-3 border-t border-line pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-brand-700 select-none [&::-webkit-details-marker]:hidden">
            Ingredients ({dish.ingredients.length})
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {dish.ingredients.map((ingredient) => (
              <li key={ingredient.name} className="flex items-baseline justify-between gap-3 border-b border-dashed border-line py-1">
                <span className="min-w-0 text-ink">
                  {ingredient.name}
                  {ingredient.allergenInfo && (
                    <span className="block text-xs text-warn-600">{ingredient.allergenInfo}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted tabular-nums">
                  {quantityFormat.format(ingredient.quantity)} {ingredient.unit}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

/**
 * Indian food packaging and menu convention (FSSAI): a green square with a dot
 * for vegetarian, a brown square with a triangle for non-vegetarian. Diners scan
 * for this mark, so it is shown in its familiar form rather than as a text badge.
 */
function DietMark({ diet }: { diet: PublicDietType | null }) {
  if (!diet) return null;

  const vegetarian = diet === 'VEG' || diet === 'VEGAN';
  const colour = vegetarian ? '#1f8a3b' : '#963a14';
  const label =
    diet === 'VEGAN' ? 'Vegan' : diet === 'VEG' ? 'Vegetarian' : diet === 'EGG' ? 'Contains egg' : 'Non-vegetarian';

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="mt-[3px] inline-grid size-4 shrink-0 place-items-center rounded-[3px] border-[1.5px] bg-white"
      style={{ borderColor: colour }}
    >
      {vegetarian ? (
        <span className="size-2 rounded-full" style={{ backgroundColor: colour }} />
      ) : (
        <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
          <path d="M5 1 9.5 9h-9z" fill={colour} />
        </svg>
      )}
    </span>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted">
      {children}
    </span>
  );
}
