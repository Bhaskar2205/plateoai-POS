'use client';

import { Check, CircleAlert, Minus, NotebookPen, Plus, ShoppingBag, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
// Shared with the admin app so there is one rule for where the API lives.
import { API_BASE_URL } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { PublicDish } from '@/lib/public-menu';

/**
 * Ordering from a table QR menu.
 *
 * Anonymous by design: the table's QR token is the only thing that identifies the
 * diner, and it is already in the address bar of their own browser. The request
 * goes straight from the phone to the API rather than through this app's server,
 * so the rate limit sees the diner's own address.
 *
 * Nothing here is a bill. The API holds every request for staff approval, so the
 * wording promises exactly that and no more: no totals are claimed as final, and
 * "placed" never means "cooking".
 *
 * Instructions are per dish, because a kitchen ticket carries each line's own note
 * and not the order's. One note spread across every line would print "no onion"
 * on the dessert.
 */

interface DinerCart {
  quantityOf: (dishId: number) => number;
  add: (dish: PublicDish) => void;
  remove: (dishId: number) => void;
}

const DinerCartContext = createContext<DinerCart | null>(null);

/** Null when the menu was opened without a table - then no dish shows an Add button. */
export const useDinerCart = (): DinerCart | null => useContext(DinerCartContext);


/**
 * A key the API uses to recognise a repeat of this submission.
 *
 * `crypto.randomUUID` needs a secure context, which a phone on a restaurant's
 * plain-HTTP LAN is not, so there is a fallback. It only has to be unlikely to
 * collide with this restaurant's other orders, not to be unguessable.
 */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** The API's per-line note limit, so a long note is stopped here rather than rejected. */
const NOTE_MAX_LENGTH = 255;

interface CartLine {
  dish: PublicDish;
  quantity: number;
  /** How this dish, and only this dish, should be cooked. */
  note: string;
}

type Submission =
  | { state: 'idle' }
  | { state: 'sending' }
  | { state: 'placed'; count: number }
  | { state: 'failed'; message: string };

export function DinerOrdering({
  slug,
  tableToken,
  tableName,
  money,
  children,
}: {
  slug: string;
  /** The raw `?table=` value from the QR link. */
  tableToken: string;
  tableName: string;
  money: (value: number) => string;
  children: ReactNode;
}) {
  const [lines, setLines] = useState<Map<number, CartLine>>(new Map());
  const [reviewing, setReviewing] = useState(false);
  const [submission, setSubmission] = useState<Submission>({ state: 'idle' });
  /**
   * One key per attempt at this cart, kept across retries.
   *
   * A double tap, or a tap on a flaky connection followed by another, sends the
   * same key - so the second request is answered with the first one's receipt
   * instead of putting the food on the bill twice. It is cleared once an order
   * is placed, because the next order is genuinely a new one.
   */
  const [submissionKey, setSubmissionKey] = useState<string | null>(null);

  const add = useCallback((dish: PublicDish) => {
    setLines((current) => {
      const next = new Map(current);
      const line = next.get(dish.id);

      next.set(dish.id, {
        dish,
        quantity: Math.min((line?.quantity ?? 0) + 1, 99),
        // Keep whatever they already asked for when the quantity changes.
        note: line?.note ?? '',
      });

      return next;
    });
  }, []);

  const remove = useCallback((dishId: number) => {
    setLines((current) => {
      const next = new Map(current);
      const line = next.get(dishId);

      if (!line) return current;
      if (line.quantity <= 1) next.delete(dishId);
      else next.set(dishId, { ...line, quantity: line.quantity - 1 });

      return next;
    });
  }, []);

  const noteFor = useCallback((dishId: number, note: string) => {
    setLines((current) => {
      const line = current.get(dishId);
      if (!line) return current;

      const next = new Map(current);
      next.set(dishId, { ...line, note });

      return next;
    });
  }, []);

  const cart = useMemo<DinerCart>(
    () => ({ quantityOf: (dishId) => lines.get(dishId)?.quantity ?? 0, add, remove }),
    [lines, add, remove],
  );

  const items = [...lines.values()];
  const count = items.reduce((total, line) => total + line.quantity, 0);
  const estimate = items.reduce((total, line) => total + line.dish.price * line.quantity, 0);
  const noteCount = items.filter((line) => line.note.trim().length > 0).length;

  const place = async () => {
    setSubmission({ state: 'sending' });

    const key = submissionKey ?? newIdempotencyKey();
    if (submissionKey === null) setSubmissionKey(key);

    try {
      const response = await fetch(
        `${API_BASE_URL}/public/restaurants/${encodeURIComponent(slug)}/orders?table=${encodeURIComponent(tableToken)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
          body: JSON.stringify({
            items: items.map((line) => ({
              dishId: line.dish.id,
              quantity: line.quantity,
              ...(line.note.trim() ? { note: line.note.trim() } : {}),
            })),
          }),
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;

        throw new Error(
          body?.message ??
            'We could not place your order. Please try again, or ask a member of staff.',
        );
      }

      setSubmission({ state: 'placed', count });
      setLines(new Map());
      setReviewing(false);
      // The next order is a new one, so it gets a new key.
      setSubmissionKey(null);
    } catch (error) {
      setSubmission({
        state: 'failed',
        message:
          error instanceof Error
            ? error.message
            : 'We could not place your order. Please ask a member of staff.',
      });
    }
  };

  return (
    <DinerCartContext.Provider value={cart}>
      {children}

      {/* Room for the bar, so the last dish is never hidden behind it. */}
      {count > 0 && <div aria-hidden className="h-28" />}

      {submission.state === 'placed' && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-brand-100 bg-brand-50 px-4 py-4 shadow-raised sm:px-6">
          <div className="mx-auto flex max-w-3xl items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-brand-600"
            >
              <Check className="size-4 text-white" />
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold text-brand-700">
                Order placed — {submission.count} item
                {submission.count === 1 ? '' : 's'}
              </p>
              <p className="mt-0.5 text-brand-700/80">
                A member of staff will confirm it at {tableName} before the kitchen starts. You can
                keep adding to it.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSubmission({ state: 'idle' })}
              aria-label="Dismiss"
              className="shrink-0 rounded-lg p-1 text-brand-700/70 hover:text-brand-700"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      )}

      {count > 0 && submission.state !== 'placed' && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-3 sm:px-6 sm:pb-5">
          <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-2xl bg-ink/95 px-4 py-3 shadow-raised backdrop-blur">
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-500 text-sm font-bold text-white tabular-nums"
            >
              {count}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {count} item{count === 1 ? '' : 's'} · about {money(estimate)}
              </p>
              <p className="truncate text-xs text-white/70">{tableName}</p>
            </div>
            <button
              type="button"
              onClick={() => setReviewing(true)}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-brand-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
            >
              <ShoppingBag className="size-4" aria-hidden />
              Review &amp; place
            </button>
          </div>
        </div>
      )}

      {reviewing && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/50 p-0 backdrop-blur-sm sm:items-center sm:p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="diner-order-title"
            className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-line bg-surface shadow-raised sm:rounded-3xl"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur">
              <div>
                <h2 id="diner-order-title" className="text-lg font-bold tracking-tight text-ink">
                  Your order
                </h2>
                <p className="text-sm text-muted">
                  {tableName} · {count} item{count === 1 ? '' : 's'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReviewing(false)}
                aria-label="Close"
                className="rounded-lg p-1 text-muted hover:text-ink"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <ul className="divide-y divide-line">
              {items.map((line) => (
                <li key={line.dish.id} className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{line.dish.name}</p>
                      <p className="text-xs text-muted">{money(line.dish.price)} each</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <StepperButton
                        label={`One fewer ${line.dish.name}`}
                        onClick={() => remove(line.dish.id)}
                      >
                        <Minus className="size-4" aria-hidden />
                      </StepperButton>
                      <span className="w-7 text-center text-sm font-semibold text-ink tabular-nums">
                        {line.quantity}
                      </span>
                      <StepperButton
                        label={`One more ${line.dish.name}`}
                        onClick={() => add(line.dish)}
                      >
                        <Plus className="size-4" aria-hidden />
                      </StepperButton>
                    </div>
                    <p className="w-16 shrink-0 text-right text-sm font-semibold text-ink tabular-nums">
                      {money(line.dish.price * line.quantity)}
                    </p>
                  </div>

                  {/* Per dish, because this is the only note the kitchen is shown. */}
                  <label
                    htmlFor={`diner-note-${line.dish.id}`}
                    className="mt-2.5 flex items-center gap-2 rounded-xl border border-line bg-ground px-3 focus-within:border-brand-500"
                  >
                    <NotebookPen className="size-4 shrink-0 text-saffron-500" aria-hidden />
                    <span className="sr-only">Instructions for {line.dish.name}</span>
                    <input
                      id={`diner-note-${line.dish.id}`}
                      type="text"
                      value={line.note}
                      maxLength={NOTE_MAX_LENGTH}
                      onChange={(event) => noteFor(line.dish.id, event.target.value)}
                      placeholder="Add an instruction for the chef"
                      className="h-10 min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted/80 focus:outline-none"
                    />
                  </label>
                </li>
              ))}
            </ul>

            <div className="space-y-3 border-t border-line px-5 py-4">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted">Estimated total</span>
                <span className="text-lg font-bold text-ink tabular-nums">{money(estimate)}</span>
              </div>
              <p className="text-xs text-muted">
                An estimate from menu prices. Taxes, or any discount, are applied to the bill staff
                bring you.
              </p>

              {submission.state === 'failed' && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-xl bg-danger-50 px-3 py-2 text-xs font-medium text-danger-600"
                >
                  <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
                  {submission.message}
                </p>
              )}

              <button
                type="button"
                onClick={() => void place()}
                disabled={submission.state === 'sending'}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submission.state === 'sending' ? 'Placing your order...' : 'Place order'}
              </button>
              <p className="text-center text-xs text-muted">
                {noteCount > 0
                  ? `Staff confirm it at your table before the kitchen starts · ${noteCount} instruction${noteCount === 1 ? '' : 's'} for the chef`
                  : 'Staff confirm it at your table before the kitchen starts.'}
              </p>
            </div>
          </div>
        </div>
      )}
    </DinerCartContext.Provider>
  );
}

function StepperButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-lg border border-line bg-surface text-ink transition-colors hover:bg-ground"
    >
      {children}
    </button>
  );
}

/** The Add / quantity control on a dish card. Renders nothing without a table. */
export function DishOrderControl({ dish }: { dish: PublicDish }) {
  const cart = useDinerCart();

  if (!cart) return null;

  const quantity = cart.quantityOf(dish.id);

  if (quantity === 0) {
    return (
      <button
        type="button"
        onClick={() => cart.add(dish)}
        className={cn(
          'inline-flex h-10 items-center gap-1.5 rounded-full bg-brand-600 px-5',
          'text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700',
          'focus-visible:ring-4 focus-visible:ring-brand-500/25 focus-visible:outline-none',
        )}
      >
        <Plus className="size-4" aria-hidden />
        Add
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-brand-600 bg-brand-50 p-0.5">
      <StepperButton label={`One fewer ${dish.name}`} onClick={() => cart.remove(dish.id)}>
        <Minus className="size-4" aria-hidden />
      </StepperButton>
      <span
        className="w-7 text-center text-sm font-bold text-brand-700 tabular-nums"
        aria-live="polite"
      >
        {quantity}
      </span>
      <StepperButton label={`One more ${dish.name}`} onClick={() => cart.add(dish)}>
        <Plus className="size-4" aria-hidden />
      </StepperButton>
    </div>
  );
}
