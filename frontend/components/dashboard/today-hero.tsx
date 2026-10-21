'use client';

import { ArrowRight, Receipt, TrendingUp } from 'lucide-react';
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
 * It is the dark surface on an otherwise light panel, and the only one. Every
 * admin screen is a grid of white cards; inverting the band that carries the
 * takings makes the number impossible to miss from across a room, and ties the
 * page to the sign-in screen, which is the other place the product shows its
 * own colours.
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
}) {
  return (
    <section
      aria-labelledby="today-heading"
      className="relative overflow-hidden rounded-3xl bg-ink shadow-raised"
    >
      {/* Two soft lights rather than a flat fill, so the band has depth and the
          figure sits in the brighter corner. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(47,125,82,.55),transparent_58%),radial-gradient(circle_at_90%_90%,rgba(201,130,43,.38),transparent_55%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-saffron-500 via-brand-500 to-brand-700"
      />

      <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-10">
        <div className="min-w-0">
          <h1 id="today-heading" className="text-sm font-medium text-white/70">
            {greeting} — <span className="font-semibold text-white">{restaurantName}</span>
          </h1>

          <p className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold tracking-[0.12em] text-white/80 uppercase backdrop-blur">
            <TrendingUp className="size-3" aria-hidden />
            Taken today
          </p>

          {loading ? (
            <Skeleton className="mt-2 h-14 w-56 bg-white/10" />
          ) : (
            <p className="mt-2 text-5xl leading-none font-semibold tracking-tight text-white sm:text-6xl">
              {formatMoneyWhole(sales?.net ?? 0)}
            </p>
          )}

          <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
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
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/10 py-1.5 pr-3 pl-3.5 text-sm font-medium text-white ring-1 ring-white/20 backdrop-blur transition-colors hover:bg-white/20 focus-visible:ring-4 focus-visible:ring-white/40 focus-visible:outline-none"
            >
              <span aria-hidden className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-saffron-500 opacity-70" />
                <span className="relative inline-flex size-2 rounded-full bg-saffron-500" />
              </span>
              <Receipt className="size-4" aria-hidden />
              {openBills} {openBills === 1 ? 'bill' : 'bills'} still open
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          )}
        </div>

        <div className="min-w-0 self-end rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 backdrop-blur-sm">
          {loading ? (
            <Skeleton className="h-24 w-full bg-white/10" />
          ) : (
            <ServiceRhythm hourly={sales?.hourly ?? []} onDark />
          )}
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
      <dt className="text-xs text-white/60">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-white">
        {loading || value === null ? <Skeleton className="h-6 w-14 bg-white/10" /> : value}
      </dd>
    </div>
  );
}
