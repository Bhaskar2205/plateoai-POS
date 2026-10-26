'use client';

import { ChevronLeft, Minus, Plus, Search, Send, StickyNote, Trash2, UtensilsCrossed } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatMoney } from '@/lib/format';
import type { OrderItemInput } from '@/lib/queries';
import { useCategories, useDishes } from '@/lib/queries';
import type { DietType, Dish } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { cn } from '@/lib/cn';

/**
 * Punching an order, laid out the way a till is.
 *
 * Three panes: the sections down the left, that section's dishes as tiles in the
 * middle, and the bill being built on the right. That shape is not a preference
 * - it is how every POS a restaurant has already used is arranged, so a manager
 * who has never seen Plateo can work it without being taught.
 *
 * Tapping a tile adds one; tapping again adds another. No quantity field to
 * focus, because during service nobody wants to aim at a number input. Dishes
 * that are off the menu are shown and not tappable - staff need to tell a diner
 * "we have it, it's off tonight" rather than wonder where it went.
 *
 * Tiles carry the dish's own photo where it has one, because a cook or a waiter
 * recognises a picture faster than they read a name, and a wall of identical
 * white rectangles is what made the old dialog tiring to use. Where there is no
 * photo the tile draws a monogram in a colour derived from the name, so the grid
 * still reads as a set of distinct things rather than a blank form.
 *
 * On a phone the three panes become one: sections as a scrolling row, the tiles
 * under them, and the bill as a sheet you open from the footer.
 */

/** The marker every Indian menu carries. Green square for veg, red for not. */
function DietMark({ diet }: { diet: DietType }) {
  const vegetarian = diet === 'VEG' || diet === 'VEGAN';

  return (
    <span
      aria-label={vegetarian ? 'Vegetarian' : 'Non-vegetarian'}
      className={cn(
        'grid size-3.5 shrink-0 place-items-center rounded-[3px] border bg-white',
        vegetarian ? 'border-[#1f8a3b]' : 'border-[#963a14]',
      )}
    >
      <span
        aria-hidden
        className={cn('size-1.5 rounded-full', vegetarian ? 'bg-[#1f8a3b]' : 'bg-[#963a14]')}
      />
    </span>
  );
}

/**
 * A stable tint per dish, so a menu without photos still looks like a set of
 * distinct things. Derived from the name, so a dish keeps its colour between
 * sessions and between staff.
 */
const TINTS = [
  'bg-brand-100 text-brand-700',
  'bg-saffron-100 text-saffron-600',
  'bg-info-100 text-info-700',
  'bg-warn-50 text-warn-600',
  'bg-danger-100 text-danger-600',
] as const;

function tintFor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) | 0;

  return TINTS[Math.abs(hash) % TINTS.length];
}

/**
 * The dish's photo, falling back to its monogram.
 *
 * The fallback is not decoration: a photo URL can 404 long after it was saved -
 * an upload volume that did not survive a move, a link pasted from a site that
 * later took the image down - and an empty grey square on a till tells staff
 * nothing. The monogram always renders something recognisable.
 */
function DishThumb({ dish, dimmed }: { dish: Dish; dimmed: boolean }) {
  const [failed, setFailed] = useState(false);
  const usePhoto = Boolean(dish.imageUrl) && !failed;

  return (
    <span
      aria-hidden
      className={cn(
        'relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl',
        usePhoto ? 'bg-ground' : tintFor(dish.name),
        dimmed && 'opacity-50 grayscale',
      )}
    >
      {usePhoto ? (
        // Not next/image: these are served from the API origin, which differs
        // per environment, and the grid is small enough not to need a loader.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dish.imageUrl!}
          alt=""
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <span className="text-base font-bold">{monogram(dish.name)}</span>
      )}
    </span>
  );
}

const monogram = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

export function DishPicker({
  onSubmit,
  submitting,
  submitLabel = 'Add to bill',
}: {
  onSubmit: (items: OrderItemInput[]) => void;
  submitting?: boolean;
  submitLabel?: string;
}) {
  const dishes = useDishes();
  const categories = useCategories();

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | 'all'>('all');
  const [draft, setDraft] = useState<Map<number, number>>(new Map());
  const [notes, setNotes] = useState<Map<number, string>>(new Map());
  const [noteFor, setNoteFor] = useState<number | null>(null);
  /** Phones only: the bill is a sheet rather than a column. */
  const [billOpen, setBillOpen] = useState(false);

  const all = useMemo(() => dishes.data ?? [], [dishes.data]);

  const countFor = (id: number | 'all') =>
    id === 'all' ? all.length : all.filter((dish) => dish.categoryId === id).length;

  // A search looks across the whole menu, never only the open section: somebody
  // typing "coke" wants the drink, not to be told this section has no coke.
  const searching = search.trim() !== '';

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (term !== '') return all.filter((dish) => dish.name.toLowerCase().includes(term));

    return categoryId === 'all' ? all : all.filter((dish) => dish.categoryId === categoryId);
  }, [all, search, categoryId]);

  const sectionName = (dish: Dish) =>
    categories.data?.find((category) => category.id === dish.categoryId)?.name ?? null;

  const change = (dishId: number, delta: number) =>
    setDraft((current) => {
      const next = new Map(current);
      const quantity = (next.get(dishId) ?? 0) + delta;

      if (quantity <= 0) next.delete(dishId);
      else next.set(dishId, Math.min(quantity, 99));

      return next;
    });

  const chosen = [...draft.entries()];
  const lines = chosen.length;
  const units = chosen.reduce((sum, [, quantity]) => sum + quantity, 0);
  const draftTotal = chosen.reduce((sum, [dishId, quantity]) => {
    const dish = all.find((candidate) => candidate.id === dishId);

    return sum + (dish ? dish.price * quantity : 0);
  }, 0);

  const submit = () => {
    onSubmit(
      chosen.map(([dishId, quantity]) => {
        const note = notes.get(dishId)?.trim();

        return { dishId, quantity, ...(note ? { note } : {}) };
      }),
    );
    setDraft(new Map());
    setNotes(new Map());
    setBillOpen(false);
  };

  if (dishes.isError) {
    return (
      <div className="p-5">
        <ErrorState error={dishes.error} onRetry={() => void dishes.refetch()} />
      </div>
    );
  }

  const sections: Array<{ id: number | 'all'; name: string }> = [
    { id: 'all', name: 'All items' },
    ...(categories.data ?? []).map((category) => ({ id: category.id, name: category.name })),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col lg:grid lg:grid-cols-[14rem_minmax(0,1fr)_22rem]">
      {/* ---- Sections ---- */}
      <nav
        aria-label="Menu sections"
        className="relative shrink-0 border-b border-line bg-ground/70 lg:overflow-y-auto lg:border-r lg:border-b-0"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 hidden h-28 bg-[linear-gradient(180deg,var(--color-brand-50),transparent)] lg:block"
        />
        <p className="relative hidden items-center gap-2 px-4 pt-4 pb-2.5 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase lg:flex">
          Sections
          <span aria-hidden className="h-px flex-1 bg-line" />
        </p>
        <ul className="relative flex gap-1.5 overflow-x-auto px-3 py-2 lg:block lg:space-y-1 lg:overflow-visible lg:px-2.5 lg:py-0 lg:pb-4">
          {sections.map((section) => {
            const active = !searching && categoryId === section.id;
            const count = countFor(section.id);

            return (
              <li key={String(section.id)} className="shrink-0 lg:shrink">
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => {
                    setCategoryId(section.id);
                    setSearch('');
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-3 text-left text-sm whitespace-nowrap transition-all',
                    active
                      ? 'bg-gradient-to-r from-brand-600 to-brand-700 font-semibold text-white shadow-sm'
                      : 'font-medium text-muted hover:bg-surface hover:text-ink',
                  )}
                >
                  <span className="truncate">{section.name}</span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                      active ? 'bg-white/20 text-white' : 'bg-line/70 text-muted',
                    )}
                  >
                    {count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ---- Dishes ---- */}
      <div className="flex min-h-0 flex-1 flex-col bg-ground/30">
        <div className="shrink-0 border-b border-line bg-surface p-3">
          <label className="relative block">
            <span className="sr-only">Search the menu</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search the whole menu"
              className="h-11 w-full rounded-xl border border-line bg-ground/60 pr-3 pl-10 text-base text-ink placeholder:text-muted/70 focus:border-brand-500 focus:bg-surface focus:ring-4 focus:ring-brand-500/10 focus:outline-none"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {dishes.isPending ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 9 }).map((_, index) => (
                <Skeleton key={index} className="h-[4.75rem] rounded-2xl" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-16 text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-surface text-muted ring-1 ring-line">
                <UtensilsCrossed className="size-6" aria-hidden />
              </span>
              <p className="text-sm font-medium text-ink">
                {searching ? 'Nothing matches that' : 'This section is empty'}
              </p>
              <p className="max-w-xs text-xs text-muted">
                {searching
                  ? `No dish on the menu contains “${search.trim()}”.`
                  : 'Add dishes to this section from the Menu screen.'}
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 2xl:grid-cols-4">
              {visible.map((dish) => {
                const quantity = draft.get(dish.id) ?? 0;
                const section = sectionName(dish);

                return (
                  <li key={dish.id}>
                    <button
                      type="button"
                      disabled={!dish.isAvailable}
                      onClick={() => change(dish.id, 1)}
                      className={cn(
                        'group relative flex h-full w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition-all duration-150',
                        'focus-visible:ring-4 focus-visible:ring-brand-500/25 focus-visible:outline-none',
                        dish.isAvailable
                          ? quantity > 0
                            ? 'border-brand-600 bg-brand-50 shadow-sm ring-1 ring-brand-600/20'
                            : 'border-line bg-surface shadow-card hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-raised active:translate-y-0'
                          : 'cursor-not-allowed border-line bg-ground/70',
                      )}
                    >
                      <DishThumb dish={dish} dimmed={!dish.isAvailable} />

                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-start gap-1.5">
                          {dish.dietType && <span className="mt-0.5"><DietMark diet={dish.dietType} /></span>}
                          <span
                            className={cn(
                              // break-words as well as the clamp: the clamp only
                              // limits height, and a long single word like
                              // "Hyderabadi" overflows the tile sideways without it.
                              'line-clamp-2 text-sm leading-snug font-semibold break-words',
                              dish.isAvailable ? 'text-ink' : 'text-muted line-through',
                            )}
                          >
                            {dish.name}
                          </span>
                        </span>

                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={cn(
                              'text-[15px] font-bold tabular-nums',
                              quantity > 0 ? 'text-brand-700' : 'text-ink',
                            )}
                          >
                            {formatMoney(dish.price)}
                          </span>
                          {/* Which section a dish is in only needs saying when
                              the list is not already one section. */}
                          {(searching || categoryId === 'all') && section && (
                            // Not on a phone: two columns at 390px leaves the
                            // price and the section fighting, and the section
                            // row is right above anyway.
                            <span className="hidden truncate text-[11px] text-muted sm:inline">
                              {section}
                            </span>
                          )}
                        </span>

                        {!dish.isAvailable && (
                          <span className="text-[11px] font-medium text-warn-600">
                            Off the menu today
                          </span>
                        )}
                      </span>

                      {quantity > 0 && (
                        <span className="absolute -top-2 -right-2 grid size-7 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white shadow-md ring-2 ring-surface tabular-nums">
                          {quantity}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ---- The bill being built ---- */}
      <aside
        aria-label="This bill"
        className={cn(
          'flex min-h-0 flex-col border-line bg-surface lg:border-l',
          // On a phone it is a sheet over the dishes, opened from the footer.
          billOpen ? 'fixed inset-0 z-10 lg:static' : 'hidden lg:flex',
        )}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-ground/50 px-4 py-3.5">
          <button
            type="button"
            onClick={() => setBillOpen(false)}
            className="-ml-1 grid size-8 place-items-center rounded-lg text-muted hover:bg-surface hover:text-ink lg:hidden"
            aria-label="Back to the menu"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <h3 className="text-sm font-semibold tracking-tight text-ink">This bill</h3>
          <span className="ml-auto text-xs font-medium text-muted tabular-nums">
            {lines === 0 ? 'empty' : `${units} item${units === 1 ? '' : 's'}`}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {lines === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-ground text-muted ring-1 ring-line">
                <UtensilsCrossed className="size-6" aria-hidden />
              </span>
              <p className="text-sm font-medium text-ink">Nothing punched yet</p>
              <p className="text-xs text-muted">Tap a dish to add it to this bill.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {chosen.map(([dishId, quantity]) => {
                const dish = all.find((candidate) => candidate.id === dishId);

                if (!dish) return null;

                const note = notes.get(dishId) ?? '';

                return (
                  <li
                    key={dishId}
                    className="rounded-xl border border-line bg-surface p-3 shadow-card"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start gap-1.5">
                          {dish.dietType && (
                            <span className="mt-0.5">
                              <DietMark diet={dish.dietType} />
                            </span>
                          )}
                          <span className="block text-sm leading-snug font-semibold text-ink">
                            {dish.name}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs text-muted tabular-nums">
                          {quantity} × {formatMoney(dish.price)} ={' '}
                          <span className="font-bold text-ink">
                            {formatMoney(dish.price * quantity)}
                          </span>
                        </span>
                      </span>

                      <span className="flex shrink-0 items-center gap-1 rounded-lg bg-ground/70 p-0.5 ring-1 ring-line">
                        <button
                          type="button"
                          onClick={() => change(dishId, -1)}
                          aria-label={`One fewer ${dish.name}`}
                          className="grid size-7 place-items-center rounded-md bg-surface text-ink shadow-sm hover:bg-ground"
                        >
                          {quantity === 1 ? (
                            <Trash2 className="size-3.5 text-danger-600" aria-hidden />
                          ) : (
                            <Minus className="size-3.5" aria-hidden />
                          )}
                        </button>
                        <span className="w-6 text-center text-sm font-bold text-ink tabular-nums">
                          {quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => change(dishId, 1)}
                          aria-label={`One more ${dish.name}`}
                          className="grid size-7 place-items-center rounded-md bg-surface text-ink shadow-sm hover:bg-ground"
                        >
                          <Plus className="size-3.5" aria-hidden />
                        </button>
                      </span>
                    </div>

                    {/* The note is behind a tap: most lines never need one, and a
                        text field on every row is a wall of boxes. */}
                    {noteFor === dishId || note !== '' ? (
                      <input
                        autoFocus={noteFor === dishId}
                        value={note}
                        maxLength={255}
                        onChange={(event) =>
                          setNotes((current) => new Map(current).set(dishId, event.target.value))
                        }
                        onBlur={() => setNoteFor(null)}
                        placeholder="No onion, less spicy…"
                        aria-label={`Note for ${dish.name}`}
                        className="mt-2 h-9 w-full rounded-lg border border-line bg-ground/60 px-2.5 text-sm text-ink placeholder:text-muted/70 focus:border-brand-500 focus:bg-surface focus:ring-2 focus:ring-brand-500/15 focus:outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setNoteFor(dishId)}
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-brand-700"
                      >
                        <StickyNote className="size-3.5" aria-hidden />
                        Note for the kitchen
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="shrink-0 space-y-3 border-t border-line bg-ground/40 px-4 py-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium text-muted">Total</span>
            <span className="text-2xl font-bold tracking-tight text-ink tabular-nums">
              {formatMoney(draftTotal)}
            </span>
          </div>
          <Button
            onClick={submit}
            disabled={lines === 0}
            loading={submitting}
            className="h-12 w-full text-base"
          >
            <Send className="size-4" aria-hidden />
            {submitLabel}
          </Button>
        </div>
      </aside>

      {/* ---- Phone footer: what is punched, and the way into the bill ---- */}
      <div className="shrink-0 border-t border-line bg-surface px-3 py-2.5 lg:hidden">
        <button
          type="button"
          onClick={() => setBillOpen(true)}
          disabled={lines === 0}
          className="flex h-12 w-full items-center justify-between gap-3 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 px-4 text-white shadow-sm disabled:bg-ground disabled:bg-none disabled:text-muted disabled:shadow-none"
        >
          <span className="text-sm font-semibold">
            {lines === 0 ? 'Nothing punched yet' : `${units} item${units === 1 ? '' : 's'} · view bill`}
          </span>
          <span className="text-base font-bold tabular-nums">{formatMoney(draftTotal)}</span>
        </button>
      </div>
    </div>
  );
}
