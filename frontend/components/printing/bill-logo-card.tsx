'use client';

import { ImagePlus, Loader2, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useClearLogo, usePrintSettings, useUploadLogo } from '@/lib/queries';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

/**
 * The logo printed across the top of a bill.
 *
 * Only the bill. A kitchen ticket never carries it: a cook does not need the
 * branding, the roll is short, and every millimetre at the top of a ticket
 * pushes the first dish further from the tear.
 *
 * Shown against a white tile rather than the page background, because that is
 * what it will be printed on - a pale logo that looks fine on a cream screen
 * can be invisible on thermal paper, and an owner should find that out here
 * rather than from a guest.
 */

const ACCEPTED = 'image/jpeg,image/png,image/webp';
const MAX_BYTES = 8 * 1024 * 1024;

export function BillLogoCard() {
  const toast = useToast();
  const settings = usePrintSettings();
  const upload = useUploadLogo();
  const clear = useClearLogo();

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = (file: File | undefined) => {
    if (!file) return;

    setProblem(null);

    if (!ACCEPTED.split(',').includes(file.type)) {
      setProblem('Choose a JPEG, PNG or WebP image.');
      return;
    }

    if (file.size > MAX_BYTES) {
      setProblem(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 8 MB.`);
      return;
    }

    upload.mutate(file, {
      onSuccess: () => toast.success('Logo saved. It prints at the top of every bill.'),
      onError: (error) => setProblem(error.message),
    });
  };

  const logoUrl = settings.data?.logoUrl ?? null;
  const busy = upload.isPending || clear.isPending;

  return (
    <Card>
      <CardHeader
        title="Logo on bills"
        description="Printed across the top of the customer bill, above your name, address and GSTIN."
      />
      <CardBody className="space-y-4">
        {settings.isPending ? (
          <Skeleton className="h-28 w-full rounded-xl" />
        ) : logoUrl ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="relative grid h-24 w-44 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt="The logo printed on your bills"
                className="max-h-full max-w-full object-contain"
              />
              {busy && (
                <div className="absolute inset-0 grid place-items-center bg-ink/40">
                  <Loader2 className="size-5 animate-spin text-white" aria-hidden />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              <p className="text-xs leading-relaxed text-muted">
                Shown on white, which is what it will be printed on. A thermal printer has no
                colour and no grey — a pale or thin logo comes out faint, so a bold, high-contrast
                mark reads best.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => inputRef.current?.click()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-ground disabled:opacity-60"
                >
                  <Upload className="size-4" aria-hidden />
                  Replace
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    clear.mutate(undefined, {
                      onSuccess: () => toast.success('Logo removed.'),
                      onError: (error) => toast.error(error),
                    })
                  }
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:text-danger-600 disabled:opacity-60"
                >
                  <Trash2 className="size-4" aria-hidden />
                  Remove
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              choose(event.dataTransfer.files?.[0]);
            }}
            className={cn(
              'rounded-xl border-2 border-dashed transition-colors',
              dragging ? 'border-brand-500 bg-brand-50' : 'border-line bg-ground/50',
            )}
          >
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-1.5 px-4 py-8 text-center"
            >
              {busy ? (
                <Loader2 className="size-6 animate-spin text-brand-600" aria-hidden />
              ) : (
                <ImagePlus className="size-6 text-brand-600" aria-hidden />
              )}
              <span className="text-sm font-medium text-ink">
                {busy ? 'Uploading…' : 'Add your logo'}
              </span>
              <span className="max-w-sm text-xs text-muted">
                Tap to choose, or drag one here. JPEG, PNG or WebP, up to 8 MB. Bills print your
                name on its own until you add one.
              </span>
            </button>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="sr-only"
          aria-label="Choose your logo image"
          onChange={(event) => {
            choose(event.target.files?.[0]);
            // Let the same file be picked again after a failure.
            event.target.value = '';
          }}
        />

        {problem && (
          <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-danger-600">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            {problem}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
