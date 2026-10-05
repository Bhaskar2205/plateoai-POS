'use client';

import {
  ArrowDownRight,
  ClipboardCheck,
  History,
  Lock,
  Package,
  Plus,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { canBill, canManageTables } from '@/lib/permissions';
import { useInventorySettings, useSaveInventorySettings, useStock } from '@/lib/queries';
import type { Ingredient } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { TextField } from '@/components/ui/field';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { LinkButton } from '@/components/inventory/link-button';
import {
  AddStockDialog,
  AdjustStockDialog,
  WastageDialog,
} from '@/components/inventory/stock-dialogs';
import {
  CATEGORY_LABELS,
  formatQuantity,
  fromPaise,
  stockLevel,
  UNIT_LABELS,
  type StockLevel,
} from '@/components/inventory/stock-units';

/**
 * What is on the shelves.
 *
 * One table, and three buttons per row: stock arrived, stock was wasted, the
 * figure is wrong. That is the whole of what a restaurant does to inventory day
 * to day, and anything more elaborate would be a form nobody fills in during
 * service.
 *
 * Nothing here sets a quantity to a number. Every button records a change of a
 * size, which is both what keeps the ledger complete and what stops two people
 * on two tills overwriting each other.
 */

const LEVEL_BADGE: Record<StockLevel, { tone: 'neutral' | 'success' | 'danger' | 'warn'; label: string }> = {
  OUT: { tone: 'danger', label: 'Out of stock' },
  LOW: { tone: 'warn', label: 'Running low' },
  OK: { tone: 'success', label: 'In stock' },
  UNTRACKED: { tone: 'neutral', label: 'No minimum set' },
};

export default function InventoryPage() {
  const { session } = useAuth();
  const canSee = canBill(session?.user.role);
  const isOwner = canManageTables(session?.user.role);

  const stock = useStock();
  const settings = useInventorySettings(canSee);

  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<Ingredient | null>(null);
  const [wasting, setWasting] = useState<Ingredient | null>(null);
  const [adjusting, setAdjusting] = useState<Ingredient | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = stock.data ?? [];

    return term ? all.filter((row) => row.name.toLowerCase().includes(term)) : all;
  }, [stock.data, search]);

  const summary = useMemo(() => {
    const all = stock.data ?? [];

    return {
      out: all.filter((row) => stockLevel(row.currentQuantity, row.minimumQuantity) === 'OUT').length,
      low: all.filter((row) => stockLevel(row.currentQuantity, row.minimumQuantity) === 'LOW').length,
      valuePaise: all.reduce(
        (sum, row) => sum + Math.round(row.currentQuantity * Number(row.costPerUnitPaise)),
        0,
      ),
    };
  }, [stock.data]);

  if (!session) return null;

  if (!canSee) {
    return (
      <>
        <PageHeader title="Inventory" description="What is on the shelves." />
        <EmptyState
          icon={Lock}
          title="Inventory is for owners and managers"
          description="It shows what the restaurant owns and what it cost, so it is limited to the people who order the stock."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Inventory"
        description="What is on the shelves, what is running out, and where it went."
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/restaurant/inventory/movements">
              <History className="size-4" aria-hidden />
              History
            </LinkButton>
            <LinkButton href="/restaurant/inventory/count">
              <ClipboardCheck className="size-4" aria-hidden />
              Count stock
            </LinkButton>
          </div>
        }
      />

      {settings.data && settings.data.mode === 'DISABLED' && (
        <TrackingOffNotice canTurnOn={isOwner} />
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <SummaryTile
          label="Out of stock"
          value={String(summary.out)}
          tone={summary.out > 0 ? 'danger' : 'neutral'}
        />
        <SummaryTile
          label="Running low"
          value={String(summary.low)}
          tone={summary.low > 0 ? 'warn' : 'neutral'}
        />
        <SummaryTile label="Value on the shelf" value={formatMoney(fromPaise(summary.valuePaise))} />
      </div>

      <Card>
        <CardHeader
          title="Stock"
          description="Every ingredient you are tracking. Add new ones from the Ingredients screen."
          action={
            <TextField
              label="Search"
              placeholder="Find an ingredient"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-48"
            />
          }
        />

        {stock.isError ? (
          <ErrorState error={stock.error} onRetry={() => void stock.refetch()} />
        ) : stock.isPending ? (
          <TableSkeleton rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Package}
            compact
            title={search ? 'Nothing matches that' : 'No ingredients yet'}
            description={
              search
                ? 'Try a shorter search.'
                : 'Add your ingredients first, then record what you have on the shelf.'
            }
            action={
              search ? undefined : (
                <LinkButton href="/restaurant/menu/ingredients?new=1">
                  Add an ingredient
                </LinkButton>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {rows.map((row) => (
              <StockRow
                key={row.id}
                row={row}
                onAdd={() => setAdding(row)}
                onWaste={() => setWasting(row)}
                onAdjust={() => setAdjusting(row)}
              />
            ))}
          </ul>
        )}
      </Card>

      <AddStockDialog ingredient={adding} onClose={() => setAdding(null)} />
      <WastageDialog ingredient={wasting} onClose={() => setWasting(null)} />
      <AdjustStockDialog ingredient={adjusting} onClose={() => setAdjusting(null)} />
    </>
  );
}

function SummaryTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'warn' | 'danger';
}) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs text-muted">{label}</p>
        <p
          className={cn(
            'mt-1 text-2xl font-semibold tabular-nums',
            tone === 'danger' && 'text-danger-600',
            tone === 'warn' && 'text-warn-600',
            tone === 'neutral' && 'text-ink',
          )}
        >
          {value}
        </p>
      </CardBody>
    </Card>
  );
}

/**
 * Tracking is off until somebody turns it on, and that is the default for every
 * restaurant. Said plainly here, because stock figures that never change are
 * otherwise a mystery rather than a setting.
 */
function TrackingOffNotice({ canTurnOn }: { canTurnOn: boolean }) {
  const toast = useToast();
  const save = useSaveInventorySettings({
    onSuccess: () => toast.success('Stock will now be deducted when a bill is settled.'),
    onError: (error) => toast.error(error),
  });

  return (
    <Card className="mb-4 border-warn-500/30">
      <CardBody className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-3">
          <TriangleAlert className="size-5 shrink-0 text-warn-600" aria-hidden />
          <div>
            <p className="text-sm font-medium text-ink">Stock is not being deducted yet</p>
            <p className="mt-0.5 text-sm text-muted">
              You can record what you have and what you throw away, but selling a dish will not take
              its ingredients off the shelf until you turn tracking on. Billing is unaffected either
              way.
            </p>
          </div>
        </div>

        {canTurnOn && (
          <Button
            loading={save.isPending}
            onClick={() => save.mutate({ inventoryMode: 'TRACKING' })}
          >
            Turn on tracking
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

function StockRow({
  row,
  onAdd,
  onWaste,
  onAdjust,
}: {
  row: Ingredient;
  onAdd: () => void;
  onWaste: () => void;
  onAdjust: () => void;
}) {
  const level = stockLevel(row.currentQuantity, row.minimumQuantity);
  const badge = LEVEL_BADGE[level];
  const cost = Number(row.costPerUnitPaise);

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">{row.name}</span>
          <Badge tone={badge.tone} dot>
            {badge.label}
          </Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {CATEGORY_LABELS[row.category]}
          {row.minimumQuantity > 0 &&
            ` · warn below ${formatQuantity(row.minimumQuantity, row.unit)}`}
          {cost > 0 && ` · ${formatMoney(fromPaise(cost))} per ${UNIT_LABELS[row.unit]}`}
        </p>
      </div>

      <div className="text-right">
        <p
          className={cn(
            'text-sm font-semibold tabular-nums',
            level === 'OUT' ? 'text-danger-600' : level === 'LOW' ? 'text-warn-600' : 'text-ink',
          )}
        >
          {formatQuantity(row.currentQuantity, row.unit)}
        </p>
        {cost > 0 && (
          <p className="text-xs text-muted tabular-nums">
            {formatMoney(fromPaise(Math.round(row.currentQuantity * cost)))}
          </p>
        )}
      </div>

      <div className="flex gap-1">
        <Button size="sm" variant="secondary" onClick={onAdd} title="Record a delivery">
          <Plus className="size-4" aria-hidden />
          <span className="sr-only sm:not-sr-only">Add</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={onWaste} title="Record wastage">
          <Trash2 className="size-4" aria-hidden />
          <span className="sr-only">Record wastage</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={onAdjust} title="Correct the figure">
          <SlidersHorizontal className="size-4" aria-hidden />
          <span className="sr-only">Correct the figure</span>
        </Button>
      </div>
    </li>
  );
}
