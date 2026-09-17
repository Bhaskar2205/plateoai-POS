'use client';

import {
  Carrot,
  CheckCircle2,
  ChefHat,
  Copy,
  ExternalLink,
  LayoutList,
  Plus,
  Receipt,
  UtensilsCrossed,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useCategories, useDishes, useIngredients, useRestaurantStats } from '@/lib/queries';
import { MenuPreview } from '@/components/dashboard/menu-preview';
import { QuickAction } from '@/components/dashboard/quick-action';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { SummaryCard } from '@/components/dashboard/summary-card';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';

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
  const categories = useCategories();
  const ingredients = useIngredients();

  // The admin shell only renders this page once the session is loaded.
  if (!session) return null;

  const firstName = session.user.name.split(/\s+/)[0] || session.user.name;
  const data = stats.data;
  const statsLoading = stats.isPending;

  const unavailableDishes = data ? data.totalDishes - data.availableDishes : 0;
  const allergenIngredients = ingredients.data?.filter((ingredient) => ingredient.allergenInfo).length;

  const activityLoading = dishes.isPending || categories.isPending || ingredients.isPending;
  const activityError = dishes.error ?? categories.error ?? ingredients.error;

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-ink text-balance sm:text-[1.75rem]">
            {greeting()}, {firstName}
          </h1>
          <p className="max-w-2xl text-sm text-muted">
            Here’s how <span className="font-medium text-ink">{session.restaurant.name}</span> looks today — keep
            dishes, prices and availability up to date so diners always see an accurate menu.
          </p>
        </div>
      </section>

      <section aria-labelledby="summary-heading">
        <h2 id="summary-heading" className="sr-only">
          Summary
        </h2>

        {stats.isError ? (
          <Card>
            <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <SummaryCard
              label="Total dishes"
              value={data?.totalDishes ?? 0}
              hint={data ? (unavailableDishes > 0 ? `${unavailableDishes} marked unavailable` : 'All on the menu') : undefined}
              icon={ChefHat}
              tone="brand"
              loading={statsLoading}
              href="/restaurant/menu"
            />
            <SummaryCard
              label="Available dishes"
              value={data?.availableDishes ?? 0}
              hint={
                data && data.totalDishes > 0
                  ? `${Math.round((data.availableDishes / data.totalDishes) * 100)}% of your menu`
                  : 'No dishes yet'
              }
              progress={data && data.totalDishes > 0 ? data.availableDishes / data.totalDishes : undefined}
              icon={CheckCircle2}
              tone="brand"
              loading={statsLoading}
              href="/restaurant/menu"
            />
            <SummaryCard
              label="Categories"
              value={data?.totalCategories ?? 0}
              hint={data ? `${data.activeCategories} visible to diners` : undefined}
              icon={LayoutList}
              tone="saffron"
              loading={statsLoading}
              href="/restaurant/menu/categories"
            />
            <SummaryCard
              label="Ingredients"
              value={data?.totalIngredients ?? 0}
              hint={
                allergenIngredients === undefined
                  ? undefined
                  : allergenIngredients > 0
                    ? `${allergenIngredients} with allergen notes`
                    : 'No allergen notes yet'
              }
              icon={Carrot}
              tone="saffron"
              loading={statsLoading}
              href="/restaurant/menu/ingredients"
            />
            <SummaryCard
              label="Pending orders"
              value={null}
              icon={Receipt}
              unavailableReason="Arrives with QR table ordering."
            />
          </div>
        )}
      </section>

      <section aria-labelledby="actions-heading" className="space-y-3">
        <h2 id="actions-heading" className="text-sm font-semibold text-ink">
          Quick actions
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickAction
            primary
            href="/restaurant/menu?new=dish"
            title="Add New Dish"
            description="Price, prep time, ingredients and nutrition."
            icon={Plus}
          />
          <QuickAction
            href="/restaurant/menu?new=category"
            title="Add Category"
            description="Group dishes into sections like Starters."
            icon={LayoutList}
          />
          <QuickAction
            href="/restaurant/menu/ingredients?new=1"
            title="Add Ingredient"
            description="Build a reusable pantry with allergen notes."
            icon={Carrot}
          />
          <QuickAction
            href={`/menu/${session.restaurant.slug}` as Route}
            external
            title="View Menu"
            description="See your menu exactly as diners do."
            icon={UtensilsCrossed}
          />
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] items-stretch gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <MenuPreview
          dishes={dishes.data}
          loading={dishes.isPending}
          error={dishes.error}
          onRetry={() => void dishes.refetch()}
        />
        <RecentActivity
          dishes={dishes.data}
          categories={categories.data}
          ingredients={ingredients.data}
          loading={activityLoading}
          error={activityError}
          onRetry={() => {
            void dishes.refetch();
            void categories.refetch();
            void ingredients.refetch();
          }}
        />
      </div>

      <PublicMenuLink slug={session.restaurant.slug} />
    </div>
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
