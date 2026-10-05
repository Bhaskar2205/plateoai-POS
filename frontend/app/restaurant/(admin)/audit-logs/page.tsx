'use client';

import { ChevronDown, ChevronRight, Lock, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { canManageTables } from '@/lib/permissions';
import { useAuditLogs, type AuditLogQuery } from '@/lib/queries';
import type { AuditAction, AuditEntity, AuditLogRow } from '@/lib/types';
import { Badge, Card, CardBody } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { PageHeader } from '@/components/page-header';

/**
 * Who changed what, and when.
 *
 * Written for someone reconstructing an evening, so it reads as sentences rather
 * than as constants: "Bill discounted", not BILL_DISCOUNTED. The before and after
 * are folded away by default because most of the time the question is "what
 * happened at eight o'clock", not "what exactly changed".
 *
 * Owner-only, matching the API. A manager is one of the people the log exists to
 * record, so the screen explains that rather than showing them an error.
 */

const ACTION_LABELS: Record<AuditAction, string> = {
  BILL_DISCOUNTED: 'Bill discounted',
  BILL_DISCOUNT_REMOVED: 'Discount removed',
  BILL_SETTLED: 'Bill settled',
  BILL_VOIDED: 'Bill voided',
  BILL_TDS_RECORDED: 'TDS recorded',
  TAX_CONFIGURATION_CHANGED: 'Tax configuration changed',
  SERVICE_CHARGE_CHANGED: 'Service charge changed',
  DISH_PRICE_CHANGED: 'Dish price changed',
  DISH_TAX_GROUP_CHANGED: 'Dish tax group changed',
  DISH_AVAILABILITY_CHANGED: 'Dish availability changed',
  TABLE_CREATED: 'Table created',
  TABLE_DEACTIVATED: 'Table deactivated',
  TABLE_REACTIVATED: 'Table reactivated',
  QR_REGENERATED: 'QR code regenerated',
  KITCHEN_CODE_REGENERATED: 'Kitchen code regenerated',
};

const ENTITY_LABELS: Record<AuditEntity, string> = {
  ORDER: 'Bill',
  TAX_COMPONENT: 'Charge',
  DISH: 'Dish',
  TABLE: 'Table',
  RESTAURANT: 'Restaurant',
};

/** Money actions are the ones an owner is usually looking for. */
const MONEY_ACTIONS = new Set<AuditAction>([
  'BILL_DISCOUNTED',
  'BILL_DISCOUNT_REMOVED',
  'BILL_SETTLED',
  'BILL_VOIDED',
  'BILL_TDS_RECORDED',
]);

const PAGE_SIZE = 25;

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function AuditLogsPage() {
  const { session } = useAuth();
  const canView = canManageTables(session?.user.role);

  const [query, setQuery] = useState<AuditLogQuery>({ page: 1, pageSize: PAGE_SIZE });
  const { data, isPending, isError, error, refetch } = useAuditLogs(query, canView);

  if (!session) return null;

  if (!canView) {
    return (
      <>
        <PageHeader title="Activity log" description="Who changed what, and when." />
        <EmptyState
          icon={Lock}
          title="The activity log is for the owner"
          description="It records what managers and staff did, so it is kept to the owner's account. Ask them if you need to check something."
        />
      </>
    );
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const page = query.page ?? 1;

  const setFilter = (patch: Partial<AuditLogQuery>) =>
    setQuery((current) => ({ ...current, ...patch, page: 1 }));

  return (
    <>
      <PageHeader
        title="Activity log"
        description="Every discount, void, settlement and rate change, as it happened."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          aria-label="Filter by action"
          value={query.action ?? ''}
          onChange={(event) =>
            setFilter({ action: (event.target.value || undefined) as AuditAction | undefined })
          }
          className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:border-brand-500 focus:outline-none"
        >
          <option value="">Everything</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-sm text-muted">
          From
          <input
            type="date"
            value={query.from ?? ''}
            onChange={(event) => setFilter({ from: event.target.value || undefined })}
            className="h-10 rounded-lg border border-line bg-surface px-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          to
          <input
            type="date"
            value={query.to ?? ''}
            onChange={(event) => setFilter({ to: event.target.value || undefined })}
            className="h-10 rounded-lg border border-line bg-surface px-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
          />
        </label>

        {(query.action || query.from || query.to) && (
          <button
            type="button"
            onClick={() => setQuery({ page: 1, pageSize: PAGE_SIZE })}
            className="text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600"
          >
            Clear
          </button>
        )}
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : data.rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="Nothing recorded yet"
          description="Discounts, voids, settlements, tax changes and QR regenerations appear here as they happen."
        />
      ) : (
        <>
          <Card>
            <ul className="divide-y divide-line">
              {data.rows.map((row) => (
                <AuditRow key={row.id} row={row} />
              ))}
            </ul>
          </Card>

          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <p className="text-muted">
              {data.total} record{data.total === 1 ? '' : 's'} · page {page} of {pages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setQuery((current) => ({ ...current, page: page - 1 }))}
                className="h-9 rounded-lg border border-line bg-surface px-3 font-medium text-ink disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= pages}
                onClick={() => setQuery((current) => ({ ...current, page: page + 1 }))}
                className="h-9 rounded-lg border border-line bg-surface px-3 font-medium text-ink disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      <Card className="mt-4">
        <CardBody>
          <p className="text-xs text-muted">
            Records are written by Plateo as each change is made, never by the browser, and anything
            affecting money is written in the same step as the change itself — so a bill that failed
            to settle leaves no record saying it did. Nothing here can be edited or deleted.
          </p>
        </CardBody>
      </Card>
    </>
  );
}

function AuditRow({ row }: { row: AuditLogRow }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(row.oldValue || row.newValue || row.requestId);

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-ground focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-none"
      >
        <span className="mt-0.5 shrink-0 text-muted">
          {hasDetail ? (
            open ? (
              <ChevronDown className="size-4" aria-hidden />
            ) : (
              <ChevronRight className="size-4" aria-hidden />
            )
          ) : (
            <span className="block size-4" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'text-sm font-semibold',
                MONEY_ACTIONS.has(row.action) ? 'text-ink' : 'text-ink/80',
              )}
            >
              {ACTION_LABELS[row.action] ?? row.action}
            </span>
            <Badge>{ENTITY_LABELS[row.entityType] ?? row.entityType}</Badge>
            {row.entityId !== null && (
              <span className="text-xs text-muted tabular-nums">#{row.entityId}</span>
            )}
          </span>

          <span className="mt-0.5 block text-xs text-muted">
            {when(row.createdAt)} · {row.userName ?? (row.userId === null ? 'A diner' : `User ${row.userId}`)}
            {row.reason ? ` · ${row.reason}` : ''}
          </span>
        </span>
      </button>

      {open && hasDetail && (
        <div className="grid gap-3 border-t border-line bg-ground px-4 py-3 sm:grid-cols-2">
          <ValueBlock label="Before" value={row.oldValue} />
          <ValueBlock label="After" value={row.newValue} />
          {row.requestId && (
            <p className="text-xs text-muted sm:col-span-2">
              Request <span className="font-mono">{row.requestId}</span>
              {row.ipAddress ? ` · from ${row.ipAddress}` : ''}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function ValueBlock({ label, value }: { label: string; value: Record<string, unknown> | null }) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
      {value === null ? (
        <p className="mt-1 text-sm text-muted">—</p>
      ) : (
        <dl className="mt-1 space-y-0.5">
          {Object.entries(value).map(([key, item]) => (
            <div key={key} className="flex gap-2 text-sm">
              <dt className="text-muted">{key}</dt>
              <dd className="min-w-0 break-words text-ink">{String(item)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
