'use client';

import {
  Carrot,
  CheckCircle2,
  ChefHat,
  Copy,
  ExternalLink,
  LayoutList,
  Plus,
  UtensilsCrossed,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { canBill, canTakeOrders } from '@/lib/permissions';
import {
  useBookings,
  useDishes,
  useFloor,
  useInventoryReport,
  useInventorySettings,
  useItemsReport,
  useRestaurantStats,
  useSalesReport,
} from '@/lib/queries';
import { SectionHeading } from '@/components/page-header';
import { today } from '@/components/reports/report-shell';
import { HowTheyPaid } from '@/components/dashboard/how-they-paid';
import { NeedsYou } from '@/components/dashboard/needs-you';
import { QuickAction } from '@/components/dashboard/quick-action';
import { SellingToday } from '@/components/dashboard/selling-today';
import { ServiceNow } from '@/components/dashboard/service-now';
import { TodayHero } from '@/components/dashboard/today-hero';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';

/**
 * The owner's home screen.
 *
 * Ordered by what somebody actually opens it to find out: what we took today,
 * what is happening in the room, what needs answering, what is selling. The menu
 * counts that used to lead the page - dishes, categories, ingredients - are true
 * but they are setup figures, and an owner learns them once and never looks
 * again, so they sit at the bottom as a strip.
 *
 * Money is owner-and-manager only, exactly as Reports is. A waiter who reaches
 * this page gets the parts of it they can act on and none of the takings.
 */
function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';

  return 'Good evening';
}

export default function DashboardPage() {
  const { session } = useAuth();
  const stats = useRestaurantStats();
  const dishes = useDishes();
  const floor = useFloor();

  const seesMoney = canBill(session?.user.role);
  const range = { from: today(), to: today() };

  const sales = useSalesReport(range, seesMoney);
  const items = useItemsReport(range, seesMoney);

  // Both arrive from the guest app rather than the floor. Anyone who may take an
  // order may answer them, so these are not gated on seeing money.
  const bookings = useBookings(canTakeOrders(session?.user.role));

  const inventorySettings = useInventorySettings(seesMoney);
  const inventoryOn = (inventorySettings.data?.mode ?? 'DISABLED') !== 'DISABLED';
  // Only fetched once stock tracking is on, so a restaurant that never opened
  // the inventory screen does not pay for a report it would ignore.
  const inventory = useInventoryReport(range, inventoryOn);

  // The admin shell only renders this page once the session is loaded.
  if (!session) return null;

  const firstName = session.user.name.split(/\s+/)[0] || session.user.name;
  const openBills = floor.data?.filter((table) => table.orderId !== null).length;

  return (
    <div className="space-y-8">
      {seesMoney ? (
        sales.isError ? (
          <Card>
            <ErrorState error={sales.error} onRetry={() => void sales.refetch()} />
          </Card>
        ) : (
          <TodayHero
            restaurantName={session.restaurant.name}
            greeting={`${greeting()}, ${firstName}`}
            sales={sales.data}
            loading={sales.isPending}
            openBills={openBills}
          />
        )
      ) : (
        <header className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-ink text-balance">
            {greeting()}, {firstName}
          </h1>
          <p className="text-sm text-muted">
            Here is what is happening at{' '}
            <span className="font-medium text-ink">{session.restaurant.name}</span> right now.
          </p>
        </header>
      )}

      <ServiceNow floor={floor.data} loading={floor.isPending} />

      {/* Two columns only when there is something to put in both. A waiter sees
          no takings, so the sales half is absent and the rest runs full width -
          putting the four quick actions in a third of the page crushed them into
          unreadable slivers. */}
      {seesMoney ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <SellingToday items={items.data} loading={items.isPending} />

          <div className="space-y-6">
            <NeedsYou
              floor={floor.data}
              dishes={dishes.data}
              inventory={inventory.data}
              inventoryOn={inventoryOn}
              bookings={bookings.data}
            />
            <HowTheyPaid payments={sales.data?.payments} loading={sales.isPending} />
          </div>
        </div>
      ) : (
        <NeedsYou
          floor={floor.data}
          dishes={dishes.data}
          inventory={inventory.data}
          inventoryOn={inventoryOn}
          bookings={bookings.data}
        />
      )}

      <QuickActions slug={session.restaurant.slug} />

      <section aria-labelledby="menu-heading" className="space-y-3">
        <SectionHeading id="menu-heading">Your menu</SectionHeading>

        {stats.isError ? (
          <Card>
            <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
          </Card>
        ) : (
          <Card>
            <dl className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <Count
                label="Dishes"
                value={stats.data?.totalDishes}
                hint={
                  stats.data
                    ? stats.data.totalDishes === stats.data.availableDishes
                      ? 'All on the menu'
                      : `${stats.data.totalDishes - stats.data.availableDishes} hidden`
                    : undefined
                }
                icon={ChefHat}
                href="/restaurant/menu"
                loading={stats.isPending}
              />
              <Count
                label="Sections"
                value={stats.data?.totalCategories}
                hint={stats.data ? `${stats.data.activeCategories} visible to diners` : undefined}
                icon={LayoutList}
                href="/restaurant/menu/categories"
                loading={stats.isPending}
              />
              <Count
                label="Ingredients"
                value={stats.data?.totalIngredients}
                hint={
                  stats.data?.totalIngredients === 0
                    ? 'None added yet'
                    : 'Reused across dishes'
                }
                icon={Carrot}
                href="/restaurant/menu/ingredients"
                loading={stats.isPending}
              />
            </dl>
          </Card>
        )}
      </section>

      {/* Copyable, so it uses the permanent slug that survives a rename. */}
      <PublicMenuLink slug={session.restaurant.publicSlug} />
    </div>
  );
}

function QuickActions({ slug }: { slug: string }) {
  return (
    <section aria-labelledby="actions-heading" className="space-y-3">
      <SectionHeading id="actions-heading">Quick actions</SectionHeading>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <QuickAction
          primary
          href="/restaurant/menu?new=dish"
          title="Add a dish"
          description="Name and price is enough to start."
          icon={Plus}
        />
        <QuickAction
          href="/restaurant/menu"
          title="Edit the menu"
          description="Prices, photos, sections and what's in each dish."
          icon={LayoutList}
        />
        <QuickAction
          href="/restaurant/menu/ingredients?new=1"
          title="Add an ingredient"
          description="Reusable across dishes, with allergen notes."
          icon={Carrot}
        />
        <QuickAction
          href={`/menu/${slug}` as Route}
          external
          title="View menu"
          description="See your menu exactly as diners do."
          icon={UtensilsCrossed}
        />
      </div>
    </section>
  );
}

/** One setup figure. Three to a card, because none of them earns a card alone. */
function Count({
  label,
  value,
  hint,
  icon: Icon,
  href,
  loading,
}: {
  label: string;
  value: number | undefined;
  hint: string | undefined;
  icon: LucideIcon;
  href: Route;
  loading: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 p-4 transition-colors hover:bg-ground focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-none"
    >
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-ground text-muted">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <dt className="text-xs text-muted">{label}</dt>
        <dd className="flex items-baseline gap-2">
          {loading || value === undefined ? (
            <Skeleton className="mt-1 h-6 w-10" />
          ) : (
            <span className="text-xl font-semibold text-ink">{value}</span>
          )}
          {hint && <span className="truncate text-xs text-muted">{hint}</span>}
        </dd>
      </div>
    </Link>
  );
}

/** Where the restaurant's public menu lives, with copy and open actions. */
function PublicMenuLink({ slug }: { slug: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const path = `/menu/${slug}`;
  const url = typeof window === 'undefined' ? path : `${window.location.origin}${path}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Public menu link copied.');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(new Error('Could not copy the link. Select it and copy it manually.'));
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-saffron-50 text-saffron-600 ring-1 ring-saffron-100">
        <UtensilsCrossed className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">Your public menu</p>
        <p className="mt-0.5 truncate font-mono text-xs text-muted" title={url}>
          {url}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink shadow-card transition-colors hover:bg-ground focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-offset-0"
        >
          {copied ? <CheckCircle2 className="size-4 text-brand-600" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <Link
          href={path as Route}
          target="_blank"
          rel="noopener"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-offset-0"
        >
          <ExternalLink className="size-4" aria-hidden />
          Open
        </Link>
      </div>
    </Card>
  );
}
