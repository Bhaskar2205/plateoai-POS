'use client';

import { useCallback, useState } from 'react';
import { copyText, downloadQrCard, printQrCards, type QrCardInput } from '@/lib/qr';
import type { RestaurantTable } from '@/lib/types';
import { useToast } from '@/components/ui/toast';

type Busy = { kind: 'download' | 'print'; key: string } | null;

/** Copy / download / print for table QR codes, with feedback and busy states. */
export function useQrActions(restaurantName: string) {
  const toast = useToast();
  const [busy, setBusy] = useState<Busy>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const card = useCallback(
    (table: RestaurantTable): QrCardInput => ({ url: table.menuUrl, tableName: table.name, restaurantName }),
    [restaurantName],
  );

  const copy = useCallback(
    async (table: RestaurantTable) => {
      try {
        await copyText(table.menuUrl);
        setCopiedId(table.id);
        toast.success(`Copied the menu link for “${table.name}”.`);
        window.setTimeout(() => setCopiedId((current) => (current === table.id ? null : current)), 2000);
      } catch {
        toast.error(new Error('Could not copy the link. Select it and copy it manually.'));
      }
    },
    [toast],
  );

  const download = useCallback(
    async (table: RestaurantTable) => {
      setBusy({ kind: 'download', key: String(table.id) });
      try {
        await downloadQrCard(card(table));
        toast.success(`Downloaded the QR code for “${table.name}”.`);
      } catch {
        toast.error(new Error('Could not create the QR code image. Please try again.'));
      } finally {
        setBusy(null);
      }
    },
    [card, toast],
  );

  const print = useCallback(
    async (selection: RestaurantTable[], key: string) => {
      if (selection.length === 0) return;
      setBusy({ kind: 'print', key });
      try {
        await printQrCards(selection.map(card));
      } catch {
        toast.error(new Error('Could not open the print dialog. Try downloading the PNG instead.'));
      } finally {
        setBusy(null);
      }
    },
    [card, toast],
  );

  const isBusy = (kind: 'download' | 'print', key: string | number) => busy?.kind === kind && busy.key === String(key);

  return { copy, download, print, isBusy, copiedId };
}
