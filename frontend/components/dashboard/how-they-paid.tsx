'use client';

import { Banknote, CreditCard, Smartphone, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatMoney } from '@/lib/format';
import type { PaymentBreakdown, PaymentMethod } from '@/lib/types';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * How today's money arrived.
 *
 * The question at close: how much cash should be in the drawer. Everything that
 * is not cash reconciles itself against a statement; cash is the figure somebody
 * has to count, and seeing it split out before cashing up is the difference
 * between a two-minute close and an argument.
 *
 * A row per method rather than a pie: four slices are read more slowly than four
 * lines, and the amounts are what matters, not the shape.
 */
const METHODS: Record<PaymentMethod, { label: string; icon: LucideIcon }> = {
  CASH: { label: 'Cash', icon: Banknote },
  CARD: { label: 'Card', icon: CreditCard },
  UPI: { label: 'UPI', icon: Smartphone },
  OTHER: { label: 'Other', icon: Wallet },
};

export function HowTheyPaid({
  payments,
  loading,
}: {
  payments: PaymentBreakdown[] | undefined;
  loading: boolean;
}) {
  const rows = (payments ?? []).filter((row) => row.bills > 0);
  const total = rows.reduce((sum, row) => sum + row.total, 0);

  return (
    <Card>
      <CardHeader title="How they paid" description="Today, by method." />

      {loading ? (
        <CardBody className="space-y-2 border-t border-line">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </CardBody>
      ) : rows.length === 0 ? (
        <CardBody className="border-t border-line">
          <p className="text-sm text-muted">Nothing settled yet today.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {rows.map((row) => {
            const method = METHODS[row.method] ?? METHODS.OTHER;
            const Icon = method.icon;
            const share = total > 0 ? row.total / total : 0;

            return (
              <li key={row.method} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  aria-hidden
                  className="grid size-7 shrink-0 place-items-center rounded-lg bg-ground text-muted"
                >
                  <Icon className="size-3.5" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink">{method.label}</span>
                  {/* A hairline track, not a chart: it qualifies the number beside
                      it rather than standing in for it. */}
                  <span aria-hidden className="mt-1 block h-1 rounded-full bg-ground">
                    <span
                      className="block h-1 rounded-full bg-brand-500/70"
                      style={{ width: `${Math.max(3, share * 100)}%` }}
                    />
                  </span>
                </span>

                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold text-ink tabular-nums">
                    {formatMoney(row.total)}
                  </span>
                  <span className="block text-xs text-muted tabular-nums">
                    {row.bills} {row.bills === 1 ? 'bill' : 'bills'}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
