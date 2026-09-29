'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  Armchair,
  Check,
  Copy,
  Download,
  ExternalLink,
  LayoutGrid,
  Lock,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Receipt,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { canManageTables, canTakeOrders } from '@/lib/permissions';
import { formatMoney } from '@/lib/format';
import {
  useDeleteTable,
  useFloor,
  useRegenerateTableQr,
  useSaveTable,
  useTables,
  useToggleTable,
} from '@/lib/queries';
import { tableSchema, type TableValues } from '@/lib/schemas';
import type { RestaurantTable, TableOrderSummary } from '@/lib/types';
import { FloorView } from '@/components/tables/floor-view';
import { QrPreview } from '@/components/tables/qr-preview';
import { TableStatusSwitch } from '@/components/tables/table-status-switch';
import { useQrActions } from '@/components/tables/use-qr-actions';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { CheckboxField, TextField } from '@/components/ui/field';
import { ConfirmDialog, Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, FormError } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';

type StatusFilter = 'all' | 'active' | 'inactive';

const naturalOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Two jobs live under Tables, so the page has two tabs rather than one crowded
 * screen:
 *
 *  - **Floor** is the working view during service - the table grid a till operator
 *    reads at a glance, with a bill one tap away.
 *  - **Setup** is the occasional view - adding tables, renaming them, and the QR
 *    codes that get printed and put on them.
 *
 * Floor is the default because service is what happens every day; setup happens
 * once and then rarely.
 */
type TablesTab = 'floor' | 'setup';

export default function TablesPage() {
  const { session } = useAuth();
  const canManage = canManageTables(session?.user.role);
  const canOrder = canTakeOrders(session?.user.role);
  const [tab, setTab] = useState<TablesTab>(canOrder ? 'floor' : 'setup');

  if (!session) return null;

  return (
    <>
      <PageHeader
        title="Table view"
        description="Your floor at a glance. Every table has its own QR code, so diners can order from it themselves."
        action={
          canManage ? (
            <Link
              href="/restaurant/qr-codes"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink shadow-card transition-colors hover:bg-ground"
            >
              <QrCode className="size-4" aria-hidden />
              Print QR codes
            </Link>
          ) : undefined
        }
      />

      <div
        role="tablist"
        aria-label="Table view"
        className="mb-4 inline-flex rounded-xl border border-line bg-surface p-1 shadow-card"
      >
        {(
          [
            { id: 'floor', label: 'Floor', icon: LayoutGrid },
            { id: 'setup', label: 'Setup & QR codes', icon: QrCode },
          ] as const
        ).map((item) => {
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors',
                tab === item.id ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === 'floor' ? (
        canOrder ? (
          <FloorView />
        ) : (
          <Card>
            <EmptyState
              icon={Lock}
              title="Your role does not take orders"
              description="The floor view is for owners, managers and waiters. Kitchen staff work from the Kitchen panel instead."
            />
          </Card>
        )
      ) : canManage ? (
        <TablesManager restaurantName={session.restaurant.name} canOrder={canOrder} />
      ) : (
        <Card>
          <EmptyState
            icon={Lock}
            title="Only restaurant owners can manage tables"
            description="Table QR codes are what diners scan, so creating and changing them is limited to owners. Ask your restaurant owner if a table needs a new code."
          />
        </Card>
      )}
    </>
  );
}

function TablesManager({ restaurantName, canOrder }: { restaurantName: string; canOrder: boolean }) {
  const { data: tables, isPending, isError, error, refetch } = useTables();
  // What is happening at each table right now, so this page shows the same bill
  // the Service page does rather than a second, disagreeing view of the floor.
  const floor = useFloor({ enabled: canOrder });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RestaurantTable | null>(null);
  const [deleting, setDeleting] = useState<RestaurantTable | null>(null);
  const [regenerating, setRegenerating] = useState<RestaurantTable | null>(null);

  const toast = useToast();
  const qr = useQrActions(restaurantName);
  const toggle = useToggleTable();
  const remove = useDeleteTable();
  const regenerate = useRegenerateTableQr();
  const save = useSaveTable({
    onSuccess: (table, variables) => {
      toast.success(variables.id ? `Saved “${table.name}”.` : `Added “${table.name}” with a new QR code.`);
      setCreating(false);
      setEditing(null);
    },
  });

  const form = useForm<TableValues>({
    resolver: zodResolver(tableSchema),
    defaultValues: { name: '', isActive: true },
  });

  const counts = useMemo(() => {
    const list = tables ?? [];
    const active = list.filter((table) => table.isActive).length;
    return { total: list.length, active, inactive: list.length - active };
  }, [tables]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (tables ?? [])
      .filter((table) => (status === 'all' ? true : status === 'active' ? table.isActive : !table.isActive))
      .filter((table) => !term || table.name.toLowerCase().includes(term))
      .sort((a, b) => naturalOrder.compare(a.name, b.name));
  }, [tables, search, status]);

  // Suggest the next free "Table NN" so adding a run of tables is quick.
  const suggestedName = () => {
    const taken = new Set((tables ?? []).map((table) => table.name.toLowerCase()));
    for (let n = 1; n < 1000; n++) {
      const name = `Table ${String(n).padStart(2, '0')}`;
      if (!taken.has(name.toLowerCase())) return name;
    }
    return '';
  };

  const openCreate = () => {
    save.reset();
    form.reset({ name: suggestedName(), isActive: true });
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (table: RestaurantTable) => {
    save.reset();
    form.reset({ name: table.name, isActive: table.isActive });
    setCreating(false);
    setEditing(table);
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const onSubmit = form.handleSubmit((values) => {
    const name = values.name.trim().replace(/\s+/g, ' ');
    save.mutate(editing ? { id: editing.id, body: { name } } : { body: { name, isActive: values.isActive } });
  });

  const onToggle = (table: RestaurantTable, isActive: boolean) =>
    toggle.mutate(
      { id: table.id, isActive },
      {
        onSuccess: (updated) =>
          toast.success(
            updated.isActive
              ? `“${updated.name}” is active — its QR code opens the menu again.`
              : `“${updated.name}” is inactive — its QR code now shows “table not available”.`,
          ),
        onError: (mutationError) => toast.error(mutationError),
      },
    );

  return (
    <>
      <Card>
        {isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isPending ? (
          <TablesSkeleton />
        ) : tables.length === 0 ? (
          <EmptyState
            icon={Armchair}
            title="No tables yet"
            description="Add your first table to get a QR code you can print and place on it."
            action={
              <Button onClick={openCreate}>
                <Plus className="size-4" aria-hidden />
                Add your first table
              </Button>
            }
          />
        ) : (
          <>
            <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:px-5">
              <div className="relative sm:max-w-xs sm:flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search tables"
                  aria-label="Search tables"
                  className="w-full rounded-lg border border-line bg-surface py-2 pr-3 pl-9 text-sm shadow-card placeholder:text-muted/70 transition-[border-color,box-shadow] hover:border-muted/40 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none"
                />
              </div>

              <div role="radiogroup" aria-label="Filter by status" className="inline-flex self-start rounded-lg bg-ground p-0.5 ring-1 ring-line">
                {(
                  [
                    ['all', 'All', counts.total],
                    ['active', 'Active', counts.active],
                    ['inactive', 'Inactive', counts.inactive],
                  ] as const
                ).map(([value, label, count]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={status === value}
                    onClick={() => setStatus(value)}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors focus-visible:ring-4 focus-visible:ring-brand-500/20',
                      status === value ? 'bg-surface font-medium text-ink shadow-card' : 'text-muted hover:text-ink',
                    )}
                  >
                    {label}
                    <span className="text-xs text-muted tabular-nums">{count}</span>
                  </button>
                ))}
              </div>

              <div className="sm:ml-auto">
                <Button onClick={openCreate} className="w-full sm:w-auto">
                  <Plus className="size-4" aria-hidden />
                  Add table
                </Button>
              </div>
            </div>

            {visible.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No tables match"
                description={search.trim() ? `Nothing matches “${search.trim()}”.` : `You have no ${status} tables.`}
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSearch('');
                      setStatus('all');
                    }}
                  >
                    Show all tables
                  </Button>
                }
              />
            ) : (
              <ul className="grid gap-3 p-3 sm:p-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="Tables">
                {visible.map((table) => (
                  <li key={table.id} className="overflow-hidden rounded-xl border border-line bg-surface">
                    <TableCard
                      table={table}
                      bill={floor.data?.find((row) => row.tableId === table.id)}
                      copied={qr.copiedId === table.id}
                      downloading={qr.isBusy('download', table.id)}
                      printing={qr.isBusy('print', table.id)}
                      toggling={toggle.isPending && toggle.variables?.id === table.id}
                      onCopy={() => void qr.copy(table)}
                      onDownload={() => void qr.download(table)}
                      onPrint={() => void qr.print([table], String(table.id))}
                      onToggle={(next) => onToggle(table, next)}
                      onEdit={() => openEdit(table)}
                      onRegenerate={() => setRegenerating(table)}
                      onDelete={() => setDeleting(table)}
                      restaurantName={restaurantName}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>

      <Modal
        open={creating || editing !== null}
        title={editing ? 'Edit table' : 'Add table'}
        description={
          editing
            ? 'Renaming keeps the same QR code, so printed codes keep working.'
            : 'A unique QR code is created for the table straight away.'
        }
        onClose={closeForm}
        footer={
          <>
            <Button variant="secondary" onClick={closeForm} disabled={save.isPending}>
              Cancel
            </Button>
            <Button onClick={() => void onSubmit()} loading={save.isPending}>
              {editing ? 'Save changes' : 'Create table'}
            </Button>
          </>
        }
      >
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError error={save.error} />
          <TextField
            label="Table name or number"
            placeholder="Table 01"
            required
            autoFocus
            maxLength={60}
            hint="Printed under the QR code and shown to diners. Must be unique in your restaurant."
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
          {!editing && (
            <CheckboxField
              label="Active"
              hint="Inactive tables keep their QR code, but diners who scan it are told the table isn’t available."
              {...form.register('isActive')}
            />
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={regenerating !== null}
        title={`Regenerate the QR code for “${regenerating?.name}”?`}
        message="The current QR code and menu link stop working immediately. Anyone scanning an old printed code will be told the table isn’t available, so print and replace the new code."
        confirmLabel="Regenerate QR code"
        loading={regenerate.isPending}
        onCancel={() => setRegenerating(null)}
        onConfirm={() => {
          if (!regenerating) return;
          const { id, name } = regenerating;
          regenerate.mutate(id, {
            onSuccess: () => {
              toast.success(`New QR code created for “${name}”. The old code no longer works.`);
              setRegenerating(null);
            },
            onError: (mutationError) => toast.error(mutationError),
          });
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete “${deleting?.name}”?`}
        message="The table and its QR code are removed. Printed codes for this table stop working. This cannot be undone."
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          const { id, name } = deleting;
          remove.mutate(id, {
            onSuccess: () => {
              toast.success(`Deleted “${name}”.`);
              setDeleting(null);
            },
            onError: (mutationError) => toast.error(mutationError),
          });
        }}
      />
    </>
  );
}

function TableCard({
  table,
  bill,
  restaurantName,
  copied,
  downloading,
  printing,
  toggling,
  onCopy,
  onDownload,
  onPrint,
  onToggle,
  onEdit,
  onRegenerate,
  onDelete,
}: {
  table: RestaurantTable;
  /** The table's open bill, when the signed-in role may see bills at all. */
  bill?: TableOrderSummary;
  restaurantName: string;
  copied: boolean;
  downloading: boolean;
  printing: boolean;
  toggling: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onPrint: () => void;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  return (
    <article aria-labelledby={`table-${table.id}-name`} className="flex h-full flex-col">
      <div className="flex gap-4 p-4 sm:p-5">
        <QrPreview
          url={table.menuUrl}
          label={`QR code for ${table.name} at ${restaurantName}`}
          dimmed={!table.isActive}
          className="size-24 shrink-0 sm:size-28"
        />

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h2 id={`table-${table.id}-name`} className="min-w-0 text-base font-semibold break-words text-ink">
              {table.name}
            </h2>
            <TableStatusSwitch checked={table.isActive} tableName={table.name} disabled={toggling} onChange={onToggle} />
          </div>

          <Badge tone={table.isActive ? 'success' : 'neutral'} dot>
            {table.isActive ? 'Active' : 'Inactive'}
          </Badge>

          <div className="flex items-center gap-1 rounded-lg border border-line bg-ground py-1 pr-1 pl-2.5">
            <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={table.menuUrl}>
              {table.menuUrl.replace(/^https?:\/\//, '')}
            </p>
            <button
              type="button"
              onClick={onCopy}
              aria-label={`Copy menu link for ${table.name}`}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:ring-4 focus-visible:ring-brand-500/20"
            >
              {copied ? <Check className="size-4 text-brand-600" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            </button>
            <a
              href={table.menuUrl}
              target="_blank"
              rel="noopener"
              aria-label={`Open the menu for ${table.name} in a new tab`}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:ring-4 focus-visible:ring-brand-500/20"
            >
              <ExternalLink className="size-4" aria-hidden />
            </a>
          </div>
          {!table.isActive && (
            <p className="text-xs text-muted">Diners scanning this code are told the table isn’t available.</p>
          )}

          {bill?.orderId != null && (
            <Link
              href={`/restaurant/orders/${bill.orderId}` as Route}
              className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50/60 px-2.5 py-2 transition-colors hover:bg-brand-50"
            >
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-brand-700">
                  Bill #{bill.orderNumber} · {formatMoney(bill.total)}
                </span>
                <span className="block text-xs text-brand-700/80">
                  {bill.pendingApprovalCount > 0
                    ? `${bill.pendingApprovalCount} diner request(s) to approve`
                    : bill.unsentItemCount > 0
                      ? `${bill.unsentItemCount} not sent to the kitchen`
                      : `${bill.itemCount} item(s) · settle, discount or print`}
                </span>
              </span>
              <Receipt className="size-4 shrink-0 text-brand-700" aria-hidden />
            </Link>
          )}
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-line px-3 py-2 sm:px-4">
        <Button variant="ghost" size="sm" onClick={onDownload} loading={downloading} aria-label={`Download QR code PNG for ${table.name}`}>
          {!downloading && <Download className="size-4" aria-hidden />}
          PNG
        </Button>
        <Button variant="ghost" size="sm" onClick={onPrint} loading={printing} aria-label={`Print QR code for ${table.name}`}>
          {!printing && <Printer className="size-4" aria-hidden />}
          Print
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onRegenerate} aria-label={`Regenerate QR code for ${table.name}`} title="Regenerate QR code">
          <RefreshCw className="size-4" aria-hidden />
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${table.name}`} title="Edit">
          <Pencil className="size-4" aria-hidden />
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete} aria-label={`Delete ${table.name}`} title="Delete">
          <Trash2 className="size-4 text-danger-500" aria-hidden />
        </Button>
      </div>
    </article>
  );
}

function TablesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading tables">
      <div className="flex gap-3 border-b border-line px-5 py-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-56" />
      </div>
      <div className="grid gap-3 p-3 sm:p-4 md:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="flex gap-4 rounded-xl border border-line p-5">
            <Skeleton className="size-28 rounded-xl" />
            <div className="flex-1 space-y-2.5">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
