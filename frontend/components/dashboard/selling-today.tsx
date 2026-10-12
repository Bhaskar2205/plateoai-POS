'use client';

import { ArrowRight, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { formatMoney } from '@/lib/format';
import type { ItemSales } from '@/lib/types';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/states';

/**
 * What sold today, best first.
 *
 * Five rows, not twenty: this answers "is the special moving" at a glance, and
 * anyone who wants the full list has the item report. The bar behind each row is
 * the dish's share of takings, drawn as a fill rather than a separate column so
 * the row stays one thing to read.
 */
export function SellingToday({
  items,
  loading,
}: {
  items: ItemSales[] | undefined;
  loading: boolean;
}) {
  const top = (items ?? []).slice(0, 5);
  const most = top[0]?.total ?? 0;

  return (
    <Card>
      <CardHeader
        title="Selling today"
        description="Your best five, by what they took."
        action={
          <Link
            href="/restaurant/reports"
            className="inline-flex items-center gap-1 rounded-lg text-xs font-semibold text-brand-700 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-none"
          >
            All items
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        }
      />

      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-11 w-full" />
          ))}
        </div>
      ) : top.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          compact
          title="Nothing sold yet today"
          description="As bills are settled, your best sellers appear here."
        />
      ) : (
        <ol className="divide-y divide-line border-t border-line">
          {top.map((item, index) => (
            <li key={`${item.dishId ?? 'none'}-${item.name}`} className="relative px-4 py-3">
              {/* The share, behind the text rather than beside it.
                  Capped well short of the full row: at 100% the wash covers the
                  whole row and reads as a selected state rather than a quantity,
                  and the best seller is exactly the row that would always hit it. */}
              <span
                aria-hidden
                className="absolute inset-y-1 left-0 rounded-r-md bg-brand-50"
                style={{ width: most > 0 ? `${6 + (item.total / most) * 62}%` : 0 }}
              />

              <div className="relative flex items-center gap-3">
                <span className="w-4 shrink-0 text-xs font-semibold text-muted tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {item.name}
                </span>
                <span className="shrink-0 text-xs text-muted tabular-nums">
                  &times;{item.quantity}
                </span>
                <span className="w-20 shrink-0 text-right text-sm font-semibold text-ink tabular-nums">
                  {formatMoney(item.total)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
