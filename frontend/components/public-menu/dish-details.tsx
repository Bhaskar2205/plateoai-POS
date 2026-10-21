'use client';

import {
  Beef,
  Clock,
  Croissant,
  Droplet,
  Flame,
  Sparkles,
  TriangleAlert,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { amount } from '@/lib/rupees';
import type { PublicDietType, PublicDish } from '@/lib/public-menu';
import { DishOrderControl, useDinerCart } from './diner-order';
import { IngredientChip, ingredientIcon } from './ingredient-icon';

/**
 * The parts of the diner menu that answer "what is actually in this dish?".
 *
 * A menu card can only hold a name, a price and a photo before it stops being
 * scannable, so everything else - the full description, what is in it, the
 * declared nutrition and the allergen warning - lives in a detail sheet the diner
 * opens by tapping the dish.
 *
 * Ingredients are **names with an icon, and no quantities**. A guest deciding
 * what to eat wants to know there is paneer and cashew in it; how many grams is
 * the kitchen's own business, and the icons let a list of fifteen be read at a
 * glance rather than word by word.
 */

// Not Intl: this is server-rendered markup, and a device whose ICU groups
// differently would make React rebuild the tree. See lib/rupees.ts.
const numberFormat = { format: (value: number) => amount(value) };

const DIET_LABELS: Record<PublicDietType, string> = {
  VEG: 'Vegetarian',
  VEGAN: 'Vegan',
  EGG: 'Contains egg',
  NON_VEG: 'Non-vegetarian',
};

const isVegetarian = (diet: PublicDietType) => diet === 'VEG' || diet === 'VEGAN';

/**
 * Indian food packaging and menu convention (FSSAI): a green square with a dot
 * for vegetarian, a brown square with a triangle for non-vegetarian. Diners scan
 * for this mark, so it is shown in its familiar form rather than as a text badge.
 */
export function DietMark({ diet, className }: { diet: PublicDietType | null; className?: string }) {
  if (!diet) return null;

  const vegetarian = isVegetarian(diet);
  const colour = vegetarian ? '#1f8a3b' : '#963a14';

  return (
    <span
      role="img"
      aria-label={DIET_LABELS[diet]}
      title={DIET_LABELS[diet]}
      className={cn(
        'inline-grid size-4 shrink-0 place-items-center rounded-[3px] border-[1.5px] bg-white',
        className,
      )}
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

/** The mark plus its words, for places with room to spell it out. */
export function DietBadge({ diet }: { diet: PublicDietType | null }) {
  if (!diet) return null;

  const vegetarian = isVegetarian(diet);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
        vegetarian
          ? 'border-brand-100 bg-brand-50 text-brand-700'
          : 'border-saffron-100 bg-saffron-50 text-saffron-600',
      )}
    >
      <DietMark diet={diet} />
      {DIET_LABELS[diet]}
    </span>
  );
}

/**
 * A dish photo, or a placeholder that still looks deliberate.
 *
 * Most restaurants photograph their menu gradually, so a card with no image must
 * not collapse into a ragged text row next to cards that have one - every dish
 * keeps the same shape, and the placeholder carries the dish's own initial so the
 * list still reads as a list of distinct things.
 */
export function DishImage({
  dish,
  className,
  failed,
  onFailed,
  priority = false,
  size = 'full',
}: {
  dish: PublicDish;
  className?: string;
  failed: boolean;
  onFailed: () => void;
  priority?: boolean;
  /**
   * `grid` asks for the smaller variant. Sixty-four cards at full size is several
   * megabytes to scroll a menu; at grid size it is a few hundred kilobytes.
   */
  size?: 'grid' | 'full';
}) {
  // Falls back to the full image, so a menu served before the API returned this
  // field still shows a photo rather than a blank frame.
  const src = size === 'grid' ? (dish.thumbnailUrl ?? dish.imageUrl) : dish.imageUrl;
  const shell = 'relative overflow-hidden bg-ground';

  if (!src || failed) {
    return (
      <div aria-hidden className={cn(shell, 'grid place-items-center', className)}>
        <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-ground to-saffron-50" />
        <UtensilsCrossed className="relative size-1/4 min-w-5 text-brand-600/25" />
      </div>
    );
  }

  return (
    <div className={cn(shell, className)}>
      {/* Restaurant-supplied URL on an arbitrary host; next/image would need every host allow-listed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`${dish.name}, as served`}
        loading={priority ? 'eager' : 'lazy'}
        onError={onFailed}
        className="size-full object-cover"
      />
    </div>
  );
}

/** Prep time, phrased as a diner reads it rather than as a number. */
export function PrepTime({ minutes }: { minutes: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <Clock className="size-3.5 shrink-0" aria-hidden />
      <span className="sr-only">Usually ready in </span>
      {minutes} min
    </span>
  );
}

/** Allergens, in the one colour on the page that means "read this". */
export function AllergenNotice({ allergens, className }: { allergens: string[]; className?: string }) {
  if (allergens.length === 0) return null;

  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-xl bg-warn-50 px-3 py-2 text-xs font-medium text-warn-600',
        className,
      )}
    >
      <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
      <span>
        <span className="font-semibold">Contains: </span>
        {allergens.join(', ')}
      </span>
    </p>
  );
}

interface Macro {
  label: string;
  value: number;
  unit: string;
  icon: LucideIcon;
  tint: string;
}

const macrosOf = (dish: PublicDish): Macro[] => {
  const nutrition = dish.nutrition;

  if (!nutrition) return [];

  return (
    [
      { label: 'Calories', value: nutrition.calories, unit: 'kcal', icon: Flame, tint: 'bg-orange-50 text-orange-700' },
      { label: 'Protein', value: nutrition.proteinGrams, unit: 'g', icon: Beef, tint: 'bg-rose-50 text-rose-700' },
      { label: 'Carbs', value: nutrition.carbsGrams, unit: 'g', icon: Croissant, tint: 'bg-amber-50 text-amber-700' },
      { label: 'Fat', value: nutrition.fatGrams, unit: 'g', icon: Droplet, tint: 'bg-sky-50 text-sky-700' },
    ] as Array<Omit<Macro, 'value'> & { value: number | null }>
  ).filter((macro): macro is Macro => macro.value !== null);
};

/** Calories alone, for the card - the one number most diners scan for. */
export function CalorieChip({ dish }: { dish: PublicDish }) {
  const calories = dish.nutrition?.calories;

  if (calories === null || calories === undefined) return null;

  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <Flame className="size-3.5 shrink-0" aria-hidden />
      {numberFormat.format(calories)} kcal
    </span>
  );
}

/**
 * The first few ingredients as icons only, on the dish card.
 *
 * A row of small icons says "chicken, chilli, cashew" from across the table, and
 * invites the tap that opens the full list.
 */
export function IngredientGlyphs({ dish, max = 4 }: { dish: PublicDish; max?: number }) {
  if (dish.ingredients.length === 0) return null;

  const shown = dish.ingredients.slice(0, max);
  const rest = dish.ingredients.length - shown.length;

  return (
    <span className="flex items-center gap-1" aria-hidden>
      {shown.map((ingredient) => {
        const { icon: Icon, className } = ingredientIcon(ingredient.name);

        return (
          <span
            key={ingredient.name}
            title={ingredient.name}
            className={cn('grid size-6 place-items-center rounded-md', className)}
          >
            <Icon className="size-3.5" />
          </span>
        );
      })}
      {rest > 0 && <span className="text-[11px] font-medium text-muted">+{rest}</span>}
    </span>
  );
}

function SheetSection({
  title,
  hint,
  icon: Icon,
  children,
}: {
  title: string;
  hint?: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-px grid size-6 shrink-0 place-items-center rounded-lg bg-ground text-brand-700">
          <Icon className="size-3.5" aria-hidden />
        </span>
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * Everything known about one dish, opened from its card.
 *
 * A bottom sheet on a phone and a centred dialog on a laptop, because this is
 * read one-handed at a table far more often than on a desk. The photo runs to the
 * edges with the dish name over it and the price on a chip, which is what makes
 * it read as a menu rather than a form.
 */
export function DishDetailsSheet({
  dish,
  money,
  disclaimer,
  onClose,
}: {
  dish: PublicDish | null;
  money: (value: number) => string;
  disclaimer: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  /**
   * How far down the sheet has been dragged, in pixels.
   *
   * A bottom sheet that cannot be swiped away is the thing people report as "it
   * will not close": they pull down, nothing happens, and the only exits left
   * are a small X or a strip of backdrop. Every app they use closes a sheet this
   * way, so the gesture is not a flourish - its absence reads as a broken page.
   */
  const [dragY, setDragY] = useState(0);
  const dragFrom = useRef<number | null>(null);

  /**
   * The same distance again, in a ref.
   *
   * `touchend` has to decide close-or-spring-back from the final distance, and
   * state is not guaranteed to have caught up by then - a flick whose moves and
   * release land in one frame would be read as a drag of zero and the sheet
   * would stay put. The ref is written synchronously, so the decision is always
   * made on the real number; the state exists only to move the sheet on screen.
   */
  const dragDistance = useRef(0);
  // Null unless the menu was opened from a table QR code, in which case the diner
  // can order and the sheet earns a sticky action bar.
  const cart = useDinerCart();

  useEffect(() => {
    if (!dish) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [dish, onClose]);

  if (!dish) return null;

  /**
   * Only begins a drag when the content is already scrolled to the top.
   *
   * Otherwise reading a long dish turns into dismissing it: the first upward
   * flick would scroll, and the first downward one would throw the sheet away
   * mid-sentence.
   */
  const onTouchStart = (event: React.TouchEvent) => {
    if ((sheetRef.current?.scrollTop ?? 0) > 0) return;

    dragFrom.current = event.touches[0].clientY;
  };

  const onTouchMove = (event: React.TouchEvent) => {
    if (dragFrom.current === null) return;

    // Downward only. Dragging up would lift the sheet off the bottom of the
    // screen and show a gap under it.
    const distance = Math.max(0, event.touches[0].clientY - dragFrom.current);

    dragDistance.current = distance;
    setDragY(distance);
  };

  const onTouchEnd = () => {
    if (dragFrom.current === null) return;

    const travelled = dragDistance.current;

    dragFrom.current = null;
    dragDistance.current = 0;
    setDragY(0);

    // Far enough to be deliberate. Shorter than that is a mis-swipe while
    // reading, and the sheet springs back.
    if (travelled > 110) onClose();
  };

  const macros = macrosOf(dish);
  const calories = macros.find((macro) => macro.label === 'Calories');
  const hasPhoto = Boolean(dish.imageUrl);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 backdrop-blur-sm sm:items-center sm:p-6"
      // A tap on the backdrop closes it, the way every app sheet behaves.
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`dish-sheet-${dish.id}-title`}
        onClick={(event) => event.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ transform: dragY ? `translateY(${dragY}px)` : undefined }}
        className={cn(
          'max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface shadow-raised sm:rounded-3xl',
          // No transition while a finger is on it - the sheet should track the
          // thumb exactly - and a quick spring back when it is let go.
          dragY === 0 && 'transition-transform duration-200',
        )}
      >
        {/* The grab handle. Its job is to say "this pulls down" before anybody
            has to discover it. Phones only: a mouse has the X and the backdrop. */}
        <div aria-hidden className="sticky top-0 z-10 flex justify-center bg-transparent pt-2 pb-1 sm:hidden">
          <span className="h-1 w-10 rounded-full bg-ink/25" />
        </div>

        <div className="relative">
          {/* Only when there is one. A dish with no photo used to get the same
              224px frame filled with a cutlery icon - a third of a phone screen
              spent saying nothing, pushing the description and the allergens
              below the fold. Without a photo the name simply leads. */}
          {hasPhoto ? (
            <DishImage
              dish={dish}
              failed={false}
              onFailed={() => undefined}
              priority
              className="h-56 w-full sm:h-64"
            />
          ) : (
            // Just enough to clear the close button and the grab handle. The
            // title block below is in normal flow without a photo, so this is
            // breathing room rather than a frame.
            <div aria-hidden className="h-12 w-full bg-gradient-to-b from-brand-50 to-surface" />
          )}

          {/* Darkened only where there is a photo, so the name over it stays readable. */}
          {hasPhoto && (
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-ink/85 via-ink/35 to-transparent"
            />
          )}

          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={`Close details for ${dish.name}`}
            className="absolute top-3 right-3 grid size-9 place-items-center rounded-full bg-surface/90 text-ink shadow-card backdrop-blur transition-colors hover:bg-surface"
          >
            <X className="size-5" aria-hidden />
          </button>

          <div
            className={cn(
              'flex items-end justify-between gap-3 p-4',
              // Over a photograph the name sits on the image. With no photo
              // there is nothing to sit on, and absolute positioning rode it
              // up over the close button.
              hasPhoto ? 'absolute inset-x-0 bottom-0' : 'pt-1',
            )}
          >
            <div className="min-w-0">
              <span className="mb-1.5 flex items-center gap-1.5">
                <DietMark diet={dish.dietType} />
                {dish.preparationTimeMinutes !== null && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold backdrop-blur',
                      hasPhoto ? 'bg-white/90 text-ink' : 'bg-ground text-muted',
                    )}
                  >
                    <Clock className="size-3" aria-hidden />
                    {dish.preparationTimeMinutes} min
                  </span>
                )}
              </span>

              <h2
                id={`dish-sheet-${dish.id}-title`}
                className={cn(
                  'text-2xl leading-tight font-bold tracking-tight text-balance',
                  hasPhoto ? 'text-white drop-shadow-md' : 'text-ink',
                )}
              >
                {dish.name}
              </h2>
            </div>

            <span
              className={cn(
                'shrink-0 rounded-full px-3.5 py-1.5 text-base font-bold tabular-nums shadow-card',
                hasPhoto ? 'bg-white text-ink' : 'bg-brand-600 text-white',
              )}
            >
              {money(dish.price)}
            </span>
          </div>
        </div>

        <div className="space-y-5 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <DietBadge diet={dish.dietType} />
            {calories && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-muted">
                <Flame className="size-3.5 text-orange-600" aria-hidden />
                {numberFormat.format(calories.value)} kcal
              </span>
            )}
          </div>

          <AllergenNotice allergens={dish.allergens} />

          {dish.description && <p className="text-sm leading-relaxed text-muted">{dish.description}</p>}

          {dish.ingredients.length > 0 && (
            <SheetSection
              title="What's inside"
              hint={`${dish.ingredients.length} ingredients, as listed by the kitchen.`}
              icon={Sparkles}
            >
              <ul className="grid grid-cols-2 gap-2">
                {dish.ingredients.map((ingredient) => (
                  <IngredientChip
                    key={ingredient.name}
                    name={ingredient.name}
                    allergenInfo={ingredient.allergenInfo}
                  />
                ))}
              </ul>
            </SheetSection>
          )}

          {macros.length > 0 && (
            <SheetSection title="Nutrition" hint="Per serving, as declared by the restaurant." icon={Flame}>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {macros.map((macro) => {
                  const Icon = macro.icon;

                  return (
                    <div
                      key={macro.label}
                      className="rounded-xl border border-line bg-surface px-3 py-2.5 text-center"
                    >
                      <span
                        className={cn(
                          'mx-auto mb-1 grid size-7 place-items-center rounded-lg',
                          macro.tint,
                        )}
                      >
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <dd className="text-base font-bold text-ink tabular-nums">
                        {numberFormat.format(macro.value)}
                        <span className="ml-0.5 text-xs font-medium text-muted">{macro.unit}</span>
                      </dd>
                      <dt className="text-xs text-muted">{macro.label}</dt>
                    </div>
                  );
                })}
              </dl>
            </SheetSection>
          )}

          {dish.ingredients.length === 0 && macros.length === 0 && !dish.description && (
            <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-muted">
              The kitchen hasn’t added details for this dish yet. Ask a member of staff and they’ll
              be happy to tell you what is in it.
            </p>
          )}

          <p className="flex items-start gap-1.5 border-t border-line pt-4 text-xs text-muted">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-warn-600" aria-hidden />
            <span>{disclaimer}</span>
          </p>
        </div>

        {/* Sticks to the bottom, so ordering is still one tap away after a long read. */}
        {cart && (
          <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-line bg-surface/95 px-5 py-4 backdrop-blur">
            <span className="text-sm font-semibold text-ink tabular-nums">{money(dish.price)}</span>
            <DishOrderControl dish={dish} />
          </div>
        )}
      </div>
    </div>
  );
}
