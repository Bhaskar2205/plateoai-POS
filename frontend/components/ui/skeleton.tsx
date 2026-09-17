import { cn } from '@/lib/cn';

/**
 * Placeholder block shaped like the content it stands in for. Give it the
 * content's real height so nothing jumps when the data arrives.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-lg bg-line/60', className)} />;
}
