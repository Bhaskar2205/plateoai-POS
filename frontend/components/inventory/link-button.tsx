import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A link that looks like a secondary button.
 *
 * `Button` renders a real `<button>`, and wrapping a link in one would nest
 * interactive elements - bad for assistive technology and for middle-clicking.
 * The classes mirror `Button`'s secondary variant.
 */
export function LinkButton({
  href,
  children,
  className,
}: {
  href: Route;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3',
        'text-sm font-medium text-ink shadow-card transition-colors hover:bg-ground',
        'focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-offset-0',
        className,
      )}
    >
      {children}
    </Link>
  );
}
