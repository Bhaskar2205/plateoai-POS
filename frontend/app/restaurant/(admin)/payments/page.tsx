'use client';

import { AlertTriangle, CreditCard, Lock, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { canBill, canManageTables } from '@/lib/permissions';
import {
  usePaymentExceptions,
  usePayments,
  usePaymentSettings,
  useReconcilePayments,
  useResolvePaymentException,
} from '@/lib/queries';
import type { PaymentIntent, PaymentStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';

/**
 * Payments taken, attempted, and the ones that need a person.
 *
 * Failed and abandoned attempts are shown alongside successful ones, because the
 * useful question here is rarely "what did we take" - the day-end report answers
 * that - but "why did that guest say their card did not work".
 *
 * Owners and managers. Not the kitchen: a kitchen screen is visible to anyone
 * walking past it, and what a table paid is none of its business.
 */

const STATUS_LABELS: Record<PaymentStatus, string> = {
  CREATED: 'Started',
  PENDING: 'Waiting on the guest',
  AUTHORIZED: 'Held, not taken',
  CAPTURED: 'Paid',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partly refunded',
};

const STATUS_TONE: Record<PaymentStatus, string> = {
  CREATED: 'bg-ground text-muted',
  PENDING: 'bg-warn-50 text-warn-600',
  AUTHORIZED: 'bg-info-50 text-info-700',
  CAPTURED: 'bg-brand-50 text-brand-700',
  FAILED: 'bg-danger-50 text-danger-600',
  CANCELLED: 'bg-ground text-muted',
  REFUNDED: 'bg-info-50 text-info-700',
  PARTIALLY_REFUNDED: 'bg-info-50 text-info-700',
};

const PROVIDER_LABELS: Record<string, string> = {
  PLATEO_INTERNAL: 'Taken at the till',
  RAZORPAY: 'Razorpay',
  CASHFREE_FUTURE: 'Cashfree',
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function PaymentsPage() {
  const { session } = useAuth();
  const toast = useToast();
  const canSee = canBill(session?.user.role);
  const isOwner = canManageTables(session?.user.role);

  const payments = usePayments(canSee);
  const settings = usePaymentSettings(isOwner);
  const exceptions = usePaymentExceptions(canSee);

  const reconcile = useReconcilePayments({
    onSuccess: (result) =>
      toast.success(
        result.found.length === 0
          ? `Checked ${result.checked} payment${result.checked === 1 ? '' : 's'}. Everything adds up.`
          : `Found ${result.found.length} thing${result.found.length === 1 ? '' : 's'} to look at.`,
      ),
    onError: (error) => toast.error(error),
  });

  if (!session) return null;

  if (!canSee) {
    return (
      <>
        <PageHeader title="Payments" description="What guests paid, and what failed." />
        <EmptyState
          icon={Lock}
          title="Payments are for owners and managers"
          description="They show what the restaurant took, so they are limited to the people who handle the money. Waiters and kitchen staff do not see them."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every attempt to collect a bill — taken, failed and abandoned."
        action={
          <Button
            variant="secondary"
            loading={reconcile.isPending}
            onClick={() => reconcile.mutate()}
          >
            {!reconcile.isPending && <RefreshCw className="size-4" aria-hidden />}
            Check for discrepancies
          </Button>
        }
      />

      {isOwner && settings.data && <ProviderStatus settings={settings.data} />}

      {exceptions.data && exceptions.data.length > 0 && (
        <Card className="mb-4 border-warn-500/30">
          <CardHeader
            title="Needs a person"
            description="Plateo never repairs money on its own. These are written down for you to decide about."
          />
          <ul className="divide-y divide-line border-t border-line">
            {exceptions.data.map((row) => (
              <ExceptionRow key={row.id} row={row} />
            ))}
          </ul>
        </Card>
      )}

      {payments.isError ? (
        <ErrorState error={payments.error} onRetry={() => void payments.refetch()} />
      ) : payments.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : payments.data.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No online payments yet"
          description="Bills settled at the till by cash, UPI or card appear in Reports, not here. This page fills up once guests start paying online."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {payments.data.map((payment) => (
              <PaymentRow key={payment.id} payment={payment} />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function ProviderStatus({
  settings,
}: {
  settings: NonNullable<ReturnType<typeof usePaymentSettings>['data']>;
}) {
  return (
    <Card className="mb-4">
      <CardHeader
        title="Payment providers"
        description="Online payment is an addition. Cash, UPI and card at the till keep working either way."
      />
      <CardBody>
        <ul className="space-y-2">
          {settings.providers.map((provider) => (
            <li key={provider.provider} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm text-ink">
                {provider.usable ? (
                  <ShieldCheck className="size-4 text-brand-600" aria-hidden />
                ) : (
                  <AlertTriangle className="size-4 text-muted" aria-hidden />
                )}
                {PROVIDER_LABELS[provider.provider] ?? provider.provider}
              </span>
              <Badge tone={provider.usable ? 'success' : 'neutral'}>{provider.label}</Badge>
            </li>
          ))}
        </ul>

        {!settings.onlinePaymentsAvailable && (
          <p className="mt-3 text-xs text-muted">
            No online payment provider is connected, so guests cannot pay from their phone yet.
            Settling bills at the till is unaffected.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function PaymentRow({ payment }: { payment: PaymentIntent }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink tabular-nums">{payment.amount}</span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              STATUS_TONE[payment.status],
            )}
          >
            {STATUS_LABELS[payment.status]}
          </span>
          {payment.orderNumber !== null && (
            <span className="text-xs text-muted">Bill #{payment.orderNumber}</span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {PROVIDER_LABELS[payment.provider] ?? payment.provider} · started {when(payment.createdAt)}
          {payment.capturedAt ? ` · paid ${when(payment.capturedAt)}` : ''}
        </p>
        {payment.failureReason && (
          <p className="mt-0.5 text-xs text-danger-600">{payment.failureReason}</p>
        )}
      </div>

      {payment.providerPaymentId && (
        <span className="font-mono text-xs text-muted">{payment.providerPaymentId}</span>
      )}
    </li>
  );
}

function ExceptionRow({
  row,
}: {
  row: NonNullable<ReturnType<typeof usePaymentExceptions>['data']>[number];
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);

  const resolve = useResolvePaymentException({
    onSuccess: () => {
      setOpen(false);
      toast.success('Recorded as dealt with.');
    },
    onError: (error) => toast.error(error),
  });

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink">{row.detail}</p>
          <p className="mt-0.5 text-xs text-muted">
            {when(row.createdAt)}
            {row.orderId !== null ? ` · bill ${row.orderId}` : ''}
          </p>
        </div>
        <Button variant="ghost" onClick={() => setOpen((current) => !current)}>
          {open ? 'Cancel' : 'Mark as dealt with'}
        </Button>
      </div>

      {open && (
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What did you do about it?"
            className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:border-brand-500 focus:outline-none"
          />
          <Button
            loading={resolve.isPending}
            disabled={note.trim().length === 0}
            onClick={() => resolve.mutate({ id: row.id, note: note.trim() })}
          >
            Save
          </Button>
        </div>
      )}
    </li>
  );
}
