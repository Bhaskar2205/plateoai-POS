'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';

/**
 * The two charts the reports need, built in plain HTML.
 *
 * Every chart here plots **one measure** - money - so there is one hue and no
 * legend: identity is carried by the axis labels, not by colour. That is also why
 * there is no pie chart anywhere in these reports; shares are read from ranked
 * bars, which stay readable at ten rows where a pie does not.
 *
 * Both carry a hover tooltip, because a chart in a browser that cannot be
 * interrogated is a picture of data rather than data. The same figures appear in
 * a table underneath every chart, which is what makes them readable to a screen
 * reader and printable for someone reconciling on paper.
 */

const BAR = 'bg-brand-600';
const BAR_MUTED = 'bg-brand-600/25';

/**
 * Time down the x-axis: sales per business day, or per hour of the day.
 *
 * Bars rather than a line because business days are discrete buckets, and a line
 * between Tuesday and Wednesday implies a value at Tuesday-and-a-half.
 */
export function TimeBars({
  data,
  label,
  emptyLabel = 'Nothing in this range yet.',
}: {
  data: Array<{ key: string; caption: string; value: number; sub?: string }>;
  label: string;
  emptyLabel?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">{emptyLabel}</p>;
  }

  const peak = Math.max(...data.map((point) => point.value), 0);
  const busiest = data.find((point) => point.value === peak && peak > 0);

  return (
    <figure className="space-y-2">
      <figcaption className="sr-only">{label}</figcaption>

      <div
        className="flex h-44 items-end gap-1.5 border-b border-line"
        role="img"
        aria-label={`${label}. Highest: ${busiest ? `${busiest.caption}, ${formatMoney(peak)}` : 'nothing'}.`}
      >
        {data.map((point) => {
          // A zero day still shows a hairline, so the gap in trade is visible
          // rather than looking like missing data.
          const height = peak === 0 ? 0 : Math.max(2, Math.round((point.value / peak) * 100));
          const active = hovered === point.key;

          return (
            <div
              key={point.key}
              // Full height, bar pinned to the baseline: a percentage height on
              // the bar only means anything if this track has a height itself.
              className="relative flex h-full min-w-0 flex-1 items-end justify-center"
              onMouseEnter={() => setHovered(point.key)}
              onMouseLeave={() => setHovered(null)}
            >
              {active && (
                <div className="pointer-events-none absolute bottom-full z-10 mb-1 w-max max-w-40 rounded-lg bg-ink px-2 py-1 text-center text-xs text-white shadow-raised">
                  <span className="block font-semibold">{formatMoney(point.value)}</span>
                  <span className="block text-white/70">{point.caption}</span>
                  {point.sub && <span className="block text-white/70">{point.sub}</span>}
                </div>
              )}

              <div
                // 4px rounded data-end, anchored to the baseline.
                className={cn(
                  'w-full rounded-t transition-colors',
                  point.value === 0 ? BAR_MUTED : active ? 'bg-brand-700' : BAR,
                )}
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>

      <div className="flex gap-1.5">
        {data.map((point) => (
          <span
            key={point.key}
            className="min-w-0 flex-1 truncate text-center text-[10px] text-muted"
            title={point.caption}
          >
            {point.caption}
          </span>
        ))}
      </div>
    </figure>
  );
}

/**
 * Ranked horizontal bars: top dishes, sections, payment methods.
 *
 * The name sits on the row and the value at its end, so nothing depends on
 * matching a colour to a legend.
 */
export function RankedBars({
  data,
  label,
  emptyLabel = 'Nothing to show yet.',
  max = 8,
}: {
  data: Array<{ key: string; name: string; value: number; sub?: string }>;
  label: string;
  emptyLabel?: string;
  max?: number;
}) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">{emptyLabel}</p>;
  }

  const rows = data.slice(0, max);
  const peak = Math.max(...rows.map((row) => row.value), 0);

  return (
    <ul className="space-y-2.5" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink">{row.name}</span>
            <span className="shrink-0 font-semibold text-ink tabular-nums">
              {formatMoney(row.value)}
              {row.sub && <span className="ml-1.5 text-xs font-normal text-muted">{row.sub}</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ground">
            <div
              className="h-full rounded-full bg-brand-600"
              style={{ width: `${peak === 0 ? 0 : Math.max(2, Math.round((row.value / peak) * 100))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
