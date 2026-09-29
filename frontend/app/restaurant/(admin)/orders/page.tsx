'use client';

import { ChefHat, LayoutGrid, Lock, QrCode, Receipt, Utensils } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { formatMoney, formatTime } from '@/lib/format';
import { canTakeOrders } from '@/lib/permissions';
import { useOrders } from '@/lib/queries';
import type { Order } from '@/lib/types';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { PageHeader } from '@/components/page-header';

/**
 * The day's bills.
 *
 * The floor itself lives under Tables, which is where staff work during service;
 * this page is the list view of the same day - what is running, what has been
 * paid, and what was voided - for the person reconciling rather than serving.
 */
export default function OrdersPage() {
  const { session } = useAuth();

  if (!session) return null;

  if (!canTakeOrders(session.user.role)) {
    return (
      <>
        <PageHeader title="Bills" description="Today's bills." />
        <Card>
          <EmptyState
            icon={Lock}
            title="Your role does not take orders"
            description="Bills are open to owners, managers and waiters. Kitchen staff work from the Kitchen panel instead."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Bills"
        description="Everything running now, and everything closed during today's service."
        action={
          <div className="flex gap-2">
            <Link
              href={'/restaurant/tables' as Route}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink shadow-card transition-colors hover:bg-ground"
            >
              <LayoutGrid className="size-4" aria-hidden />
              Floor
            </Link>
            <Link
              href={'/restaurant/kitchen' as Route}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink shadow-card transition-colors hover:bg-ground"
            >
              <ChefHat className="size-4" aria-hidden />
              Kitchen
            </Link>
          </div>
        }
      />
      <BillsList />
    </>
  );
}

function BillsList() {
  const orders = useOrders();

  if (orders.isError) {
    return (
      <Card>
        <CardBody>
          <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
        </CardBody>
      </Card>
    );
  }

  if (orders.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const running = (orders.data ?? []).filter((order) => order.status === 'OPEN');
  const closed = (orders.data ?? []).filter((order) => order.status !== 'OPEN');
  const takings = closed
    .filter((order) => order.status === 'SETTLED')
    .reduce((sum, order) => sum + order.total, 0);

  return (
    <div className="space-y-4">
      <Section
        title="Running"
        description="Bills open right now, including tables left open from an earlier service."
        orders={running}
        empty="Nothing is running. Open a bill from the floor."
      />

      <Section
        title="Closed today"
        description={
          closed.length > 0
            ? `${closed.length} bill(s) · ${formatMoney(takings)} taken`
            : undefined
        }
        orders={closed}
        empty="Nothing settled yet today."
      />
    </div>
  );
}

function Section({
  title,
  description,
  orders,
  empty,
}: {
  title: string;
  description?: string;
  orders: Order[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {orders.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">{empty}</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-line">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/restaurant/orders/${order.id}` as Route}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-ground"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ground text-muted">
                  {order.status === 'CANCELLED' ? (
                    <Utensils className="size-4" aria-hidden />
                  ) : (
                    <Receipt className="size-4" aria-hidden />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-ink">
                    #{order.orderNumber} · {order.tableName ?? 'Counter'}
                    {order.source === 'DINER_QR' && (
                      <QrCode className="size-3.5 shrink-0 text-saffron-600" aria-label="Started from a table QR code" />
                    )}
                  </p>
                  <p className="text-xs text-muted">
                    {order.items.filter((item) => item.status !== 'CANCELLED').length} item(s) ·
                    opened {formatTime(order.createdAt)}
                    {order.settledAt ? ` · settled ${formatTime(order.settledAt)}` : ''}
                    {order.paymentMethod ? ` · ${order.paymentMethod.toLowerCase()}` : ''}
                  </p>
                </div>

                {order.pendingApprovalCount > 0 && (
                  <Badge tone="warn">{order.pendingApprovalCount} to approve</Badge>
                )}

                <div className="text-right">
                  <p className="text-sm font-semibold text-ink tabular-nums">
                    {formatMoney(order.total)}
                  </p>
                  <Badge
                    tone={
                      order.status === 'OPEN'
                        ? 'success'
                        : order.status === 'SETTLED'
                          ? 'neutral'
                          : 'danger'
                    }
                  >
                    {order.status === 'OPEN' ? 'running' : order.status === 'SETTLED' ? 'paid' : 'voided'}
                  </Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
