'use client';

import { ArrowLeft, Lock } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { formatTime } from '@/lib/format';
import { canBill, canDeleteNcBill, canTakeOrders } from '@/lib/permissions';
import { useOrder } from '@/lib/queries';
import { OrderPanel } from '@/components/orders/order-panel';
import { Badge, Card, CardBody } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { PageHeader } from '@/components/page-header';

/** One bill, from first order to printed receipt. */
export default function OrderPage() {
  const params = useParams<{ id: string }>();
  const orderId = Number(params.id);
  const { session } = useAuth();

  const order = useOrder(Number.isFinite(orderId) ? orderId : undefined);

  if (!session) return null;

  if (!canTakeOrders(session.user.role)) {
    return (
      <Card>
        <EmptyState
          icon={Lock}
          title="Your role does not take orders"
          description="Ordering and billing are open to owners, managers and waiters."
        />
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title={
          order.data
            ? `Bill #${order.data.orderNumber} · ${order.data.tableName ?? 'Counter'}`
            : 'Bill'
        }
        description={
          order.data
            ? `Opened at ${formatTime(order.data.createdAt)}${
                order.data.source === 'DINER_QR' ? ' from the table QR menu' : ''
              }.`
            : undefined
        }
        action={
          <Link
            href={'/restaurant/orders' as Route}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink shadow-card transition-colors hover:bg-ground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back to service
          </Link>
        }
      />

      {order.isError ? (
        <Card>
          <CardBody>
            <ErrorState error={order.error} onRetry={() => void order.refetch()} />
          </CardBody>
        </Card>
      ) : order.isPending ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : order.data ? (
        <>
          {order.data.status !== 'OPEN' && (
            <div className="mb-4">
              <Badge tone={order.data.status === 'SETTLED' ? 'neutral' : 'danger'}>
                {order.data.status === 'SETTLED' ? 'Settled' : 'Voided'}
              </Badge>
            </div>
          )}
          <OrderPanel
            order={order.data}
            canBill={canBill(session.user.role)}
            canDeleteNc={canDeleteNcBill(session.user.role)}
          />
        </>
      ) : null}
    </>
  );
}
