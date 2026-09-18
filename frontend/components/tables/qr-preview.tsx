'use client';

import { QrCode } from 'lucide-react';
import { useEffect, useState } from 'react';
import { renderQrCard, renderQrDataUrl } from '@/lib/qr';
import { cn } from '@/lib/cn';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Renders a QR code for `url` in the browser. With `card`, renders the full
 * printable card (restaurant, QR, table name) instead of the bare code.
 */
export function QrPreview({
  url,
  label,
  card,
  className,
  dimmed = false,
}: {
  url: string;
  /** Accessible description, e.g. "QR code for Table 01". */
  label: string;
  card?: { tableName: string; restaurantName: string };
  className?: string;
  dimmed?: boolean;
}) {
  const [state, setState] = useState<{ key: string; src: string | null; failed: boolean }>({ key: '', src: null, failed: false });
  const key = card ? `${url}|${card.tableName}|${card.restaurantName}` : url;

  useEffect(() => {
    let cancelled = false;

    (card ? renderQrCard({ url, ...card }) : renderQrDataUrl(url, 320))
      .then((src) => !cancelled && setState({ key, src, failed: false }))
      .catch(() => !cancelled && setState({ key, src: null, failed: true }));

    return () => {
      cancelled = true;
    };
    // `key` captures url + card text; the card object itself is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = state.key === key;

  if (current && state.failed) {
    return (
      <div role="img" aria-label={`${label} could not be generated`} className={cn('grid place-items-center rounded-xl bg-ground text-muted ring-1 ring-line', className)}>
        <QrCode className="size-6" aria-hidden />
      </div>
    );
  }

  if (!current || !state.src) {
    return <Skeleton className={cn('rounded-xl', className)} />;
  }

  return (
    // A generated data URL; next/image adds nothing here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={state.src}
      alt={label}
      className={cn('rounded-xl bg-white ring-1 ring-line transition-opacity', dimmed && 'opacity-40 grayscale', className)}
    />
  );
}
