'use client';

import { AlertTriangle, Ban, CheckCircle2, Clock, Gift } from 'lucide-react';
import { formatTime } from '@/lib/format';
import { useDayEndReport, type ReportRange } from '@/lib/queries';
import type { DayEndTaxLine } from '@/lib/types';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Kpi, money, ReportState, ReportTable } from './report-shell';

/**
 * The day-end statement, as a till is closed on it.
 *
 * Built to be read in one pass, top to bottom, in the order a manager reconciles:
 * what was sold, what came off it, what was charged on top, what should be in the
 * drawer, and then the awkward bits - voids and anything still open.
 *
 * The tax section is the reason this report exists separately from the sales
 * summary. A return is filed component by component, so CGST and SGST each need
 * their own line with the value they were charged on; one combined "tax" figure
 * cannot be filed from.
 *
 * Open bills are shown but never added in. A day with a table still sitting is
 * not reconcilable, and the report says so rather than quietly reporting a total
 * that will change.
 */

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  OTHER: 'Other',
};

const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

export function DayEndReport({ range }: { range: ReportRange }) {
  const report = useDayEndReport(range);

  return (
    <ReportState isPending={report.isPending} error={report.error} onRetry={() => void report.refetch()}>
      {report.data && (
        <div className="space-y-4">
          {/* The first thing to know is whether this day can be signed off at all. */}
          {report.data.isClosed ? (
            <div className="flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3">
              <CheckCircle2 className="mt-px size-5 shrink-0 text-brand-700" aria-hidden />
              <p className="text-sm text-brand-700">
                <span className="font-semibold">{dayLabel(report.data.businessDate)}</span> is closed —
                every bill is settled or voided, so these figures are final.
              </p>
            </div>
          ) : (
            <div
              role="status"
              className="flex items-start gap-3 rounded-xl border border-warn-500/30 bg-warn-50 px-4 py-3"
            >
              <AlertTriangle className="mt-px size-5 shrink-0 text-warn-600" aria-hidden />
              <div className="text-sm text-warn-600">
                <p className="font-semibold">
                  This business day contains open bills and is not ready for final reconciliation.
                </p>
                <p className="mt-0.5">
                  {report.data.openBills} bill{report.data.openBills === 1 ? '' : 's'} still running,
                  worth about {money(report.data.openValue)}. That money is not counted below.
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Collected"
              value={money(report.data.collected)}
              hint="What should be in the drawer and the bank"
              tone="good"
            />
            <Kpi
              label="Bills settled"
              value={String(report.data.bills)}
              hint={`${report.data.itemsSold} items sold`}
            />
            <Kpi label="Average bill" value={money(report.data.averageBill)} />
            <Kpi
              label="Tax collected"
              value={money(report.data.taxTotal)}
              hint="Owed on filing, not income"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="How the day adds up"
                description="In the order it is worked out, from menu prices to what you collect."
              />
              <CardBody>
                <dl className="space-y-2 text-sm">
                  <Line label="Gross sales" hint="Menu value of everything sold" value={money(report.data.gross)} />
                  <Line
                    label="Discounts"
                    hint="Taken off before tax"
                    value={`- ${money(report.data.discounts)}`}
                  />
                  <Line label="Net sales" value={money(report.data.netSales)} strong />
                  {report.data.serviceCharge > 0 && (
                    <Line
                      label="Service charge"
                      hint="Your own charge, and taxable itself"
                      value={money(report.data.serviceCharge)}
                    />
                  )}
                  <Line label="Tax" value={money(report.data.taxTotal)} />
                  <div className="flex items-baseline justify-between border-t border-line pt-2">
                    <dt className="font-semibold text-ink">Total billed</dt>
                    <dd className="text-lg font-bold text-ink tabular-nums">{money(report.data.total)}</dd>
                  </div>
                  {report.data.tdsWithheld > 0 && (
                    <>
                      <Line
                        label="TDS withheld"
                        hint="Deducted by the payer, not charged by you"
                        value={`- ${money(report.data.tdsWithheld)}`}
                      />
                      <div className="flex items-baseline justify-between rounded-lg bg-info-50 px-3 py-2">
                        <dt className="text-sm font-semibold text-info-700">Collected</dt>
                        <dd className="text-base font-bold text-info-700 tabular-nums">
                          {money(report.data.collected)}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="How people paid"
                description="What actually arrived, after anything withheld."
              />
              <CardBody>
                {report.data.payments.length === 0 ? (
                  <p className="text-sm text-muted">Nothing settled on this day yet.</p>
                ) : (
                  <dl className="space-y-2 text-sm">
                    {report.data.payments.map((payment) => (
                      <Line
                        key={payment.method}
                        label={PAYMENT_LABELS[payment.method] ?? payment.method}
                        hint={`${payment.bills} bill${payment.bills === 1 ? '' : 's'}`}
                        value={money(payment.total)}
                      />
                    ))}
                    <div className="flex items-baseline justify-between border-t border-line pt-2">
                      <dt className="font-semibold text-ink">Total</dt>
                      <dd className="font-bold text-ink tabular-nums">{money(report.data.collected)}</dd>
                    </div>
                  </dl>
                )}

                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
                  <div>
                    <p className="flex items-center gap-1.5 text-muted">
                      <Clock className="size-3.5" aria-hidden />
                      First bill
                    </p>
                    <p className="mt-0.5 font-semibold text-ink">
                      {report.data.firstSettledAt ? formatTime(report.data.firstSettledAt) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="flex items-center gap-1.5 text-muted">
                      <Clock className="size-3.5" aria-hidden />
                      Last bill
                    </p>
                    <p className="mt-0.5 font-semibold text-ink">
                      {report.data.lastSettledAt ? formatTime(report.data.lastSettledAt) : '—'}
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Tax collected, component by component"
              description="What goes on a return. Each line is the rate it was charged at, on the value it was charged on."
            />
            <ReportTable<DayEndTaxLine>
              caption="Tax collected"
              fileName={`day-end-tax-${report.data.businessDate}`}
              empty="No tax was charged on this day."
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
                  header: 'Bills',
                  align: 'right',
                  cell: (row) => String(row.bills),
                  value: (row) => row.bills,
                },
                {
                  header: 'Collected',
                  align: 'right',
                  cell: (row) => money(row.amount),
                  value: (row) => row.amount,
                },
              ]}
            />
          </Card>

          <Card>
            <CardBody>
              <div className="grid gap-4 sm:grid-cols-4">
                <div>
                  <p className="flex items-center gap-1.5 text-sm text-muted">
                    <Gift className="size-4" aria-hidden />
                    No charge
                  </p>
                  <p className="mt-1 text-xl font-bold text-ink tabular-nums">{report.data.ncBills}</p>
                  <p className="text-xs text-muted">
                    Worth {money(report.data.ncValue)} — given away, not sold
                  </p>
                </div>
                <div>
                  <p className="flex items-center gap-1.5 text-sm text-muted">
                    <Ban className="size-4" aria-hidden />
                    Voided bills
                  </p>
                  <p className="mt-1 text-xl font-bold text-ink tabular-nums">{report.data.voidedBills}</p>
                  <p className="text-xs text-muted">
                    Worth {money(report.data.voidedValue)} — never counted as takings
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted">Still open</p>
                  <p className="mt-1 text-xl font-bold text-ink tabular-nums">{report.data.openBills}</p>
                  <p className="text-xs text-muted">
                    {report.data.openBills === 0
                      ? 'Every table is closed'
                      : `About ${money(report.data.openValue)} not yet taken`}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted">Business day</p>
                  <p className="mt-1 text-xl font-bold text-ink tabular-nums">
                    {report.data.businessDate}
                  </p>
                  <p className="text-xs text-muted">Starts at 5am, so a 1am bill belongs here</p>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <p className="text-xs text-muted">
                Plateo reports the tax your restaurant configured and charged. It is a record of what was
                billed, not a statement of what you owe — check your rates and your filings with your own
                accountant.
              </p>
            </CardBody>
          </Card>
        </div>
      )}
    </ReportState>
  );
}

function Line({
  label,
  hint,
  value,
  strong,
}: {
  label: string;
  hint?: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0">
        <span className={strong ? 'font-semibold text-ink' : 'text-muted'}>{label}</span>
        {hint && <span className="block text-xs text-muted/80">{hint}</span>}
      </dt>
      <dd className={`shrink-0 tabular-nums ${strong ? 'font-semibold text-ink' : 'text-ink'}`}>
        {value}
      </dd>
    </div>
  );
}
