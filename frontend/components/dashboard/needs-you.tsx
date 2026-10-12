'use client';

import {
  BellRing,
  CalendarClock,
  CircleCheck,
  EyeOff,
  PackageX,
  TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import type {
  Dish,
  InventoryReport,
  TableBooking,
  TableOrderSummary,
} from '@/lib/types';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatQuantity } from '@/components/inventory/stock-units';

/**
 * Everything asking for the owner's attention, gathered into one place.
 *
 * Scattered badges across four screens are how a restaurant ends up serving a
 * dish it ran out of yesterday. One list, ordered by how much it costs to ignore
 * - a guest waiting beats a shelf running low, which beats a dish quietly hidden
 * from the menu.
 *
 * When there is nothing, it says so plainly rather than disappearing: an empty
 * panel that vanishes makes an owner wonder whether it was ever checked.
 */
interface Concern {
  id: string;
  icon: LucideIcon;
  text: string;
  href: Route;
  tone: 'urgent' | 'warn';
}

export function NeedsYou({
  floor,
  dishes,
  inventory,
  inventoryOn,
  bookings,
}: {
  floor: TableOrderSummary[] | undefined;
  dishes: Dish[] | undefined;
  inventory: InventoryReport | undefined;
  /** Stock warnings are noise for a restaurant that does not track stock. */
  inventoryOn: boolean;
  bookings: TableBooking[] | undefined;
}) {
  const concerns: Concern[] = [];

  const waiting = (floor ?? []).reduce((sum, table) => sum + table.pendingApprovalCount, 0);
  if (waiting > 0) {
    concerns.push({
      id: 'approvals',
      icon: BellRing,
      text: `${waiting} diner ${waiting === 1 ? 'request is' : 'requests are'} waiting to be approved`,
      href: '/restaurant/orders',
      tone: 'urgent',
    });
  }

  if (inventoryOn) {
    const out = (inventory?.lowStock ?? []).filter((row) => row.onHand <= 0);
    const low = (inventory?.lowStock ?? []).filter((row) => row.onHand > 0);

    if (out.length > 0) {
      concerns.push({
        id: 'out',
        icon: PackageX,
        text:
          out.length === 1
            ? `${out[0].ingredientName} has run out`
            : `${out.length} ingredients have run out`,
        href: '/restaurant/inventory',
        tone: 'urgent',
      });
    }

    if (low.length > 0) {
      concerns.push({
        id: 'low',
        icon: TriangleAlert,
        text:
          low.length === 1
            ? `${low[0].ingredientName} is down to ${formatQuantity(low[0].onHand, low[0].unit)}`
            : `${low.length} ingredients are running low`,
        href: '/restaurant/inventory',
        tone: 'warn',
      });
    }
  }

  const unansweredBookings = (bookings ?? []).filter(
    (booking) => booking.status === 'REQUESTED',
  ).length;
  if (unansweredBookings > 0) {
    concerns.push({
      id: 'bookings',
      icon: CalendarClock,
      text: `${unansweredBookings} table ${unansweredBookings === 1 ? 'booking is' : 'bookings are'} waiting for a reply`,
      href: '/restaurant/bookings',
      tone: 'urgent',
    });
  }

  const hidden = (dishes ?? []).filter((dish) => !dish.isAvailable);
  if (hidden.length > 0) {
    concerns.push({
      id: 'hidden',
      icon: EyeOff,
      text:
        hidden.length === 1
          ? `${hidden[0].name} is hidden from the menu`
          : `${hidden.length} dishes are hidden from the menu`,
      href: '/restaurant/menu',
      tone: 'warn',
    });
  }

  return (
    <Card className={concerns.some((c) => c.tone === 'urgent') ? 'border-warn-600/30' : undefined}>
      <CardHeader title="Needs you" description="Anything a guest or the kitchen is waiting on." />

      {concerns.length === 0 ? (
        <CardBody className="flex items-center gap-2.5 border-t border-line">
          <CircleCheck className="size-4 shrink-0 text-brand-600" aria-hidden />
          <p className="text-sm text-muted">Nothing needs you right now.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {concerns.map((concern) => {
            const Icon = concern.icon;

            return (
              <li key={concern.id}>
                <Link
                  href={concern.href}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ground focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-none"
                >
                  <span
                    aria-hidden
                    className={
                      concern.tone === 'urgent'
                        ? 'grid size-8 shrink-0 place-items-center rounded-lg bg-warn-50 text-warn-600'
                        : 'grid size-8 shrink-0 place-items-center rounded-lg bg-ground text-muted'
                    }
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-ink">{concern.text}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
