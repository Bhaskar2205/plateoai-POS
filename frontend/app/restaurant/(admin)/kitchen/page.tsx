'use client';

import { Check, ChefHat, CircleCheck, Flame, Lock, Printer, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { formatTime, formatWait } from '@/lib/format';
import { canWorkKitchen } from '@/lib/permissions';
import { printKotTicket } from '@/lib/print-receipt';
import { useKitchenTickets, useMarkTicketPrinted, useUpdateTicketStatus } from '@/lib/queries';
import type { KitchenTicket, KotStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';

/**
 * The kitchen panel: three columns a cook works left to right.
 *
 * Built for a wall screen or a tablet with flour on it - big type, big targets,
 * no money, and no navigation to get lost in. It refreshes itself every few
 * seconds, so nobody has to remember to reload during a rush. A ticket that has
 * been waiting a long time turns amber and then red, because the number of
 * minutes matters far less than "this one is late".
 */
const COLUMNS: Array<{ status: KotStatus; title: string; hint: string }> = [
  { status: 'NEW', title: 'New', hint: 'Just in' },
  { status: 'PREPARING', title: 'Cooking', hint: 'On the pass' },
  { status: 'READY', title: 'Ready', hint: 'Waiting to go out' },
];

export default function KitchenPage() {
  const { session } = useAuth();

  if (!session) return null;

  if (!canWorkKitchen(session.user.role)) {
    return (
      <Card>
        <EmptyState
          icon={Lock}
          title="The kitchen panel is for kitchen staff"
          description="Owners, managers and kitchen staff can work tickets here. Waiters send them from the table."
        />
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="Kitchen"
        description="Today's tickets, oldest first. Updates by itself every few seconds."
      />
      <KitchenBoard />
    </>
  );
}

function KitchenBoard() {
  const tickets = useKitchenTickets();

  if (tickets.isError) {
    return (
      <Card>
        <CardBody>
          <ErrorState error={tickets.error} onRetry={() => void tickets.refetch()} />
        </CardBody>
      </Card>
    );
  }

  if (tickets.isPending) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((column) => (
          <Skeleton key={column} className="h-64 w-full" />
        ))}
      </div>
    );
  }

  const all = tickets.data ?? [];

  if (all.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={ChefHat}
          title="Nothing in the kitchen"
          description="Tickets appear here the moment staff send an order through from a table."
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {COLUMNS.map((column) => {
        const columnTickets = all.filter((ticket) => ticket.status === column.status);

        return (
          <section key={column.status} className="space-y-3">
            <header className="flex items-baseline justify-between gap-2 px-1">
              <h2 className="text-sm font-semibold tracking-tight text-ink">
                {column.title}
                <span className="ml-2 rounded-full bg-ground px-2 py-0.5 text-xs font-medium text-muted">
                  {columnTickets.length}
                </span>
              </h2>
              <p className="text-xs text-muted">{column.hint}</p>
            </header>

            {columnTickets.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-muted">
                Empty
              </p>
            ) : (
              <ul className="space-y-3">
                {columnTickets.map((ticket) => (
                  <li key={ticket.id}>
                    <TicketCard ticket={ticket} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Amber after 10 minutes, red after 20: a cook should see lateness, not arithmetic. */
function waitTone(minutes: number): 'neutral' | 'warn' | 'danger' {
  if (minutes >= 20) return 'danger';
  if (minutes >= 10) return 'warn';

  return 'neutral';
}

function TicketCard({ ticket }: { ticket: KitchenTicket }) {
  const { session } = useAuth();
  const toast = useToast();
  const updateStatus = useUpdateTicketStatus();
  const markPrinted = useMarkTicketPrinted();

  const tone = waitTone(ticket.waitingMinutes);

  const move = (status: KotStatus) => updateStatus.mutate({ id: ticket.id, status });

  const print = async () => {
    try {
      await printKotTicket({
        restaurantName: session?.restaurant.name ?? '',
        ticketNumber: ticket.ticketNumber,
        orderNumber: ticket.orderNumber,
        tableName: ticket.tableName,
        businessDate: ticket.createdAt.slice(0, 10),
        items: ticket.items,
        createdAt: ticket.createdAt,
      });
      markPrinted.mutate(ticket.id);
    } catch (error) {
      toast.error(error, 'Could not print the ticket.');
    }
  };

  return (
    <article
      className={cn(
        'rounded-2xl border bg-surface shadow-card',
        tone === 'danger'
          ? 'border-danger-500/50'
          : tone === 'warn'
            ? 'border-warn-600/40'
            : 'border-line',
      )}
    >
      <header className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          {/* Each ticket is its own region on the board, so the table names it. */}
          <h3 className="truncate text-base font-semibold text-ink">
            {ticket.tableName ?? 'Counter'}
          </h3>
          <p className="text-xs text-muted">
            KOT #{ticket.ticketNumber} · Bill #{ticket.orderNumber} · {formatTime(ticket.createdAt)}
          </p>
        </div>
        <Badge tone={tone === 'neutral' ? 'neutral' : tone}>{formatWait(ticket.waitingMinutes)}</Badge>
      </header>

      <ul className="divide-y divide-line">
        {ticket.items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 px-4 py-2.5">
            <span className="text-lg leading-6 font-bold text-ink">{item.quantity}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{item.name}</p>
              {item.note && (
                <p className="text-xs font-medium text-warn-600 italic">{item.note}</p>
              )}
            </div>
          </li>
        ))}
      </ul>

      <footer className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
        {ticket.status === 'NEW' && (
          <Button size="sm" onClick={() => move('PREPARING')} loading={updateStatus.isPending}>
            <Flame className="size-4" aria-hidden />
            Start cooking
          </Button>
        )}

        {ticket.status === 'PREPARING' && (
          <Button size="sm" onClick={() => move('READY')} loading={updateStatus.isPending}>
            <CircleCheck className="size-4" aria-hidden />
            Ready
          </Button>
        )}

        {ticket.status === 'READY' && (
          <>
            <Button size="sm" onClick={() => move('DONE')} loading={updateStatus.isPending}>
              <Check className="size-4" aria-hidden />
              Served
            </Button>
            <Button size="sm" variant="ghost" onClick={() => move('PREPARING')}>
              <RefreshCw className="size-4" aria-hidden />
              Back to cooking
            </Button>
          </>
        )}

        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void print()}>
          <Printer className="size-4" aria-hidden />
          {ticket.printedAt ? 'Reprint' : 'Print'}
        </Button>
      </footer>
    </article>
  );
}
