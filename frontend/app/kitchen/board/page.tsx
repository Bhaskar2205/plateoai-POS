'use client';

import {
  Check,
  ChefHat,
  CircleAlert,
  CircleCheck,
  Flame,
  LogOut,
  Printer,
  RefreshCw,
  TriangleAlert,
  Utensils,
} from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatTime, formatWait } from '@/lib/format';
import {
  fetchKitchenTickets,
  kitchenSession,
  markTicketPrinted,
  setTicketStatus,
} from '@/lib/kitchen-session';
import { printKotTicket } from '@/lib/print-receipt';
import type { KitchenTicket, KotStatus } from '@/lib/types';

/**
 * The kitchen board.
 *
 * Written for a screen on a wall in a hot room, read from two metres away by
 * someone holding a pan: dark background so it does not glare, very large table
 * names, quantities bigger than anything else, and one obvious button per ticket.
 *
 * Tickets are grouped **by table**, because that is the unit a kitchen plates and
 * a waiter carries. A second round at a table already being cooked for arrives as
 * its own ticket under the same table heading, marked as a later round, so a cook
 * never has to work out which half of a ticket they already made.
 *
 * It refreshes itself every five seconds. Nothing here shows a price.
 */
const REFRESH_MS = 5000;

export default function KitchenBoardPage() {
  const router = useRouter();
  const [session, setSession] = useState<{ restaurantName: string } | null>(null);
  const [tickets, setTickets] = useState<KitchenTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const signOut = useCallback(() => {
    kitchenSession.clear();
    router.replace('/kitchen' as Route);
  }, [router]);

  const load = useCallback(async () => {
    try {
      setTickets(await fetchKitchenTickets());
      setUpdatedAt(new Date());
      setError(null);
    } catch (loadError) {
      // The session ends when the code is regenerated or the tenant suspended.
      if (!kitchenSession.read()) {
        signOut();
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Could not reach the restaurant.');
    }
  }, [signOut]);

  useEffect(() => {
    const current = kitchenSession.read();

    if (!current) {
      router.replace('/kitchen' as Route);
      return;
    }

    setSession(current);
    void load();

    const timer = window.setInterval(() => void load(), REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [load, router]);

  const move = async (ticket: KitchenTicket, status: KotStatus) => {
    setBusyId(ticket.id);

    // Move the card immediately: a cook taps and walks away.
    setTickets((current) =>
      current?.map((row) => (row.id === ticket.id ? { ...row, status } : row)) ?? current,
    );

    try {
      await setTicketStatus(ticket.id, status);
      await load();
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : 'That did not go through.');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const print = async (ticket: KitchenTicket) => {
    try {
      await printKotTicket({
        restaurantName: session?.restaurantName ?? '',
        ticketNumber: ticket.ticketNumber,
        orderNumber: ticket.orderNumber,
        tableName: ticket.tableName,
        businessDate: ticket.createdAt.slice(0, 10),
        items: ticket.items,
        createdAt: ticket.createdAt,
      });
      await markTicketPrinted(ticket.id);
    } catch {
      setError('Could not print that ticket.');
    }
  };

  if (!session) return null;

  // One group per table, oldest ticket first inside each - the order they were sent.
  const groups = new Map<string, KitchenTicket[]>();
  for (const ticket of tickets ?? []) {
    const key = ticket.tableName ?? 'Counter / takeaway';
    groups.set(key, [...(groups.get(key) ?? []), ticket]);
  }

  const waiting = (tickets ?? []).filter((ticket) => ticket.status !== 'READY').length;
  const ready = (tickets ?? []).filter((ticket) => ticket.status === 'READY').length;

  return (
    <div className="min-h-dvh bg-ink text-white">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-ink/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
          <span className="inline-flex items-center gap-2 text-lg font-bold">
            <ChefHat className="size-5 text-brand-500" aria-hidden />
            Kitchen
          </span>
          <span className="truncate text-sm text-white/50">{session.restaurantName}</span>

          <span className="ml-auto flex items-center gap-4 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <Flame className="size-4 text-warn-500" aria-hidden />
              <span className="font-semibold tabular-nums">{waiting}</span>
              <span className="text-white/50">cooking</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CircleCheck className="size-4 text-brand-500" aria-hidden />
              <span className="font-semibold tabular-nums">{ready}</span>
              <span className="text-white/50">ready</span>
            </span>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
              aria-label="Refresh now"
              title={updatedAt ? `Updated ${formatTime(updatedAt.toISOString())}` : 'Refresh'}
            >
              <RefreshCw className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-white/50 hover:bg-white/10 hover:text-white"
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </span>
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="flex items-center gap-2 bg-danger-500/20 px-4 py-2 text-sm font-medium text-danger-100 sm:px-6"
        >
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <main className="px-4 py-5 sm:px-6">
        {tickets === null ? (
          <p className="py-20 text-center text-white/40">Loading the board…</p>
        ) : tickets.length === 0 ? (
          <div className="py-24 text-center">
            <Utensils className="mx-auto size-10 text-white/20" aria-hidden />
            <p className="mt-4 text-xl font-semibold text-white/80">Nothing to cook right now</p>
            <p className="mt-1 text-sm text-white/40">
              Tickets appear the moment the floor sends an order through.
            </p>
          </div>
        ) : (
          <div className="space-y-7">
            {[...groups.entries()].map(([tableName, tableTickets]) => (
              <section key={tableName}>
                <h2 className="mb-2.5 flex items-baseline gap-3">
                  <span className="text-2xl font-bold tracking-tight">{tableName}</span>
                  <span className="text-sm text-white/40">
                    {tableTickets.length} ticket{tableTickets.length === 1 ? '' : 's'}
                  </span>
                </h2>

                <ul className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                  {tableTickets.map((ticket, index) => (
                    <li key={ticket.id}>
                      <TicketCard
                        ticket={ticket}
                        round={index + 1}
                        rounds={tableTickets.length}
                        busy={busyId === ticket.id}
                        onMove={(status) => void move(ticket, status)}
                        onPrint={() => void print(ticket)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

/** Amber after 10 minutes, red after 20: lateness should be seen, not calculated. */
function waitTone(minutes: number): 'calm' | 'warn' | 'late' {
  if (minutes >= 20) return 'late';
  if (minutes >= 10) return 'warn';

  return 'calm';
}

function TicketCard({
  ticket,
  round,
  rounds,
  busy,
  onMove,
  onPrint,
}: {
  ticket: KitchenTicket;
  round: number;
  rounds: number;
  busy: boolean;
  onMove: (status: KotStatus) => void;
  onPrint: () => void;
}) {
  const tone = waitTone(ticket.waitingMinutes);

  return (
    <article
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-2xl border-2 bg-white/5',
        ticket.status === 'READY'
          ? 'border-brand-500'
          : tone === 'late'
            ? 'border-danger-500'
            : tone === 'warn'
              ? 'border-warn-500'
              : 'border-white/15',
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5">
        <span className="text-sm font-semibold text-white/70">
          KOT #{ticket.ticketNumber}
          <span className="ml-2 font-normal text-white/40">Bill #{ticket.orderNumber}</span>
        </span>

        <span className="flex items-center gap-2">
          {/* A later round at a table already being cooked for. */}
          {rounds > 1 && (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold">
              Round {round} of {rounds}
            </span>
          )}
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-bold',
              tone === 'late'
                ? 'bg-danger-500 text-white'
                : tone === 'warn'
                  ? 'bg-warn-500 text-ink'
                  : 'bg-white/10 text-white/70',
            )}
          >
            {formatWait(ticket.waitingMinutes)}
          </span>
        </span>
      </header>

      <ul className="flex-1 divide-y divide-white/10">
        {ticket.items.map((item) => (
          <li key={item.id} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="min-w-8 text-3xl leading-8 font-black tabular-nums">
                {item.quantity}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-lg leading-tight font-semibold">{item.name}</p>

                {/* The table's instruction: the one thing a cook must not miss. */}
                {item.note && (
                  <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-warn-500/20 px-2.5 py-1.5 text-sm font-semibold text-warn-50">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {item.note}
                  </p>
                )}

                {item.ingredients.length > 0 && (
                  <p className="mt-1.5 text-xs leading-relaxed text-white/45">
                    <span className="text-white/30">Goes in: </span>
                    {item.ingredients.join(' · ')}
                  </p>
                )}

                {item.allergens.length > 0 && (
                  <p className="mt-1 text-xs font-semibold text-warn-500">
                    {item.allergens.join(' · ')}
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <footer className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3">
        {ticket.status === 'NEW' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onMove('PREPARING')}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-warn-500 px-4 text-sm font-bold text-ink disabled:opacity-50"
          >
            <Flame className="size-4" aria-hidden />
            Start cooking
          </button>
        )}

        {ticket.status === 'PREPARING' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onMove('READY')}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            <CircleCheck className="size-4" aria-hidden />
            Ready to serve
          </button>
        )}

        {ticket.status === 'READY' && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onMove('DONE')}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              <Check className="size-4" aria-hidden />
              Served
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onMove('PREPARING')}
              className="inline-flex h-11 items-center justify-center rounded-xl px-3 text-sm text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <RefreshCw className="size-4" aria-hidden />
            </button>
          </>
        )}

        <button
          type="button"
          onClick={onPrint}
          aria-label={`Print KOT ${ticket.ticketNumber}`}
          className="inline-flex h-11 items-center justify-center rounded-xl px-3 text-sm text-white/50 hover:bg-white/10 hover:text-white"
        >
          <Printer className="size-4" aria-hidden />
        </button>
      </footer>
    </article>
  );
}
