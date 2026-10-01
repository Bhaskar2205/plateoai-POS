'use client';

import { Check, ChefHat, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { copyText } from '@/lib/qr';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * The kitchen code, shown to the owner.
 *
 * This is the one place the code is readable. It is a credential, so the API
 * keeps it out of every other response - and the card says plainly what the code
 * does and does not open, because "a code that signs anyone in" is the kind of
 * thing a restaurant will otherwise stick on the wall next to the pass.
 */
const KEY = ['restaurant', 'kitchen-code'] as const;

interface KitchenCode {
  code: string;
  display: string;
}

export function KitchenCodeCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const code = useQuery({
    queryKey: KEY,
    queryFn: () => apiFetch<KitchenCode>('/restaurants/me/kitchen-code'),
  });

  const regenerate = useMutation({
    mutationFn: () =>
      apiFetch<KitchenCode>('/restaurants/me/kitchen-code/regenerate', { method: 'POST' }),
    onSuccess: (next) => {
      queryClient.setQueryData(KEY, next);
      setConfirming(false);
      toast.success('New kitchen code issued. Sign your kitchen screens in again.');
    },
    onError: (error) => toast.error(error),
  });

  const kitchenUrl =
    typeof window === 'undefined' ? '/kitchen' : `${window.location.origin}/kitchen`;

  return (
    <>
      <Card>
        <CardHeader
          title="Kitchen screen"
          description="The kitchen has its own screen, signed in with this code — no email or password."
          action={
            <a
              href="/kitchen"
              target="_blank"
              rel="noopener"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink shadow-card transition-colors hover:bg-ground"
            >
              <ExternalLink className="size-4" aria-hidden />
              Open kitchen
            </a>
          }
        />

        <CardBody className="space-y-4">
          {code.isError ? (
            <ErrorState error={code.error} onRetry={() => void code.refetch()} />
          ) : code.isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <p
                  className="rounded-xl border border-line bg-ground px-5 py-3 font-mono text-3xl font-bold tracking-[0.2em] text-ink"
                  aria-label={`Kitchen code ${code.data.code.split('').join(' ')}`}
                >
                  {code.data.display}
                </p>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      try {
                        await copyText(code.data.code);
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 2000);
                      } catch {
                        toast.error(new Error('Could not copy the code.'));
                      }
                    }}
                  >
                    {copied ? (
                      <Check className="size-4 text-brand-600" aria-hidden />
                    ) : (
                      <Copy className="size-4" aria-hidden />
                    )}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>

                  <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
                    <RefreshCw className="size-4" aria-hidden />
                    New code
                  </Button>
                </div>
              </div>

              <div className="rounded-xl bg-ground px-4 py-3 text-sm text-muted">
                <p className="flex items-start gap-2">
                  <ChefHat className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                  <span>
                    On the kitchen tablet, open{' '}
                    <span className="font-medium text-ink">{kitchenUrl}</span> and type this code.
                    It stays signed in, so you only do this once per device.
                  </span>
                </p>
                <p className="mt-2 text-xs">
                  The kitchen screen shows what to cook — tables, quantities, instructions and what
                  goes into each dish. It cannot see bills, prices or your takings. Issue a new code
                  if a tablet goes missing; the old one stops working at once.
                </p>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirming}
        title="Issue a new kitchen code?"
        message="The current code stops working immediately, and every kitchen screen will ask for the new one. Do this if a tablet has gone missing."
        confirmLabel="Issue new code"
        loading={regenerate.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => regenerate.mutate()}
      />
    </>
  );
}
