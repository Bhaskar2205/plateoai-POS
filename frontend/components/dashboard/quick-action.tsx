import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * A large, tappable shortcut. The first action in a row can be `primary` so the
 * most common task (adding a dish) reads as the obvious next step.
 */
export function QuickAction({
  href,
  title,
  description,
  icon: Icon,
  primary = false,
  external = false,
}: {
  href: Route;
  title: string;
  description: string;
  icon: LucideIcon;
  primary?: boolean;
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener' } : {})}
      className={cn(
        'group flex h-full items-start gap-3.5 rounded-2xl border p-4 transition-[border-color,background-color,box-shadow] duration-150',
        'focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-offset-0',
        primary
          ? 'border-brand-600 bg-brand-600 text-white shadow-sm hover:bg-brand-700'
          : 'border-line bg-surface shadow-card hover:border-brand-100 hover:shadow-raised',
      )}
    >
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-xl',
          primary ? 'bg-white/15 text-white' : 'bg-brand-50 text-brand-600 ring-1 ring-brand-100',
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('flex items-center gap-1 text-sm font-semibold', primary ? 'text-white' : 'text-ink')}>
          {title}
          <ArrowUpRight
            className={cn(
              'size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5',
              primary ? 'text-white/70' : 'text-muted',
            )}
            aria-hidden
          />
        </span>
        <span className={cn('mt-0.5 block text-xs leading-relaxed', primary ? 'text-white/80' : 'text-muted')}>
          {description}
        </span>
      </span>
    </Link>
  );
}
