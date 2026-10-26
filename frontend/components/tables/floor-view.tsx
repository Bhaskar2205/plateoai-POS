'use client';

import { Armchair, ChefHat, CircleDot, Clock, Printer, Receipt, ShoppingBag } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { formatMoney, formatTime } from '@/lib/format';
import { printBill, printKotTicket } from '@/lib/print-receipt';
import { fetchBill, useCreateOrder, useFloor, useOrders, useSendToKitchen } from '@/lib/queries';
import type { Order, TableOrderSummary } from '@/lib/types';
import { DishPicker } from '@/components/orders/dish-picker';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';

/**
 * The floor, as a till operator reads it.
 *
 * Deliberately shaped like the table screen restaurants already use: a grid of
 * tiles, one per table, each showing how long the table has been running, what it
 * owes and the one or two actions worth taking from here. Everything else happens
 * on the bill screen, one tap away.
 *
 * The colours are the important part, so they are derived from real state rather
 * than decoration - see `tableState`. A tile's colour always answers "does this
 * table need me, and what for?".
 */

type FloorState =
  | 'INACTIVE'
  | 'FREE'
  | 'NEEDS_APPROVAL'
  | 'READY'
  | 'TO_SEND'
  | 'COOKING'
  | 'TO_BILL';

interface StateStyle {
  label: string;
  hint: string;
  /** Tile surface. */
  tile: string;
  /** The legend swatch and the tile's own status dot. */
  dot: string;
}

/**
 * Ordered by how much the table needs a human, most urgent first: an unconfirmed
 * diner request blocks the kitchen, food going cold beats food still cooking, and
 * a table that only owes money can wait for the others.
 */
const STATE_STYLES: Record<FloorState, StateStyle> = {
  NEEDS_APPROVAL: {
    label: 'New request',
    hint: 'A diner ordered from the QR menu and is waiting for you to confirm it.',
    tile: 'border-saffron-500 bg-saffron-50 hover:bg-saffron-100/70',
    dot: 'bg-saffron-500',
  },
  READY: {
    label: 'Ready to serve',
    hint: 'The kitchen has finished everything on this table’s last ticket.',
    tile: 'border-brand-500 bg-brand-50 hover:bg-brand-100/70',
    dot: 'bg-brand-500',
  },
  TO_SEND: {
    label: 'Not sent yet',
    hint: 'Items are on the bill but the kitchen has not been given them.',
    tile: 'border-info-500 bg-info-50 hover:bg-info-100',
    dot: 'bg-info-500',
  },
  COOKING: {
    label: 'In the kitchen',
    hint: 'A ticket is being cooked.',
    tile: 'border-warn-500 bg-warn-50 hover:bg-warn-50/70',
    dot: 'bg-warn-500',
  },
  TO_BILL: {
    label: 'Awaiting payment',
    hint: 'Everything is served. The next step is the bill.',
    tile: 'border-line bg-surface hover:bg-ground',
    dot: 'bg-muted',
  },
  FREE: {
    label: 'Free',
    hint: 'No bill open. Tap to start one.',
    tile: 'border-dashed border-line bg-ground/60 hover:bg-ground',
    dot: 'bg-line',
  },
  INACTIVE: {
    label: 'Switched off',
    hint: 'This table is not taking orders; its QR code shows as unavailable.',
    tile: 'border-dashed border-line bg-ground/40',
    dot: 'bg-line',
  },
};

/** The legend, in the same order staff should scan the floor. */
const LEGEND: FloorState[] = ['NEEDS_APPROVAL', 'READY', 'TO_SEND', 'COOKING', 'TO_BILL', 'FREE'];

export function tableState(table: TableOrderSummary): FloorState {
  if (table.orderId === null) return table.isActive ? 'FREE' : 'INACTIVE';
  if (table.pendingApprovalCount > 0) return 'NEEDS_APPROVAL';
  if (table.kitchenState === 'READY') return 'READY';
  if (table.unsentItemCount > 0) return 'TO_SEND';
  if (table.kitchenState === 'COOKING') return 'COOKING';

  return 'TO_BILL';
}

/** Whole minutes since the bill was opened - what a POS shows as "26 Min". */
function minutesSince(openedAt: string | null): number | null {
  if (!openedAt) return null;

  return Math.max(0, Math.floor((Date.now() - new Date(openedAt).getTime()) / 60_000));
}

export function FloorView() {
  const floor = useFloor();
  const orders = useOrders();
  const router = useRouter();
  const toast = useToast();

  const [startingAt, setStartingAt] = useState<TableOrderSummary | null>(null);
  const [counterBill, setCounterBill] = useState(false);
  const [busyTableId, setBusyTableId] = useState<number | null>(null);

  const createOrder = useCreateOrder({
    onSuccess: (order) => {
      setStartingAt(null);
      setCounterBill(false);
      toast.success(`Bill #${order.orderNumber} opened.`);
      router.push(`/restaurant/orders/${order.id}` as Route);
    },
    onError: (error) => toast.error(error),
  });

  const sendToKitchen = useSendToKitchen({
    onSuccess: async (ticket) => {
      toast.success(`KOT #${ticket.ticketNumber} sent to the kitchen.`);
      try {
        await printKotTicket(ticket);
      } catch (error) {
        toast.error(error, 'The ticket was sent, but printing failed.');
      }
    },
    onError: (error) => toast.error(error),
    onSettled: () => setBusyTableId(null),
  });

  const print = async (table: TableOrderSummary) => {
    if (table.orderId === null) return;

    setBusyTableId(table.tableId);
    try {
      await printBill(await fetchBill(table.orderId));
    } catch (error) {
      toast.error(error, 'Could not print the bill.');
    } finally {
      setBusyTableId(null);
    }
  };

  const openBills = (orders.data ?? []).filter((order) => order.status === 'OPEN');
  const closedToday = (orders.data ?? []).filter((order) => order.status !== 'OPEN');
  const counts = (floor.data ?? []).reduce<Partial<Record<FloorState, number>>>((tally, table) => {
    const state = tableState(table);

    return { ...tally, [state]: (tally[state] ?? 0) + 1 };
  }, {});

  if (floor.isError) {
    return (
      <Card>
        <CardBody>
          <ErrorState error={floor.error} onRetry={() => void floor.refetch()} />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Legend counts={counts} />

        <Button variant="secondary" size="sm" onClick={() => setCounterBill(true)}>
          <ShoppingBag className="size-4" aria-hidden />
          Counter / takeaway bill
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start">
        <Card>
          <CardBody>
            {floor.isPending ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((cell) => (
                  <Skeleton key={cell} className="h-28 w-full" />
                ))}
              </div>
            ) : (floor.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon={Armchair}
                title="No tables yet"
                description="Add your tables in Setup. Each one gets its own QR code for diners to scan."
              />
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                {floor.data?.map((table) => (
                  <li key={table.tableId}>
                    <TableTile
                      table={table}
                      busy={busyTableId === table.tableId}
                      onOpen={() =>
                        table.orderId === null
                          ? setStartingAt(table)
                          : router.push(`/restaurant/orders/${table.orderId}` as Route)
                      }
                      onSendKot={() => {
                        if (table.orderId === null) return;
                        setBusyTableId(table.tableId);
                        sendToKitchen.mutate(table.orderId);
                      }}
                      onPrint={() => void print(table)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <OrderRail
            title="Running bills"
            empty="No bill is open right now."
            orders={openBills}
            onOpen={(order) => router.push(`/restaurant/orders/${order.id}` as Route)}
          />
          <OrderRail
            title="Closed today"
            empty="Nothing settled yet today."
            orders={closedToday}
            onOpen={(order) => router.push(`/restaurant/orders/${order.id}` as Route)}
            closed
          />
        </div>
      </div>

      <Modal
        // Full size: this is the screen staff work in all service, not a form
        // they fill in once. See DishPicker.
        size="full"
        open={startingAt !== null || counterBill}
        title={startingAt ? `Open a bill for ${startingAt.tableName}` : 'Counter / takeaway bill'}
        description={
          startingAt
            ? 'Punch what they ordered. You can add more at any time.'
            : 'A bill with no table, for a walk-in or a parcel.'
        }
        onClose={() => {
          setStartingAt(null);
          setCounterBill(false);
        }}
      >
        <DishPicker
          submitLabel="Open bill"
          submitting={createOrder.isPending}
          onSubmit={(items) =>
            createOrder.mutate({
              ...(startingAt ? { tableId: startingAt.tableId } : {}),
              items,
            })
          }
        />
      </Modal>
    </div>
  );
}

function Legend({ counts }: { counts: Partial<Record<FloorState, number>> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {LEGEND.map((state) => {
        const style = STATE_STYLES[state];

        return (
          <li key={state} className="flex items-center gap-1.5" title={style.hint}>
            <span aria-hidden className={cn('size-2.5 rounded-full', style.dot)} />
            <span className="text-xs text-muted">
              {style.label}
              {counts[state] ? (
                <span className="ml-1 font-semibold text-ink tabular-nums">{counts[state]}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function TableTile({
  table,
  busy,
  onOpen,
  onSendKot,
  onPrint,
}: {
  table: TableOrderSummary;
  busy: boolean;
  onOpen: () => void;
  onSendKot: () => void;
  onPrint: () => void;
}) {
  const state = tableState(table);
  const style = STATE_STYLES[state];
  const minutes = minutesSince(table.openedAt);
  const occupied = table.orderId !== null;

  return (
    <article
      className={cn(
        'flex h-full min-h-28 flex-col rounded-xl border-2 transition-colors',
        style.tile,
        state === 'INACTIVE' && 'opacity-60',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={state === 'INACTIVE'}
        aria-label={
          occupied
            ? `Open bill #${table.orderNumber} for ${table.tableName}, ${formatMoney(table.total)}`
            : `Start a bill for ${table.tableName}`
        }
        className="flex flex-1 flex-col items-center justify-center gap-0.5 px-2 py-3 text-center focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-none disabled:cursor-not-allowed"
      >
        {occupied && minutes !== null && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted">
            <Clock className="size-3" aria-hidden />
            {minutes} Min
          </span>
        )}

        <span className="line-clamp-2 text-sm font-bold text-ink">{table.tableName}</span>

        {occupied ? (
          <span className="text-sm font-semibold text-ink tabular-nums">
            {formatMoney(table.total)}
          </span>
        ) : (
          <span className="text-[11px] text-muted">
            {state === 'INACTIVE' ? 'Switched off' : 'Tap to start'}
          </span>
        )}

        {table.pendingApprovalCount > 0 && (
          <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-saffron-500 px-2 py-0.5 text-[10px] font-bold text-white">
            <CircleDot className="size-3 animate-pulse" aria-hidden />
            {table.pendingApprovalCount} to approve
          </span>
        )}

        {occupied && table.pendingApprovalCount === 0 && (
          <span className="text-[10px] font-medium text-muted">
            #{table.orderNumber} · {style.label}
          </span>
        )}
      </button>

      {occupied && (
        <div className="flex items-center justify-center gap-1.5 border-t border-black/5 px-2 py-1.5">
          {table.unsentItemCount > 0 && (
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={onSendKot}
              aria-label={`Send ${table.unsentItemCount} item(s) from ${table.tableName} to the kitchen`}
              title="Send to kitchen and print the KOT"
            >
              {!busy && <ChefHat className="size-4" aria-hidden />}
              KOT
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onPrint}
            aria-label={`Print the bill for ${table.tableName}`}
            title="Print bill"
          >
            <Printer className="size-4" aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpen}
            aria-label={`Open bill for ${table.tableName}`}
            title="Open bill"
          >
            <Receipt className="size-4" aria-hidden />
          </Button>
        </div>
      )}
    </article>
  );
}

/** The running-order list every POS keeps down one side. */
function OrderRail({
  title,
  empty,
  orders,
  onOpen,
  closed = false,
}: {
  title: string;
  empty: string;
  orders: Order[];
  onOpen: (order: Order) => void;
  closed?: boolean;
}) {
  return (
    <Card>
      <CardHeader title={title} />
      {orders.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">{empty}</p>
        </CardBody>
      ) : (
        <ul className="max-h-80 divide-y divide-line overflow-y-auto">
          {orders.map((order) => (
            <li key={order.id}>
              <button
                type="button"
                onClick={() => onOpen(order)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ground focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-none"
              >
                <span className="w-12 shrink-0 text-xs font-semibold text-muted tabular-nums">
                  #{order.orderNumber}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {order.tableName ?? 'Counter'}
                  {closed && order.settledAt && (
                    <span className="block text-xs text-muted">{formatTime(order.settledAt)}</span>
                  )}
                </span>
                <span className="shrink-0 text-sm font-semibold text-ink tabular-nums">
                  {formatMoney(order.total)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
