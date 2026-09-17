'use client';

import { ExternalLink, QrCode, Receipt, UtensilsCrossed } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';

/**
 * Orders are not built yet: there is no order API. This page says so plainly
 * and points at what is ready, instead of showing a table of invented orders.
 */
export default function OrdersPage() {
  const { session } = useAuth();

  return (
    <>
      <PageHeader title="Orders" description="Live orders from diners, once QR table ordering launches." />

      <Card className="overflow-hidden">
        <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-saffron-50 text-saffron-600 ring-1 ring-saffron-100">
            <Receipt className="size-6" aria-hidden />
          </span>
          <div className="max-w-md space-y-1.5">
            <p className="text-xs font-semibold tracking-[0.08em] text-saffron-600 uppercase">Coming soon</p>
            <h2 className="text-lg font-semibold tracking-tight text-ink">Ordering isn’t switched on yet</h2>
            <p className="text-sm text-muted">
              When diners can order by scanning a table QR code, their orders will arrive here with status
              updates. Nothing is being taken or charged today.
            </p>
          </div>
          {session && (
            <Link
              href={`/menu/${session.restaurant.slug}` as Route}
              target="_blank"
              rel="noopener"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink shadow-card transition-colors hover:bg-ground"
            >
              <ExternalLink className="size-4" aria-hidden />
              Preview your public menu
            </Link>
          )}
        </div>

        <div className="grid gap-px border-t border-line bg-line sm:grid-cols-2">
          <div className="flex gap-3 bg-surface p-5">
            <UtensilsCrossed className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
            <div>
              <p className="text-sm font-medium text-ink">Ready now</p>
              <p className="mt-0.5 text-sm text-muted">
                Your menu, prices, ingredients and availability are live on your public menu page.
              </p>
            </div>
          </div>
          <div className="flex gap-3 bg-surface p-5">
            <QrCode className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
            <div>
              <p className="text-sm font-medium text-ink">Next</p>
              <p className="mt-0.5 text-sm text-muted">Restaurant tables, table QR codes, then orders and their statuses.</p>
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
