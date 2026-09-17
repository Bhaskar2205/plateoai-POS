'use client';

import { Bell, ChevronDown, ExternalLink, LogOut, Menu, Settings, Store } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/card';
import { Avatar, PlateoMark } from './brand';
import { ROLE_LABELS } from './sidebar';

/**
 * Small popover behaviour shared by the notifications panel and the account
 * menu: closes on Escape or an outside click, and returns focus to its trigger.
 */
function usePopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  return { open, setOpen, close, rootRef, triggerRef };
}

const PANEL =
  'absolute right-0 top-full z-40 mt-2 origin-top-right rounded-2xl border border-line bg-surface shadow-raised';

const ICON_BUTTON =
  'relative grid size-10 place-items-center rounded-xl text-muted transition-colors hover:bg-ground hover:text-ink ' +
  'focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-offset-0';

export function DashboardHeader({ onOpenNavigation }: { onOpenNavigation: () => void }) {
  const { session } = useAuth();

  if (!session) return null;

  const { restaurant } = session;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur supports-[backdrop-filter]:bg-surface/75">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button type="button" onClick={onOpenNavigation} aria-label="Open navigation" className={cn(ICON_BUTTON, 'lg:hidden')}>
          <Menu className="size-5" aria-hidden />
        </button>

        <Link href="/restaurant/dashboard" className="rounded-lg lg:hidden" aria-label="Plateo overview">
          <PlateoMark className="size-8" />
        </Link>

        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <p className="truncate text-sm font-semibold text-ink sm:text-[15px]" title={restaurant.name}>
            {restaurant.name}
          </p>
          <span className="hidden sm:inline-flex">
            <Badge tone={restaurant.status === 'ACTIVE' ? 'success' : 'warn'} dot>
              {restaurant.status === 'ACTIVE' ? 'Active' : 'Inactive'}
            </Badge>
          </span>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <Link
            href={`/menu/${restaurant.slug}` as Route}
            target="_blank"
            rel="noopener"
            className="hidden h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-ground hover:text-ink md:inline-flex"
          >
            <ExternalLink className="size-4" aria-hidden />
            Public menu
          </Link>
          <NotificationsButton />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

function NotificationsButton() {
  const { open, setOpen, rootRef, triggerRef } = usePopover();
  const panelId = useId();

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Notifications"
        aria-expanded={open}
        aria-controls={panelId}
        className={ICON_BUTTON}
      >
        <Bell className="size-5" aria-hidden />
      </button>

      {open && (
        <div id={panelId} role="dialog" aria-label="Notifications" className={cn(PANEL, 'w-80 max-w-[calc(100vw-2rem)]')}>
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-ink">Notifications</p>
          </div>
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <span className="grid size-10 place-items-center rounded-2xl bg-ground text-muted ring-1 ring-line">
              <Bell className="size-5" aria-hidden />
            </span>
            <p className="text-sm font-medium text-ink">You’re all caught up</p>
            <p className="text-xs text-muted">
              Order alerts will appear here once QR table ordering is live.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountMenu() {
  const { session, signOut } = useAuth();
  const { open, setOpen, close, rootRef, triggerRef } = usePopover();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Move focus into the menu when it opens, so keyboard users land on an item.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  if (!session) return null;

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;

    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-xl p-1 pr-1.5 transition-colors hover:bg-ground focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-offset-0 sm:pr-2"
      >
        <Avatar name={session.user.name} className="size-8" />
        <span className="hidden max-w-32 truncate text-sm font-medium text-ink sm:block">{session.user.name}</span>
        <ChevronDown className={cn('hidden size-4 text-muted transition-transform sm:block', open && 'rotate-180')} aria-hidden />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className={cn(PANEL, 'w-64 p-1.5')}
        >
          <div className="px-3 pt-2 pb-2.5">
            <p className="truncate text-sm font-semibold text-ink">{session.user.name}</p>
            <p className="truncate text-xs text-muted">{session.user.email}</p>
            <p className="mt-1 text-xs text-muted">{ROLE_LABELS[session.user.role]}</p>
          </div>
          <div className="my-1 h-px bg-line" role="separator" />
          <MenuLink href="/restaurant/profile" icon={<Store className="size-4" aria-hidden />} onSelect={() => close(false)}>
            Restaurant profile
          </MenuLink>
          <MenuLink href="/restaurant/settings" icon={<Settings className="size-4" aria-hidden />} onSelect={() => close(false)}>
            Settings
          </MenuLink>
          <MenuLink
            href={`/menu/${session.restaurant.slug}` as Route}
            external
            icon={<ExternalLink className="size-4" aria-hidden />}
            onSelect={() => close(false)}
          >
            View public menu
          </MenuLink>
          <div className="my-1 h-px bg-line" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-danger-600 outline-none hover:bg-danger-50 focus-visible:bg-danger-50"
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  external = false,
  onSelect,
  children,
}: {
  href: Route;
  icon: ReactNode;
  external?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      {...(external ? { target: '_blank', rel: 'noopener' } : {})}
      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink outline-none hover:bg-ground focus-visible:bg-ground"
    >
      <span className="text-muted">{icon}</span>
      {children}
    </Link>
  );
}
