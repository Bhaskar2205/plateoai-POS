'use client';

import { ArrowLeft, ClipboardCheck, Lock } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { canBill } from '@/lib/permissions';
import { useRecordStockCount, useStock } from '@/lib/queries';
import type { StockCountLine } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { TextAreaField } from '@/components/ui/field';
import { EmptyState, ErrorState, FormError, TableSkeleton } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { LinkButton } from '@/components/inventory/link-button';
import {
  formatQuantity,
  fromPaise,
  UNIT_LABELS,
} from '@/components/inventory/stock-units';

/**
 * A stock count.
 *
 * A sheet of ingredients with one box each: type what is actually on the shelf.
 * Boxes left empty are not counted, and not counted is deliberately different
 * from counted as zero - treating a blank as zero would wipe out stock nobody
 * looked at.
 *
 * What gets saved is the difference between expected and actual, as a correction
 * per ingredient, so the history shows both figures and why they moved. An
 * ingredient that already matches gets no record at all.
 */
export default function StockCountPage() {
  const { session } = useAuth();
  const canSee = canBill(session?.user.role);
  const toast = useToast();

  const stock = useStock();
  const [counted, setCounted] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const [result, setResult] = useState<StockCountLine[] | null>(null);

  const record = useRecordStockCount({
    onSuccess: (response) => {
      const corrected = response.lines.filter((line) => line.variance !== 0);

      setResult(response.lines);
      setCounted({});
      toast.success(
        corrected.length === 0
          ? 'Everything matched. Nothing to correct.'
          : `Corrected ${corrected.length} ingredient${corrected.length === 1 ? '' : 's'}.`,
      );
    },
    onError: (error) => toast.error(error),
  });

  if (!session) return null;

  if (!canSee) {
    return (
      <>
        <PageHeader title="Count stock" />
        <EmptyState
          icon={Lock}
          title="Counting stock is for owners and managers"
          description="A count corrects what the restaurant believes it owns."
        />
      </>
    );
  }

  const lines = Object.entries(counted)
    .map(([id, value]) => ({ ingredientId: Number(id), countedQuantity: Number(value) }))
    // A blank box is not a count. An unparseable one is not either, and the
    // field already refuses to hold anything but digits.
    .filter((line) => Number.isFinite(line.countedQuantity) && line.countedQuantity >= 0);

  const filled = Object.values(counted).filter((value) => value.trim() !== '').length;

  return (
    <>
      <PageHeader
        title="Count stock"
        description="Type what is actually on the shelf. Leave anything you have not counted blank."
        action={
          <LinkButton href="/restaurant/inventory">
            <ArrowLeft className="size-4" aria-hidden />
            Back to stock
          </LinkButton>
        }
      />

      {result && <CountResult lines={result} onDismiss={() => setResult(null)} />}

      <Card>
        <CardHeader
          title="Count sheet"
          description="Expected is what Plateo thinks is there. Counted is what you found."
        />

        {stock.isError ? (
          <ErrorState error={stock.error} onRetry={() => void stock.refetch()} />
        ) : stock.isPending ? (
          <TableSkeleton rows={6} />
        ) : stock.data.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            compact
            title="Nothing to count"
            description="Add your ingredients first."
          />
        ) : (
          <>
            <ul className="divide-y divide-line border-t border-line">
              {stock.data.map((row) => {
                const typed = counted[row.id] ?? '';
                const variance =
                  typed.trim() === '' || !Number.isFinite(Number(typed))
                    ? null
                    : Math.round((Number(typed) - row.currentQuantity) * 1000) / 1000;

                return (
                  <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">{row.name}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        Expected {formatQuantity(row.currentQuantity, row.unit)}
                      </p>
                    </div>

                    {variance !== null && variance !== 0 && (
                      <span
                        className={cn(
                          'text-xs font-medium tabular-nums',
                          variance < 0 ? 'text-danger-600' : 'text-brand-700',
                        )}
                      >
                        {variance > 0 ? '+' : '−'}
                        {formatQuantity(Math.abs(variance), row.unit)}
                      </span>
                    )}

                    <label className="flex items-center gap-2">
                      <span className="sr-only">Counted {row.name}</span>
                      <input
                        inputMode="decimal"
                        value={typed}
                        placeholder="—"
                        onChange={(event) => {
                          const next = event.target.value;
                          // Digits and at most three decimals, because that is
                          // what the column holds.
                          if (next !== '' && !/^\d*\.?\d{0,3}$/.test(next)) return;

                          setCounted((current) => ({ ...current, [row.id]: next }));
                        }}
                        className="h-10 w-24 rounded-lg border border-line bg-surface px-3 text-right text-sm text-ink tabular-nums focus:border-brand-500 focus:outline-none"
                      />
                      <span className="w-14 text-xs text-muted">{UNIT_LABELS[row.unit]}</span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <CardBody className="space-y-3 border-t border-line">
              <FormError error={record.error} />

              <TextAreaField
                label="Note (optional)"
                rows={2}
                placeholder="Monthly count, who counted, anything worth remembering"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted">
                  {filled === 0
                    ? 'Nothing counted yet.'
                    : `${filled} ingredient${filled === 1 ? '' : 's'} counted. The rest will be left alone.`}
                </p>
                <Button
                  loading={record.isPending}
                  disabled={lines.length === 0}
                  onClick={() =>
                    record.mutate({ lines, note: note.trim() ? note.trim() : undefined })
                  }
                >
                  Save the count
                </Button>
              </div>
            </CardBody>
          </>
        )}
      </Card>
    </>
  );
}

function CountResult({
  lines,
  onDismiss,
}: {
  lines: StockCountLine[];
  onDismiss: () => void;
}) {
  const corrected = lines.filter((line) => line.variance !== 0);
  const net = corrected.reduce((sum, line) => sum + line.variancePaise, 0);

  return (
    <Card className="mb-4">
      <CardHeader
        title="What the count changed"
        description={
          corrected.length === 0
            ? 'Every figure already matched.'
            : `${corrected.length} corrected. The rest matched.`
        }
        action={
          <Button variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        }
      />

      {corrected.length > 0 && (
        <>
          <ul className="divide-y divide-line border-t border-line">
            {corrected.map((line) => (
              <li
                key={line.ingredientId}
                className="flex items-center justify-between gap-3 px-4 py-2"
              >
                <span className="text-sm text-ink">{line.ingredientName}</span>
                <span className="text-xs text-muted tabular-nums">
                  {formatQuantity(line.expected, line.unit)} →{' '}
                  {formatQuantity(line.counted, line.unit)}
                </span>
                <span
                  className={cn(
                    'w-24 text-right text-sm font-medium tabular-nums',
                    line.variance < 0 ? 'text-danger-600' : 'text-brand-700',
                  )}
                >
                  {formatMoney(fromPaise(line.variancePaise))}
                </span>
              </li>
            ))}
          </ul>

          <CardBody className="border-t border-line">
            <p className="text-sm text-muted">
              Net difference{' '}
              <span
                className={cn(
                  'font-semibold tabular-nums',
                  net < 0 ? 'text-danger-600' : 'text-brand-700',
                )}
              >
                {formatMoney(fromPaise(net))}
              </span>
              . A negative figure means less was on the shelf than the books said.
            </p>
          </CardBody>
        </>
      )}
    </Card>
  );
}
