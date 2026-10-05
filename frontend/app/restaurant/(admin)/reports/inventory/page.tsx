'use client';

import { ArrowLeft, Lock, PackageSearch, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { canBill } from '@/lib/permissions';
import { useInventoryReport } from '@/lib/queries';
import type { InventoryReportLine } from '@/lib/types';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { TextField } from '@/components/ui/field';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { PageHeader } from '@/components/page-header';
import { LinkButton } from '@/components/inventory/link-button';
import { formatQuantity, fromPaise } from '@/components/inventory/stock-units';

/**
 * What a period did to the shelves.
 *
 * Four columns, and they are four different things: received is what was bought,
 * used is what the recipes of settled bills account for, wasted is what was
 * thrown away, and corrected is what a person changed by hand. Adding them into
 * one "stock movement" figure would hide the only comparison worth making -
 * wastage and corrections against sales, which is where money quietly leaves a
 * kitchen.
 *
 * Business days, not calendar days, so a range here covers the same service as
 * the same range in the sales report.
 */
export default function InventoryReportPage() {
  const { session } = useAuth();
  const canSee = canBill(session?.user.role);

  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const report = useInventoryReport({ from, to });

  if (!session) return null;

  if (!canSee) {
    return (
      <>
        <PageHeader title="Inventory report" />
        <EmptyState
          icon={Lock}
          title="Reports are for owners and managers"
          description="They show what the restaurant spent and what it has left."
        />
      </>
    );
  }

  const moved = (report.data?.lines ?? []).filter(
    (line) =>
      line.consumed !== 0 || line.wasted !== 0 || line.received !== 0 || line.adjusted !== 0,
  );

  return (
    <>
      <PageHeader
        title="Inventory report"
        description="What came in, what the kitchen used, what was thrown away, and what was corrected."
        action={
          <LinkButton href="/restaurant/reports">
            <ArrowLeft className="size-4" aria-hidden />
            All reports
          </LinkButton>
        }
      />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-3">
          <TextField
            label="From"
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
          />
          <TextField
            label="To"
            type="date"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
          />
        </CardBody>
      </Card>

      {report.isError ? (
        <ErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : report.isPending ? (
        <TableSkeleton rows={6} />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Used by sales" value={formatMoney(fromPaise(report.data.totals.consumedPaise))} />
            <Tile
              label="Wasted"
              value={formatMoney(fromPaise(report.data.totals.wastedPaise))}
              tone={report.data.totals.wastedPaise > 0 ? 'danger' : 'neutral'}
            />
            <Tile label="Received" value={formatMoney(fromPaise(report.data.totals.receivedPaise))} />
            <Tile label="Value on the shelf now" value={formatMoney(fromPaise(report.data.totals.onHandPaise))} />
          </div>

          {report.data.lowStock.length > 0 && (
            <Card className="mb-4 border-warn-500/30">
              <CardHeader
                title="Running low"
                description="At or below the minimum you set. Worst first."
              />
              <ul className="divide-y divide-line border-t border-line">
                {report.data.lowStock.map((row) => (
                  <li
                    key={row.ingredientId}
                    className="flex flex-wrap items-center gap-3 px-4 py-2"
                  >
                    <TriangleAlert className="size-4 shrink-0 text-warn-600" aria-hidden />
                    <span className="min-w-0 flex-1 text-sm text-ink">{row.ingredientName}</span>
                    <span className="text-xs text-muted tabular-nums">
                      {formatQuantity(row.onHand, row.unit)} of{' '}
                      {formatQuantity(row.minimum, row.unit)}
                    </span>
                    {row.reorderQuantity > 0 && (
                      <span className="text-xs text-muted">
                        usually order {formatQuantity(row.reorderQuantity, row.unit)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader
              title="By ingredient"
              description="Only ingredients that moved in this period."
            />

            {moved.length === 0 ? (
              <EmptyState
                icon={PackageSearch}
                compact
                title="Nothing moved in this period"
                description="Deliveries, wastage, corrections and the ingredients used by settled bills would appear here."
              />
            ) : (
              <div className="overflow-x-auto border-t border-line">
                <table className="w-full text-sm">
                  <thead className="bg-ground text-xs text-muted">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Ingredient</th>
                      <th className="px-4 py-2 text-right font-medium">Received</th>
                      <th className="px-4 py-2 text-right font-medium">Used</th>
                      <th className="px-4 py-2 text-right font-medium">Wasted</th>
                      <th className="px-4 py-2 text-right font-medium">Corrected</th>
                      <th className="px-4 py-2 text-right font-medium">On the shelf</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {moved.map((line) => (
                      <ReportRow key={line.ingredientId} line={line} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function Tile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs text-muted">{label}</p>
        <p
          className={cn(
            'mt-1 text-xl font-semibold tabular-nums',
            tone === 'danger' ? 'text-danger-600' : 'text-ink',
          )}
        >
          {value}
        </p>
      </CardBody>
    </Card>
  );
}

function ReportRow({ line }: { line: InventoryReportLine }) {
  return (
    <tr>
      <td className="px-4 py-2 text-ink">{line.ingredientName}</td>
      <td className="px-4 py-2 text-right text-muted tabular-nums">
        {line.received === 0 ? '—' : formatQuantity(line.received, line.unit)}
      </td>
      <td className="px-4 py-2 text-right text-muted tabular-nums">
        {line.consumed === 0 ? '—' : formatQuantity(line.consumed, line.unit)}
      </td>
      <td
        className={cn(
          'px-4 py-2 text-right tabular-nums',
          line.wasted > 0 ? 'text-danger-600' : 'text-muted',
        )}
      >
        {line.wasted === 0 ? '—' : formatQuantity(line.wasted, line.unit)}
      </td>
      <td
        className={cn(
          'px-4 py-2 text-right tabular-nums',
          line.adjusted < 0 ? 'text-danger-600' : line.adjusted > 0 ? 'text-brand-700' : 'text-muted',
        )}
      >
        {line.adjusted === 0
          ? '—'
          : `${line.adjusted > 0 ? '+' : '−'}${formatQuantity(Math.abs(line.adjusted), line.unit)}`}
      </td>
      <td className="px-4 py-2 text-right font-medium text-ink tabular-nums">
        {formatQuantity(line.onHand, line.unit)}
      </td>
    </tr>
  );
}
