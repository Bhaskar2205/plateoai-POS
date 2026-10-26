'use client';

import { ChevronLeft, Minus, Plus, Search, Send, StickyNote, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatMoney } from '@/lib/format';
import type { OrderItemInput } from '@/lib/queries';
import { useCategories, useDishes } from '@/lib/queries';
import type { Dish } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { cn } from '@/lib/cn';

/**
 * Punching an order, laid out the way a till is.
 *
 * Three panes: the sections down the left, that section's dishes as big tiles in
 * the middle, and the bill being built on the right. That shape is not a
 * preference - it is how every POS a restaurant has already used is arranged, so
 * a manager who has never seen Plateo can work it without being taught.
 *
 * What it replaced was a 512px dialog with a search box, a row of filter chips
 * and a scrolling list of one-line rows. Everything was reachable and nothing
 * was quick: finding a dish meant typing or scrolling, and the window showed
 * four items at a time on a screen with room for forty.
 *
 * Tapping a tile adds one; tapping again adds another. No quantity field to
 * focus, because during service nobody wants to aim at a number input. Dishes
 * that are off the menu are shown and not tappable - staff need to tell a diner
 * "we have it, it's off tonight" rather than wonder where it went.
 *
 * On a phone the three panes become one: sections as a scrolling row, the tiles
 * under them, and the bill as a sheet you open from the footer.
 */
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
    <div className="flex h-full min-h-0 flex-col lg:grid lg:grid-cols-[13rem_minmax(0,1fr)_21rem]">
      {/* ---- Sections ---- */}
      <nav
        aria-label="Menu sections"
        className="shrink-0 border-b border-line bg-ground/60 lg:overflow-y-auto lg:border-r lg:border-b-0"
      >
        <p className="hidden px-4 pt-4 pb-2 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase lg:block">
          Sections
        </p>
        <ul className="flex gap-1.5 overflow-x-auto px-3 py-2 lg:block lg:space-y-0.5 lg:overflow-visible lg:px-2 lg:py-0 lg:pb-4">
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
                    'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm whitespace-nowrap transition-colors',
                    active
                      ? 'bg-brand-600 font-semibold text-white shadow-sm'
                      : 'font-medium text-muted hover:bg-surface hover:text-ink',
                  )}
                >
                  <span className="truncate">{section.name}</span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-1.5 text-xs tabular-nums',
                      active ? 'bg-white/20 text-white' : 'bg-line/60 text-muted',
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
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-line p-3">
          <label className="relative block">
            <span className="sr-only">Search the menu</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search the whole menu"
              className="h-11 w-full rounded-xl border border-line bg-surface pr-3 pl-9 text-base text-ink placeholder:text-muted/70 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {dishes.isPending ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-muted">
              {searching
                ? `Nothing on the menu matches “${search.trim()}”.`
                : 'This section has no dishes yet.'}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {visible.map((dish) => {
                const quantity = draft.get(dish.id) ?? 0;

                return (
                  <li key={dish.id}>
                    <button
                      type="button"
                      disabled={!dish.isAvailable}
                      onClick={() => change(dish.id, 1)}
                      className={cn(
                        'relative flex h-full min-h-20 w-full flex-col justify-between rounded-xl border p-3 text-left transition-all',
                        'focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-none',
                        dish.isAvailable
                          ? quantity > 0
                            ? 'border-brand-600 bg-brand-50 shadow-sm'
                            : 'border-line bg-surface hover:border-brand-300 hover:shadow-card active:scale-[0.98]'
                          : 'cursor-not-allowed border-line bg-ground/60',
                      )}
                    >
                      {quantity > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 grid size-6 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white shadow-sm tabular-nums">
                          {quantity}
                        </span>
                      )}

                      <span
                        className={cn(
                          'line-clamp-2 text-sm leading-snug font-semibold',
                          dish.isAvailable ? 'text-ink' : 'text-muted line-through',
                        )}
                      >
                        {dish.name}
                      </span>

                      <span className="mt-1.5 flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            'text-sm font-semibold tabular-nums',
                            quantity > 0 ? 'text-brand-700' : 'text-muted',
                          )}
                        >
                          {formatMoney(dish.price)}
                        </span>
                        {/* Which section a dish is in only needs saying when the
                            list is not already one section. */}
                        {(searching || categoryId === 'all') && sectionName(dish) && (
                          <span className="truncate text-[11px] text-muted">{sectionName(dish)}</span>
                        )}
                      </span>

                      {!dish.isAvailable && (
                        <span className="mt-1 text-[11px] font-medium text-warn-600">
                          Off the menu today
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
          'flex min-h-0 flex-col border-line bg-ground/40 lg:border-l',
          // On a phone it is a sheet over the dishes, opened from the footer.
          billOpen
            ? 'fixed inset-0 z-10 bg-surface lg:static lg:bg-ground/40'
            : 'hidden lg:flex',
        )}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
          <button
            type="button"
            onClick={() => setBillOpen(false)}
            className="-ml-1 grid size-8 place-items-center rounded-lg text-muted hover:bg-ground hover:text-ink lg:hidden"
            aria-label="Back to the menu"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <h3 className="text-sm font-semibold text-ink">This bill</h3>
          {lines > 0 && (
            <span className="ml-auto text-xs text-muted tabular-nums">
              {units} item{units === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {lines === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-muted">
              Nothing punched yet. Tap a dish to add it.
            </p>
          ) : (
            <ul className="space-y-2">
              {chosen.map(([dishId, quantity]) => {
                const dish = all.find((candidate) => candidate.id === dishId);

                if (!dish) return null;

                const note = notes.get(dishId) ?? '';

                return (
                  <li key={dishId} className="rounded-xl border border-line bg-surface p-2.5">
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink">{dish.name}</span>
                        <span className="block text-xs text-muted tabular-nums">
                          {quantity} × {formatMoney(dish.price)} ={' '}
                          <span className="font-semibold text-ink">
                            {formatMoney(dish.price * quantity)}
                          </span>
                        </span>
                      </span>

                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => change(dishId, -1)}
                          aria-label={`One fewer ${dish.name}`}
                          className="grid size-8 place-items-center rounded-lg border border-line bg-surface text-ink hover:bg-ground"
                        >
                          {quantity === 1 ? (
                            <Trash2 className="size-3.5 text-danger-600" aria-hidden />
                          ) : (
                            <Minus className="size-4" aria-hidden />
                          )}
                        </button>
                        <span className="w-6 text-center text-sm font-semibold text-ink tabular-nums">
                          {quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => change(dishId, 1)}
                          aria-label={`One more ${dish.name}`}
                          className="grid size-8 place-items-center rounded-lg border border-line bg-surface text-ink hover:bg-ground"
                        >
                          <Plus className="size-4" aria-hidden />
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
                        className="mt-2 h-9 w-full rounded-lg border border-line bg-ground/60 px-2.5 text-sm text-ink placeholder:text-muted/70 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 focus:outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setNoteFor(dishId)}
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-brand-700"
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

        <div className="shrink-0 space-y-3 border-t border-line bg-surface px-4 py-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted">Total</span>
            <span className="text-xl font-bold text-ink tabular-nums">
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
          className="flex h-12 w-full items-center justify-between gap-3 rounded-xl bg-brand-600 px-4 text-white disabled:bg-ground disabled:text-muted"
        >
          <span className="text-sm font-semibold">
            {lines === 0 ? 'Nothing punched yet' : `${units} item${units === 1 ? '' : 's'}`}
          </span>
          <span className="text-base font-bold tabular-nums">{formatMoney(draftTotal)}</span>
        </button>
      </div>
    </div>
  );
}
