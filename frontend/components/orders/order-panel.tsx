'use client';

import {
  BadgePercent,
  Ban,
  Check,
  ChefHat,
  Clock,
  Minus,
  Plus,
  Printer,
  QrCode,
  Receipt,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
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
  useRemoveDiscount,
  useSendToKitchen,
  useSettleOrder,
  useUpdateOrderItem,
  type OrderItemInput,
} from '@/lib/queries';
import type { DiscountType, Order, OrderItem, PaymentMethod } from '@/lib/types';
import { ItemPunchRow } from '@/components/orders/item-punch-row';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectField, TextField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
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
export function OrderPanel({ order, canBill }: { order: Order; canBill: boolean }) {
  const toast = useToast();

  const [discounting, setDiscounting] = useState(false);
  const [settling, setSettling] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [cancellingItem, setCancellingItem] = useState<OrderItem | null>(null);

  const addItems = useAddOrderItems({
    onSuccess: () => toast.success('Added to the bill.'),
    onError: (error) => toast.error(error),
  });

  const approve = useApproveOrderItems({
    onSuccess: () => toast.success('Approved. Send it to the kitchen when you are ready.'),
    onError: (error) => toast.error(error),
  });

  const updateItem = useUpdateOrderItem({ onError: (error) => toast.error(error) });

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
    onSuccess: async (settled) => {
      setSettling(false);
      toast.success(`Bill #${settled.orderNumber} settled.`);
      await print();
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

  const isOpen = order.status === 'OPEN';
  const pending = order.items.filter((item) => item.awaitingApproval);
  const live = order.items.filter((item) => item.status !== 'CANCELLED' && !item.awaitingApproval);
  const cancelled = order.items.filter((item) => item.status === 'CANCELLED');
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60_000));

  return (
    <div className="space-y-4">
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
          {isOpen && <ItemPunchRow onAdd={punch} adding={addItems.isPending} />}

          <Card>
            <div className="hidden border-b border-line bg-ground px-4 py-2 text-xs font-semibold tracking-wide text-muted uppercase sm:grid sm:grid-cols-[minmax(0,1fr)_7.5rem_5.5rem_6rem_2rem] sm:gap-3">
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
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_7.5rem_5.5rem_6rem_2rem]"
                  >
                    <div className="min-w-0">
                      <p
                        className={cn(
                          'truncate text-sm font-medium',
                          item.status === 'CANCELLED' ? 'text-muted line-through' : 'text-ink',
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
                        item.status === 'CANCELLED' ? 'text-muted line-through' : 'text-ink',
                      )}
                    >
                      {formatMoney(item.lineTotal)}
                    </span>

                    <div className="col-start-2 flex justify-end sm:col-auto">
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
            {order.taxAmount > 0 && (
              <Row label={`Tax @ ${order.taxRate}%`} value={formatMoney(order.taxAmount)} />
            )}
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <span className="text-sm font-semibold text-ink">Grand total</span>
              <span className="text-xl font-bold text-ink tabular-nums">
                {formatMoney(order.total)}
              </span>
            </div>

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

                  <Button className="w-full" onClick={() => setSettling(true)}>
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

      <DiscountDialog
        open={discounting}
        submitting={applyDiscount.isPending}
        onClose={() => setDiscounting(false)}
        onSubmit={(values) => applyDiscount.mutate({ orderId: order.id, ...values })}
      />

      <SettleDialog
        open={settling}
        total={order.total}
        submitting={settle.isPending}
        onClose={() => setSettling(false)}
        onSubmit={(paymentMethod) => settle.mutate({ orderId: order.id, paymentMethod })}
      />

      <VoidDialog
        open={voiding}
        submitting={voidOrder.isPending}
        onClose={() => setVoiding(false)}
        onSubmit={(reason) => voidOrder.mutate({ orderId: order.id, reason })}
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
      description="The bill is frozen once it is settled, and prints automatically."
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

  return (
    <Modal
      open={item !== null}
      title={item ? `Cancel ${item.quantity}x ${item.name}` : 'Cancel line'}
      description={
        item?.kotTicketId === null
          ? 'It has not reached the kitchen yet.'
          : 'The kitchen already has this - let them know as well.'
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
            onClick={() => onSubmit(reason.trim() || undefined)}
          >
            Cancel line
          </Button>
        </>
      }
    >
      <TextField
        label="Reason"
        placeholder="Guest changed their mind, kitchen out of stock..."
        hint="Optional, but it is what the owner sees later."
        maxLength={255}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
    </Modal>
  );
}
