'use client';

import {
  CalendarClock,
  Check,
  Armchair,
  MessageSquareQuote,
  Phone,
  TicketPercent,
  UserRound,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import type {
  BookingDiscount,
  DiscountType,
  RestaurantTable,
  TableBooking,
  TableBookingStatus,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';

/**
 * One booking, as the person answering the phone sees it.
 *
 * Built around the two things they need at a glance - **when**, and **how many** -
 * so the card leads with the time and the party size at a size you can read
 * across a counter, and everything else is support.
 *
 * The actions change with the state rather than being greyed out. A row of five
 * disabled buttons teaches somebody nothing; one or two live ones tell them what
 * this booking is waiting for.
 */

const STATUS: Record<
  TableBookingStatus,
  { label: string; tone: 'neutral' | 'success' | 'danger' | 'warn' }
> = {
  REQUESTED: { label: 'Needs an answer', tone: 'warn' },
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  SEATED: { label: 'Seated', tone: 'success' },
  COMPLETED: { label: 'Finished', tone: 'neutral' },
  DECLINED: { label: 'Declined', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  NO_SHOW: { label: 'No show', tone: 'danger' },
};

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

const dayOf = (iso: string) => {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();

  if (sameDay) return 'Today';

  const tomorrow = new Date(today.getTime() + 86_400_000);
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';

  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/**
 * What the discount says on the card.
 *
 * Written as an instruction rather than a value - "10% off the bill" is something
 * a person can carry out; "PERCENT 10" is a database row. The reason travels with
 * it because the person applying it has to write a reason on the bill anyway, and
 * retyping somebody else's words is where discounts quietly become wrong.
 */
const discountLine = (discount: BookingDiscount) =>
  discount.type === 'PERCENT'
    ? `${discount.value}% off the bill`
    : `${formatMoney(discount.value)} off the bill`;

export interface BookingActions {
  /**
   * `discount` undefined keeps what the booking arrived with, and null clears it
   * - the same distinction the API draws, carried all the way to the button so
   * the page in between never has to guess.
   */
  confirm: (id: number, discount?: BookingDiscount | null, tableId?: number) => void;
  decline: (id: number, note: string) => void;
  seat: (id: number) => void;
  complete: (id: number) => void;
  noShow: (id: number) => void;
  busy: boolean;
}

export function BookingCard({
  booking,
  actions,
  tables,
}: {
  booking: TableBooking;
  actions: BookingActions;
  /** Offered when confirming. Empty is fine - a table is optional even then. */
  tables?: RestaurantTable[];
}) {
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  // undefined until somebody touches it, so confirming without opening the
  // editor leaves the app's discount exactly as it arrived.
  const [discount, setDiscount] = useState<BookingDiscount | null | undefined>(undefined);
  const [editingDiscount, setEditingDiscount] = useState(false);
  const [tableId, setTableId] = useState<number | undefined>(undefined);

  const shown =
    discount !== undefined
      ? discount
      : booking.discountType
        ? {
            type: booking.discountType,
            value: booking.discountValue ?? 0,
            reason: booking.discountReason ?? '',
          }
        : null;

  const status = STATUS[booking.status];
  const needsAnswer = booking.status === 'REQUESTED';
  // Confirmed, and the time has come and gone with nobody seated.
  const overdue =
    booking.status === 'CONFIRMED' && new Date(booking.bookedFor).getTime() < Date.now() - 900_000;

  return (
    <article
      className={cn(
        'overflow-hidden rounded-2xl border bg-surface shadow-card transition-shadow hover:shadow-raised',
        needsAnswer ? 'border-warn-600/35' : overdue ? 'border-danger-500/30' : 'border-line',
      )}
    >
      <div className="flex items-stretch">
        {/* A time rail down the left: the one thing read first, and the thing the
            list is sorted by. */}
        <div
          className={cn(
            'flex w-24 shrink-0 flex-col items-center justify-center gap-0.5 px-2 py-4 text-center',
            needsAnswer ? 'bg-warn-50' : 'bg-ground',
          )}
        >
          <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
            {dayOf(booking.bookedFor)}
          </span>
          <span className="text-lg leading-tight font-semibold text-ink">
            {timeOf(booking.bookedFor)}
          </span>
          <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted">
            <UserRound className="size-3.5" aria-hidden />
            <span className="sr-only">Party of </span>
            {booking.partySize}
          </span>
        </div>

        <div className="min-w-0 flex-1 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{booking.guestName}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                <Phone className="size-3.5 shrink-0" aria-hidden />
                <a href={`tel:${booking.guestPhone}`} className="hover:text-ink">
                  {booking.guestPhone}
                </a>
                <span aria-hidden>·</span>
                <span>#{booking.referenceNumber}</span>
              </p>
            </div>

            <div className="flex items-center gap-2">
              {booking.table && (
                <span className="inline-flex items-center gap-1 rounded-full bg-ground px-2 py-0.5 text-xs text-muted">
                  <Armchair className="size-3" aria-hidden />
                  {booking.table.name}
                </span>
              )}
              <Badge tone={status.tone} dot>
                {status.label}
              </Badge>
            </div>
          </div>

          {booking.guestNote && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-ground px-2.5 py-1.5 text-xs text-muted">
              <MessageSquareQuote className="mt-px size-3.5 shrink-0" aria-hidden />
              {booking.guestNote}
            </p>
          )}

          {shown && !editingDiscount && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs text-brand-700">
              <TicketPercent className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>
                <span className="font-semibold">{discountLine(shown)}</span>
                {shown.reason && <> &middot; {shown.reason}</>}
                {/* Said plainly, because nothing applies it for you. A card that
                    looked automatic would be worse than one that says nothing. */}
                <span className="mt-0.5 block text-brand-700/70">
                  Apply it on the bill when they are seated.
                </span>
              </span>
            </p>
          )}

          {editingDiscount && (
            <DiscountEditor
              value={shown}
              onCancel={() => setEditingDiscount(false)}
              onSave={(next) => {
                setDiscount(next);
                setEditingDiscount(false);
              }}
            />
          )}

          {overdue && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-danger-600">
              <CalendarClock className="size-3.5 shrink-0" aria-hidden />
              Booked for {timeOf(booking.bookedFor)} and not seated yet.
            </p>
          )}

          {booking.restaurantNote && !declining && (
            <p className="mt-2 text-xs text-muted">You said: {booking.restaurantNote}</p>
          )}

          {declining ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                value={note}
                autoFocus
                onChange={(event) => setNote(event.target.value)}
                placeholder="Why? The guest is told this."
                className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:border-brand-500 focus:outline-none"
              />
              <Button variant="ghost" onClick={() => setDeclining(false)}>
                Keep it
              </Button>
              <Button
                variant="danger"
                loading={actions.busy}
                onClick={() => actions.decline(booking.id, note.trim())}
              >
                Decline
              </Button>
            </div>
          ) : (
            <Actions
              booking={booking}
              actions={actions}
              discount={discount}
              tables={tables}
              tableId={tableId}
              onTableChange={setTableId}
              onDecline={() => setDeclining(true)}
              onEditDiscount={() => setEditingDiscount(true)}
            />
          )}
        </div>
      </div>
    </article>
  );
}

/** Only what this booking can actually do next. */
function Actions({
  booking,
  actions,
  discount,
  tables,
  tableId,
  onTableChange,
  onDecline,
  onEditDiscount,
}: {
  booking: TableBooking;
  actions: BookingActions;
  discount: BookingDiscount | null | undefined;
  tables?: RestaurantTable[];
  tableId: number | undefined;
  onTableChange: (id: number | undefined) => void;
  onDecline: () => void;
  onEditDiscount: () => void;
}) {
  if (booking.status === 'REQUESTED') {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          loading={actions.busy}
          onClick={() => actions.confirm(booking.id, discount, tableId)}
        >
          <Check className="size-4" aria-hidden />
          Confirm
        </Button>

        {/* Optional on purpose: plenty of restaurants say yes now and decide the
            table on the night, and forcing one here would make them invent it. */}
        {tables && tables.length > 0 && (
          <select
            value={tableId ?? ''}
            aria-label="Table for this booking"
            onChange={(event) =>
              onTableChange(event.target.value ? Number(event.target.value) : undefined)
            }
            className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-ink focus:border-brand-500 focus:outline-none"
          >
            <option value="">Table later</option>
            {tables
              .filter((table) => table.isActive)
              .map((table) => (
                <option key={table.id} value={table.id}>
                  {table.name}
                </option>
              ))}
          </select>
        )}
        <Button size="sm" variant="secondary" onClick={onDecline}>
          <X className="size-4" aria-hidden />
          Decline
        </Button>
        {/* Answering is the only moment a discount can be set, so the control
            lives here rather than on a card that can no longer change. */}
        <Button size="sm" variant="ghost" onClick={onEditDiscount}>
          <TicketPercent className="size-4" aria-hidden />
          {booking.discountType || discount ? 'Change discount' : 'Add discount'}
        </Button>
      </div>
    );
  }

  if (booking.status === 'CONFIRMED') {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" loading={actions.busy} onClick={() => actions.seat(booking.id)}>
          <Armchair className="size-4" aria-hidden />
          They have arrived
        </Button>
        <Button size="sm" variant="ghost" onClick={() => actions.noShow(booking.id)}>
          Nobody came
        </Button>
      </div>
    );
  }

  if (booking.status === 'SEATED') {
    return (
      <div className="mt-3">
        <Button size="sm" variant="secondary" loading={actions.busy} onClick={() => actions.complete(booking.id)}>
          Finished
        </Button>
      </div>
    );
  }

  return null;
}

/**
 * Setting, changing or taking back the discount, while answering the booking.
 *
 * The three parts are edited together because they are saved together: a value
 * with no reason is refused by the API, and discovering that after pressing
 * Confirm would lose the answer as well as the discount. So Save is closed off
 * until the three agree, and the rules it enforces are the API's own - a
 * percentage no higher than 50, because a bill caps any discount at half its
 * subtotal, and a reason of at least three characters.
 */
function DiscountEditor({
  value,
  onSave,
  onCancel,
}: {
  value: BookingDiscount | null;
  onSave: (next: BookingDiscount | null) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<DiscountType>(value?.type ?? 'PERCENT');
  const [amount, setAmount] = useState(value ? String(value.value) : '');
  const [reason, setReason] = useState(value?.reason ?? '');

  const parsed = Number(amount);
  const valid =
    amount.trim() !== '' &&
    Number.isFinite(parsed) &&
    parsed >= 0.01 &&
    (type !== 'PERCENT' || parsed <= 50) &&
    reason.trim().length >= 3;

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-line bg-ground p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-line">
          {(['PERCENT', 'AMOUNT'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setType(option)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium transition-colors',
                type === option ? 'bg-ink text-white' : 'bg-surface text-muted hover:text-ink',
              )}
            >
              {option === 'PERCENT' ? '%' : '₹'}
            </button>
          ))}
        </div>

        <input
          value={amount}
          autoFocus
          inputMode="decimal"
          onChange={(event) => setAmount(event.target.value)}
          placeholder={type === 'PERCENT' ? 'e.g. 10' : 'e.g. 150'}
          aria-label={type === 'PERCENT' ? 'Discount percentage' : 'Discount amount'}
          className="h-8 w-24 rounded-lg border border-line bg-surface px-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
        />

        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why? This goes on the bill."
          aria-label="Reason for the discount"
          className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
        />
      </div>

      {type === 'PERCENT' && parsed > 50 && (
        <p className="text-xs text-danger-600">
          A bill will not take more than half off, so 50% is the most you can promise.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!valid}
          onClick={() => onSave({ type, value: parsed, reason: reason.trim() })}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {value && (
          <Button size="sm" variant="ghost" onClick={() => onSave(null)}>
            Remove discount
          </Button>
        )}
      </div>
    </div>
  );
}
