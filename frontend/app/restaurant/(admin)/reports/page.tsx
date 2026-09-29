'use client';

import {
  ArrowLeft,
  ArrowRight,
  Armchair,
  BadgePercent,
  ChartNoAxesColumn,
  LayoutList,
  Lock,
  Receipt,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { canBill } from '@/lib/permissions';
import { useSalesReport, type ReportRange } from '@/lib/queries';
import {
  AdjustmentsReportView,
  ItemsReport,
  OrdersReport,
  SalesReport,
  SectionsReport,
  StaffReport,
  TablesReport,
} from '@/components/reports/report-views';
import { Kpi, money, RANGE_PRESETS, RangePicker } from '@/components/reports/report-shell';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { PageHeader } from '@/components/page-header';

/**
 * Reports.
 *
 * The landing screen is a set of cards, one per report, the way every POS does it -
 * a restaurant manager arrives looking for a named report, not for a dashboard to
 * interpret. Above them sit the four numbers worth knowing without clicking
 * anything, for the selected range.
 *
 * Choosing a report replaces the grid rather than opening a new page, so the date
 * range you picked stays picked as you move between reports.
 */

type ReportId = 'sales' | 'items' | 'sections' | 'orders' | 'staff' | 'tables' | 'adjustments';

const REPORTS: Array<{
  id: ReportId;
  title: string;
  description: string;
  icon: LucideIcon;
  tint: string;
}> = [
  {
    id: 'sales',
    title: 'Sales summary',
    description: 'What you took, day by day and hour by hour, and how people paid.',
    icon: TrendingUp,
    tint: 'bg-brand-50 text-brand-700',
  },
  {
    id: 'items',
    title: 'Item summary',
    description: 'Which dishes sold, how many, and what each one earned.',
    icon: ChartNoAxesColumn,
    tint: 'bg-info-50 text-info-700',
  },
  {
    id: 'sections',
    title: 'Section summary',
    description: 'Sales gathered into the menu sections diners see.',
    icon: LayoutList,
    tint: 'bg-saffron-50 text-saffron-600',
  },
  {
    id: 'orders',
    title: 'Bill register',
    description: 'Every bill with its table, payment method and who settled it.',
    icon: Receipt,
    tint: 'bg-brand-50 text-brand-700',
  },
  {
    id: 'staff',
    title: 'Staff summary',
    description: 'Bills opened and settled per person, and the discounts they gave.',
    icon: Users,
    tint: 'bg-info-50 text-info-700',
  },
  {
    id: 'tables',
    title: 'Table summary',
    description: 'Which tables earn, and how long a bill stays open at each.',
    icon: Armchair,
    tint: 'bg-saffron-50 text-saffron-600',
  },
  {
    id: 'adjustments',
    title: 'Discounts & voids',
    description: 'Everything that took money off a bill, with the reason given.',
    icon: BadgePercent,
    tint: 'bg-warn-50 text-warn-600',
  },
];

export default function ReportsPage() {
  const { session } = useAuth();
  const [preset, setPreset] = useState<string | null>('today');
  const [range, setRange] = useState<ReportRange>(RANGE_PRESETS[0].range());
  const [open, setOpen] = useState<ReportId | null>(null);

  if (!session) return null;

  if (!canBill(session.user.role)) {
    return (
      <>
        <PageHeader title="Reports" description="How the restaurant is trading." />
        <Card>
          <EmptyState
            icon={Lock}
            title="Reports are for owners and managers"
            description="They show what the restaurant earned, so they are limited to the people who handle the money. Waiters and kitchen staff do not see them."
          />
        </Card>
      </>
    );
  }

  const current = REPORTS.find((report) => report.id === open);

  return (
    <>
      <PageHeader
        title={current ? current.title : 'Reports'}
        description={
          current
            ? current.description
            : 'How the restaurant is trading. Pick a period, then open the report you need.'
        }
        action={
          current ? (
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink shadow-card transition-colors hover:bg-ground"
            >
              <ArrowLeft className="size-4" aria-hidden />
              All reports
            </button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <RangePicker
          range={range}
          preset={preset}
          onChange={(next, nextPreset) => {
            setRange(next);
            setPreset(nextPreset);
          }}
        />
      </div>

      {current ? (
        <ReportBody id={current.id} range={range} />
      ) : (
        <div className="space-y-5">
          <HeadlineNumbers range={range} />

          <div>
            <h2 className="mb-3 text-sm font-semibold tracking-tight text-ink">All reports</h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {REPORTS.map((report) => {
                const Icon = report.icon;

                return (
                  <li key={report.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(report.id)}
                      className="group flex h-full w-full items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition-shadow hover:shadow-raised focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-none"
                    >
                      <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', report.tint)}>
                        <Icon className="size-5" aria-hidden />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-ink">{report.title}</span>
                          <ArrowRight
                            className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600"
                            aria-hidden
                          />
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                          {report.description}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <Card>
            <CardBody>
              <p className="text-xs text-muted">
                Every report counts <span className="font-medium text-ink">settled bills only</span>, over
                business days that start at 5am — so a bill paid at 1am belongs to the night before, the
                same way your till closes it. Open bills and voided bills are shown separately and never
                counted as takings.
              </p>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}

/** The four numbers worth seeing before choosing a report. */
function HeadlineNumbers({ range }: { range: ReportRange }) {
  const report = useSalesReport(range);

  if (report.isError) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        label="What you took"
        value={report.data ? money(report.data.net) : '—'}
        hint="Settled bills only"
        tone="good"
      />
      <Kpi label="Bills settled" value={report.data ? String(report.data.bills) : '—'} />
      <Kpi label="Average bill" value={report.data ? money(report.data.averageBill) : '—'} />
      <Kpi
        label="Discounts given"
        value={report.data ? money(report.data.discounts) : '—'}
        tone={report.data && report.data.discounts > 0 ? 'warn' : 'plain'}
      />
    </div>
  );
}

function ReportBody({ id, range }: { id: ReportId; range: ReportRange }) {
  switch (id) {
    case 'sales':
      return <SalesReport range={range} />;
    case 'items':
      return <ItemsReport range={range} />;
    case 'sections':
      return <SectionsReport range={range} />;
    case 'orders':
      return <OrdersReport range={range} />;
    case 'staff':
      return <StaffReport range={range} />;
    case 'tables':
      return <TablesReport range={range} />;
    case 'adjustments':
      return <AdjustmentsReportView range={range} />;
  }
}
