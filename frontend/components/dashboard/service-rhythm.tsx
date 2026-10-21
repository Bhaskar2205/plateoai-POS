'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatMoneyWhole } from '@/lib/format';
import type { HourlySales } from '@/lib/types';

/**
 * The shape of the day: what each hour took.
 *
 * A restaurant's day has a shape - a lunch rush, a dead afternoon, a long
 * evening - and an owner reads that shape faster than any table of figures.
 * Showing it on the home screen, rather than three clicks into Reports, is most
 * of what makes this feel like a tool for running a restaurant rather than a
 * list of records.
 *
 * One series, so there is no legend: the heading says what is plotted. Only the
 * busiest hour is labelled, because a number on every bar is chaos that goes
 * unread - the rest are carried by the tooltip.
 *
 * Hours with no trade are drawn as a flat baseline tick rather than skipped, so
 * the gap between lunch and dinner is visible as a gap.
 */

/** Trading hours worth drawing. Outside these a restaurant is shut. */
const FIRST_HOUR = 8;
const LAST_HOUR = 23;

const hourLabel = (hour: number): string => {
  const suffix = hour < 12 || hour === 24 ? 'am' : 'pm';
  const display = hour % 12 === 0 ? 12 : hour % 12;

  return `${display}${suffix}`;
};

export function ServiceRhythm({
  hourly,
  onDark = false,
}: {
  hourly: HourlySales[];
  /** Drawn on the dark takings band, where muted grey on ink is unreadable. */
  onDark?: boolean;
}) {
  const headingId = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  const byHour = new Map(hourly.map((entry) => [entry.hour, entry]));
  const hours = Array.from(
    { length: LAST_HOUR - FIRST_HOUR + 1 },
    (_, index) => FIRST_HOUR + index,
  );

  const rows = hours.map((hour) => ({
    hour,
    total: byHour.get(hour)?.total ?? 0,
    bills: byHour.get(hour)?.bills ?? 0,
  }));

  const peak = rows.reduce((best, row) => (row.total > best.total ? row : best), rows[0]);
  const max = peak.total;

  if (max <= 0) {
    return (
      <p className={cn('text-xs', onDark ? 'text-white/60' : 'text-muted')}>
        The day&apos;s rhythm appears here once the first bill is settled.
      </p>
    );
  }

  const active = hovered === null ? null : rows.find((row) => row.hour === hovered) ?? null;

  return (
    <figure className="m-0">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span
          id={headingId}
          className={cn('text-xs font-medium', onDark ? 'text-white/70' : 'text-muted')}
        >
          Through the day
        </span>
        {/* One reading at a time: the hovered hour, or the busiest when idle. */}
        <span className={cn('text-xs tabular-nums', onDark ? 'text-white/70' : 'text-muted')}>
          {active
            ? `${hourLabel(active.hour)} · ${formatMoneyWhole(active.total)}`
            : `Busiest ${hourLabel(peak.hour)} · ${formatMoneyWhole(peak.total)}`}
        </span>
      </figcaption>

      <div
        className="mt-2 flex h-16 items-end gap-[2px]"
        role="img"
        aria-labelledby={headingId}
        aria-describedby={`${headingId}-summary`}
        onMouseLeave={() => setHovered(null)}
      >
        {rows.map((row) => {
          const share = row.total / max;

          return (
            <button
              key={row.hour}
              type="button"
              // A bar can be 2px tall, far under a usable hit target, so the
              // button fills the full height and the bar is drawn inside it.
              className="group relative flex h-full flex-1 cursor-default items-end rounded-sm focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none"
              onMouseEnter={() => setHovered(row.hour)}
              onFocus={() => setHovered(row.hour)}
              onBlur={() => setHovered(null)}
              aria-label={`${hourLabel(row.hour)}: ${formatMoneyWhole(row.total)} from ${row.bills} ${row.bills === 1 ? 'bill' : 'bills'}`}
            >
              <span
                aria-hidden
                className={cn(
                  'w-full rounded-t-[4px] transition-colors',
                  row.total === 0
                    ? onDark
                      ? 'bg-white/20'
                      : 'bg-line'
                    : onDark
                      ? hovered === row.hour
                        ? 'bg-white'
                        : 'bg-brand-500 group-hover:bg-white'
                      : hovered === row.hour
                        ? 'bg-brand-700'
                        : 'bg-brand-500/85 group-hover:bg-brand-700',
                )}
                // Minimum 2px so an hour that traded never looks identical to one
                // that did not.
                style={{ height: row.total === 0 ? 2 : `${Math.max(6, share * 100)}%` }}
              />
            </button>
          );
        })}
      </div>

      <div className={cn('mt-1.5 flex justify-between text-[10px]', onDark ? 'text-white/50' : 'text-muted')}>
        <span>{hourLabel(FIRST_HOUR)}</span>
        <span>{hourLabel(14)}</span>
        <span>{hourLabel(LAST_HOUR)}</span>
      </div>

      {/* The figures themselves, for a screen reader and for anyone who cannot
          separate the bars by eye. */}
      <p id={`${headingId}-summary`} className="sr-only">
        {rows
          .filter((row) => row.total > 0)
          .map((row) => `${hourLabel(row.hour)} ${formatMoneyWhole(row.total)}`)
          .join(', ')}
      </p>
    </figure>
  );
}
