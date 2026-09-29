'use client';

import {
  Armchair,
  Carrot,
  ChefHat,
  LayoutDashboard,
  LogOut,
  QrCode,
  Receipt,
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
import { BILLING_ROLES, KITCHEN_ROLES, ORDER_WRITE_ROLES, TABLE_ADMIN_ROLES } from '@/lib/permissions';
import type { UserRole } from '@/lib/types';
import { Avatar, PlateoWordmark } from './brand';

interface NavItem {
  href: Route;
  label: string;
  icon: LucideIcon;
  /** Shown for sections that are not built yet, so the item never looks broken. */
  badge?: string;
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
      // Everyone who takes orders needs the floor; the Setup tab inside is still
      // owner-only, so a waiter sees the tables without the QR controls.
      { href: '/restaurant/tables', label: 'Tables', icon: Armchair, roles: ORDER_WRITE_ROLES },
      { href: '/restaurant/qr-codes', label: 'QR Codes', icon: QrCode, roles: TABLE_ADMIN_ROLES },
      { href: '/restaurant/orders', label: 'Bills', icon: Receipt, roles: ORDER_WRITE_ROLES },
      { href: '/restaurant/kitchen', label: 'Kitchen', icon: ChefHat, roles: KITCHEN_ROLES },
      // Money: owners and managers only, never waiters or the kitchen.
      { href: '/restaurant/reports', label: 'Reports', icon: TrendingUp, roles: BILLING_ROLES },
    ],
  },
  {
    title: 'Restaurant',
    items: [
      { href: '/restaurant/profile', label: 'Restaurant Profile', icon: Store },
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
    <div className="flex h-full flex-col">
      <div className="px-5 pt-5 pb-4">
        <Link href="/restaurant/dashboard" onClick={onNavigate} className="rounded-lg">
          <PlateoWordmark subtitle="Restaurant admin" />
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-muted/80 uppercase">
              {section.title}
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
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
                        isActive
                          ? 'bg-brand-50 font-medium text-brand-700'
                          : 'text-muted hover:bg-ground hover:text-ink',
                      )}
                    >
                      {isActive && (
                        <span aria-hidden className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-brand-600" />
                      )}
                      <Icon
                        className={cn('size-[18px] shrink-0', isActive ? 'text-brand-600' : 'text-muted group-hover:text-ink')}
                        aria-hidden
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge && (
                        <span className="rounded-full bg-saffron-50 px-1.5 py-px text-[10px] font-semibold tracking-wide text-saffron-600 uppercase ring-1 ring-saffron-100">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {session && (
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <Avatar name={session.user.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{session.user.name}</p>
              <p className="truncate text-xs text-muted">
                {ROLE_LABELS[session.user.role]} · {session.user.email}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted transition-colors hover:bg-danger-50 hover:text-danger-600"
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
