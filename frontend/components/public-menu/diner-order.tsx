'use client';

import { Check, CircleAlert, Minus, Plus, ShoppingBag, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
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
 * "sent" never means "cooking".
 */

interface DinerCart {
  quantityOf: (dishId: number) => number;
  add: (dish: PublicDish) => void;
  remove: (dishId: number) => void;
}

const DinerCartContext = createContext<DinerCart | null>(null);

/** Null when the menu was opened without a table - then no dish shows an Add button. */
export const useDinerCart = (): DinerCart | null => useContext(DinerCartContext);

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:4000';

interface CartLine {
  dish: PublicDish;
  quantity: number;
}

type Submission =
  | { state: 'idle' }
  | { state: 'sending' }
  | { state: 'sent'; count: number }
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
  const [note, setNote] = useState('');
  const [submission, setSubmission] = useState<Submission>({ state: 'idle' });

  const add = useCallback((dish: PublicDish) => {
    setLines((current) => {
      const next = new Map(current);
      const line = next.get(dish.id);

      next.set(dish.id, { dish, quantity: Math.min((line?.quantity ?? 0) + 1, 99) });

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

  const cart = useMemo<DinerCart>(
    () => ({ quantityOf: (dishId) => lines.get(dishId)?.quantity ?? 0, add, remove }),
    [lines, add, remove],
  );

  const items = [...lines.values()];
  const count = items.reduce((total, line) => total + line.quantity, 0);
  const estimate = items.reduce((total, line) => total + line.dish.price * line.quantity, 0);

  const send = async () => {
    setSubmission({ state: 'sending' });

    try {
      const response = await fetch(
        `${API_BASE_URL}/public/restaurants/${encodeURIComponent(slug)}/orders?table=${encodeURIComponent(tableToken)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: items.map((line) => ({
              dishId: line.dish.id,
              quantity: line.quantity,
              ...(note.trim() ? { note: note.trim() } : {}),
            })),
          }),
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;

        throw new Error(
          body?.message ??
            'We could not send your order. Please try again, or ask a member of staff.',
        );
      }

      setSubmission({ state: 'sent', count });
      setLines(new Map());
      setNote('');
      setReviewing(false);
    } catch (error) {
      setSubmission({
        state: 'failed',
        message:
          error instanceof Error
            ? error.message
            : 'We could not send your order. Please ask a member of staff.',
      });
    }
  };

  return (
    <DinerCartContext.Provider value={cart}>
      {children}

      {/* Room for the bar, so the last dish is never hidden behind it. */}
      {count > 0 && <div aria-hidden className="h-24" />}

      {submission.state === 'sent' && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-brand-100 bg-brand-50 px-4 py-4 sm:px-6">
          <div className="mx-auto flex max-w-3xl items-start gap-3">
            <Check className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold text-brand-700">
                Sent to the restaurant — {submission.count} item
                {submission.count === 1 ? '' : 's'}
              </p>
              <p className="mt-0.5 text-brand-700/80">
                A member of staff will confirm your order for {tableName} shortly. You can keep
                adding to it.
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

      {count > 0 && submission.state !== 'sent' && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">
                {count} item{count === 1 ? '' : 's'} · about {money(estimate)}
              </p>
              <p className="truncate text-xs text-muted">
                {tableName} · staff confirm before the kitchen starts
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReviewing(true)}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              <ShoppingBag className="size-4" aria-hidden />
              Review order
            </button>
          </div>
        </div>
      )}

      {reviewing && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="diner-order-title"
            className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-surface shadow-xl sm:rounded-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <h2 id="diner-order-title" className="text-base font-semibold text-ink">
                  Your order
                </h2>
                <p className="text-sm text-muted">{tableName}</p>
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
                <li key={line.dish.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{line.dish.name}</p>
                    <p className="text-xs text-muted">{money(line.dish.price)} each</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <StepperButton
                      label={`One fewer ${line.dish.name}`}
                      onClick={() => remove(line.dish.id)}
                    >
                      <Minus className="size-4" aria-hidden />
                    </StepperButton>
                    <span className="w-7 text-center text-sm font-semibold text-ink">
                      {line.quantity}
                    </span>
                    <StepperButton
                      label={`One more ${line.dish.name}`}
                      onClick={() => add(line.dish)}
                    >
                      <Plus className="size-4" aria-hidden />
                    </StepperButton>
                  </div>
                  <p className="w-16 shrink-0 text-right text-sm font-medium text-ink tabular-nums">
                    {money(line.dish.price * line.quantity)}
                  </p>
                </li>
              ))}
            </ul>

            <div className="space-y-3 border-t border-line px-5 py-4">
              <label className="block text-sm font-medium text-ink" htmlFor="diner-order-note">
                Anything the kitchen should know?
              </label>
              <input
                id="diner-order-note"
                type="text"
                value={note}
                maxLength={255}
                onChange={(event) => setNote(event.target.value)}
                placeholder="No onion, less spicy, one plate to share..."
                className="h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/80 focus:border-brand-500 focus:outline-none"
              />

              <div className="flex items-baseline justify-between border-t border-line pt-3 text-sm">
                <span className="text-muted">Estimated total</span>
                <span className="text-base font-semibold text-ink tabular-nums">
                  {money(estimate)}
                </span>
              </div>
              <p className="text-xs text-muted">
                An estimate from menu prices. Taxes, or any discount, are applied to the bill staff
                bring you.
              </p>

              {submission.state === 'failed' && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg bg-danger-50 px-3 py-2 text-xs font-medium text-danger-600"
                >
                  <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
                  {submission.message}
                </p>
              )}

              <button
                type="button"
                onClick={() => void send()}
                disabled={submission.state === 'sending'}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submission.state === 'sending' ? 'Sending...' : 'Send to the restaurant'}
              </button>
              <p className="text-center text-xs text-muted">
                Staff will confirm it at your table before the kitchen starts.
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
          'inline-flex h-9 items-center gap-1.5 rounded-full border border-brand-600 px-4',
          'text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50',
        )}
      >
        <Plus className="size-4" aria-hidden />
        Add
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1">
      <StepperButton label={`One fewer ${dish.name}`} onClick={() => cart.remove(dish.id)}>
        <Minus className="size-4" aria-hidden />
      </StepperButton>
      <span className="w-7 text-center text-sm font-semibold text-ink" aria-live="polite">
        {quantity}
      </span>
      <StepperButton label={`One more ${dish.name}`} onClick={() => cart.add(dish)}>
        <Plus className="size-4" aria-hidden />
      </StepperButton>
    </div>
  );
}
