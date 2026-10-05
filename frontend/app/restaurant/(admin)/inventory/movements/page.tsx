'use client';

import { ArrowLeft, History, Lock } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { canBill } from '@/lib/permissions';
import { useStock, useStockMovements } from '@/lib/queries';
import type { InventoryMovement } from '@/lib/types';
import { Card, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { PageHeader } from '@/components/page-header';
import { LinkButton } from '@/components/inventory/link-button';
import {
  formatQuantity,
  fromPaise,
  isIncoming,
  MOVEMENT_LABELS,
  REASON_LABELS,
} from '@/components/inventory/stock-units';

/**
 * Every change to a stock figure, newest first.
 *
 * Append-only, and it matters that it looks that way: there is no edit and no
 * delete, so a mistake appears here next to the correction that fixed it rather
 * than being quietly replaced by it. When somebody asks where thirty kilos of
 * onions went, this is the answer.
 */
export default function StockMovementsPage() {
  const { session } = useAuth();
  const canSee = canBill(session?.user.role);

  const [ingredientId, setIngredientId] = useState<string>('');

  const stock = useStock(true);
  const movements = useStockMovements(
    ingredientId ? Number(ingredientId) : undefined,
    200,
  );

  if (!session) return null;

  if (!canSee) {
    return (
      <>
        <PageHeader title="Stock history" />
        <EmptyState
          icon={Lock}
          title="Stock history is for owners and managers"
          description="It shows what the restaurant bought and what it cost."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Stock history"
        description="Every change to a stock figure, and what caused it. Nothing here can be edited or deleted."
        action={
          <LinkButton href="/restaurant/inventory">
            <ArrowLeft className="size-4" aria-hidden />
            Back to stock
          </LinkButton>
        }
      />

      <Card>
        <CardHeader
          title="Movements"
          description="The most recent 200."
          action={
            <SelectField
              label="Ingredient"
              value={ingredientId}
              onChange={(event) => setIngredientId(event.target.value)}
              className="w-56"
            >
              <option value="">All ingredients</option>
              {(stock.data ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </SelectField>
          }
        />

        {movements.isError ? (
          <ErrorState error={movements.error} onRetry={() => void movements.refetch()} />
        ) : movements.isPending ? (
          <TableSkeleton rows={6} />
        ) : movements.data.length === 0 ? (
          <EmptyState
            icon={History}
            compact
            title="Nothing recorded yet"
            description="Deliveries, wastage, corrections and the ingredients used by settled bills all appear here."
          />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {movements.data.map((movement) => (
              <MovementRow key={movement.id} movement={movement} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

function MovementRow({ movement }: { movement: InventoryMovement }) {
  const incoming = isIncoming(movement.movementType);
  const value = Number(movement.valuePaise);

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">
            {movement.ingredient?.name ?? `Ingredient ${movement.ingredientId}`}
          </span>
          <span className="text-xs text-muted">{MOVEMENT_LABELS[movement.movementType]}</span>
          {movement.referenceType === 'ORDER' && movement.referenceId !== null && (
            <span className="text-xs text-muted">· bill {movement.referenceId}</span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {when(movement.createdAt)}
          {movement.reason ? ` · ${REASON_LABELS[movement.reason]}` : ''}
          {movement.note ? ` · ${movement.note}` : ''}
        </p>
      </div>

      <div className="text-right">
        <p
          className={cn(
            'text-sm font-semibold tabular-nums',
            incoming ? 'text-brand-700' : 'text-danger-600',
          )}
        >
          {incoming ? '+' : '−'}
          {formatQuantity(movement.quantity, movement.unit)}
        </p>
        <p className="text-xs text-muted tabular-nums">
          {/* Both ends, so the chain reads without arithmetic. */}
          {formatQuantity(movement.quantityBefore, movement.unit)} →{' '}
          {formatQuantity(movement.quantityAfter, movement.unit)}
        </p>
      </div>

      {value > 0 && (
        <span className="w-20 text-right text-xs text-muted tabular-nums">
          {formatMoney(fromPaise(value))}
        </span>
      )}
    </li>
  );
}
