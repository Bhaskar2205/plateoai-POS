'use client';

import { Carrot, ExternalLink } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import type { CategoryFilter } from '@/components/menu/category-manager';
import { DishManager } from '@/components/menu/dish-manager';
import { SectionStrip } from '@/components/menu/section-strip';
import { PageHeader } from '@/components/page-header';

/**
 * The menu screen: your dishes, with the menu's sections as a filter above them.
 *
 * One column, not two. Sections used to sit in a panel of their own beside the
 * dishes, which gave a heading-with-a-name the same weight on screen as the
 * dishes themselves and left people unsure which side to start on. They are now
 * a row of chips - a filter, which is what they are used as - with everything
 * else behind "Edit sections".
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
        description="Add dishes, set prices, and switch a dish off when the kitchen runs out. Everything here is what diners see when they scan a table QR code."
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
              Ingredient list
            </Link>
          </div>
        }
      />

      <div className="mb-4">
        <SectionStrip selected={filter} onSelect={setFilter} />
      </div>

      <DishManager
        categoryFilter={filter}
        onCategoryFilterChange={setFilter}
        autoOpenCreate={intent === 'dish'}
        onAutoOpened={clearIntent}
      />
    </>
  );
}
