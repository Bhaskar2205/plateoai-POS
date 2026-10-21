'use client';

import { AlertTriangle, Download, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { downloadCsv } from '@/lib/csv';
import {
  useDayEndSeries,
  useDeleteTradingData,
  useTradingDataSummary,
  type ReportRange,
} from '@/lib/queries';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { money } from './report-shell';

/**
 * Erasing a stretch of trading history, permanently.
 *
 * The screen is built to slow somebody down, because the operation cannot be
 * undone: it shows exactly what would go, it offers the export first, and it
 * asks for the restaurant's name to be typed out. None of that is decoration -
 * it is the difference between clicking through a dialog and stating which
 * months of which restaurant are being destroyed.
 *
 * What survives is the audit record: who did it, when, which range, and what the
 * totals were at that moment. That is deliberate. A restaurant may delete its
 * own books; it may not delete the fact that it did.
 */
export function DeleteDataCard({
  range,
  restaurantName,
}: {
  range: ReportRange;
  restaurantName: string;
}) {
  const toast = useToast();
  const summary = useTradingDataSummary(range);
  const remove = useDeleteTradingData();
  // Fetched only to make "export it first" a button rather than an instruction.
  const series = useDayEndSeries(range);

  const [confirmName, setConfirmName] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  const data = summary.data;
  const bills = data ? data.settledBills + data.voidedBills + data.ncBills : 0;
  const nameMatches =
    confirmName.trim().toLowerCase() === restaurantName.trim().toLowerCase() &&
    confirmName.trim().length > 0;
  const ready = Boolean(data?.canDelete) && nameMatches && acknowledged && !remove.isPending;

  const exportFirst = () => {
    if (!series.data) return;

    downloadCsv(`plateo-before-deletion-${range.from}-to-${range.to}`, [
      ['Plateo statement kept before deletion', restaurantName],
      ['Business days', `${range.from} to ${range.to}`],
      ['Exported', new Date().toISOString()],
      [],
      [
        'Business date',
        'Bills',
        'Items sold',
        'Gross',
        'Discounts',
        'Net sales',
        'Tax',
        'Total billed',
        'Collected',
        'Voided bills',
        'NC bills',
      ],
      ...series.data.days.map((day) => [
        day.businessDate,
        day.bills,
        day.itemsSold,
        day.gross,
        day.discounts,
        day.netSales,
        day.taxTotal,
        day.total,
        day.collected,
        day.voidedBills,
        day.ncBills,
      ]),
      [],
      ['TAX COLLECTED, COMPONENT BY COMPONENT'],
      ['Charge', 'Type', 'Rate %', 'Taxable value', 'Tax collected', 'Bills'],
      ...series.data.taxes.map((line) => [
        line.name,
        line.kind,
        line.rate,
        line.taxableAmount,
        line.amount,
        line.bills,
      ]),
    ]);
  };

  return (
    <Card className="border-danger-100">
      <CardHeader
        title="Delete this data permanently"
        description="Erases every bill with a business date in the selected range, along with its lines, kitchen tickets and tax breakdown."
      />
      <CardBody className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-danger-100 bg-danger-50 px-4 py-3">
          <AlertTriangle className="mt-px size-5 shrink-0 text-danger-600" aria-hidden />
          <p className="text-sm leading-relaxed text-danger-600">
            There is no undo and no recycle bin. Once this runs, the bills in{' '}
            <span className="font-semibold">
              {range.from} to {range.to}
            </span>{' '}
            are gone from every report you have. Export what you need first.
          </p>
        </div>

        {summary.isPending ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : data ? (
          <dl className="grid gap-x-6 gap-y-3 rounded-xl bg-ground/60 p-4 ring-1 ring-line sm:grid-cols-3">
            <Figure label="Settled bills" value={String(data.settledBills)} />
            <Figure label="Voided bills" value={String(data.voidedBills)} />
            <Figure label="No-charge bills" value={String(data.ncBills)} />
            <Figure label="Billed lines" value={String(data.items)} />
            <Figure label="Kitchen tickets" value={String(data.kotTickets)} />
            <Figure label="Takings in range" value={money(data.collected)} />
          </dl>
        ) : null}

        {data?.blockedReason && (
          <p role="status" className="text-sm font-medium text-warn-600">
            {data.blockedReason}
          </p>
        )}

        <button
          type="button"
          onClick={exportFirst}
          disabled={!series.data || bills === 0}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink shadow-card transition-colors hover:bg-ground disabled:opacity-50"
        >
          <Download className="size-4" aria-hidden />
          Export this range before deleting
        </button>

        {data?.canDelete && (
          <div className="space-y-4 border-t border-line pt-5">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 rounded border-line text-danger-500 focus:ring-2 focus:ring-danger-500/30"
              />
              <span className="text-sm text-ink">
                I have exported anything I need. I understand this cannot be undone.
              </span>
            </label>

            <div className="space-y-1.5">
              <label htmlFor="confirm-restaurant" className="block text-sm font-medium text-ink">
                Type <span className="font-semibold">{restaurantName}</span> to confirm
              </label>
              <input
                id="confirm-restaurant"
                value={confirmName}
                autoComplete="off"
                placeholder={restaurantName}
                onChange={(event) => setConfirmName(event.target.value)}
                className="h-10 w-full max-w-sm rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/60 focus:border-danger-500 focus:ring-4 focus:ring-danger-500/10 focus:outline-none"
              />
            </div>

            <button
              type="button"
              disabled={!ready}
              onClick={() =>
                remove.mutate(
                  { from: range.from, to: range.to, confirmName: confirmName.trim() },
                  {
                    onSuccess: (result) => {
                      setConfirmName('');
                      setAcknowledged(false);
                      toast.success(
                        `${result.deletedBills} bill${result.deletedBills === 1 ? '' : 's'} and ${result.deletedItems} line${result.deletedItems === 1 ? '' : 's'} deleted permanently.`,
                      );
                    },
                    onError: (error) => toast.error(error),
                  },
                )
              }
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-danger-500 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-danger-600 focus-visible:ring-4 focus-visible:ring-danger-500/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {remove.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="size-4" aria-hidden />
              )}
              Delete {bills} bill{bills === 1 ? '' : 's'} permanently
            </button>
          </div>
        )}

        <p className="text-xs leading-relaxed text-muted">
          A record of the deletion — who ran it, when, the range, and the totals at that moment —
          is written to your Activity Log and is not deleted with the bills. Payment-gateway
          records are kept too.
        </p>
      </CardBody>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-base font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  );
}
