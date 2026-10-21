'use client';

import { Check, Loader2, Search, Tag } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { useDishes, useSetDishTaxGroup } from '@/lib/queries';
import type { Dish, TaxComponent, TaxGroup } from '@/lib/types';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

/**
 * Which items are taxed, and which are not.
 *
 * A tax component names the group it applies to; a dish belongs to one group.
 * That is the whole rule, and until now the only way to use it was to open each
 * dish and change it there - sixty edits to take GST off the bottled water, with
 * one bottle missed and still being charged wrongly a month later.
 *
 * So this is a list of the menu with its groups, a search box and a bulk action.
 * The point of the summary row above it is that a manager can see the rule
 * rather than the dishes: "food and drink pays 5%, these four pay nothing" is
 * the thing being decided, and it has to be checkable at a glance.
 */

const GROUPS: Array<{ value: TaxGroup; label: string; hint: string }> = [
  { value: 'STANDARD', label: 'Food & drink', hint: 'Everything you cook and serve.' },
  { value: 'ALCOHOL', label: 'Alcohol', hint: 'Outside GST; state VAT applies instead.' },
  { value: 'PACKAGED', label: 'Packaged', hint: 'Sold sealed, as bought.' },
  { value: 'EXEMPT', label: 'No tax', hint: 'Carries no tax at all.' },
];

const groupOf = (dish: Dish): TaxGroup => dish.taxGroup ?? 'STANDARD';

/** What a group is charged, from the components that name it. */
function chargesFor(components: TaxComponent[], group: TaxGroup) {
  const applied = components.filter((component) => component.isActive && component.appliesTo === group);

  return {
    applied,
    rate: applied.reduce((sum, component) => sum + component.rate, 0),
  };
}

export function TaxedItemsCard({ components }: { components: TaxComponent[] }) {
  const toast = useToast();
  const dishes = useDishes();
  const assign = useSetDishTaxGroup();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TaxGroup | 'ALL'>('ALL');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const all = useMemo(() => dishes.data ?? [], [dishes.data]);

  const counts = useMemo(() => {
    const tally = new Map<TaxGroup, number>();
    for (const dish of all) tally.set(groupOf(dish), (tally.get(groupOf(dish)) ?? 0) + 1);

    return tally;
  }, [all]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return all.filter(
      (dish) =>
        (filter === 'ALL' || groupOf(dish) === filter) &&
        (needle === '' || dish.name.toLowerCase().includes(needle)),
    );
  }, [all, filter, search]);

  const shownIds = shown.map((dish) => dish.id);
  const allShownSelected = shownIds.length > 0 && shownIds.every((id) => selected.has(id));

  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });

  const apply = (taxGroup: TaxGroup) => {
    const dishIds = [...selected];

    if (dishIds.length === 0) return;

    assign.mutate(
      { dishIds, taxGroup },
      {
        onSuccess: (result) => {
          setSelected(new Set());
          const label = GROUPS.find((group) => group.value === taxGroup)?.label ?? taxGroup;
          toast.success(
            result.updated === 0
              ? `Already ${label.toLowerCase()}. Nothing to change.`
              : `${result.updated} item${result.updated === 1 ? '' : 's'} moved to ${label}.`,
          );
        },
        onError: (error) => toast.error(error),
      },
    );
  };

  return (
    <Card>
      <CardHeader
        title="Which items are taxed"
        description="A charge above applies to a group. This is where each dish is put into one — so you can take GST off the items that should not carry it."
      />
      <CardBody className="space-y-4">
        {/* The rule, before the list. */}
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {GROUPS.map((group) => {
            const { applied, rate } = chargesFor(components, group.value);
            const count = counts.get(group.value) ?? 0;

            return (
              <div
                key={group.value}
                className={cn(
                  'rounded-xl border p-3',
                  rate > 0 ? 'border-line bg-surface' : 'border-line bg-ground/50',
                )}
              >
                <dt className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{group.label}</span>
                  <span className="text-xs text-muted tabular-nums">
                    {count} item{count === 1 ? '' : 's'}
                  </span>
                </dt>
                <dd className="mt-1">
                  <p
                    className={cn(
                      'text-lg font-semibold tabular-nums',
                      rate > 0 ? 'text-ink' : 'text-muted',
                    )}
                  >
                    {rate > 0 ? `${Number(rate.toFixed(2))}%` : 'No tax'}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">
                    {applied.length > 0
                      ? applied.map((component) => `${component.name} ${component.rate}%`).join(' + ')
                      : 'No charge applies to this group.'}
                  </p>
                </dd>
              </div>
            );
          })}
        </dl>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <span className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search the menu"
              aria-label="Search the menu"
              className="h-9 w-full rounded-lg border border-line bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted/70 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none"
            />
          </span>

          <div className="flex flex-wrap gap-1.5">
            {(['ALL', ...GROUPS.map((group) => group.value)] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  'h-9 rounded-lg border px-3 text-sm font-medium transition-colors',
                  filter === value
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-line bg-surface text-muted hover:bg-ground hover:text-ink',
                )}
              >
                {value === 'ALL'
                  ? `All ${all.length}`
                  : `${GROUPS.find((group) => group.value === value)!.label} ${counts.get(value) ?? 0}`}
              </button>
            ))}
          </div>
        </div>

        {/* The bulk action, only once something is picked. */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 p-3">
            <span className="text-sm font-medium text-brand-700">
              {selected.size} selected — charge them as:
            </span>
            {GROUPS.map((group) => (
              <button
                key={group.value}
                type="button"
                disabled={assign.isPending}
                onClick={() => apply(group.value)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-brand-100 bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-ground disabled:opacity-60"
              >
                {assign.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Tag className="size-3.5 text-brand-600" aria-hidden />
                )}
                {group.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="ml-auto text-sm font-medium text-muted hover:text-ink"
            >
              Clear
            </button>
          </div>
        )}

        {/* The menu */}
        {dishes.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-11 rounded-lg" />
            ))}
          </div>
        ) : all.length === 0 ? (
          <p className="text-sm text-muted">
            No dishes yet. Add them on the Menu, then come back and decide what they are charged.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            <div className="flex items-center gap-3 border-b border-line bg-ground px-3 py-2">
              <input
                type="checkbox"
                checked={allShownSelected}
                aria-label={allShownSelected ? 'Clear selection' : 'Select everything shown'}
                onChange={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (allShownSelected) shownIds.forEach((id) => next.delete(id));
                    else shownIds.forEach((id) => next.add(id));

                    return next;
                  })
                }
                className="size-4 shrink-0 rounded border-line text-brand-600 focus:ring-2 focus:ring-brand-500/30"
              />
              <span className="text-xs font-semibold tracking-wide text-muted uppercase">
                {shown.length} of {all.length} shown
              </span>
            </div>

            <ul
              aria-label="Menu items and their tax group"
              className="max-h-96 divide-y divide-line overflow-y-auto"
            >
              {shown.map((dish) => {
                const group = groupOf(dish);
                const { rate } = chargesFor(components, group);

                return (
                  <li key={dish.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-ground">
                      <input
                        type="checkbox"
                        checked={selected.has(dish.id)}
                        onChange={() => toggle(dish.id)}
                        className="size-4 shrink-0 rounded border-line text-brand-600 focus:ring-2 focus:ring-brand-500/30"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{dish.name}</span>
                        <span className="block text-xs text-muted">{formatMoney(dish.price)}</span>
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
                          rate > 0
                            ? 'border-brand-100 bg-brand-50 text-brand-700'
                            : 'border-line bg-ground text-muted',
                        )}
                      >
                        {GROUPS.find((entry) => entry.value === group)?.label ?? group}
                        {rate > 0 ? ` · ${Number(rate.toFixed(2))}%` : ' · no tax'}
                      </span>
                    </label>
                  </li>
                );
              })}
              {shown.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-muted">
                  Nothing matches that.
                </li>
              )}
            </ul>
          </div>
        )}

        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
          <Check className="mt-px size-3.5 shrink-0 text-brand-600" aria-hidden />
          Changing a group applies to the next bill. Bills already settled keep the tax they were
          charged, because what a guest paid is not rewritten.
        </p>
      </CardBody>
    </Card>
  );
}
