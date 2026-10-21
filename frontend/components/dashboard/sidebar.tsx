'use client';

import {
  Armchair,
  CalendarCheck,
  Boxes,
  Carrot,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Percent,
  Printer,
  QrCode,
  UserRound,
  Receipt,
  ScrollText,
  Settings,
  Store,
  TrendingUp,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import {
  BILLING_ROLES,
  ORDER_WRITE_ROLES,
  RESTAURANT_ADMIN_ROLES,
  TABLE_ADMIN_ROLES,
} from '@/lib/permissions';
import type { UserRole } from '@/lib/types';
import { Avatar, PlateoWordmark } from './brand';

interface NavItem {
  href: Route;
  label: string;
  icon: LucideIcon;
  /** Only these roles see the item; omitted means everyone. */
  roles?: UserRole[];
}

export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Manage',
    items: [
      { href: '/restaurant/dashboard', label: 'Overview', icon: LayoutDashboard },
      { href: '/restaurant/menu', label: 'Menu', icon: UtensilsCrossed },
      { href: '/restaurant/menu/ingredients', label: 'Ingredients', icon: Carrot },
      // Stock sits next to the ingredients it counts. Owners and managers: it
      // shows what the restaurant owns and what it paid.
      { href: '/restaurant/inventory', label: 'Inventory', icon: Boxes, roles: BILLING_ROLES },
      // Everyone who takes orders needs the floor; the Setup tab inside is still
      // owner-only, so a waiter sees the tables without the QR controls.
      { href: '/restaurant/tables', label: 'Tables', icon: Armchair, roles: ORDER_WRITE_ROLES },
      { href: '/restaurant/qr-codes', label: 'QR Codes', icon: QrCode, roles: TABLE_ADMIN_ROLES },
      // Who may take orders, and what they sign in with on their own phone.
      { href: '/restaurant/captains', label: 'Captain App', icon: UserRound, roles: TABLE_ADMIN_ROLES },
      { href: '/restaurant/orders', label: 'Bills', icon: Receipt, roles: ORDER_WRITE_ROLES },
      // What comes out of the roll: the kitchen ticket, the customer bill, and
      // the payment QR an owner prints on it.
      { href: '/restaurant/printing', label: 'KOT & Printing', icon: Printer, roles: ORDER_WRITE_ROLES },
      // Arrives from the Plateo guest app rather than from the floor, and is
      // answered by whoever takes orders.
      { href: '/restaurant/bookings', label: 'Bookings', icon: CalendarCheck, roles: ORDER_WRITE_ROLES },
      // Money: owners and managers only, never waiters or the kitchen.
      { href: '/restaurant/reports', label: 'Reports', icon: TrendingUp, roles: BILLING_ROLES },
      { href: '/restaurant/payments', label: 'Payments', icon: CreditCard, roles: BILLING_ROLES },
    ],
  },
  {
    title: 'Restaurant',
    items: [
      { href: '/restaurant/profile', label: 'Restaurant Profile', icon: Store },
      // What goes on every bill: owners only, because it is what the restaurant files.
      { href: '/restaurant/taxes', label: 'Taxes & Charges', icon: Percent, roles: RESTAURANT_ADMIN_ROLES },
      // What the owner reads when a figure does not look right.
      { href: '/restaurant/audit-logs', label: 'Activity Log', icon: ScrollText, roles: RESTAURANT_ADMIN_ROLES },
      { href: '/restaurant/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const ALL_HREFS = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.href as string));

/**
 * The nav item for a path is the longest href that matches it, so
 * `/restaurant/menu/categories` lights up Categories, not Menu, while the
 * dishes page (which has no item of its own) still lights up Menu.
 */
export function activeNavHref(pathname: string): string | undefined {
  return ALL_HREFS.filter((href) => pathname === href || pathname.startsWith(`${href}/`)).sort(
    (a, b) => b.length - a.length,
  )[0];
}

const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Plateo admin',
  RESTAURANT_OWNER: 'Owner',
  RESTAURANT_MANAGER: 'Manager',
  WAITER: 'Waiter',
  KITCHEN_STAFF: 'Kitchen staff',
};

/** Sidebar contents, shared by the desktop rail and the mobile drawer. */
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { session, signOut } = useAuth();
  const active = activeNavHref(pathname);

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* The masthead. A wash of brand colour behind it so the rail opens with
          the product's name on a surface of its own, rather than with a logo
          floating at the top of a white column. */}
      <div className="relative shrink-0 px-5 pt-5 pb-4">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,var(--color-brand-50),transparent_70%)]"
        />
        <div aria-hidden className="pointer-events-none absolute inset-x-5 bottom-0 h-px bg-line" />
        <Link
          href="/restaurant/dashboard"
          onClick={onNavigate}
          aria-label="PlateoAI restaurant admin, overview"
          className="relative block rounded-lg focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-none"
        >
          <PlateoWordmark subtitle="Restaurant admin" />
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="flex items-center gap-2 px-3 pb-2 text-[10px] font-semibold tracking-[0.14em] text-muted/70 uppercase">
              {section.title}
              <span aria-hidden className="h-px flex-1 bg-line" />
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                if (item.roles && !(session && item.roles.includes(session.user.role))) return null;
                const Icon = item.icon;
                const isActive = item.href === active;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-150',
                        // Where you are is filled, not tinted: on a rail of
                        // fifteen items a pale wash is easy to lose, and the one
                        // thing this list has to answer at a glance is "which
                        // page am I on".
                        isActive
                          ? 'bg-gradient-to-r from-brand-600 to-brand-700 font-semibold text-white shadow-sm'
                          : 'font-medium text-muted hover:bg-ground hover:text-ink',
                      )}
                    >
                      <Icon
                        className={cn(
                          'size-[18px] shrink-0 transition-colors',
                          isActive ? 'text-white' : 'text-muted group-hover:text-brand-600',
                        )}
                        aria-hidden
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {session && (
        <div className="shrink-0 border-t border-line p-3">
          <div className="flex items-center gap-3 rounded-xl bg-ground p-2.5 ring-1 ring-line/70">
            <Avatar name={session.user.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{session.user.name}</p>
              <p className="truncate text-xs text-muted" title={session.user.email}>
                {ROLE_LABELS[session.user.role]}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-1.5 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-danger-50 hover:text-danger-600"
          >
            <LogOut className="size-[18px]" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export { ROLE_LABELS };
