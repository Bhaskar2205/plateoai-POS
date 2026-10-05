'use client';

import { Boxes } from 'lucide-react';
import { useInventorySettings, useSaveInventorySettings } from '@/lib/queries';
import type { InventoryMode } from '@/lib/types';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CheckboxField, SelectField } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';

/**
 * Turning stock tracking on.
 *
 * Off for every restaurant until somebody comes here, and that default is the
 * point: a restaurant that has never opened the inventory screen must see its
 * till behave exactly as it did before this existed.
 *
 * Each control saves on change rather than behind a Save button: they are
 * independent, and a form that has to be submitted is a form people leave
 * half-filled.
 *
 * `autoDisableOutOfStockDishes` has no control here on purpose. The column and
 * the API accept it, but nothing acts on it yet, and a switch that does nothing
 * is worse than no switch.
 */

const MODE_HINTS: Record<InventoryMode, string> = {
  DISABLED: 'Nothing is calculated. You can still record stock by hand, but selling a dish will not take its ingredients off the shelf.',
  TRACKING: 'Settling a bill takes the recipe off the shelf. A sale is never blocked, whatever the figures say.',
  STRICT: 'As tracking. Reserved for stock affecting what may be sold, which is not built yet, so today it behaves as tracking.',
};

export function InventorySettingsCard() {
  const toast = useToast();
  const settings = useInventorySettings();

  const save = useSaveInventorySettings({
    onSuccess: () => toast.success('Saved.'),
    onError: (error) => toast.error(error),
  });

  return (
    <Card>
      <CardHeader
        title="Inventory"
        description="Whether Plateo keeps track of what is on your shelves."
      />

      {settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : settings.isPending ? (
        <CardBody>
          <Skeleton className="h-24 w-full" />
        </CardBody>
      ) : (
        <CardBody className="space-y-4">
          <SelectField
            label="Stock tracking"
            value={settings.data.mode}
            hint={MODE_HINTS[settings.data.mode]}
            disabled={save.isPending}
            onChange={(event) =>
              save.mutate({ inventoryMode: event.target.value as InventoryMode })
            }
          >
            <option value="DISABLED">Off</option>
            <option value="TRACKING">On — track and report</option>
            <option value="STRICT">On — strict (same as tracking for now)</option>
          </SelectField>

          <CheckboxField
            label="Allow stock to go below zero when correcting by hand"
            checked={settings.data.allowNegativeStock}
            disabled={save.isPending}
            hint="A negative figure usually means a recipe or a count is wrong rather than that the kitchen owes you paneer. Settling a bill is never blocked either way."
            onChange={(event) => save.mutate({ allowNegativeStock: event.target.checked })}
          />

          <p className="flex items-start gap-2 text-xs text-muted">
            <Boxes className="mt-0.5 size-4 shrink-0" aria-hidden />
            Billing, bills and reports work the same whichever of these you choose. Inventory is an
            addition.
          </p>
        </CardBody>
      )}
    </Card>
  );
}
