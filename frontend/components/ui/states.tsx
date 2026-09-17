'use client';

import { AlertCircle, Inbox, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Skeleton } from './skeleton';
import { ApiError } from '@/lib/api';
import { Button } from './button';

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

/** Skeleton rows, for lists where a spinner would cause a layout jump. */
export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-12 rounded-xl" />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Something went wrong.';

  const details = error instanceof ApiError ? error.details : undefined;

  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-5 py-12 text-center">
      <span className="grid size-11 place-items-center rounded-2xl bg-danger-50 text-danger-500">
        <AlertCircle className="size-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink">{message}</p>
        {details && details.length > 0 && (
          <ul className="text-xs text-muted">
            {details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        )}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  compact = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Defaults to an inbox; pass something specific to the empty thing. */
  icon?: LucideIcon;
  /** Tighter padding for use inside small dashboard panels. */
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center gap-3 px-5 text-center ${compact ? 'py-8' : 'py-12'}`}>
      <span className="grid size-11 place-items-center rounded-2xl bg-ground text-muted ring-1 ring-line">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Inline form-level error, for a failed submit rather than a failed load. */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;

  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Something went wrong.';

  const details = error instanceof ApiError ? error.details : undefined;

  return (
    <div
      role="alert"
      className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-600"
    >
      <p className="font-medium">{message}</p>
      {details && details.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-xs">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
