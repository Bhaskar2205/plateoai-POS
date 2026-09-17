import type { LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { Skeleton } from '@/components/ui/skeleton';

type Tone = 'brand' | 'saffron' | 'neutral';

const ICON_TONES: Record<Tone, string> = {
  brand: 'bg-brand-50 text-brand-600 ring-brand-100',
  saffron: 'bg-saffron-50 text-saffron-600 ring-saffron-100',
  neutral: 'bg-ground text-muted ring-line',
};

/**
 * One headline number with its context.
 *
 * `value === null` with `unavailableReason` renders an explicit "not available
 * yet" state - a metric with no backing API must never show an invented number.
 * While loading, the card keeps its final height so the grid does not jump.
 */
export function SummaryCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
  loading = false,
  progress,
  unavailableReason,
  href,
}: {
  label: string;
  value: number | null;
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
  loading?: boolean;
  /** 0..1 - renders a thin bar under the value (e.g. share of dishes available). */
  progress?: number;
  unavailableReason?: string;
  href?: Route;
}) {
  const unavailable = value === null && unavailableReason !== undefined;

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl ring-1', ICON_TONES[unavailable ? 'neutral' : tone])}>
          <Icon className="size-[18px]" aria-hidden />
        </span>
      </div>

      <div className="mt-3 min-h-[3.75rem]">
        {loading ? (
          <div aria-hidden>
            <Skeleton className="h-8 w-16" />
            <Skeleton className="mt-2.5 h-3.5 w-28" />
          </div>
        ) : unavailable ? (
          <>
            <p className="text-2xl font-semibold tracking-tight text-muted/60">—</p>
            <p className="mt-1.5 text-xs text-muted">
              <span className="mr-1.5 rounded-full bg-ground px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase ring-1 ring-line">
                Not available yet
              </span>
              {unavailableReason}
            </p>
          </>
        ) : (
          <>
            <p className="text-3xl font-semibold tracking-tight text-ink tabular-nums">{value}</p>
            {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
          </>
        )}
      </div>

      {progress !== undefined && !loading && !unavailable && (
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-ground"
          role="progressbar"
          aria-label={`${label} share`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <div className="h-full rounded-full bg-brand-500 transition-[width] duration-500" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </>
  );

  const shell = 'block h-full rounded-2xl border border-line bg-surface p-5 shadow-card';

  if (href && !unavailable) {
    return (
      <Link
        href={href}
        className={cn(shell, 'transition-[border-color,box-shadow] hover:border-brand-100 hover:shadow-raised focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-offset-0')}
      >
        {body}
      </Link>
    );
  }

  return <div className={shell}>{body}</div>;
}
