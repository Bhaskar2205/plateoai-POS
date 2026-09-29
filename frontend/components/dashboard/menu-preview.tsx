'use client';

import { ArrowRight, ChefHat, Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Dish } from '@/lib/types';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';

const PREVIEW_LIMIT = 5;

const price = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);

/** The most recently added dishes, as a compact table (stacked rows on phones). */
export function MenuPreview({
  dishes,
  loading,
  error,
  onRetry,
}: {
  dishes?: Dish[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const recent = useMemo(
    () =>
      [...(dishes ?? [])]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, PREVIEW_LIMIT),
    [dishes],
  );

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title="Recently added dishes"
        description={dishes ? `${dishes.length} ${dishes.length === 1 ? 'dish' : 'dishes'} on your menu` : 'Your latest menu items.'}
        action={
          <Link
            href="/restaurant/menu"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
          >
            View all dishes
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        }
      />

      {error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : loading ? (
        <ul className="divide-y divide-line" aria-busy="true" aria-label="Loading dishes">
          {Array.from({ length: 4 }).map((_, index) => (
            <li key={index} className="flex items-center gap-3 px-5 py-3">
              <Skeleton className="size-11 rounded-xl" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </li>
          ))}
        </ul>
      ) : recent.length === 0 ? (
        <EmptyState
          compact
          icon={ChefHat}
          title="No dishes yet"
          description="Add your first dish with its price, prep time and ingredients."
          action={
            <Link
              href="/restaurant/menu?new=dish"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              <Plus className="size-4" aria-hidden />
              Add your first dish
            </Link>
          }
        />
      ) : (
        <div className="flex-1">
          {/* Column headings only where there is room for columns. */}
          <div className="hidden grid-cols-[minmax(0,1fr)_9rem_6rem_7rem] gap-4 border-b border-line bg-ground/60 px-5 py-2 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase md:grid">
            <span>Dish</span>
            <span>Category</span>
            <span className="text-right">Price</span>
            <span className="text-right">Status</span>
          </div>
          <ul className="divide-y divide-line">
            {recent.map((dish) => (
              <li
                key={dish.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 md:grid-cols-[minmax(0,1fr)_9rem_6rem_7rem]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <DishThumb dish={dish} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{dish.name}</p>
                    <p className="truncate text-xs text-muted md:hidden">
                      {dish.category?.name ?? 'No section'} · <span className="tabular-nums">{price(dish.price)}</span>
                    </p>
                  </div>
                </div>
                <p className="hidden truncate text-sm text-muted md:block">{dish.category?.name ?? 'No section'}</p>
                <p className="hidden text-right text-sm font-medium text-ink tabular-nums md:block">{price(dish.price)}</p>
                <div className="text-right">
                  <Badge tone={dish.isAvailable ? 'success' : 'neutral'} dot>
                    {dish.isAvailable ? 'Available' : 'Unavailable'}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** Dish photo, falling back to an icon tile when there is none or it fails to load. */
function DishThumb({ dish }: { dish: Dish }) {
  const [failed, setFailed] = useState(false);

  if (!dish.imageUrl || failed) {
    return (
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-saffron-50 text-saffron-600 ring-1 ring-saffron-100">
        <ChefHat className="size-5" aria-hidden />
      </span>
    );
  }

  return (
    // Restaurant-supplied URL on any host; next/image would need every host allow-listed.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dish.imageUrl}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-11 shrink-0 rounded-xl border border-line object-cover"
    />
  );
}
