'use client';

import { ArrowLeft, Check, Loader2, Minus, Plus, Search, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { tokenStorage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  useAddOrderItems,
  useCancelOrderItem,
  useCreateOrder,
  useFloor,
  useOrderBoard,
  useSendToKitchen,
} from '@/lib/queries';
import type { OrderBoardDish, TableOrderSummary } from '@/lib/types';
import { Button } from '@/components/ui/button';

/**
 * The captain app: a waiter taking an order at a table, on their own phone.
 *
 * Two screens and nothing else. Pick a table, pick dishes, send. Everything a
 * POS can do that this cannot - discounting, settling, comping - is deliberate:
 * a captain's account exists so orders are attributable, and that is worth
 * nothing if the same account can also move money.
 *
 * Built for a thumb. Targets are large, the running order sits at the bottom of
 * the screen where a thumb rests, and nothing important hides behind a menu.
 */

/** How long the captain has to pull an order back before it is simply sent. */
const UNDO_SECONDS = 10;

type Sent = {
  orderId: number;
  tableName: string;
  /** The lines this send added, so undo takes back exactly those. */
  itemIds: number[];
  total: number;
};

export default function CaptainPage() {
  const router = useRouter();
  const [table, setTable] = useState<TableOrderSummary | null>(null);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [sent, setSent] = useState<Sent | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /**
   * Null until the browser has been asked.
   *
   * The token lives in this device's storage, which the server cannot see, so
   * the server cannot know whether anybody is signed in. Reading it during
   * render - `typeof window !== 'undefined' && ...` - makes the first client
   * render disagree with the HTML it is replacing, and React throws out the
   * whole tree and rebuilds it. So the first render says "I do not know yet" on
   * both sides, and the answer arrives in an effect, which only ever runs in a
   * browser.
   */
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  /**
   * Who is actually signed in.
   *
   * Shown in the header because on one origin - localhost, or
   * app.plateoai.in/captain - this app shares the browser's storage with the
   * POS. An owner already signed in there walks straight into this app, which
   * is not wrong (an owner may take orders) but is deeply confusing when you
   * expected to be asked for a code. Naming them answers that before it is
   * asked.
   */
  const { session } = useAuth();

  const floor = useFloor({ enabled: signedIn === true });
  const board = useOrderBoard({ enabled: signedIn === true });

  const createOrder = useCreateOrder();
  const addItems = useAddOrderItems();
  const sendKot = useSendToKitchen();
  const cancelItem = useCancelOrderItem();

  useEffect(() => {
    const hasToken = tokenStorage.get() !== null;

    setSignedIn(hasToken);
    if (!hasToken) router.replace('/captain/login');
  }, [router]);

  // The undo window. A plain countdown rather than anything clever: when it
  // reaches zero the banner goes and the order simply stands.
  useEffect(() => {
    if (!sent) return;

    setRemaining(UNDO_SECONDS);
    const tick = setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          clearInterval(tick);
          setSent(null);
          return 0;
        }

        return value - 1;
      });
    }, 1000);

    return () => clearInterval(tick);
  }, [sent]);

  const busy = createOrder.isPending || addItems.isPending || sendKot.isPending;
  const lines = Object.entries(cart).filter(([, quantity]) => quantity > 0);
  const dishes = board.data ?? [];

  const total = lines.reduce((sum, [id, quantity]) => {
    const dish = dishes.find((d) => d.id === Number(id));
    return sum + (dish ? dish.price * quantity : 0);
  }, 0);

  const bump = (dishId: number, by: number) =>
    setCart((current) => {
      const next = Math.max(0, (current[dishId] ?? 0) + by);
      const { [dishId]: _removed, ...rest } = current;

      return next === 0 ? rest : { ...rest, [dishId]: next };
    });

  /**
   * Sends the order, and the kitchen ticket with it.
   *
   * Both go now rather than the ticket waiting out the undo window on the
   * phone. A captain who locks their screen or walks out of signal mid-countdown
   * would otherwise leave an order that never reaches the kitchen - and a guest
   * waiting for food nobody is cooking is far worse than a ticket the kitchen
   * briefly sees and then sees cancelled.
   */
  const send = async () => {
    if (!table || lines.length === 0) return;
    setError(null);

    const items = lines.map(([id, quantity]) => ({ dishId: Number(id), quantity }));

    try {
      const order = table.orderId
        ? await addItems.mutateAsync({ orderId: table.orderId, items })
        : await createOrder.mutateAsync({ tableId: table.tableId, items });

      await sendKot.mutateAsync(order.id);

      // Only the lines this send added: a table may already have had food on it.
      const added = order.items
        .filter((item) => items.some((line) => line.dishId === item.dishId))
        .slice(-items.length)
        .map((item) => item.id);

      setSent({ orderId: order.id, tableName: table.tableName, itemIds: added, total });
      setCart({});
      setTable(null);
      void floor.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send. Try again.');
    }
  };

  const undo = async () => {
    if (!sent) return;

    for (const itemId of sent.itemIds) {
      await cancelItem
        .mutateAsync({ orderId: sent.orderId, itemId, reason: 'Captain undid the order' })
        .catch(() => undefined);
    }

    setSent(null);
    void floor.refetch();
  };

  // Nothing until we know, and nothing when signed out - the effect above is
  // already sending them to the sign-in page.
  if (signedIn !== true) return null;

  return (
    <main className="min-h-dvh bg-ground pb-36">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          {table && (
            <button
              type="button"
              aria-label="Back to tables"
              onClick={() => {
                setTable(null);
                setCart({});
              }}
              className="-ml-1 rounded-lg p-1.5 text-muted hover:text-ink"
            >
              <ArrowLeft className="size-5" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-ink">
              {table ? table.tableName : 'Tables'}
            </p>
            {table && (
              <p className="text-xs text-muted">
                {table.orderId ? 'Adding to the open bill' : 'New bill'}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            {session?.user.name && (
              <p className="max-w-28 truncate text-xs font-medium text-ink">{session.user.name}</p>
            )}
            <button
              type="button"
              onClick={() => {
                tokenStorage.clear();
                router.replace('/captain/login');
              }}
              className="text-xs font-medium text-muted hover:text-ink"
            >
              End shift
            </button>
          </div>
        </div>
      </header>

      {error && (
        <p role="alert" className="mx-4 mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600">
          {error}
        </p>
      )}

      {table ? (
        <DishBoard dishes={dishes} loading={board.isLoading} cart={cart} onBump={bump} />
      ) : (
        <TableGrid
          tables={floor.data ?? []}
          loading={floor.isLoading}
          onPick={(picked) => {
            setTable(picked);
            setCart({});
          }}
        />
      )}

      {/* The running order, under the thumb. */}
      {table && lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface p-3 shadow-raised">
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">
                {lines.reduce((n, [, q]) => n + q, 0)} item
                {lines.reduce((n, [, q]) => n + q, 0) === 1 ? '' : 's'} · {formatMoney(total)}
              </p>
              <p className="truncate text-xs text-muted">{table.tableName}</p>
            </div>
            <Button loading={busy} onClick={() => void send()} className="h-12 px-5 text-base">
              <Check className="size-5" aria-hidden />
              Send to kitchen
            </Button>
          </div>
        </div>
      )}

      {/* The undo window. */}
      {sent && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink p-3 text-white shadow-raised">
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Sent to the kitchen</p>
              <p className="truncate text-xs text-white/70">
                {sent.tableName} · {formatMoney(sent.total)}
              </p>
            </div>
            <Button
              variant="secondary"
              loading={cancelItem.isPending}
              onClick={() => void undo()}
            >
              <Undo2 className="size-4" aria-hidden />
              Undo {remaining}
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}

/** Every table, with whatever is already running on it. */
function TableGrid({
  tables,
  loading,
  onPick,
}: {
  tables: TableOrderSummary[];
  loading: boolean;
  onPick: (table: TableOrderSummary) => void;
}) {
  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Loader2 className="size-6 animate-spin" aria-hidden />
      </div>
    );
  }

  const open = tables.filter((table) => table.isActive);

  if (open.length === 0) {
    return <p className="px-4 py-16 text-center text-sm text-muted">No tables set up yet.</p>;
  }

  return (
    <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
      {open.map((table) => (
        <li key={table.tableId}>
          <button
            type="button"
            onClick={() => onPick(table)}
            className={cn(
              'flex h-24 w-full flex-col items-start justify-between rounded-2xl border p-3 text-left transition-colors',
              table.orderId
                ? 'border-brand-500/40 bg-brand-50'
                : 'border-line bg-surface hover:border-brand-500/40',
            )}
          >
            <span className="truncate text-base font-semibold text-ink">{table.tableName}</span>
            {table.orderId ? (
              <span className="text-xs font-medium text-brand-700">
                {formatMoney(table.total)}
                <span className="block font-normal text-brand-700/70">
                  {table.itemCount} item{table.itemCount === 1 ? '' : 's'}
                </span>
              </span>
            ) : (
              <span className="text-xs text-muted">Free</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The menu, as a captain punches from it. */
function DishBoard({
  dishes,
  loading,
  cart,
  onBump,
}: {
  dishes: OrderBoardDish[];
  loading: boolean;
  cart: Record<number, number>;
  onBump: (dishId: number, by: number) => void;
}) {
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const matching = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return needle ? dishes.filter((dish) => dish.name.toLowerCase().includes(needle)) : dishes;
  }, [dishes, search]);

  // Grouped by course, in the order the restaurant arranged them - the API
  // already sorted, so insertion order is the right order.
  const courses = useMemo(() => {
    const groups = new Map<string, OrderBoardDish[]>();

    for (const dish of matching) {
      const key = dish.categoryName ?? 'Other';
      groups.set(key, [...(groups.get(key) ?? []), dish]);
    }

    return [...groups.entries()];
  }, [matching]);

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Loader2 className="size-6 animate-spin" aria-hidden />
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="relative mb-4">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          ref={searchRef}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search dishes"
          aria-label="Search dishes"
          autoCapitalize="none"
          autoCorrect="off"
          className="h-12 w-full rounded-xl border border-line bg-surface pr-3 pl-9 text-base text-ink focus:border-brand-500 focus:outline-none"
        />
      </div>

      {courses.length === 0 && (
        <p className="py-12 text-center text-sm text-muted">Nothing matches &ldquo;{search}&rdquo;.</p>
      )}

      <div className="space-y-5">
        {courses.map(([course, items]) => (
          <section key={course}>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{course}</h2>
            <ul className="space-y-2">
              {items.map((dish) => (
                <li key={dish.id}>
                  <DishRow dish={dish} quantity={cart[dish.id] ?? 0} onBump={onBump} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function DishRow({
  dish,
  quantity,
  onBump,
}: {
  dish: OrderBoardDish;
  quantity: number;
  onBump: (dishId: number, by: number) => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border bg-surface p-3 transition-colors',
        quantity > 0 ? 'border-brand-500/40 bg-brand-50' : 'border-line',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-3 shrink-0 rounded-[3px] border',
          dish.dietType === 'NON_VEG' ? 'border-danger-500' : 'border-brand-600',
        )}
      >
        <span
          className={cn(
            'block size-full scale-50 rounded-full',
            dish.dietType === 'NON_VEG' ? 'bg-danger-500' : 'bg-brand-600',
          )}
        />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{dish.name}</p>
        <p className="text-xs text-muted tabular-nums">{formatMoney(dish.price)}</p>
      </div>

      {quantity > 0 ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={`One less ${dish.name}`}
            onClick={() => onBump(dish.id, -1)}
            className="grid size-10 place-items-center rounded-lg border border-line bg-surface text-ink"
          >
            <Minus className="size-4" aria-hidden />
          </button>
          <span className="w-7 text-center text-sm font-semibold text-ink tabular-nums">
            {quantity}
          </span>
          <button
            type="button"
            aria-label={`One more ${dish.name}`}
            onClick={() => onBump(dish.id, 1)}
            className="grid size-10 place-items-center rounded-lg bg-brand-600 text-white"
          >
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type="button"
          aria-label={`Add ${dish.name}`}
          onClick={() => onBump(dish.id, 1)}
          className="grid size-10 shrink-0 place-items-center rounded-lg border border-brand-600 text-brand-700"
        >
          <Plus className="size-5" aria-hidden />
        </button>
      )}
    </div>
  );
}
