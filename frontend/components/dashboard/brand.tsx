import Image from 'next/image';
import { cn } from '@/lib/cn';

/**
 * The PlateoAI identity, as it appears inside the admin.
 *
 * One logo file, used everywhere the product names itself, so the panel and the
 * sign-in screen are recognisably the same piece of software. The file is the
 * supplied artwork cropped to its ink - the original is a square with the
 * wordmark in a band across the middle, and sizing that by height renders mostly
 * empty space with the name too small to read.
 */

/** Intrinsic size of `plateo-wordmark.png`, so the browser reserves the right box. */
const WORDMARK = { width: 804, height: 264 };

export function PlateoLogo({
  className,
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/plateo-wordmark.png"
      alt="PlateoAI"
      width={WORDMARK.width}
      height={WORDMARK.height}
      priority={priority}
      className={cn('w-auto', className)}
    />
  );
}

/**
 * The logo with what it is sitting underneath it.
 *
 * The rule is what separates the two: without it the subtitle reads as part of
 * the logo, and "PlateoAI Restaurant admin" is not the product's name.
 */
export function PlateoWordmark({ subtitle }: { subtitle?: string }) {
  return (
    <span className="block min-w-0">
      <PlateoLogo className="h-7" priority />
      {subtitle && (
        <span className="mt-2 flex items-center gap-2">
          <span
            aria-hidden
            className="h-px w-5 shrink-0 rounded-full bg-gradient-to-r from-brand-600 to-saffron-500"
          />
          <span className="truncate text-[10px] font-semibold tracking-[0.16em] text-muted uppercase">
            {subtitle}
          </span>
        </span>
      )}
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
        'grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-saffron-100 to-saffron-50 text-xs font-semibold text-saffron-600 ring-1 ring-saffron-500/25',
        className,
      )}
    >
      {initialsOf(name) || '?'}
    </span>
  );
}
