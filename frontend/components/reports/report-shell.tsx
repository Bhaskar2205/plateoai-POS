'use client';

import { CalendarDays, Download } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { downloadCsv } from '@/lib/csv';
import { formatMoney } from '@/lib/format';
import type { ReportRange } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';

/**
 * The furniture every report shares: a date range, headline numbers, a table, and
 * a way to get the figures out into a spreadsheet.
 */

/** `YYYY-MM-DD` for a date this many days before today. */
export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export const today = () => new Date().toISOString().slice(0, 10);

/** `YYYY-MM-DD` for the first and last day of a calendar month, `offset` back. */
export function monthRange(offset = 0): ReportRange {
  const now = new Date();
  const first = new Date(Date.UTC(now.getFullYear(), now.getMonth() - offset, 1));
  // Day 0 of the next month is the last day of this one, leap years included.
  const last = new Date(Date.UTC(now.getFullYear(), now.getMonth() - offset + 1, 0));
  const iso = (date: Date) => date.toISOString().slice(0, 10);

  // Never past today: a range running to the 31st in the middle of the month
  // reads as if the rest of it had already been counted and came to nothing.
  const end = iso(last) > today() ? today() : iso(last);

  return { from: iso(first), to: end };
}

export const RANGE_PRESETS: Array<{ id: string; label: string; range: () => ReportRange }> = [
  { id: 'today', label: 'Today', range: () => ({ from: today(), to: today() }) },
  { id: 'yesterday', label: 'Yesterday', range: () => ({ from: daysAgo(1), to: daysAgo(1) }) },
  { id: '7', label: 'Last 7 days', range: () => ({ from: daysAgo(6), to: today() }) },
  { id: '30', label: 'Last 30 days', range: () => ({ from: daysAgo(29), to: today() }) },
  // Calendar months, because a GST return is filed for one - "last 30 days" is
  // never the thing an accountant asks for.
  { id: 'month', label: 'This month', range: () => monthRange(0) },
  { id: 'last-month', label: 'Last month', range: () => monthRange(1) },
];

/**
 * The range control.
 *
 * Presets first, because "today" and "last 7 days" are what a restaurant actually
 * asks for; the two date boxes are there for the month-end or the accountant.
 */
export function RangePicker({
  range,
  preset,
  onChange,
}: {
  range: ReportRange;
  preset: string | null;
  onChange: (range: ReportRange, preset: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {RANGE_PRESETS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={preset === option.id}
          onClick={() => onChange(option.range(), option.id)}
          className={cn(
            'inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-medium transition-colors',
            preset === option.id
              ? 'border-brand-600 bg-brand-600 text-white'
              : 'border-line bg-surface text-ink shadow-card hover:border-brand-500',
          )}
        >
          {option.label}
        </button>
      ))}

      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 shadow-card">
        <CalendarDays className="size-4 shrink-0 text-muted" aria-hidden />
        <label className="sr-only" htmlFor="report-from">
          From
        </label>
        <input
          id="report-from"
          type="date"
          value={range.from}
          max={range.to}
          onChange={(event) => onChange({ ...range, from: event.target.value }, null)}
          className="bg-transparent text-sm text-ink focus:outline-none"
        />
        <span className="text-muted">–</span>
        <label className="sr-only" htmlFor="report-to">
          To
        </label>
        <input
          id="report-to"
          type="date"
          value={range.to}
          min={range.from}
          onChange={(event) => onChange({ ...range, to: event.target.value }, null)}
          className="bg-transparent text-sm text-ink focus:outline-none"
        />
      </span>
    </div>
  );
}

/** One headline number. `tone` marks the figures that mean money leaving. */
export function Kpi({
  label,
  value,
  hint,
  tone = 'plain',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'plain' | 'good' | 'warn';
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-xl font-bold tracking-tight tabular-nums',
          tone === 'good' ? 'text-brand-700' : tone === 'warn' ? 'text-warn-600' : 'text-ink',
        )}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export interface Column<Row> {
  header: string;
  /** Rendered in the cell. */
  cell: (row: Row) => ReactNode;
  /** Plain text for the CSV export; falls back to the cell when it is a string. */
  value?: (row: Row) => string | number;
  align?: 'left' | 'right';
}

/**
 * A report table with its own CSV export.
 *
 * Restaurants send these to an accountant, so every table can leave as a file
 * rather than a screenshot. The export is built from the same column definitions
 * the table renders, so the two can never disagree.
 */
export function ReportTable<Row>({
  columns,
  rows,
  caption,
  empty = 'Nothing in this range.',
  fileName,
}: {
  columns: Array<Column<Row>>;
  rows: Row[];
  caption: string;
  empty?: string;
  fileName: string;
}) {
  // Built from the same column definitions the table renders, so the file and
  // the screen can never disagree. The quoting and the BOM live in lib/csv.
  const download = () =>
    downloadCsv(fileName, [
      columns.map((column) => column.header),
      ...rows.map((row) => columns.map((column) => (column.value ? column.value(row) : ''))),
    ]);

  return (
    <Card>
      <CardHeader
        title={caption}
        description={`${rows.length} row${rows.length === 1 ? '' : 's'}`}
        action={
          rows.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={download}>
              <Download className="size-4" aria-hidden />
              Export CSV
            </Button>
          ) : undefined
        }
      />

      {rows.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">{empty}</p>
        </CardBody>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-line bg-ground text-xs tracking-wide text-muted uppercase">
                {columns.map((column) => (
                  <th
                    key={column.header}
                    scope="col"
                    className={cn(
                      'px-4 py-2 font-semibold',
                      column.align === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row, index) => (
                <tr key={index} className="hover:bg-ground/60">
                  {columns.map((column) => (
                    <td
                      key={column.header}
                      className={cn(
                        'px-4 py-2.5',
                        column.align === 'right' ? 'text-right tabular-nums' : 'text-left',
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Loading and error handling, so every report behaves the same way. */
export function ReportState({
  isPending,
  error,
  onRetry,
  children,
}: {
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (error) {
    return (
      <Card>
        <CardBody>
          <ErrorState error={error} onRetry={onRetry} />
        </CardBody>
      </Card>
    );
  }

  if (isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return <>{children}</>;
}

/** Money for a report cell: no decimals when there are none to show. */
export const money = (value: number) => formatMoney(value);
