'use client';

import { Armchair, BellRing, ChefHat, CircleCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { cn } from '@/lib/cn';
import type { TableOrderSummary } from '@/lib/types';
import { SectionHeading } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * What is happening in the room right now.
 *
 * The floor query already polls, so these figures move on their own - which is
 * the point. A dashboard that only changes when you reload is a report; one that
 * shows the room filling up is something an owner leaves open on a screen.
 *
 * Each tile links to where you would act on it, because a number you cannot act
 * on is decoration.
 */
export function ServiceNow({
  floor,
  loading,
}: {
  floor: TableOrderSummary[] | undefined;
  loading: boolean;
}) {
  const tables = floor ?? [];
  const occupied = tables.filter((table) => table.orderId !== null);
  const waitingApproval = tables.reduce((sum, table) => sum + table.pendingApprovalCount, 0);
  const cooking = tables.filter((table) => table.kitchenState === 'COOKING').length;
  const ready = tables.filter((table) => table.kitchenState === 'READY').length;

  return (
    <section aria-labelledby="service-heading" className="space-y-3">
      <SectionHeading id="service-heading">In service now</SectionHeading>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Tables seated"
          value={`${occupied.length}`}
          detail={tables.length > 0 ? `of ${tables.length}` : 'No tables set up'}
          icon={Armchair}
          href="/restaurant/tables"
          loading={loading}
        />
        <Tile
          label="Diner requests"
          value={`${waitingApproval}`}
          detail={waitingApproval > 0 ? 'Waiting for you to approve' : 'Nothing waiting'}
          icon={BellRing}
          href="/restaurant/orders"
          loading={loading}
          // The only one that is ever urgent: a guest has asked for something and
          // nobody has answered yet.
          tone={waitingApproval > 0 ? 'urgent' : 'calm'}
        />
        <Tile
          label="In the kitchen"
          value={`${cooking}`}
          detail={cooking > 0 ? 'Tables being cooked for' : 'Nothing on the pass'}
          icon={ChefHat}
          href="/restaurant/kitchen"
          loading={loading}
        />
        <Tile
          label="Ready to serve"
          value={`${ready}`}
          detail={ready > 0 ? 'Waiting to go out' : 'All served'}
          icon={CircleCheck}
          href="/restaurant/kitchen"
          loading={loading}
          tone={ready > 0 ? 'ready' : 'calm'}
        />
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  detail,
  icon: Icon,
  href,
  loading,
  tone = 'calm',
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  href: Route;
  loading: boolean;
  tone?: 'calm' | 'urgent' | 'ready';
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group relative overflow-hidden rounded-2xl border bg-surface p-4 shadow-card transition-all duration-150',
        'hover:-translate-y-0.5 hover:shadow-raised focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-none',
        tone === 'urgent' ? 'border-warn-600/35' : tone === 'ready' ? 'border-brand-500/35' : 'border-line',
      )}
    >
      {/* A tile that wants attention says so with its surface, not with a
          louder number: the figure stays the same size on every tile so four of
          them can still be compared at a glance. */}
      {tone !== 'calm' && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0',
            tone === 'urgent'
              ? 'bg-[linear-gradient(135deg,var(--color-warn-50),transparent_65%)]'
              : 'bg-[linear-gradient(135deg,var(--color-brand-50),transparent_65%)]',
          )}
        />
      )}

      <div className="relative flex items-start justify-between gap-3">
        <span className="text-xs font-semibold tracking-wide text-muted">{label}</span>
        <span
          aria-hidden
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-xl ring-1 transition-colors',
            tone === 'urgent'
              ? 'bg-warn-50 text-warn-600 ring-warn-600/20'
              : tone === 'ready'
                ? 'bg-brand-50 text-brand-700 ring-brand-100'
                : 'bg-ground text-muted ring-line group-hover:text-brand-600',
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>

      {loading ? (
        <Skeleton className="relative mt-2 h-9 w-12" />
      ) : (
        <p
          className={cn(
            'relative mt-1.5 text-3xl font-semibold tracking-tight tabular-nums',
            tone === 'urgent' ? 'text-warn-600' : tone === 'ready' ? 'text-brand-700' : 'text-ink',
          )}
        >
          {value}
        </p>
      )}
      <p className="relative mt-0.5 text-xs text-muted">{detail}</p>
    </Link>
  );
}
