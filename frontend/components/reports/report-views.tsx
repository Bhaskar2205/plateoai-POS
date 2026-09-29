'use client';

import { Ban, BadgePercent, Trash2 } from 'lucide-react';
import { formatTime } from '@/lib/format';
import {
  useAdjustmentsReport,
  useItemsReport,
  useOrdersReport,
  useSalesReport,
  useSectionsReport,
  useStaffReport,
  useTablesReport,
  type ReportRange,
} from '@/lib/queries';
import type { OrderRow } from '@/lib/types';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { RankedBars, TimeBars } from './charts';
import { Kpi, money, ReportState, ReportTable } from './report-shell';

/**
 * One component per report.
 *
 * Each pairs a picture with the figures behind it: the chart answers "how did we
 * do", the table answers "which ones", and the table exports to CSV for whoever
 * does the books. The wording avoids accounting jargon - "what you took" rather
 * than "net revenue" - because the people reading this run a kitchen.
 */

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  OTHER: 'Other',
};

/** `2026-09-28` -> `Sat 28 Sep`. */
const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

const shortDay = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** `14` -> `2 pm`, the way a shift is spoken about. */
const hourLabel = (hour: number) => {
  const suffix = hour < 12 ? 'am' : 'pm';
  const display = hour % 12 === 0 ? 12 : hour % 12;

  return `${display}${suffix}`;
};

export function SalesReport({ range }: { range: ReportRange }) {
  const report = useSalesReport(range);

  return (
    <ReportState isPending={report.isPending} error={report.error} onRetry={() => void report.refetch()}>
      {report.data && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="What you took"
              value={money(report.data.net)}
              hint="Settled bills, after discounts and with tax"
              tone="good"
            />
            <Kpi label="Bills settled" value={String(report.data.bills)} hint={`${report.data.itemsSold} items sold`} />
            <Kpi label="Average bill" value={money(report.data.averageBill)} />
            <Kpi
              label="Discounts given"
              value={money(report.data.discounts)}
              hint={report.data.discounts > 0 ? 'See the Discounts report for why' : 'None in this period'}
              tone={report.data.discounts > 0 ? 'warn' : 'plain'}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi label="Before discounts" value={money(report.data.gross)} />
            <Kpi label="Tax collected" value={money(report.data.tax)} />
            <Kpi
              label="Still open"
              value={String(report.data.openBills)}
              hint={report.data.openBills > 0 ? 'Not counted in takings' : 'Every table settled'}
            />
          </div>

          <Card>
            <CardHeader
              title="Day by day"
              description="Only settled bills count. A quiet day shows as a gap, not as missing data."
            />
            <CardBody>
              <TimeBars
                label="Takings per business day"
                data={report.data.daily.map((day) => ({
                  key: day.businessDate,
                  caption: report.data.daily.length > 14 ? shortDay(day.businessDate) : dayLabel(day.businessDate),
                  value: day.net,
                  sub: `${day.bills} bill${day.bills === 1 ? '' : 's'}`,
                }))}
              />
            </CardBody>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="How people paid" />
              <CardBody>
                <RankedBars
                  label="Takings by payment method"
                  emptyLabel="No settled bills in this period."
                  data={report.data.payments.map((payment) => ({
                    key: payment.method,
                    name: PAYMENT_LABELS[payment.method] ?? payment.method,
                    value: payment.total,
                    sub: `${payment.bills} bill${payment.bills === 1 ? '' : 's'}`,
                  }))}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Busiest hours"
                description={
                  report.data.hourly.length === 0
                    ? 'Shown for ranges up to 31 days.'
                    : 'When bills were settled.'
                }
              />
              <CardBody>
                <TimeBars
                  label="Takings by hour of day"
                  emptyLabel="Pick a shorter range to see the busy hours."
                  data={report.data.hourly.map((hour) => ({
                    key: String(hour.hour),
                    caption: hourLabel(hour.hour),
                    value: hour.total,
                    sub: `${hour.bills} bill${hour.bills === 1 ? '' : 's'}`,
                  }))}
                />
              </CardBody>
            </Card>
          </div>

          {report.data.voidedBills > 0 && (
            <Card>
              <CardBody className="flex items-start gap-3">
                <Ban className="mt-0.5 size-5 shrink-0 text-danger-500" aria-hidden />
                <p className="text-sm text-muted">
                  <span className="font-medium text-ink">
                    {report.data.voidedBills} bill{report.data.voidedBills === 1 ? ' was' : 's were'} voided
                  </span>{' '}
                  in this period, worth {money(report.data.voidedValue)}. Voided bills are never counted
                  as takings — the Discounts &amp; voids report shows each one with its reason.
                </p>
              </CardBody>
            </Card>
          )}

          <ReportTable
            caption="Takings per day"
            fileName={`plateo-sales-${range.from}-to-${range.to}`}
            rows={report.data.daily}
            columns={[
              { header: 'Business day', cell: (row) => dayLabel(row.businessDate), value: (row) => row.businessDate },
              { header: 'Bills', cell: (row) => row.bills, value: (row) => row.bills, align: 'right' },
              { header: 'Taken', cell: (row) => money(row.net), value: (row) => row.net, align: 'right' },
            ]}
          />
        </div>
      )}
    </ReportState>
  );
}

export function ItemsReport({ range }: { range: ReportRange }) {
  const report = useItemsReport(range);

  return (
    <ReportState isPending={report.isPending} error={report.error} onRetry={() => void report.refetch()}>
      {report.data && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Best sellers" description="By what they earned, across settled bills." />
            <CardBody>
              <RankedBars
                label="Top dishes by sales"
                emptyLabel="Nothing sold in this period."
                data={report.data.map((item) => ({
                  key: `${item.dishId ?? item.name}`,
                  name: item.name,
                  value: item.total,
                  sub: `${item.quantity} sold`,
                }))}
              />
            </CardBody>
          </Card>

          <ReportTable
            caption="Every dish sold"
            fileName={`plateo-items-${range.from}-to-${range.to}`}
            rows={report.data}
            empty="No dish was sold in this period."
            columns={[
              { header: 'Dish', cell: (row) => row.name, value: (row) => row.name },
              {
                header: 'Section',
                cell: (row) => row.section ?? <span className="text-muted">No section</span>,
                value: (row) => row.section ?? 'No section',
              },
              { header: 'Sold', cell: (row) => row.quantity, value: (row) => row.quantity, align: 'right' },
              { header: 'Earned', cell: (row) => money(row.total), value: (row) => row.total, align: 'right' },
              {
                header: 'Share',
                cell: (row) => `${row.share}%`,
                value: (row) => row.share,
                align: 'right',
              },
            ]}
          />
        </div>
      )}
    </ReportState>
  );
}

export function SectionsReport({ range }: { range: ReportRange }) {
  const report = useSectionsReport(range);

  return (
    <ReportState isPending={report.isPending} error={report.error} onRetry={() => void report.refetch()}>
      {report.data && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Sales by menu section" description="The headings diners see on your menu." />
            <CardBody>
              <RankedBars
                label="Sales by section"
                emptyLabel="Nothing sold in this period."
                data={report.data.map((section) => ({
                  key: String(section.categoryId ?? 'none'),
                  name: section.name,
                  value: section.total,
                  sub: `${section.share}%`,
                }))}
              />
            </CardBody>
          </Card>

          <ReportTable
            caption="Sections"
            fileName={`plateo-sections-${range.from}-to-${range.to}`}
            rows={report.data}
            columns={[
              { header: 'Section', cell: (row) => row.name, value: (row) => row.name },
              { header: 'Dishes sold', cell: (row) => row.dishes, value: (row) => row.dishes, align: 'right' },
              { header: 'Items', cell: (row) => row.quantity, value: (row) => row.quantity, align: 'right' },
              { header: 'Earned', cell: (row) => money(row.total), value: (row) => row.total, align: 'right' },
              { header: 'Share', cell: (row) => `${row.share}%`, value: (row) => row.share, align: 'right' },
            ]}
          />
        </div>
      )}
    </ReportState>
  );
}

const STATUS_TONE: Record<string, 'success' | 'neutral' | 'danger'> = {
  OPEN: 'success',
  SETTLED: 'neutral',
  CANCELLED: 'danger',
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'running',
  SETTLED: 'paid',
  CANCELLED: 'voided',
};

export function OrdersReport({ range }: { range: ReportRange }) {
  const report = useOrdersReport(range);

  return (
    <ReportState isPending={report.isPending} error={report.error} onRetry={() => void report.refetch()}>
      {report.data && (
        <ReportTable<OrderRow>
          caption="Every bill"
          fileName={`plateo-bills-${range.from}-to-${range.to}`}
          rows={report.data}
          empty="No bill was opened in this period."
          columns={[
            {
              header: 'Bill',
              cell: (row) => (
                <span className="font-medium text-ink">
                  #{row.orderNumber}
                  {row.source === 'DINER_QR' && (
                    <span className="ml-1.5 text-xs font-normal text-saffron-600">QR</span>
                  )}
                </span>
              ),
              value: (row) => row.orderNumber,
            },
            { header: 'Day', cell: (row) => shortDay(row.businessDate), value: (row) => row.businessDate },
            {
              header: 'Table',
              cell: (row) => row.tableName ?? <span className="text-muted">Counter</span>,
              value: (row) => row.tableName ?? 'Counter',
            },
            { header: 'Items', cell: (row) => row.items, value: (row) => row.items, align: 'right' },
            {
              header: 'Discount',
              cell: (row) => (row.discount > 0 ? money(row.discount) : <span className="text-muted">—</span>),
              value: (row) => row.discount,
              align: 'right',
            },
            { header: 'Total', cell: (row) => money(row.total), value: (row) => row.total, align: 'right' },
            {
              header: 'Paid by',
              cell: (row) =>
                row.paymentMethod ? (
                  PAYMENT_LABELS[row.paymentMethod]
                ) : (
                  <span className="text-muted">—</span>
                ),
              value: (row) => row.paymentMethod ?? '',
            },
            {
              header: 'Settled by',
              cell: (row) => row.settledBy ?? <span className="text-muted">—</span>,
              value: (row) => row.settledBy ?? '',
            },
            {
              header: 'Status',
              cell: (row) => (
                <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{STATUS_LABEL[row.status] ?? row.status}</Badge>
              ),
              value: (row) => row.status,
            },
            {
              header: 'Time',
              cell: (row) => (row.settledAt ? formatTime(row.settledAt) : formatTime(row.openedAt)),
              value: (row) => row.settledAt ?? row.openedAt,
            },
          ]}
        />
      )}
    </ReportState>
  );
}

export function StaffReport({ range }: { range: ReportRange }) {
  const report = useStaffReport(range);

  return (
    <ReportState isPending={report.isPending} error={report.error} onRetry={() => void report.refetch()}>
      {report.data && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Money taken, by person" description="Who settled the bills." />
            <CardBody>
              <RankedBars
                label="Takings by staff member"
                emptyLabel="No bills were settled in this period."
                data={report.data
                  .filter((row) => row.billsSettled > 0)
                  .map((row) => ({
                    key: String(row.userId ?? row.name),
                    name: row.name,
                    value: row.settledValue,
                    sub: `${row.billsSettled} bill${row.billsSettled === 1 ? '' : 's'}`,
                  }))}
              />
            </CardBody>
          </Card>

          <ReportTable
            caption="Staff"
            fileName={`plateo-staff-${range.from}-to-${range.to}`}
            rows={report.data}
            columns={[
              { header: 'Person', cell: (row) => row.name, value: (row) => row.name },
              {
                header: 'Bills opened',
                cell: (row) => row.billsOpened,
                value: (row) => row.billsOpened,
                align: 'right',
              },
              {
                header: 'Bills settled',
                cell: (row) => row.billsSettled,
                value: (row) => row.billsSettled,
                align: 'right',
              },
              {
                header: 'Taken',
                cell: (row) => money(row.settledValue),
                value: (row) => row.settledValue,
                align: 'right',
              },
              {
                header: 'Discounts given',
                cell: (row) =>
                  row.discountsGiven > 0 ? (
                    <span className="text-warn-600">{money(row.discountsGiven)}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  ),
                value: (row) => row.discountsGiven,
                align: 'right',
              },
            ]}
          />
        </div>
      )}
    </ReportState>
  );
}

export function TablesReport({ range }: { range: ReportRange }) {
  const report = useTablesReport(range);

  return (
    <ReportState isPending={report.isPending} error={report.error} onRetry={() => void report.refetch()}>
      {report.data && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Earnings by table" description="Settled bills only." />
            <CardBody>
              <RankedBars
                label="Takings by table"
                emptyLabel="No bills were settled in this period."
                data={report.data.map((row) => ({
                  key: String(row.tableId ?? 'counter'),
                  name: row.name,
                  value: row.total,
                  sub: `${row.bills} bill${row.bills === 1 ? '' : 's'}`,
                }))}
              />
            </CardBody>
          </Card>

          <ReportTable
            caption="Tables"
            fileName={`plateo-tables-${range.from}-to-${range.to}`}
            rows={report.data}
            columns={[
              { header: 'Table', cell: (row) => row.name, value: (row) => row.name },
              { header: 'Bills', cell: (row) => row.bills, value: (row) => row.bills, align: 'right' },
              { header: 'Taken', cell: (row) => money(row.total), value: (row) => row.total, align: 'right' },
              {
                header: 'Average bill',
                cell: (row) => money(row.averageBill),
                value: (row) => row.averageBill,
                align: 'right',
              },
              {
                header: 'Average time',
                cell: (row) => `${row.averageMinutes} min`,
                value: (row) => row.averageMinutes,
                align: 'right',
              },
            ]}
          />
        </div>
      )}
    </ReportState>
  );
}

export function AdjustmentsReportView({ range }: { range: ReportRange }) {
  const report = useAdjustmentsReport(range);

  return (
    <ReportState isPending={report.isPending} error={report.error} onRetry={() => void report.refetch()}>
      {report.data && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi
              label="Discounts given"
              value={money(report.data.discountTotal)}
              hint={`${report.data.discounts.length} bill(s)`}
              tone="warn"
            />
            <Kpi
              label="Bills voided"
              value={money(report.data.voidedTotal)}
              hint={`${report.data.voided.length} bill(s)`}
              tone="warn"
            />
            <Kpi
              label="Items struck off"
              value={money(report.data.cancelledTotal)}
              hint={`${report.data.cancelledItems.length} dish(es)`}
              tone="warn"
            />
          </div>

          <ReportTable
            caption="Discounts"
            fileName={`plateo-discounts-${range.from}-to-${range.to}`}
            rows={report.data.discounts}
            empty="No discount was given in this period."
            columns={[
              { header: 'Bill', cell: (row) => `#${row.orderNumber}`, value: (row) => row.orderNumber },
              { header: 'Day', cell: (row) => shortDay(row.businessDate), value: (row) => row.businessDate },
              {
                header: 'Table',
                cell: (row) => row.tableName ?? <span className="text-muted">Counter</span>,
                value: (row) => row.tableName ?? 'Counter',
              },
              {
                header: 'Reason',
                cell: (row) => (
                  <span className="inline-flex items-center gap-1.5">
                    <BadgePercent className="size-3.5 shrink-0 text-warn-600" aria-hidden />
                    {row.reason ?? '—'}
                  </span>
                ),
                value: (row) => row.reason ?? '',
              },
              {
                header: 'Given by',
                cell: (row) => row.settledBy ?? <span className="text-muted">—</span>,
                value: (row) => row.settledBy ?? '',
              },
              {
                header: 'Taken off',
                cell: (row) => <span className="text-warn-600">{money(row.amount)}</span>,
                value: (row) => row.amount,
                align: 'right',
              },
              {
                header: 'Bill total',
                cell: (row) => money(row.billTotal),
                value: (row) => row.billTotal,
                align: 'right',
              },
            ]}
          />

          <ReportTable
            caption="Voided bills"
            fileName={`plateo-voided-${range.from}-to-${range.to}`}
            rows={report.data.voided}
            empty="No bill was voided in this period."
            columns={[
              { header: 'Bill', cell: (row) => `#${row.orderNumber}`, value: (row) => row.orderNumber },
              { header: 'Day', cell: (row) => shortDay(row.businessDate), value: (row) => row.businessDate },
              {
                header: 'Table',
                cell: (row) => row.tableName ?? <span className="text-muted">Counter</span>,
                value: (row) => row.tableName ?? 'Counter',
              },
              {
                header: 'Reason',
                cell: (row) => (
                  <span className="inline-flex items-center gap-1.5">
                    <Ban className="size-3.5 shrink-0 text-danger-500" aria-hidden />
                    {row.reason ?? '—'}
                  </span>
                ),
                value: (row) => row.reason ?? '',
              },
              {
                header: 'Was worth',
                cell: (row) => money(row.value),
                value: (row) => row.value,
                align: 'right',
              },
            ]}
          />

          <ReportTable
            caption="Items struck off bills"
            fileName={`plateo-cancelled-items-${range.from}-to-${range.to}`}
            rows={report.data.cancelledItems}
            empty="No item was struck off a bill in this period."
            columns={[
              {
                header: 'Dish',
                cell: (row) => (
                  <span className="inline-flex items-center gap-1.5">
                    <Trash2 className="size-3.5 shrink-0 text-muted" aria-hidden />
                    {row.name}
                  </span>
                ),
                value: (row) => row.name,
              },
              { header: 'Times', cell: (row) => row.times, value: (row) => row.times, align: 'right' },
              { header: 'Quantity', cell: (row) => row.quantity, value: (row) => row.quantity, align: 'right' },
              {
                header: 'Reasons',
                cell: (row) =>
                  row.reasons.length > 0 ? row.reasons.join(' · ') : <span className="text-muted">—</span>,
                value: (row) => row.reasons.join(' | '),
              },
              { header: 'Value', cell: (row) => money(row.value), value: (row) => row.value, align: 'right' },
            ]}
          />
        </div>
      )}
    </ReportState>
  );
}
