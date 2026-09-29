'use client';

import { Minus, Plus, Search, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatMoney } from '@/lib/format';
import type { OrderItemInput } from '@/lib/queries';
import { useCategories, useDishes } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { cn } from '@/lib/cn';

/**
 * Picking dishes for a table, built for a phone held in one hand during service.
 *
 * Tapping a dish adds one; tapping again adds another, so the common case is a
 * single tap per dish with no quantity field to focus. Unavailable dishes are
 * shown but not tappable - staff need to be able to tell a diner "we have that on
 * the menu, it's off tonight" rather than wonder where it went.
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

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();

    return (dishes.data ?? []).filter(
      (dish) =>
        (categoryId === 'all' || dish.categoryId === categoryId) &&
        (term === '' || dish.name.toLowerCase().includes(term)),
    );
  }, [dishes.data, search, categoryId]);

  const change = (dishId: number, delta: number) =>
    setDraft((current) => {
      const next = new Map(current);
      const quantity = (next.get(dishId) ?? 0) + delta;

      if (quantity <= 0) next.delete(dishId);
      else next.set(dishId, Math.min(quantity, 99));

      return next;
    });

  const chosen = [...draft.entries()];
  const draftTotal = chosen.reduce((sum, [dishId, quantity]) => {
    const dish = dishes.data?.find((candidate) => candidate.id === dishId);

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
  };

  if (dishes.isError) return <ErrorState error={dishes.error} onRetry={() => void dishes.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <TextField
            label="Find a dish"
            placeholder="Search the menu"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {(categories.data?.length ?? 0) > 0 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <CategoryChip active={categoryId === 'all'} onClick={() => setCategoryId('all')}>
            All
          </CategoryChip>
          {categories.data?.map((category) => (
            <CategoryChip
              key={category.id}
              active={categoryId === category.id}
              onClick={() => setCategoryId(category.id)}
            >
              {category.name}
            </CategoryChip>
          ))}
        </div>
      )}

      {dishes.isPending ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-14 w-full" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No dish matches"
          description="Try a different search, or clear the category filter."
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {visible.map((dish) => {
            const quantity = draft.get(dish.id) ?? 0;

            return (
              <li key={dish.id} className="bg-surface">
                <div className="flex items-center gap-3 p-3">
                  <button
                    type="button"
                    disabled={!dish.isAvailable}
                    onClick={() => change(dish.id, 1)}
                    className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                  >
                    <p
                      className={cn(
                        'truncate text-sm font-medium',
                        dish.isAvailable ? 'text-ink' : 'text-muted line-through',
                      )}
                    >
                      {dish.name}
                    </p>
                    <p className="text-xs text-muted">
                      {formatMoney(dish.price)}
                      {!dish.isAvailable && ' · off the menu today'}
                    </p>
                  </button>

                  {quantity > 0 ? (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => change(dish.id, -1)}
                        aria-label={`One fewer ${dish.name}`}
                      >
                        <Minus className="size-4" aria-hidden />
                      </Button>
                      <span className="w-7 text-center text-sm font-semibold text-ink" aria-live="polite">
                        {quantity}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => change(dish.id, 1)}
                        aria-label={`One more ${dish.name}`}
                      >
                        <Plus className="size-4" aria-hidden />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!dish.isAvailable}
                      onClick={() => change(dish.id, 1)}
                    >
                      <Plus className="size-4" aria-hidden />
                      Add
                    </Button>
                  )}
                </div>

                {quantity > 0 && (
                  <div className="px-3 pb-3">
                    <TextField
                      label="Note for the kitchen"
                      placeholder="No onion, less spicy..."
                      maxLength={255}
                      value={notes.get(dish.id) ?? ''}
                      onChange={(event) =>
                        setNotes((current) => new Map(current).set(dish.id, event.target.value))
                      }
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-line bg-surface/95 py-3 backdrop-blur">
        <p className="text-sm text-muted">
          {chosen.length === 0 ? (
            'Nothing selected yet'
          ) : (
            <>
              <span className="font-medium text-ink">
                {chosen.reduce((sum, [, quantity]) => sum + quantity, 0)} item(s)
              </span>{' '}
              · {formatMoney(draftTotal)}
            </>
          )}
        </p>
        <Button onClick={submit} disabled={chosen.length === 0} loading={submitting}>
          <Send className="size-4" aria-hidden />
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-brand-200 bg-brand-50 text-brand-700'
          : 'border-line bg-surface text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
