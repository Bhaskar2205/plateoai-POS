import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The top of an admin page.
 *
 * Eighteen screens share this, so it is where the panel either looks like a
 * product or like a list of forms. The accent tick above the title and the
 * hairline below the block are the whole device: they cost nothing to read,
 * they are the brand's two colours, and they give every page the same edge.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <span
            aria-hidden
            className="mb-2.5 block h-1 w-9 rounded-full bg-gradient-to-r from-brand-600 to-saffron-500"
          />
          <h1 className="text-xl font-semibold tracking-tight text-ink text-balance sm:text-2xl">
            {title}
          </h1>
          {description && <p className="max-w-2xl text-sm text-muted">{description}</p>}
        </div>
        {action}
      </div>
      <div
        aria-hidden
        className="mt-4 h-px bg-gradient-to-r from-line via-line to-transparent"
      />
    </header>
  );
}

/**
 * A heading inside a page, for a band of cards that belong together.
 *
 * The rule running off to the right is what makes a group read as a group: four
 * tiles under a bare line of bold text look like four unrelated cards that
 * happen to be adjacent.
 */
export function SectionHeading({
  id,
  action,
  className,
  children,
}: {
  id?: string;
  /** A link or control belonging to the whole section, shown at the far right. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <h2 id={id} className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink">
        <span
          aria-hidden
          className="h-3.5 w-1 shrink-0 rounded-full bg-gradient-to-b from-brand-500 to-brand-700"
        />
        {children}
      </h2>
      <span aria-hidden className="h-px flex-1 bg-line" />
      {action}
    </div>
  );
}
