import { cn } from '@/lib/cn';

/**
 * The Plateo mark: a plate seen from above, with a single warm dot of food.
 * Drawn inline so it needs no asset request and inherits sizing from its box.
 */
export function PlateoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('grid size-9 shrink-0 place-items-center rounded-xl bg-brand-600 shadow-sm', className)}
    >
      <svg viewBox="0 0 24 24" className="size-[62%]" fill="none">
        <circle cx="12" cy="12" r="9" stroke="white" strokeWidth="1.8" />
        <circle cx="12" cy="12" r="5" stroke="white" strokeOpacity="0.55" strokeWidth="1.4" />
        <circle cx="14.2" cy="9.8" r="1.7" fill="var(--color-saffron-100)" />
      </svg>
    </span>
  );
}

export function PlateoWordmark({ subtitle }: { subtitle?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <PlateoMark />
      <span className="min-w-0 leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight text-ink">Plateo</span>
        {subtitle && <span className="block truncate text-xs text-muted">{subtitle}</span>}
      </span>
    </span>
  );
}

/** Up to two initials from a person or restaurant name, for avatar fallbacks. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full bg-saffron-100 text-xs font-semibold text-saffron-600 ring-1 ring-saffron-500/20',
        className,
      )}
    >
      {initialsOf(name) || '?'}
    </span>
  );
}
