'use client';

import {
  Armchair,
  ChevronRight,
  Clock,
  Leaf,
  MapPin,
  QrCode,
  Search,
  Sparkles,
  TriangleAlert,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { PublicDish, PublicMenu } from '@/lib/public-menu';
import { DinerOrdering, DishOrderControl } from './diner-order';
import {
  AllergenNotice,
  CalorieChip,
  DietMark,
  DishDetailsSheet,
  DishImage,
  IngredientGlyphs,
} from './dish-details';

interface Section {
  key: string;
  name: string;
  dishes: PublicDish[];
}

/**
 * The diner-facing menu: restaurant header, sticky search and section navigation,
 * and one list of dish cards per section.
 *
 * The card carries what a diner scans for - photo, name, price, veg mark, prep
 * time and any allergen warning - and nothing else. Everything deeper (full
 * description, every ingredient, declared nutrition) opens in a detail sheet, so
 * the list stays readable on a phone at a table while the question "what is
 * actually in this?" still has a clear answer one tap away.
 *
 * `ordering` is present only when the menu was opened from a table QR code.
 * Without it this is a read-only menu - and it says so, rather than simply
 * missing its Add buttons and leaving the diner to wonder.
 */
export function PublicMenuView({
  menu,
  ordering,
}: {
  menu: PublicMenu;
  /** From the QR link: the raw `?table=` token and the slug it resolved. */
  ordering?: { slug: string; tableToken: string };
}) {
  const [query, setQuery] = useState('');
  const [vegOnly, setVegOnly] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [openDish, setOpenDish] = useState<PublicDish | null>(null);
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
    if (!term && !vegOnly) return sections;

    return sections
      .map((section) => ({
        ...section,
        dishes: section.dishes.filter((dish) => {
          // Only VEG and VEGAN count: "contains egg" is not vegetarian to the
          // diners who use this filter, and an unmarked dish makes no promise.
          if (vegOnly && dish.dietType !== 'VEG' && dish.dietType !== 'VEGAN') return false;
          if (!term) return true;

          return (
            dish.name.toLowerCase().includes(term) ||
            dish.description?.toLowerCase().includes(term) ||
            dish.ingredients.some((ingredient) => ingredient.name.toLowerCase().includes(term))
          );
        }),
      }))
      .filter((section) => section.dishes.length > 0);
  }, [sections, term, vegOnly]);

  const totalDishes = sections.reduce((total, section) => total + section.dishes.length, 0);
  const matchCount = visibleSections.reduce((total, section) => total + section.dishes.length, 0);
  const filtering = term.length > 0 || vegOnly;
  const canOrder = Boolean(ordering && menu.table);

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
      { rootMargin: '-160px 0px -55% 0px' },
    );

    sectionRefs.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [visibleSections]);

  const page = (
    <div className="min-h-dvh bg-ground">
      <RestaurantHeader menu={menu} totalDishes={totalDishes} canOrder={canOrder} />

      {totalDishes === 0 ? (
        <main className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
          <span
            aria-hidden
            className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600"
          >
            <UtensilsCrossed className="size-7" />
          </span>
          <p className="mt-4 text-lg font-semibold text-ink">The menu is being prepared</p>
          <p className="mt-2 text-sm text-muted">
            {menu.restaurant.name} hasn’t published any dishes yet. Please check back soon or ask a member of staff.
          </p>
        </main>
      ) : (
        <>
          <div className="sticky top-0 z-20 border-b border-line bg-ground/95 backdrop-blur supports-[backdrop-filter]:bg-ground/80">
            <div className="mx-auto max-w-3xl space-y-2.5 px-4 pt-3 pb-2 sm:px-6">
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
                  <input
                    id="menu-search"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search dishes"
                    aria-label="Search dishes or ingredients"
                    className="h-11 w-full rounded-full border border-line bg-surface pr-10 pl-9 text-sm text-ink shadow-card placeholder:text-muted/80 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none"
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

                <button
                  type="button"
                  onClick={() => setVegOnly((current) => !current)}
                  aria-pressed={vegOnly}
                  className={cn(
                    'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors',
                    vegOnly
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-line bg-surface text-ink shadow-card hover:border-brand-500',
                  )}
                >
                  <Leaf className="size-4 shrink-0" aria-hidden />
                  Veg only
                </button>
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

          <main className="mx-auto max-w-5xl px-4 pt-4 pb-10 sm:px-6">
            {/* Without a table there are no Add buttons. Say why, rather than
                leaving a diner to decide the menu is broken. */}
            {!canOrder && <HowToOrder restaurantName={menu.restaurant.name} />}

            {filtering && (
              <div className="mb-4 flex flex-wrap items-center gap-2" aria-live="polite">
                <p className="text-sm text-muted">
                  {matchCount === 0
                    ? 'Nothing matches those filters.'
                    : `Showing ${matchCount} of ${totalDishes} ${totalDishes === 1 ? 'dish' : 'dishes'}`}
                  {vegOnly && matchCount > 0 && ' · vegetarian only'}
                  {term && matchCount > 0 && ` · “${query.trim()}”`}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setVegOnly(false);
                  }}
                  className="text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600"
                >
                  Clear
                </button>
              </div>
            )}

            {visibleSections.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-12 text-center">
                <p className="font-medium text-ink">Nothing on the menu matches that</p>
                <p className="mt-1 text-sm text-muted">
                  Try another dish name or ingredient{vegOnly ? ', or switch off the veg filter' : ''}.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setVegOnly(false);
                  }}
                  className="mt-4 inline-flex h-10 items-center rounded-full bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700"
                >
                  Show the full menu
                </button>
              </div>
            ) : (
              <div className="space-y-9">
                {visibleSections.map((section) => (
                  <section
                    key={section.key}
                    id={section.key}
                    ref={(element) => {
                      if (element) sectionRefs.current.set(section.key, element);
                      else sectionRefs.current.delete(section.key);
                    }}
                    aria-labelledby={`${section.key}-title`}
                    className="scroll-mt-36"
                  >
                    <div className="mb-3.5 flex items-center gap-3">
                      <h2
                        id={`${section.key}-title`}
                        className="font-display text-xl font-semibold tracking-tight text-ink text-balance sm:text-2xl"
                      >
                        {section.name}
                      </h2>
                      {/* A hairline that runs to the count, so a long menu reads
                          as courses rather than one unbroken list. */}
                      <span aria-hidden className="h-px min-w-4 flex-1 bg-line" />
                      <span className="shrink-0 text-xs font-medium text-muted tabular-nums">
                        {section.dishes.length} {section.dishes.length === 1 ? 'dish' : 'dishes'}
                      </span>
                    </div>

                    <ul className="grid gap-3 sm:gap-4 lg:grid-cols-2">
                      {section.dishes.map((dish) => (
                        <li key={dish.id}>
                          <DishCard dish={dish} money={money} onOpen={() => setOpenDish(dish)} />
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

      <DishDetailsSheet
        dish={openDish}
        money={money}
        disclaimer={menu.disclaimer}
        onClose={() => setOpenDish(null)}
      />
    </div>
  );

  if (!ordering || !menu.table) return page;

  return (
    <DinerOrdering
      slug={ordering.slug}
      tableToken={ordering.tableToken}
      tableName={menu.table.name}
      money={money}
    >
      {page}
    </DinerOrdering>
  );
}

/**
 * Shown when the menu was opened as a plain link rather than from a table QR code.
 *
 * Ordering needs the table's token, which only the printed QR carries, so the
 * honest thing is to explain that instead of showing an Add button that could not
 * work. The API would refuse the request anyway.
 */
function HowToOrder({ restaurantName }: { restaurantName: string }) {
  // One line. It is a footnote about how to order, sitting directly above the
  // food, and the earlier five-line version pushed the first dish off the screen
  // on a phone to explain something most people work out by scanning the code.
  return (
    <p className="mb-4 flex items-center gap-2.5 rounded-xl border border-saffron-100 bg-saffron-50 px-3.5 py-2.5 text-xs text-muted">
      <QrCode className="size-4 shrink-0 text-saffron-600" aria-hidden />
      <span className="min-w-0">
        Scan the code on your table at {restaurantName} to order — browse freely here.
      </span>
    </p>
  );
}

/** The restaurant logo, or its initials when there is no logo or it fails to load. */
export function RestaurantMark({ restaurant }: { restaurant: PublicMenu['restaurant'] }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const initials = restaurant.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');

  return restaurant.logoUrl && !logoFailed ? (
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
  );
}

function RestaurantHeader({
  menu,
  totalDishes,
  canOrder,
}: {
  menu: PublicMenu;
  totalDishes: number;
  canOrder: boolean;
}) {
  const { restaurant, table } = menu;

  return (
    <header className="relative overflow-hidden border-b border-line bg-surface">
      {/* A warm wash behind the name, so the page opens as something served
          rather than a form. Decorative only. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-brand-50 via-saffron-50/60 to-transparent"
      />
      <div aria-hidden className="h-1.5 bg-gradient-to-r from-brand-600 via-brand-500 to-saffron-500" />

      <div className="relative mx-auto flex max-w-3xl items-start gap-4 px-4 py-6 sm:px-6 sm:py-8">
        <div className="relative">
          <RestaurantMark restaurant={restaurant} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] text-brand-700 uppercase">
            <UtensilsCrossed className="size-3" aria-hidden />
            Menu
          </p>
          <h1 className="font-display mt-2 text-[26px] leading-tight font-semibold tracking-tight text-ink text-balance sm:text-4xl">
            {restaurant.name}
          </h1>
          {restaurant.description && (
            <p className="mt-1.5 max-w-prose text-sm text-muted">{restaurant.description}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {restaurant.address && (
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{restaurant.address}</span>
              </span>
            )}
            {totalDishes > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted tabular-nums">
                <Sparkles className="size-3.5 shrink-0 text-saffron-500" aria-hidden />
                {totalDishes} {totalDishes === 1 ? 'dish' : 'dishes'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* The table is the single most important fact on this page when it is set:
          it tells the diner their order will reach their own table. */}
      {table && (
        <div className="relative border-t border-brand-100 bg-brand-50">
          <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-4 py-3 sm:px-6">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white"
            >
              <Armchair className="size-4" />
            </span>
            <p className="min-w-0 text-sm text-brand-700">
              You are seated at <span className="font-bold">{table.name}</span>
              {canOrder
                ? ' — tap Add on any dish, then Place order. It goes straight to your table.'
                : ' — ask a member of staff to take your order.'}
            </p>
          </div>
        </div>
      )}
    </header>
  );
}

/**
 * One dish, as a diner scans it.
 *
 * A row, with the photograph on the right at a size worth looking at. The
 * earlier version gave every dish a 4:3 photo frame whether or not it had a
 * photo, on the reasoning that a menu is a shop window and uniform cards read as
 * deliberate. The window argument is right; the uniform frame was not. Most
 * restaurants photograph their menu gradually, and a menu of five dishes with
 * one photograph became five screens of empty grey block with a cutlery icon in
 * the middle - a diner scrolled past nothing to reach nothing.
 *
 * So the frame is gone and the photo is optional. A dish with one shows it; a
 * dish without simply gives its words the full width. Rows still line up, because
 * what sets their height is the text every dish has rather than an image most of
 * them do not.
 *
 * The whole row opens the details, so a diner wanting to know what is in
 * something does not have to find a small link. Add stays its own target:
 * ordering by accident while reading is worse than one more tap.
 */
function DishCard({
  dish,
  money,
  onOpen,
}: {
  dish: PublicDish;
  money: (value: number) => string;
  onOpen: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const hasPhoto = Boolean(dish.imageUrl) && !imageFailed;

  return (
    <article
      aria-labelledby={`dish-${dish.id}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition-all focus-within:border-brand-500/40 focus-within:shadow-raised hover:border-brand-500/40 hover:shadow-raised"
    >
      <div className="flex flex-1 items-start gap-3.5 p-3.5 sm:gap-4 sm:p-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            onClick={onOpen}
            aria-label={`See what is in ${dish.name}`}
            className="min-w-0 text-left focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-none"
          >
            <span className="flex items-start gap-2">
              <DietMark diet={dish.dietType} className="mt-0.5 shrink-0" />
              <h3
                id={`dish-${dish.id}`}
                className="min-w-0 text-[15px] leading-snug font-semibold text-ink text-balance sm:text-base"
              >
                {dish.name}
              </h3>
            </span>

            {/* Under the name rather than over the photograph. On the old card a
                long name and the price met in the same corner and overlapped. */}
            <p className="mt-1 text-[15px] font-bold text-ink tabular-nums sm:text-base">
              {money(dish.price)}
            </p>

            {dish.description && (
              <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted sm:text-[13px]">
                {dish.description}
              </p>
            )}
          </button>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <CalorieChip dish={dish} />
            {dish.preparationTimeMinutes !== null && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted tabular-nums">
                <Clock className="size-3" aria-hidden />
                <span className="sr-only">Usually ready in </span>
                {dish.preparationTimeMinutes} min
              </span>
            )}
          </div>

          <div className="mt-2 space-y-2">
            <IngredientGlyphs dish={dish} />
            <AllergenNotice allergens={dish.allergens} />
          </div>

          <div className="mt-auto flex items-center justify-between gap-3 pt-3">
            {/* Truncates rather than wrapping. At 390px a long label used to run
                to a second line and shove itself into the Add button. */}
            <button
              type="button"
              onClick={onOpen}
              className="inline-flex min-w-0 items-center gap-0.5 rounded-lg text-xs font-semibold text-brand-700 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-none"
            >
              {dish.ingredients.length > 0 ? (
                <>
                  <Sparkles className="mr-1 size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">
                    {`What's inside · ${dish.ingredients.length} ingredients`}
                  </span>
                </>
              ) : (
                'Dish details'
              )}
              <ChevronRight className="size-3.5 shrink-0" aria-hidden />
            </button>

            <span className="shrink-0">
              <DishOrderControl dish={dish} />
            </span>
          </div>
        </div>

        {/* Only when there is one. An empty frame sells nothing and costs a
            third of the screen on the phone this is read on. */}
        {hasPhoto && (
          <button
            type="button"
            onClick={onOpen}
            tabIndex={-1}
            aria-hidden
            className="shrink-0 focus-visible:outline-none"
          >
            <DishImage
              dish={dish}
              size="grid"
              failed={imageFailed}
              onFailed={() => setImageFailed(true)}
              className="size-24 rounded-xl ring-1 ring-ink/5 transition-transform duration-300 group-hover:scale-[1.03] sm:size-28"
            />
          </button>
        )}
      </div>
    </article>
  );
}
