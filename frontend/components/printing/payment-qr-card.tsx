'use client';

import { ImagePlus, Loader2, QrCode, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import {
  useClearPaymentQr,
  usePrintSettings,
  useUpdatePrintSettings,
  useUploadPaymentQr,
} from '@/lib/queries';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

/**
 * The payment code a restaurant prints on its bills.
 *
 * Most small restaurants already have one: a printed UPI code taped to the
 * counter that a waiter carries to the table. Putting a picture of it on the
 * bill removes that walk, and nothing else - Plateo does not read the code, does
 * not know the account behind it, and cannot tell whether a scan led to a
 * payment. A bill is still settled by a person pressing Settle, which is why
 * this screen says so rather than implying a payment integration that does not
 * exist.
 */

const ACCEPTED = 'image/jpeg,image/png,image/webp';
const MAX_BYTES = 8 * 1024 * 1024;

export function PaymentQrCard() {
  const toast = useToast();
  const settings = usePrintSettings();
  const upload = useUploadPaymentQr();
  const clear = useClearPaymentQr();
  const update = useUpdatePrintSettings();

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [label, setLabel] = useState('');

  // The saved caption, once it arrives. Kept in state because it is an
  // uncontrolled-feeling text field the owner types into before saving.
  const savedLabel = settings.data?.paymentQrLabel ?? '';

  useEffect(() => setLabel(savedLabel), [savedLabel]);

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
      onSuccess: () => toast.success('Payment QR saved.'),
      onError: (error) => setProblem(error.message),
    });
  };

  const qrUrl = settings.data?.paymentQrUrl ?? null;
  const printing = settings.data?.printPaymentQr ?? false;
  const busy = upload.isPending || clear.isPending;

  return (
    <Card>
      <CardHeader
        title="Payment QR on bills"
        description="Your own UPI or bank code, printed at the bottom of every bill so a guest can pay from the table."
      />
      <CardBody className="space-y-5">
        {settings.isPending ? (
          <div className="flex gap-4">
            <Skeleton className="size-32 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-9 w-full max-w-xs" />
            </div>
          </div>
        ) : qrUrl ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="relative size-32 shrink-0 overflow-hidden rounded-xl border border-line bg-white p-2">
              {/* Not next/image: the file is served from the API origin, which
                  varies per environment, and a QR must never be re-compressed
                  on its way to the screen. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrUrl} alt="The payment QR printed on your bills" className="size-full object-contain" />
              {busy && (
                <div className="absolute inset-0 grid place-items-center bg-ink/40">
                  <Loader2 className="size-5 animate-spin text-white" aria-hidden />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-4">
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
                      onSuccess: () => toast.success('Payment QR removed.'),
                      onError: (error) => toast.error(error),
                    })
                  }
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:text-danger-600 disabled:opacity-60"
                >
                  <Trash2 className="size-4" aria-hidden />
                  Remove
                </button>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="qr-label" className="block text-sm font-medium text-ink">
                  Caption under the code
                </label>
                <div className="flex flex-wrap gap-2">
                  <input
                    id="qr-label"
                    value={label}
                    maxLength={100}
                    placeholder="greenbowl@okhdfcbank"
                    onChange={(event) => setLabel(event.target.value)}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={update.isPending || label === savedLabel}
                    onClick={() =>
                      update.mutate(
                        { paymentQrLabel: label.trim() },
                        {
                          onSuccess: () => toast.success('Caption saved.'),
                          onError: (error) => toast.error(error),
                        },
                      )
                    }
                    className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-ground disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
                <p className="text-xs text-muted">
                  Printed under the code so a guest can check who they are paying. Leave it empty
                  to print the code alone.
                </p>
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
                {busy ? 'Uploading…' : 'Add your payment QR'}
              </span>
              <span className="max-w-sm text-xs text-muted">
                A photo or screenshot of the code you already use. Tap to choose, or drag one here.
                JPEG, PNG or WebP, up to 8 MB.
              </span>
            </button>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="sr-only"
          aria-label="Choose your payment QR image"
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

        {/* The switch. Ticked once; it stays on until it is unticked. */}
        <label
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors',
            printing ? 'border-brand-500/40 bg-brand-50' : 'border-line bg-ground/40',
            !qrUrl && 'cursor-not-allowed opacity-60',
          )}
        >
          <input
            type="checkbox"
            checked={printing}
            disabled={!qrUrl || update.isPending}
            onChange={(event) =>
              update.mutate(
                { printPaymentQr: event.target.checked },
                {
                  onSuccess: (next) =>
                    toast.success(
                      next.printPaymentQr
                        ? 'Every bill will now carry your payment QR.'
                        : 'Bills will print without the payment QR.',
                    ),
                  onError: (error) => toast.error(error),
                },
              )
            }
            className="mt-0.5 size-4 shrink-0 rounded border-line text-brand-600 focus:ring-2 focus:ring-brand-500/30 disabled:opacity-50"
          />
          <span className="min-w-0 text-sm text-ink">
            <span className="flex items-center gap-1.5 font-medium">
              <QrCode className="size-4 text-brand-600" aria-hidden />
              Print this QR on every bill
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted">
              {qrUrl
                ? 'Stays on until you untick it. It is left off a bill that has already been settled, so a paid receipt never asks for payment twice.'
                : 'Add a QR first.'}
            </span>
          </span>
        </label>

        <p className="rounded-xl bg-ground/60 p-3 text-xs leading-relaxed text-muted ring-1 ring-line">
          Plateo prints the picture and nothing more. It does not read the code, does not know
          which account it pays into, and cannot tell whether a guest who scanned it paid — your
          till still marks a bill paid when somebody presses Settle. Check the printed code scans
          correctly before you rely on it.
        </p>
      </CardBody>
    </Card>
  );
}
