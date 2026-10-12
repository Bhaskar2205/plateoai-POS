'use client';

import { ArrowRight, Receipt } from 'lucide-react';
import Link from 'next/link';
import { formatMoney, formatMoneyWhole } from '@/lib/format';
import type { SalesSummary } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { ServiceRhythm } from './service-rhythm';

/**
 * What the restaurant took today.
 *
 * The one thing an owner opens this page to see, so it is the one thing given
 * real size - a single hero figure, with everything else arranged around it.
 * The previous dashboard led with five equal cards counting dishes, categories
 * and ingredients: true, and not what anybody opens a till report to find out.
 *
 * The band is warm rather than white. Every admin panel is a grid of white
 * cards; one deliberate surface at the top gives the page a centre and makes it
 * recognisable at a glance, which is most of what "looks like a product" means.
 */
export function TodayHero({
  restaurantName,
  greeting,
  sales,
  loading,
  openBills,
}: {
  restaurantName: string;
  greeting: string;
  sales: SalesSummary | undefined;
  loading: boolean;
  /** Live, from the floor - bills still open right now. */
  openBills: number | undefined;
  /** Collection orders, counted apart from the till. */
}) {
  return (
    <section
      aria-labelledby="today-heading"
      className="relative overflow-hidden rounded-3xl border border-line bg-surface shadow-card"
    >
      {/* A wash rather than a flat fill: warm at the top left, fading out, so the
          band reads as one surface instead of a coloured block. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,var(--color-saffron-50)_0%,var(--color-ground)_38%,var(--color-surface)_72%)]"
      />
      {/* Painted after the wash, which covers the whole band and would otherwise
          sit on top of it. A hairline of saffron into green gives the page one
          deliberate edge - enough to be recognisable, short of decoration. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-saffron-500 via-brand-500 to-brand-700"
      />

      <div className="relative grid gap-6 p-6 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-10">
        <div className="min-w-0">
          <h1 id="today-heading" className="text-sm font-medium text-muted">
            {greeting} — <span className="text-ink">{restaurantName}</span>
          </h1>

          <p className="mt-4 text-xs font-medium tracking-wide text-muted uppercase">
            Taken today
          </p>

          {loading ? (
            <Skeleton className="mt-1 h-14 w-56" />
          ) : (
            <p className="mt-1 text-5xl leading-none font-semibold text-ink sm:text-6xl">
              {formatMoneyWhole(sales?.net ?? 0)}
            </p>
          )}

          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
            <Figure label="Bills" value={sales ? String(sales.bills) : null} loading={loading} />
            <Figure
              label="Items sold"
              value={sales ? String(sales.itemsSold) : null}
              loading={loading}
            />
            <Figure
              label="Average bill"
              value={sales ? formatMoney(sales.averageBill) : null}
              loading={loading}
            />
          </dl>

          {/* Open bills are money not yet taken, so they sit next to the takings
              rather than in a list further down. Live from the floor. */}
          {openBills !== undefined && openBills > 0 && (
            <Link
              href="/restaurant/orders"
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 py-1.5 pr-3 pl-3.5 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100 focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-none"
            >
              <span aria-hidden className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-500 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-brand-500" />
              </span>
              <Receipt className="size-4" aria-hidden />
              {openBills} {openBills === 1 ? 'bill' : 'bills'} still open
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          )}
        </div>

        <div className="min-w-0 self-end rounded-2xl border border-line/70 bg-surface/80 p-4 backdrop-blur-sm">
          {loading ? <Skeleton className="h-24 w-full" /> : <ServiceRhythm hourly={sales?.hourly ?? []} />}
        </div>
      </div>
    </section>
  );
}

/**
 * A supporting figure.
 *
 * Deliberately not a card. These three qualify the headline - how many bills
 * made it, how big each one was - and boxing them would give them the same
 * weight as the number they are qualifying.
 */
function Figure({
  label,
  value,
  loading,
}: {
  label: string;
  value: string | null;
  loading: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-ink">
        {loading || value === null ? <Skeleton className="h-6 w-14" /> : value}
      </dd>
    </div>
  );
}
