'use client';

import { Loader2, Scroll } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PAPER_WIDTHS_MM, type PaperWidthMm, paperFor, paperWidthOrDefault } from '@/lib/print-config';
import { usePrintSettings, useUpdatePrintSettings } from '@/lib/queries';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

/**
 * Which roll this restaurant's printer takes.
 *
 * The one thing about the paper an owner has to tell us, because nothing in the
 * browser can ask the printer. Everything else - how much of the roll the head
 * reaches, what type size fits, how many characters go on a line - follows from
 * it and is shown here rather than asked.
 *
 * Getting it wrong is visible immediately and only in one direction: a bill laid
 * out for 80mm loses the right-hand end of every line on a 58mm roll, which is
 * the amount column. A bill laid out for 58mm on an 80mm roll merely prints
 * narrow. So the wording leans on matching the paper actually loaded.
 */
export function PaperWidthCard() {
  const toast = useToast();
  const settings = usePrintSettings();
  const update = useUpdatePrintSettings({
    onError: (error) => toast.error(error),
  });

  const current = paperWidthOrDefault(settings.data?.paperWidthMm);

  const choose = (width: PaperWidthMm) => {
    if (width === current || update.isPending) return;
    update.mutate({ paperWidthMm: width });
  };

  return (
    <Card>
      <CardHeader
        title="Paper width"
        description="The thermal roll your printer takes. Match it to the paper actually loaded."
      />
      <CardBody className="space-y-4">
        {settings.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div
              role="radiogroup"
              aria-label="Thermal roll width"
              className="grid gap-3 sm:grid-cols-3"
            >
              {PAPER_WIDTHS_MM.map((width) => {
                const paper = paperFor(width);
                const selected = width === current;

                return (
                  <button
                    key={width}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={update.isPending}
                    onClick={() => choose(width)}
                    className={cn(
                      'rounded-xl border p-4 text-left transition-colors disabled:opacity-60',
                      selected
                        ? 'border-brand-700 bg-brand-50 ring-1 ring-brand-700'
                        : 'border-line bg-surface hover:bg-ground',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Scroll
                        className={cn('size-4', selected ? 'text-brand-700' : 'text-muted')}
                        aria-hidden
                      />
                      <span className="text-sm font-semibold text-ink">{width} mm roll</span>
                      {update.isPending && selected ? (
                        <Loader2 className="size-3.5 animate-spin text-muted" aria-hidden />
                      ) : null}
                    </span>
                    <span className="mt-1.5 block text-xs text-muted">
                      {paper.printableWidthMm.toFixed(1)} mm printable
                    </span>
                    <span className="block text-xs text-muted">
                      {paper.dots} dots across the head
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="rounded-xl bg-ground/60 p-3 text-xs leading-relaxed text-muted ring-1 ring-line">
              The printable width is narrower than the roll because the print head covers a fixed
              number of dots and cannot reach the edges. Type size follows the roll, so a 58 mm
              bill is set smaller to keep the amount column on the paper. Print a test after
              changing this.
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
