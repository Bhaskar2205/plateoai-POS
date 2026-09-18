'use client';

import { Armchair, Download, Lock, Printer, QrCode } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { canManageTables } from '@/lib/permissions';
import { useTables } from '@/lib/queries';
import { QrPreview } from '@/components/tables/qr-preview';
import { useQrActions } from '@/components/tables/use-qr-actions';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { PageHeader } from '@/components/page-header';

const naturalOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Print-ready QR cards for every table. Management (rename, deactivate,
 * regenerate) lives on the Tables page; this page is for getting codes onto paper.
 */
export default function QrCodesPage() {
  const { session } = useAuth();
  const canManage = canManageTables(session?.user.role);
  const { data: tables, isPending, isError, error, refetch } = useTables({ enabled: canManage });
  const [includeInactive, setIncludeInactive] = useState(false);
  const qr = useQrActions(session?.restaurant.name ?? '');

  const visible = useMemo(
    () =>
      (tables ?? [])
        .filter((table) => includeInactive || table.isActive)
        .sort((a, b) => naturalOrder.compare(a.name, b.name)),
    [tables, includeInactive],
  );
  const inactiveCount = (tables ?? []).filter((table) => !table.isActive).length;

  if (!session) return null;

  const printAll = (
    <Button onClick={() => void qr.print(visible, 'all')} loading={qr.isBusy('print', 'all')} disabled={visible.length === 0}>
      {!qr.isBusy('print', 'all') && <Printer className="size-4" aria-hidden />}
      Print {visible.length > 0 ? `all ${visible.length}` : 'all'}
    </Button>
  );

  return (
    <>
      <PageHeader
        title="QR codes"
        description="Print a card for each table. Each card shows your restaurant, the QR code and the table name — one card per page."
        action={canManage && tables && tables.length > 0 ? printAll : undefined}
      />

      {!canManage ? (
        <Card>
          <EmptyState
            icon={Lock}
            title="Only restaurant owners can print table QR codes"
            description="Ask your restaurant owner for printed codes."
          />
        </Card>
      ) : isError ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-busy="true" aria-label="Loading QR codes">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} className="p-4">
              <Skeleton className="aspect-[3/4] w-full rounded-xl" />
              <Skeleton className="mt-3 h-8 w-full" />
            </Card>
          ))}
        </div>
      ) : tables.length === 0 ? (
        <Card>
          <EmptyState
            icon={QrCode}
            title="No tables yet"
            description="QR codes are created per table. Add your tables first, then print their codes here."
            action={
              <Link
                href="/restaurant/tables"
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
              >
                <Armchair className="size-4" aria-hidden />
                Go to Tables
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {visible.length} {visible.length === 1 ? 'card' : 'cards'}
              {!includeInactive && inactiveCount > 0 && ` · ${inactiveCount} inactive hidden`}
            </p>
            {inactiveCount > 0 && (
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={includeInactive}
                  onChange={(event) => setIncludeInactive(event.target.checked)}
                  className="size-4 cursor-pointer accent-brand-600"
                />
                Include inactive tables
              </label>
            )}
          </div>

          {visible.length === 0 ? (
            <Card>
              <EmptyState
                icon={QrCode}
                title="All your tables are inactive"
                description="Activate a table on the Tables page, or include inactive tables to print their codes anyway."
              />
            </Card>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-label="QR code cards">
              {visible.map((table) => (
                <li key={table.id}>
                  <Card className="flex h-full flex-col p-3">
                    <QrPreview
                      url={table.menuUrl}
                      label={`Printable QR card for ${table.name}`}
                      card={{ tableName: table.name, restaurantName: session.restaurant.name }}
                      dimmed={!table.isActive}
                      className="aspect-[3/4] w-full"
                    />
                    <div className="mt-3 flex items-center justify-between gap-2 px-1">
                      <p className="min-w-0 truncate text-sm font-medium text-ink" title={table.name}>
                        {table.name}
                      </p>
                      <Badge tone={table.isActive ? 'success' : 'neutral'} dot>
                        {table.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void qr.download(table)}
                        loading={qr.isBusy('download', table.id)}
                        aria-label={`Download QR code PNG for ${table.name}`}
                      >
                        {!qr.isBusy('download', table.id) && <Download className="size-4" aria-hidden />}
                        PNG
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void qr.print([table], String(table.id))}
                        loading={qr.isBusy('print', table.id)}
                        aria-label={`Print QR code for ${table.name}`}
                      >
                        {!qr.isBusy('print', table.id) && <Printer className="size-4" aria-hidden />}
                        Print
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
