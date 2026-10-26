'use client';

import { useRouter } from 'next/navigation';
import {
  BadgePercent,
  Ban,
  Check,
  ChefHat,
  Clock,
  Gift,
  Landmark,
  LayoutGrid,
  Minus,
  Plus,
  Printer,
  QrCode,
  Receipt,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { newIdempotencyKey } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoney, formatTime } from '@/lib/format';
import { MAX_DISCOUNT_PERCENT } from '@/lib/permissions';
import { printBill, printKotTicket } from '@/lib/print-receipt';
import {
  fetchBill,
  fetchKotTicket,
  useAddOrderItems,
  useApplyDiscount,
  useApproveOrderItems,
  useCancelOrder,
  useCancelOrderItem,
  useClearOrderNc,
  useDeleteNcOrder,
  useCompOrderItem,
  useMarkOrderNc,
  useUncompOrderItem,
  useRemoveDiscount,
  useSendToKitchen,
  useSetTds,
  useSettleOrder,
  useUpdateOrderItem,
  type OrderItemInput,
} from '@/lib/queries';
import type { DiscountType, Order, OrderItem, PaymentMethod } from '@/lib/types';
import { DishPicker } from '@/components/orders/dish-picker';
import { ItemPunchRow } from '@/components/orders/item-punch-row';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectField, TextField } from '@/components/ui/field';
import { ConfirmDialog, Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
  { value: 'OTHER', label: 'Other' },
];

/**
 * One table's bill, laid out the way a till is: punch row at the top, the running
 * order under it, money and actions down the side.
 *
 * Staff who have used a restaurant POS should be able to work this without being
 * taught: type a dish, press Enter, press Enter again, send the KOT, settle. The
 * QR-specific part - diner requests waiting for approval - sits above the order,
 * because it is the one thing here that is new to them and it blocks the kitchen
 * until someone deals with it.
 *
 * `canBill` comes from the signed-in role and hides discounting, settling and
 * voiding from waiters. The API enforces the same rule; this only keeps a waiter
 * from tapping a button that would fail.
 */
export function OrderPanel({
  order,
  canBill,
  canDeleteNc = false,
}: {
  order: Order;
  canBill: boolean;
  /** Owners only. Erasing a bill is the one thing a manager may not do. */
  canDeleteNc?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [discounting, setDiscounting] = useState(false);
  const [settling, setSettling] = useState(false);
  // Fixed when the dialog opens, so a double-click sends the same key and the
  // API answers the second press with the first one's result.
  const [settleKey, setSettleKey] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [recordingTds, setRecordingTds] = useState(false);
  const [cancellingItem, setCancellingItem] = useState<OrderItem | null>(null);
  const [compingItem, setCompingItem] = useState<OrderItem | null>(null);
  const [markingNc, setMarkingNc] = useState(false);
  const [deletingNc, setDeletingNc] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  const addItems = useAddOrderItems({
    onSuccess: () => toast.success('Added to the bill.'),
    onError: (error) => toast.error(error),
  });

  const approve = useApproveOrderItems({
    onSuccess: () => toast.success('Approved. Send it to the kitchen when you are ready.'),
    onError: (error) => toast.error(error),
  });

  const updateItem = useUpdateOrderItem({ onError: (error) => toast.error(error) });

  const compItem = useCompOrderItem({
    onSuccess: () => {
      setCompingItem(null);
      toast.success('Line comped. It still comes out of stock.');
    },
    onError: (error) => toast.error(error),
  });

  const uncompItem = useUncompOrderItem({
    onSuccess: () => toast.success('Back on the bill.'),
    onError: (error) => toast.error(error),
  });

  const markNc = useMarkOrderNc({
    onSuccess: () => {
      setMarkingNc(false);
      toast.success('Marked no charge.');
    },
    onError: (error) => toast.error(error),
  });

  const clearNc = useClearOrderNc({
    onSuccess: () => toast.success('Back to a normal bill.'),
    onError: (error) => toast.error(error),
  });

  const deleteNc = useDeleteNcOrder({
    onSuccess: () => {
      toast.success('Bill deleted. Stock was left as it was.');
      router.push('/restaurant/orders');
    },
    onError: (error) => toast.error(error),
  });

  const cancelItem = useCancelOrderItem({
    onSuccess: () => {
      setCancellingItem(null);
      toast.success('Line cancelled.');
    },
    onError: (error) => toast.error(error),
  });

  const sendToKitchen = useSendToKitchen({
    onSuccess: async (ticket) => {
      toast.success(`KOT #${ticket.ticketNumber} sent to the kitchen.`);

      try {
        await printKotTicket(ticket);
      } catch (error) {
        // The ticket is already with the kitchen panel; only the paper failed.
        toast.error(error, 'The ticket was sent, but printing failed.');
      }
    },
    onError: (error) => toast.error(error),
  });

  const applyDiscount = useApplyDiscount({
    onSuccess: () => {
      setDiscounting(false);
      toast.success('Discount applied.');
    },
    onError: (error) => toast.error(error),
  });

  const removeDiscount = useRemoveDiscount({
    onSuccess: () => toast.success('Discount removed.'),
    onError: (error) => toast.error(error),
  });

  const settle = useSettleOrder({
    // Settling is a money action, printing is a paper action. Tying them together
    // meant every settled bill opened a print dialog someone had to dismiss, and
    // a table that pays by UPI and wants no paper is the common case. Print stays
    // available on the settled bill for whoever actually wants it.
    onSuccess: (settled) => {
      setSettling(false);
      toast.success(`Bill #${settled.orderNumber} settled.`);
    },
    onError: (error) => toast.error(error),
  });

  const setTds = useSetTds({
    onSuccess: (updated) => {
      setRecordingTds(false);
      toast.success(
        updated.tdsRate === null
          ? 'TDS removed from this bill.'
          : `TDS recorded at ${updated.tdsRate}%.`,
      );
    },
    onError: (error) => toast.error(error),
  });

  const voidOrder = useCancelOrder({
    onSuccess: () => {
      setVoiding(false);
      toast.success('Bill voided.');
    },
    onError: (error) => toast.error(error),
  });

  const print = async () => {
    try {
      await printBill(await fetchBill(order.id));
    } catch (error) {
      toast.error(error, 'Could not print the bill.');
    }
  };

  const reprintKot = async (ticketId: number) => {
    try {
      await printKotTicket(await fetchKotTicket(order.id, ticketId));
    } catch (error) {
      toast.error(error, 'Could not print the ticket.');
    }
  };

  const punch = (item: OrderItemInput) => addItems.mutate({ orderId: order.id, items: [item] });

  // The same board the floor uses to open a bill. Typing is faster once you
  // know the menu by heart; tapping through sections is what everybody else
  // does, and adding to a running bill needs both.
  const punchMany = (items: OrderItemInput[]) => {
    addItems.mutate({ orderId: order.id, items });
    setBrowsing(false);
  };

  const isOpen = order.status === 'OPEN';
  const pending = order.items.filter((item) => item.awaitingApproval);
  const live = order.items.filter((item) => item.status !== 'CANCELLED' && !item.awaitingApproval);
  const cancelled = order.items.filter((item) => item.status === 'CANCELLED');
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60_000));

  return (
    <div className="space-y-4">
      {order.isNonChargeable && (
        <div className="rounded-xl border border-brand-500/30 bg-brand-50 px-4 py-3">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-brand-700">
            <Gift className="size-4 shrink-0" aria-hidden />
            No charge{order.ncFor ? ` — ${order.ncFor}` : ''}
          </p>
          {order.ncReason && <p className="mt-0.5 text-xs text-brand-700/80">{order.ncReason}</p>}
          <p className="mt-1 text-xs text-brand-700/70">
            Not counted in sales. The food still came out of stock.
          </p>

          {/* Only once it is closed: deleting a running bill would strand the
              table it is sitting on. */}
          {canDeleteNc && order.status === 'SETTLED' && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-2"
              loading={deleteNc.isPending}
              onClick={() => setDeletingNc(true)}
            >
              <Trash2 className="size-4" aria-hidden />
              Delete this bill
            </Button>
          )}
        </div>
      )}

      <OrderStrip order={order} minutes={minutes} />

      {pending.length > 0 && (
        <Card className="border-saffron-500">
          <CardHeader
            title={`${pending.length} request${pending.length === 1 ? '' : 's'} from the table`}
            description="A diner sent these from the QR menu. The kitchen cannot see them until you approve them."
            action={
              isOpen ? (
                <Button
                  size="sm"
                  onClick={() => approve.mutate({ orderId: order.id })}
                  loading={approve.isPending}
                >
                  <Check className="size-4" aria-hidden />
                  Approve all
                </Button>
              ) : undefined
            }
          />
          <ul className="divide-y divide-line">
            {pending.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-5 py-3">
                <span className="text-sm font-semibold text-ink">{item.quantity}&times;</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                  {item.note && <p className="text-xs text-muted italic">{item.note}</p>}
                  <p className="text-xs text-muted">{formatMoney(item.lineTotal)}</p>
                </div>
                {isOpen && (
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => approve.mutate({ orderId: order.id, itemIds: [item.id] })}
                      loading={approve.isPending}
                    >
                      <Check className="size-4" aria-hidden />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Refuse ${item.name}`}
                      onClick={() => setCancellingItem(item)}
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="space-y-3">
          {isOpen && (
            <div className="space-y-2">
              <ItemPunchRow onAdd={punch} adding={addItems.isPending} />
              <Button variant="secondary" className="w-full" onClick={() => setBrowsing(true)}>
                <LayoutGrid className="size-4" aria-hidden />
                Browse the menu by section
              </Button>
            </div>
          )}

          <Card>
            <div className="hidden border-b border-line bg-ground px-4 py-2 text-xs font-semibold tracking-wide text-muted uppercase sm:grid sm:grid-cols-[minmax(0,1fr)_7.5rem_5.5rem_6rem_5rem] sm:gap-3">
              <span>Item</span>
              <span className="text-center">Qty</span>
              <span className="text-right">Price</span>
              <span className="text-right">Amount</span>
              <span />
            </div>

            {live.length === 0 && cancelled.length === 0 ? (
              <CardBody>
                <p className="text-sm text-muted">
                  Nothing on this bill yet. Punch the first item above.
                </p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-line">
                {[...live, ...cancelled].map((item) => (
                  <li
                    key={item.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_7.5rem_5.5rem_6rem_5rem]"
                  >
                    <div className="min-w-0">
                      <p
                        className={cn(
                          'truncate text-sm font-medium',
                          item.status === 'CANCELLED' || item.isNonChargeable
                            ? 'text-muted line-through'
                            : 'text-ink',
                        )}
                      >
                        {item.name}
                      </p>
                      {item.note && <p className="truncate text-xs text-muted italic">{item.note}</p>}
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <ItemStatusBadge item={item} />
                        {item.cancelledReason && <span>· {item.cancelledReason}</span>}
                      </p>
                    </div>

                    <div className="flex items-center justify-end gap-1 sm:justify-center">
                      {isOpen && item.editable ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`One fewer ${item.name}`}
                            disabled={item.quantity <= 1 || updateItem.isPending}
                            onClick={() =>
                              updateItem.mutate({
                                orderId: order.id,
                                itemId: item.id,
                                quantity: item.quantity - 1,
                              })
                            }
                          >
                            <Minus className="size-4" aria-hidden />
                          </Button>
                          <span className="w-6 text-center text-sm font-semibold text-ink tabular-nums">
                            {item.quantity}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`One more ${item.name}`}
                            disabled={item.quantity >= 99 || updateItem.isPending}
                            onClick={() =>
                              updateItem.mutate({
                                orderId: order.id,
                                itemId: item.id,
                                quantity: item.quantity + 1,
                              })
                            }
                          >
                            <Plus className="size-4" aria-hidden />
                          </Button>
                        </>
                      ) : (
                        <span className="text-sm font-semibold text-ink tabular-nums">
                          {item.quantity}
                        </span>
                      )}
                    </div>

                    <span className="hidden text-right text-sm text-muted tabular-nums sm:block">
                      {formatMoney(item.unitPrice)}
                    </span>

                    <span
                      className={cn(
                        'col-start-2 row-start-1 text-right text-sm font-semibold tabular-nums sm:col-auto sm:row-auto',
                        item.status === 'CANCELLED' || item.isNonChargeable
                          ? 'text-muted line-through'
                          : 'text-ink',
                      )}
                    >
                      {formatMoney(item.lineTotal)}
                    </span>

                    <div className="col-start-2 flex justify-end gap-1 sm:col-auto">
                      {isOpen && item.status !== 'CANCELLED' && canBill && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={
                            item.isNonChargeable ? `Charge for ${item.name}` : `Comp ${item.name}`
                          }
                          title={item.isNonChargeable ? 'Put it back on the bill' : 'No charge'}
                          onClick={() =>
                            item.isNonChargeable
                              ? uncompItem.mutate({ orderId: order.id, itemId: item.id })
                              : setCompingItem(item)
                          }
                        >
                          <Gift className={cn('size-4', item.isNonChargeable && 'text-brand-600')} aria-hidden />
                        </Button>
                      )}
                      {isOpen && item.status !== 'CANCELLED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Cancel ${item.name}`}
                          onClick={() => setCancellingItem(item)}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {order.kotTickets.length > 0 && (
            <Card>
              <CardHeader
                title="Kitchen tickets"
                description="Each round sent to the kitchen, newest last."
              />
              <ul className="divide-y divide-line">
                {order.kotTickets.map((ticket) => (
                  <li key={ticket.id} className="flex items-center gap-3 px-5 py-3">
                    <ChefHat className="size-4 shrink-0 text-muted" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">KOT #{ticket.ticketNumber}</p>
                      <p className="text-xs text-muted">
                        {ticket.itemCount} item(s) · {formatTime(ticket.createdAt)}
                        {ticket.printedAt ? ' · printed' : ' · not printed'}
                      </p>
                    </div>
                    <Badge
                      tone={
                        ticket.status === 'CANCELLED'
                          ? 'danger'
                          : ticket.status === 'DONE'
                            ? 'neutral'
                            : ticket.status === 'READY'
                              ? 'success'
                              : 'warn'
                      }
                    >
                      {ticket.status.toLowerCase()}
                    </Badge>
                    <Button size="sm" variant="ghost" onClick={() => void reprintKot(ticket.id)}>
                      <Printer className="size-4" aria-hidden />
                      Reprint
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card className="lg:sticky lg:top-4">
          <CardHeader title="Bill" />
          <CardBody className="space-y-3">
            <Row label={`Sub total (${order.items.filter((item) => item.status !== 'CANCELLED').length} items)`} value={formatMoney(order.subtotal)} />
            {order.discountAmount > 0 && (
              <Row
                label={order.discountReason ? `Discount · ${order.discountReason}` : 'Discount'}
                value={`-${formatMoney(order.discountAmount)}`}
                tone="discount"
              />
            )}
            {/* Each charge on its own line: a GST invoice has to show CGST and
                SGST separately, and a guest querying a service charge needs to
                see it apart from the tax. */}
            {order.charges.map((charge, index) => (
              <Row
                key={`${index}-${charge.kind}-${charge.name}`}
                label={`${charge.name} @ ${charge.rate}%`}
                value={formatMoney(charge.amount)}
              />
            ))}
            {order.charges.length === 0 && order.taxAmount > 0 && (
              <Row label={`Tax @ ${order.taxRate}%`} value={formatMoney(order.taxAmount)} />
            )}

            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <span className="text-sm font-semibold text-ink">Grand total</span>
              <span className="text-xl font-bold text-ink tabular-nums">
                {formatMoney(order.total)}
              </span>
            </div>

            {order.tdsAmount > 0 && (
              <div className="space-y-1 rounded-lg bg-info-50 px-3 py-2">
                <Row
                  label={`TDS withheld @ ${order.tdsRate}%`}
                  value={`- ${formatMoney(order.tdsAmount)}`}
                />
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-semibold text-info-700">To collect</span>
                  <span className="text-sm font-bold text-info-700 tabular-nums">
                    {formatMoney(order.amountPayable)}
                  </span>
                </div>
              </div>
            )}

            {order.status === 'SETTLED' && (
              <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
                Settled{order.settledAt ? ` at ${formatTime(order.settledAt)}` : ''}
                {order.paymentMethod ? ` · ${order.paymentMethod.toLowerCase()}` : ''}
              </p>
            )}
            {order.status === 'CANCELLED' && (
              <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-600">
                This bill was voided.
              </p>
            )}

            <div className="space-y-2 pt-1">
              {isOpen && (
                <Button
                  className="w-full"
                  disabled={order.unsentItemCount === 0}
                  loading={sendToKitchen.isPending}
                  onClick={() => sendToKitchen.mutate(order.id)}
                >
                  <ChefHat className="size-4" aria-hidden />
                  {order.unsentItemCount > 0
                    ? `Save & KOT (${order.unsentItemCount})`
                    : 'Nothing new to send'}
                </Button>
              )}

              <Button variant="secondary" className="w-full" onClick={() => void print()}>
                <Printer className="size-4" aria-hidden />
                Print bill
              </Button>

              {isOpen && canBill && (
                <>
                  {order.discountAmount > 0 ? (
                    <Button
                      variant="ghost"
                      className="w-full"
                      loading={removeDiscount.isPending}
                      onClick={() => removeDiscount.mutate(order.id)}
                    >
                      <X className="size-4" aria-hidden />
                      Remove discount
                    </Button>
                  ) : (
                    <Button variant="secondary" className="w-full" onClick={() => setDiscounting(true)}>
                      <BadgePercent className="size-4" aria-hidden />
                      Apply discount
                    </Button>
                  )}

                  <Button variant="secondary" className="w-full" onClick={() => setRecordingTds(true)}>
                    <Landmark className="size-4" aria-hidden />
                    {order.tdsRate === null ? 'Record TDS' : `TDS @ ${order.tdsRate}%`}
                  </Button>

                  {/* Separate from a discount on purpose. A discount is money off a
                      sale; this was never a sale, and an owner asking what the house
                      gave away wants the two kept apart. */}
                  {order.isNonChargeable ? (
                    <Button
                      variant="ghost"
                      className="w-full"
                      loading={clearNc.isPending}
                      onClick={() => clearNc.mutate({ orderId: order.id })}
                    >
                      <X className="size-4" aria-hidden />
                      Charge for this bill
                    </Button>
                  ) : (
                    <Button variant="secondary" className="w-full" onClick={() => setMarkingNc(true)}>
                      <Gift className="size-4" aria-hidden />
                      No charge (NC)
                    </Button>
                  )}

                  <Button
                    className="w-full"
                    onClick={() => {
                      setSettleKey(newIdempotencyKey());
                      setSettling(true);
                    }}
                  >
                    <Receipt className="size-4" aria-hidden />
                    Settle bill
                  </Button>

                  <Button variant="ghost" className="w-full" onClick={() => setVoiding(true)}>
                    <Ban className="size-4" aria-hidden />
                    Void bill
                  </Button>
                </>
              )}

              {isOpen && !canBill && (
                <p className="text-xs text-muted">
                  Discounts and payment are handled by a manager or the owner.
                </p>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      <Modal
        size="full"
        open={browsing}
        title={`Add to ${order.tableName ?? 'this bill'}`}
        description="Tap through the sections. Everything you pick is added at once."
        onClose={() => setBrowsing(false)}
      >
        <DishPicker submitLabel="Add to bill" submitting={addItems.isPending} onSubmit={punchMany} />
      </Modal>

      <DiscountDialog
        open={discounting}
        submitting={applyDiscount.isPending}
        onClose={() => setDiscounting(false)}
        onSubmit={(values) => applyDiscount.mutate({ orderId: order.id, ...values })}
      />

      <TdsDialog
        open={recordingTds}
        currentRate={order.tdsRate}
        submitting={setTds.isPending}
        onClose={() => setRecordingTds(false)}
        onSubmit={(rate) => setTds.mutate({ orderId: order.id, rate })}
      />

      <SettleDialog
        open={settling}
        total={order.total}
        submitting={settle.isPending}
        onClose={() => setSettling(false)}
        onSubmit={(paymentMethod) =>
          settle.mutate({ orderId: order.id, paymentMethod, idempotencyKey: settleKey ?? undefined })
        }
      />

      <VoidDialog
        open={voiding}
        submitting={voidOrder.isPending}
        onClose={() => setVoiding(false)}
        onSubmit={(reason) => voidOrder.mutate({ orderId: order.id, reason })}
      />

      <ConfirmDialog
        open={deletingNc}
        title="Delete this bill for good?"
        message="It is removed from Plateo entirely and cannot be brought back. Stock is left exactly as it is, because that food was eaten. The activity log keeps a record that you deleted it."
        confirmLabel="Delete permanently"
        loading={deleteNc.isPending}
        onCancel={() => setDeletingNc(false)}
        onConfirm={() => deleteNc.mutate({ orderId: order.id })}
      />

      <CompItemDialog
        item={compingItem}
        submitting={compItem.isPending}
        onClose={() => setCompingItem(null)}
        onSubmit={(reason) =>
          compingItem && compItem.mutate({ orderId: order.id, itemId: compingItem.id, reason })
        }
      />

      <MarkNcDialog
        open={markingNc}
        total={order.amountPayable}
        submitting={markNc.isPending}
        onClose={() => setMarkingNc(false)}
        onSubmit={(forWhom, reason) => markNc.mutate({ orderId: order.id, forWhom, reason })}
      />

      <CancelItemDialog
        item={cancellingItem}
        submitting={cancelItem.isPending}
        onClose={() => setCancellingItem(null)}
        onSubmit={(reason) =>
          cancellingItem &&
          cancelItem.mutate({ orderId: order.id, itemId: cancellingItem.id, reason })
        }
      />
    </div>
  );
}

/** The header strip every POS bill screen has: who, where, how long, how far along. */
function OrderStrip({ order, minutes }: { order: Order; minutes: number }) {
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Order type</p>
          <p className="text-sm font-semibold text-ink">
            {order.tableId === null ? 'Counter / takeaway' : 'Dine in'}
          </p>
        </div>

        <div>
          <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Table</p>
          <p className="text-sm font-semibold text-ink">{order.tableName ?? '—'}</p>
        </div>

        <div>
          <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Bill no.</p>
          <p className="text-sm font-semibold text-ink tabular-nums">#{order.orderNumber}</p>
        </div>

        <div>
          <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Running</p>
          <p className="inline-flex items-center gap-1 text-sm font-semibold text-ink">
            <Clock className="size-3.5 text-muted" aria-hidden />
            {minutes} Min
            <span className="font-normal text-muted">· from {formatTime(order.createdAt)}</span>
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {order.source === 'DINER_QR' && (
            <Badge tone="warn">
              <QrCode className="size-3.5" aria-hidden />
              Started from QR
            </Badge>
          )}
          <Badge
            tone={
              order.status === 'OPEN' ? 'success' : order.status === 'SETTLED' ? 'neutral' : 'danger'
            }
            dot
          >
            {order.status === 'OPEN' ? 'Running' : order.status === 'SETTLED' ? 'Settled' : 'Voided'}
          </Badge>
        </div>
      </CardBody>
    </Card>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'discount' }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-sm text-muted">{label}</span>
      <span className={cn('text-sm tabular-nums', tone === 'discount' ? 'text-brand-700' : 'text-ink')}>
        {value}
      </span>
    </div>
  );
}

function ItemStatusBadge({ item }: { item: OrderItem }) {
  if (item.status === 'CANCELLED') return <Badge tone="danger">cancelled</Badge>;
  if (item.awaitingApproval) return <Badge tone="warn">needs approval</Badge>;
  if (item.kotTicketId === null) return <Badge tone="neutral">not sent</Badge>;
  if (item.status === 'READY') return <Badge tone="success">ready</Badge>;
  if (item.status === 'SERVED') return <Badge tone="neutral">served</Badge>;
  if (item.status === 'PREPARING') return <Badge tone="warn">cooking</Badge>;

  return <Badge tone="neutral">with kitchen</Badge>;
}

/**
 * Records income tax a corporate payer withholds from this bill.
 *
 * Worth being explicit about, because it is not a charge to the guest: the payer
 * deducts it and pays it to the department, so the restaurant collects less than
 * the bill says while still owing the same GST. A waiter never sees this - it is
 * part of settling, which is an owner or manager job.
 */
function TdsDialog({
  open,
  currentRate,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  currentRate: number | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (rate: number | null) => void;
}) {
  const [rate, setRate] = useState(String(currentRate ?? 2));

  const numeric = Number(rate);
  const valid = Number.isFinite(numeric) && numeric >= 0 && numeric <= 30;

  return (
    <Modal
      open={open}
      title="Record TDS withheld"
      description="For a bill a company settles and deducts tax from. It does not change the GST owed."
      onClose={onClose}
      footer={
        <>
          {currentRate !== null && (
            <Button variant="ghost" onClick={() => onSubmit(null)} disabled={submitting}>
              Remove
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button loading={submitting} disabled={!valid} onClick={() => onSubmit(numeric)}>
            <Check className="size-4" aria-hidden />
            Record
          </Button>
        </>
      }
    >
      <label className="block">
        <span className="text-sm font-medium text-ink">Rate withheld (%)</span>
        <input
          type="number"
          step="0.01"
          min="0"
          max="30"
          value={rate}
          onChange={(event) => setRate(event.target.value)}
          className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-right text-sm font-semibold text-ink tabular-nums focus:border-brand-500 focus:outline-none"
        />
      </label>
      <p className="mt-2 text-xs text-muted">
        Worked out on the value before GST, which is what the rules direct when tax is shown
        separately on the invoice. It reduces what you collect, not what you owe.
      </p>
      {!valid && (
        <p className="mt-2 text-xs text-danger-600">Enter a rate between 0 and 30.</p>
      )}
    </Modal>
  );
}

function DiscountDialog({
  open,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: { type: DiscountType; value: number; reason: string }) => void;
}) {
  const [type, setType] = useState<DiscountType>('PERCENT');
  const [value, setValue] = useState('10');
  const [reason, setReason] = useState('');

  const amount = Number(value);
  const valid = Number.isFinite(amount) && amount > 0 && reason.trim().length >= 3;

  return (
    <Modal
      open={open}
      title="Apply a discount"
      description={`No discount may exceed ${MAX_DISCOUNT_PERCENT}% of the bill.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            loading={submitting}
            disabled={!valid}
            onClick={() => onSubmit({ type, value: amount, reason: reason.trim() })}
          >
            Apply
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <SelectField
          label="Type"
          value={type}
          onChange={(event) => setType(event.target.value as DiscountType)}
        >
          <option value="PERCENT">Percentage of the bill</option>
          <option value="AMOUNT">Flat amount</option>
        </SelectField>

        <TextField
          label={type === 'PERCENT' ? 'Percentage' : 'Amount'}
          type="number"
          min="0.01"
          step="0.01"
          max={type === 'PERCENT' ? String(MAX_DISCOUNT_PERCENT) : undefined}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />

        <TextField
          label="Reason"
          required
          placeholder="Regular guest, service delay..."
          hint="Recorded on the bill, so the owner can see why money came off it."
          maxLength={255}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </Modal>
  );
}

function SettleDialog({
  open,
  total,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  total: number;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (paymentMethod: PaymentMethod) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>('CASH');

  return (
    <Modal
      open={open}
      title={`Settle ${formatMoney(total)}`}
      description="The bill is frozen once it is settled. Printing stays a separate step."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button loading={submitting} onClick={() => onSubmit(method)}>
            <Check className="size-4" aria-hidden />
            Mark as paid
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {PAYMENT_METHODS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={method === option.value}
            onClick={() => setMethod(option.value)}
            className={cn(
              'rounded-xl border px-4 py-3 text-sm font-medium transition-colors',
              method === option.value
                ? 'border-brand-500 bg-brand-50 text-brand-700'
                : 'border-line bg-surface text-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function VoidDialog({
  open,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Modal
      open={open}
      title="Void this bill"
      description="Nothing is charged. The bill and its lines are kept, with your reason, so the day still adds up."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Keep the bill
          </Button>
          <Button
            variant="danger"
            loading={submitting}
            disabled={reason.trim().length < 3}
            onClick={() => onSubmit(reason.trim())}
          >
            Void bill
          </Button>
        </>
      }
    >
      <TextField
        label="Reason"
        required
        placeholder="Guests left before ordering..."
        maxLength={255}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
    </Modal>
  );
}

function CancelItemDialog({
  item,
  submitting,
  onClose,
  onSubmit,
}: {
  item: OrderItem | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (reason: string | undefined) => void;
}) {
  const [reason, setReason] = useState('');

  // Once the kitchen has it, this is a write-off rather than a correction, and
  // the API will refuse it without a reason. Saying so here - and closing the
  // button off - is kinder than letting somebody press it and read an error.
  const sent = item !== null && item.kotTicketId !== null;
  const ready = !sent || reason.trim().length >= 3;

  return (
    <Modal
      open={item !== null}
      title={item ? `Remove ${item.quantity}x ${item.name}` : 'Remove line'}
      description={
        sent
          ? 'The kitchen has already made this, so a reason is required - and tell them as well.'
          : 'It has not reached the kitchen yet.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Keep it
          </Button>
          <Button
            variant="danger"
            loading={submitting}
            disabled={!ready}
            onClick={() => onSubmit(reason.trim() || undefined)}
          >
            Remove line
          </Button>
        </>
      }
    >
      <TextField
        label="Reason"
        placeholder="Guest changed their mind, kitchen out of stock..."
        hint={
          sent
            ? 'Required: the kitchen made this, so it is a write-off.'
            : 'Optional, but it is what the owner sees later.'
        }
        maxLength={255}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
    </Modal>
  );
}

/**
 * Comping one line.
 *
 * The reason is required, and the dialog says why rather than only refusing:
 * somebody reading the month back is entitled to know what was given away and to
 * whom, and "no reason given" is the one answer that helps nobody.
 */
function CompItemDialog({
  item,
  submitting,
  onClose,
  onSubmit,
}: {
  item: OrderItem | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Modal
      open={item !== null}
      title={item ? `No charge for ${item.quantity}x ${item.name}` : 'No charge'}
      description="It stays on the bill at zero, and still comes out of stock - it was cooked and eaten."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Keep charging
          </Button>
          <Button
            loading={submitting}
            disabled={reason.trim().length < 3}
            onClick={() => onSubmit(reason.trim())}
          >
            No charge
          </Button>
        </>
      }
    >
      <TextField
        label="Reason"
        placeholder="Guest sent it back, on the house..."
        hint="Required. This is what the owner reads later."
        maxLength={255}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
    </Modal>
  );
}

/**
 * The whole bill given away.
 *
 * Asks who ate as well as why, because that is the question an owner actually
 * has at the end of a month - not who authorised it, which is already on the
 * bill and in the activity log.
 */
function MarkNcDialog({
  open,
  total,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  total: number;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (forWhom: string, reason: string) => void;
}) {
  const [forWhom, setForWhom] = useState('');
  const [reason, setReason] = useState('');

  const ready = forWhom.trim().length >= 2 && reason.trim().length >= 3;

  return (
    <Modal
      open={open}
      title="Mark this bill no charge"
      description={`${formatMoney(total)} comes off the takings. The food still comes out of stock, and the bill is kept so you can see what the house gave away.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button loading={submitting} disabled={!ready} onClick={() => onSubmit(forWhom.trim(), reason.trim())}>
            No charge
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <TextField
          label="Who ate"
          placeholder="Owner's family, staff meal..."
          hint="Required. Not who approved it - who the food was for."
          maxLength={120}
          value={forWhom}
          onChange={(event) => setForWhom(event.target.value)}
        />
        <TextField
          label="Reason"
          placeholder="Sunday lunch, tasting the new menu..."
          maxLength={255}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </Modal>
  );
}
