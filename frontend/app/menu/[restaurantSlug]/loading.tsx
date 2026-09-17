/** Skeleton shaped like the real menu, so the page does not jump when it loads. */
export default function PublicMenuLoading() {
  return (
    <div className="min-h-dvh bg-ground" aria-busy="true" aria-label="Loading menu">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-start gap-4 px-4 py-6 sm:px-6 sm:py-8">
          <div className="size-16 shrink-0 animate-pulse rounded-2xl bg-ground sm:size-20" />
          <div className="flex-1 space-y-2.5 pt-1">
            <div className="h-3 w-12 animate-pulse rounded bg-ground" />
            <div className="h-7 w-2/3 animate-pulse rounded bg-ground" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-ground" />
          </div>
        </div>
      </div>

      <div className="border-b border-line">
        <div className="mx-auto max-w-3xl space-y-3 px-4 pt-3 pb-2 sm:px-6">
          <div className="h-11 animate-pulse rounded-full bg-surface" />
          <div className="flex gap-2 pb-1">
            {[20, 16, 24, 14].map((width) => (
              <div key={width} className="h-8 animate-pulse rounded-full bg-surface" style={{ width: `${width * 4}px` }} />
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-3 px-4 pt-6 sm:px-6">
        <div className="mb-4 h-6 w-40 animate-pulse rounded bg-surface" />
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex gap-4 rounded-2xl border border-line bg-surface p-4 sm:p-5">
            <div className="flex-1 space-y-2.5">
              <div className="h-5 w-1/2 animate-pulse rounded bg-ground" />
              <div className="h-4 w-20 animate-pulse rounded bg-ground" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-ground" />
            </div>
            <div className="size-24 shrink-0 animate-pulse rounded-xl bg-ground sm:size-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
