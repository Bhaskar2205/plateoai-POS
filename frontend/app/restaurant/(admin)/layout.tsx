'use client';

import { X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { DashboardHeader } from '@/components/dashboard/header';
import { SidebarContent } from '@/components/dashboard/sidebar';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Authenticated shell for every admin page: desktop sidebar, mobile drawer and
 * the top header.
 *
 * The redirect is a convenience, not a security boundary: the API rejects
 * unauthenticated requests on its own, so a user who bypasses it sees an empty
 * shell rather than anyone else's data.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { session, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoading && !session) {
      router.replace('/restaurant/login');
    }
  }, [isLoading, session, router]);

  // Close the drawer whenever navigation happens.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // Drawer: Escape closes it, the page behind stops scrolling, and focus moves in.
  useEffect(() => {
    if (!navOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.querySelector<HTMLElement>('a[aria-current="page"], a')?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [navOpen]);

  if (isLoading || !session) {
    return <ShellSkeleton label={isLoading ? 'Loading your restaurant' : 'Redirecting to sign in'} />;
  }

  return (
    <div className="min-h-dvh bg-ground lg:flex">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-lg bg-surface px-3 py-2 text-sm font-medium text-ink shadow-raised focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-line bg-surface lg:block">
        <SidebarContent />
      </aside>

      {navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          {/* Pointer-only backdrop; keyboard users close with Escape or the X button. */}
          <div aria-hidden onClick={() => setNavOpen(false)} className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]" />
          <div
            ref={drawerRef}
            className="absolute inset-y-0 left-0 w-[min(18rem,85vw)] border-r border-line bg-surface shadow-raised"
          >
            <button
              type="button"
              onClick={() => setNavOpen(false)}
              aria-label="Close navigation"
              className="absolute top-4 right-3 z-10 grid size-9 place-items-center rounded-lg text-muted hover:bg-ground hover:text-ink"
            >
              <X className="size-5" aria-hidden />
            </button>
            <SidebarContent onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardHeader onOpenNavigation={() => setNavOpen(true)} />
        <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8 lg:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** The shell's shape while the session is verified, so the page doesn't flash blank. */
function ShellSkeleton({ label }: { label: string }) {
  return (
    <div className="min-h-dvh bg-ground lg:flex" aria-busy="true" aria-label={label}>
      <div className="hidden h-dvh w-64 shrink-0 space-y-6 border-r border-line bg-surface p-5 lg:block">
        {/* Shaped like the masthead it stands in for: wordmark, then the rule
            and the "Restaurant admin" line underneath. */}
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-2.5 w-28" />
        </div>
        <div className="space-y-2.5">
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-9 rounded-xl" />
          ))}
        </div>
      </div>
      <div className="flex-1">
        <div className="flex h-16 items-center justify-between border-b border-line bg-surface px-4 sm:px-6 lg:px-8">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="size-8 rounded-full" />
        </div>
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
          <Skeleton className="h-8 w-72" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-[8.5rem] rounded-2xl" />
            ))}
          </div>
        </div>
        <p className="sr-only" role="status">
          {label}…
        </p>
      </div>
    </div>
  );
}
