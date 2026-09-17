'use client';

import { Carrot, ExternalLink } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { CategoryManager, type CategoryFilter } from '@/components/menu/category-manager';
import { DishManager } from '@/components/menu/dish-manager';
import { PageHeader } from '@/components/page-header';

/**
 * The menu management screen: categories on the left act as a filter for the
 * dish list on the right. Stacks to one column on phones.
 */
export default function MenuPage() {
  // useSearchParams needs a Suspense boundary for static prerendering.
  return (
    <Suspense fallback={null}>
      <MenuScreen />
    </Suspense>
  );
}

function MenuScreen() {
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const { session } = useAuth();
  const slug = session?.restaurant.slug;
  const router = useRouter();
  const intent = useSearchParams().get('new');
  // Drop ?new= once the dialog has opened, so refresh or Back doesn't reopen it.
  const clearIntent = () => router.replace('/restaurant/menu', { scroll: false });

  return (
    <>
      <PageHeader
        title="Menu"
        description="Organise categories, add dishes with their ingredients, and switch availability as the kitchen runs out."
        action={
          <div className="flex flex-wrap gap-2">
          {slug && (
            <Link
              href={`/menu/${slug}` as Route}
              target="_blank"
              rel="noopener"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-ground"
            >
              <ExternalLink className="size-4" aria-hidden />
              View public menu
            </Link>
          )}
          <Link
            href="/restaurant/menu/ingredients"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-ground"
          >
            <Carrot className="size-4" aria-hidden />
            Manage ingredients
          </Link>
          </div>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-6">
          <CategoryManager
            selected={filter}
            onSelect={setFilter}
            autoOpenCreate={intent === 'category'}
            onAutoOpened={clearIntent}
          />
        </div>
        <DishManager
          categoryFilter={filter}
          onCategoryFilterChange={setFilter}
          autoOpenCreate={intent === 'dish'}
          onAutoOpened={clearIntent}
        />
      </div>
    </>
  );
}
