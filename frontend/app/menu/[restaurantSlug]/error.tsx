'use client';

import { RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

/**
 * Shown when the menu could not be loaded (API down, 5xx). A diner at a table
 * needs a way to retry, not a stack trace - technical detail stays in the console.
 */
export default function PublicMenuError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Public menu failed to load', error.digest ?? error.message);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center bg-ground px-4 py-10">
      <div className="max-w-sm text-center">
        <p className="text-xs font-semibold tracking-[0.14em] text-brand-600 uppercase">Menu</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">We couldn’t load this menu</h1>
        <p className="mt-2 text-sm text-muted">
          This is usually temporary. Try again in a moment, or ask a member of staff for a printed menu.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700"
        >
          <RefreshCw className="size-4" aria-hidden />
          Try again
        </button>
      </div>
    </main>
  );
}
