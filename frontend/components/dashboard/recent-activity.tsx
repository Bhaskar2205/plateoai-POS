'use client';

import { Carrot, ChefHat, History, LayoutList, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useMemo } from 'react';
import type { Category, Dish, Ingredient } from '@/lib/types';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';

type Kind = 'dish' | 'category' | 'ingredient';

interface ActivityEvent {
  key: string;
  kind: Kind;
  verb: 'Added' | 'Updated';
  name: string;
  at: Date;
  href: Route;
}

const KINDS: Record<Kind, { label: string; icon: LucideIcon; href: Route }> = {
  dish: { label: 'dish', icon: ChefHat, href: '/restaurant/menu' },
  category: { label: 'category', icon: LayoutList, href: '/restaurant/menu/categories' },
  ingredient: { label: 'ingredient', icon: Carrot, href: '/restaurant/menu/ingredients' },
};

/** Edits within this window of creation are part of creating it, not a later update. */
const SAME_WRITE_MS = 5_000;
const LIMIT = 6;

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatRelative(date: Date, now = Date.now()): string {
  const seconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(seconds);

  if (abs < 45) return 'just now';
  if (abs < 3600) return relativeTime.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relativeTime.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86_400 * 7) return relativeTime.format(Math.round(seconds / 86_400), 'day');

  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Recent menu changes, derived from the real `createdAt` / `updatedAt` of each
 * record. There is no audit log yet, so this is labelled honestly: it shows the
 * latest state of things that still exist, and cannot show deletions.
 */
export function RecentActivity({
  dishes,
  categories,
  ingredients,
  loading,
  error,
  onRetry,
}: {
  dishes?: Dish[];
  categories?: Category[];
  ingredients?: Ingredient[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const events = useMemo<ActivityEvent[]>(() => {
    const collect = (kind: Kind, rows: { id: number; name: string; createdAt: string; updatedAt: string }[] = []) =>
      rows.map((row): ActivityEvent => {
        const created = new Date(row.createdAt);
        const updated = new Date(row.updatedAt);
        const wasEdited = updated.getTime() - created.getTime() > SAME_WRITE_MS;

        return {
          key: `${kind}-${row.id}`,
          kind,
          verb: wasEdited ? 'Updated' : 'Added',
          name: row.name,
          at: wasEdited ? updated : created,
          href: KINDS[kind].href,
        };
      });

    return [...collect('dish', dishes), ...collect('category', categories), ...collect('ingredient', ingredients)]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, LIMIT);
  }, [dishes, categories, ingredients]);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader title="Recent activity" description="Latest changes to your menu." />

      {error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : loading ? (
        <ul className="space-y-1 p-3" aria-busy="true" aria-label="Loading activity">
          {Array.from({ length: 4 }).map((_, index) => (
            <li key={index} className="flex items-center gap-3 px-2 py-2.5">
              <Skeleton className="size-8 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </li>
          ))}
        </ul>
      ) : events.length === 0 ? (
        <EmptyState
          compact
          icon={History}
          title="No activity yet"
          description="Changes to dishes, categories and ingredients will show up here."
        />
      ) : (
        <>
          <ol className="flex-1 space-y-0.5 p-3">
            {events.map((event) => {
              const Icon = KINDS[event.kind].icon;
              return (
                <li key={event.key}>
                  <Link
                    href={event.href}
                    className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-ground focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-offset-0"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ground text-muted ring-1 ring-line">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">
                        <span className="text-muted">
                          {event.verb} {KINDS[event.kind].label}
                        </span>{' '}
                        <span className="font-medium">{event.name}</span>
                      </span>
                      <time dateTime={event.at.toISOString()} title={event.at.toLocaleString('en-IN')} className="block text-xs text-muted">
                        {formatRelative(event.at)}
                      </time>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          <p className="border-t border-line px-5 py-3 text-xs text-muted">
            Based on when items were created or last edited. Deleted items aren’t shown.
          </p>
        </>
      )}
    </Card>
  );
}
