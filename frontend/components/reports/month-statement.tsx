'use client';

import { AlertTriangle, Download, FileSpreadsheet } from 'lucide-react';
import { downloadCsv } from '@/lib/csv';
import { useDayEndSeries, type ReportRange } from '@/lib/queries';
import type { DayEndDay, DayEndSeries } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Kpi, money, ReportState, ReportTable } from './report-shell';

/**
 * The same statement a till is closed on, repeated across a range.
 *
 * This is the month-end view: one row per trading day, and underneath it the
 * component-by-component totals a GST return is actually filled in from. A
 * single combined tax figure cannot be filed, which is why the tax table is
 * separate and why it is grouped by rate as well as by name - a restaurant that
 * changed its rate mid-month has two lines to file, not an average.
 *
 * The "Full statement" export is the point of the screen. The per-table exports
 * give an accountant one piece at a time; this gives them the whole thing as one
 * file, in the order a return is filled in.
 */

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  OTHER: 'Other',
};

const shortDay = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });

/**
 * The whole statement as one file.
 *
 * Written as labelled sections rather than one flat table, because that is how
 * it is read: somebody opens it next to a return and copies figures across. A
 * blank row between sections is what makes a spreadsheet show them as blocks.
 */
function exportStatement(series: DayEndSeries, restaurantName: string): void {
  const rows: Array<Array<string | number>> = [
    ['Plateo statement', restaurantName],
    ['Business days', `${series.from} to ${series.to}`],
    ['Generated', new Date().toISOString()],
    [],
    ['TOTALS'],
    ['Trading days', series.totals.tradingDays],
    ['Bills settled', series.totals.bills],
    ['Items sold', series.totals.itemsSold],
    ['Gross (menu value)', series.totals.gross],
    ['Discounts', series.totals.discounts],
    ['Net sales (taxable)', series.totals.netSales],
    ['Service charge', series.totals.serviceCharge],
    ['Tax collected', series.totals.taxTotal],
    ['Total billed', series.totals.total],
    ['TDS withheld', series.totals.tdsWithheld],
    ['Collected', series.totals.collected],
    ['Average bill', series.totals.averageBill],
    ['Voided bills', series.totals.voidedBills],
    ['Voided value (not takings)', series.totals.voidedValue],
    ['No-charge bills', series.totals.ncBills],
    ['No-charge value (not sales)', series.totals.ncValue],
    ['Days with a bill still open', series.totals.daysNotClosed],
    [],
    ['TAX COLLECTED, COMPONENT BY COMPONENT'],
    ['Charge', 'Type', 'Rate %', 'Taxable value', 'Tax collected', 'Bills'],
    ...series.taxes.map((line) => [
      line.name,
      line.kind,
      line.rate,
      line.taxableAmount,
      line.amount,
      line.bills,
    ]),
    [],
    ['HOW IT WAS PAID'],
    ['Method', 'Bills', 'Amount'],
    ...series.payments.map((payment) => [
      PAYMENT_LABELS[payment.method] ?? payment.method,
      payment.bills,
      payment.total,
    ]),
    [],
    ['DAY BY DAY'],
    [
      'Business date',
      'Closed',
      'Bills',
      'Items sold',
      'Gross',
      'Discounts',
      'Net sales',
      'Service charge',
      'Tax',
      'Total billed',
      'TDS withheld',
      'Collected',
      'Voided bills',
      'Voided value',
      'NC bills',
      'NC value',
    ],
    ...series.days.map((day) => [
      day.businessDate,
      day.isClosed ? 'yes' : `no (${day.openBills} open)`,
      day.bills,
      day.itemsSold,
      day.gross,
      day.discounts,
      day.netSales,
      day.serviceCharge,
      day.taxTotal,
      day.total,
      day.tdsWithheld,
      day.collected,
      day.voidedBills,
      day.voidedValue,
      day.ncBills,
      day.ncValue,
    ]),
    [],
    ['TAX BY DAY'],
    ['Business date', 'Charge', 'Type', 'Rate %', 'Taxable value', 'Tax collected', 'Bills'],
    ...series.days.flatMap((day) =>
      day.taxes.map((line) => [
        day.businessDate,
        line.name,
        line.kind,
        line.rate,
        line.taxableAmount,
        line.amount,
        line.bills,
      ]),
    ),
  ];

  downloadCsv(`plateo-statement-${series.from}-to-${series.to}`, rows);
}

export function MonthStatement({
  range,
  restaurantName,
}: {
  range: ReportRange;
  restaurantName: string;
}) {
  const report = useDayEndSeries(range);

  return (
    <ReportState isPending={report.isPending} error={report.error} onRetry={() => void report.refetch()}>
      {report.data && (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Statement for filing"
              description={`${report.data.from} to ${report.data.to} · ${report.data.totals.tradingDays} trading day${report.data.totals.tradingDays === 1 ? '' : 's'}`}
              action={
                <Button
                  onClick={() => exportStatement(report.data!, restaurantName)}
                  disabled={report.data.totals.tradingDays === 0}
                >
                  <Download className="size-4" aria-hidden />
                  Full statement (CSV)
                </Button>
              }
            />
            <CardBody className="space-y-4">
              {report.data.totals.daysNotClosed > 0 && (
                <div
                  role="status"
                  className="flex items-start gap-3 rounded-xl border border-warn-600/30 bg-warn-50 px-4 py-3"
                >
                  <AlertTriangle className="mt-px size-5 shrink-0 text-warn-600" aria-hidden />
                  <p className="text-sm text-warn-600">
                    <span className="font-semibold">
                      {report.data.totals.daysNotClosed} day
                      {report.data.totals.daysNotClosed === 1 ? '' : 's'}
                    </span>{' '}
                    in this range still {report.data.totals.daysNotClosed === 1 ? 'has' : 'have'} a
                    bill open. Their money is not in these figures, so the totals will change when
                    those bills are settled.
                  </p>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="Net sales" value={money(report.data.totals.netSales)} hint="What tax is charged on" />
                <Kpi label="Tax collected" value={money(report.data.totals.taxTotal)} hint="Owed on filing" />
                <Kpi label="Collected" value={money(report.data.totals.collected)} hint="What should have arrived" />
                <Kpi
                  label="Bills"
                  value={String(report.data.totals.bills)}
                  hint={`Average ${money(report.data.totals.averageBill)}`}
                />
              </div>

              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
                <FileSpreadsheet className="mt-px size-3.5 shrink-0" aria-hidden />
                The full statement carries every figure on this page plus the day-by-day and
                tax-by-day breakdowns, in the order a return is filled in.
              </p>
            </CardBody>
          </Card>

          <ReportTable
            caption="Tax collected, component by component"
            fileName={`tax-${report.data.from}-to-${report.data.to}`}
            empty="No tax was charged in this range."
            rows={report.data.taxes}
            columns={[
              { header: 'Charge', cell: (row) => row.name, value: (row) => row.name },
              { header: 'Type', cell: (row) => row.kind, value: (row) => row.kind },
              {
                header: 'Rate',
                align: 'right',
                cell: (row) => (row.rate > 0 ? `${row.rate}%` : '—'),
                value: (row) => row.rate,
              },
              {
                header: 'Taxable value',
                align: 'right',
                cell: (row) => money(row.taxableAmount),
                value: (row) => row.taxableAmount,
              },
              {
                header: 'Tax collected',
                align: 'right',
                cell: (row) => money(row.amount),
                value: (row) => row.amount,
              },
              { header: 'Bills', align: 'right', cell: (row) => row.bills, value: (row) => row.bills },
            ]}
          />

          <ReportTable<DayEndDay>
            caption="Day by day"
            fileName={`day-by-day-${report.data.from}-to-${report.data.to}`}
            empty="Nothing traded in this range."
            rows={report.data.days}
            columns={[
              {
                header: 'Day',
                cell: (row) => (
                  <span className="whitespace-nowrap">
                    {shortDay(row.businessDate)}
                    {!row.isClosed && (
                      <span className="ml-1.5 text-xs font-medium text-warn-600">
                        {row.openBills} open
                      </span>
                    )}
                  </span>
                ),
                value: (row) => row.businessDate,
              },
              { header: 'Bills', align: 'right', cell: (row) => row.bills, value: (row) => row.bills },
              {
                header: 'Net sales',
                align: 'right',
                cell: (row) => money(row.netSales),
                value: (row) => row.netSales,
              },
              {
                header: 'Tax',
                align: 'right',
                cell: (row) => money(row.taxTotal),
                value: (row) => row.taxTotal,
              },
              {
                header: 'Collected',
                align: 'right',
                cell: (row) => money(row.collected),
                value: (row) => row.collected,
              },
              {
                header: 'Voided',
                align: 'right',
                cell: (row) => (row.voidedBills > 0 ? row.voidedBills : '—'),
                value: (row) => row.voidedBills,
              },
              {
                header: 'No charge',
                align: 'right',
                cell: (row) => (row.ncBills > 0 ? row.ncBills : '—'),
                value: (row) => row.ncBills,
              },
            ]}
          />
        </div>
      )}
    </ReportState>
  );
}
