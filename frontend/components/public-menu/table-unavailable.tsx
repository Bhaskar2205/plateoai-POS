'use client';

import { Armchair, UtensilsCrossed } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { PublicMenu } from '@/lib/public-menu';
import { RestaurantMark } from './public-menu-view';

/**
 * Shown when a table QR code is unknown, has been replaced, or the table is
 * switched off. One message for all three, matching the API: the page does not
 * reveal which it was. The restaurant itself is fine, so its branding stays.
 */
export function TableUnavailable({ restaurant }: { restaurant: PublicMenu['restaurant'] }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-ground px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-6 text-center shadow-card sm:p-8">
        <div className="flex justify-center">
          <RestaurantMark restaurant={restaurant} />
        </div>
        <p className="mt-4 text-sm font-medium text-muted">{restaurant.name}</p>

        <span className="mx-auto mt-5 grid size-11 place-items-center rounded-2xl bg-saffron-50 text-saffron-600 ring-1 ring-saffron-100">
          <Armchair className="size-5" aria-hidden />
        </span>
        <h1 className="mt-3 text-xl font-semibold text-ink text-balance">This table’s QR code isn’t active</h1>
        <p className="mt-2 text-sm text-muted">
          The code may have been replaced, or the table isn’t being served right now. Please ask a member of staff
          for help.
        </p>

        <Link
          href={`/menu/${restaurant.slug}` as Route}
          className="mt-6 inline-flex h-10 items-center gap-2 rounded-full bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700"
        >
          <UtensilsCrossed className="size-4" aria-hidden />
          View the menu
        </Link>
      </div>
    </main>
  );
}
