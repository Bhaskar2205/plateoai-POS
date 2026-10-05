'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useAddStock, useAdjustStock, useRecordWastage } from '@/lib/queries';
import {
  stockAdjustmentSchema,
  stockInSchema,
  wastageSchema,
  type StockAdjustmentValues,
  type StockInValues,
  type WastageValues,
} from '@/lib/schemas';
import type { Ingredient } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { FormError } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import {
  ADJUSTMENT_REASONS,
  formatQuantity,
  REASON_LABELS,
  UNIT_LABELS,
  WASTAGE_REASONS,
} from './stock-units';

/**
 * The three things a person does to a stock figure.
 *
 * Each is its own small dialog rather than one "edit stock" form, because they
 * are three different events and the ledger records them differently. A single
 * form with a dropdown would also make it easy to log a delivery as wastage by
 * leaving a select where somebody else left it.
 *
 * None of them asks for a total. Every dialog asks for the size of a change, so
 * two people working at once cannot overwrite each other's figure.
 */

/** Rupees typed into a text box, as whole paise. '' means "leave it alone". */
const toPaise = (rupees: string | undefined): number | undefined =>
  rupees === undefined || rupees.trim() === '' ? undefined : Math.round(Number(rupees) * 100);

const blank = (value: string | undefined): string | undefined =>
  value?.trim() ? value.trim() : undefined;

export function AddStockDialog({
  ingredient,
  onClose,
}: {
  ingredient: Ingredient | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const form = useForm<StockInValues>({
    resolver: zodResolver(stockInSchema),
    defaultValues: { quantity: '', costPerUnit: '', note: '' },
  });

  const add = useAddStock({
    onSuccess: (movement) => {
      toast.success(
        `Added ${formatQuantity(movement.quantity, movement.unit)}. Now ` +
          `${formatQuantity(movement.quantityAfter, movement.unit)}.`,
      );
      onClose();
    },
  });

  if (!ingredient) return null;

  const submit = form.handleSubmit((values) =>
    add.mutate({
      ingredientId: ingredient.id,
      body: {
        quantity: Number(values.quantity),
        costPerUnitPaise: toPaise(values.costPerUnit),
        note: blank(values.note),
      },
    }),
  );

  return (
    <Modal
      open
      title={`Add stock: ${ingredient.name}`}
      description={`${formatQuantity(ingredient.currentQuantity, ingredient.unit)} on the shelf now.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={add.isPending} onClick={() => void submit()}>
            Add to stock
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormError error={add.error} />

        <TextField
          label={`How much arrived (${UNIT_LABELS[ingredient.unit]})`}
          inputMode="decimal"
          autoFocus
          required
          error={form.formState.errors.quantity?.message}
          {...form.register('quantity')}
        />

        <TextField
          label={`Cost per ${UNIT_LABELS[ingredient.unit]} (optional)`}
          inputMode="decimal"
          placeholder={String(Number(ingredient.costPerUnitPaise) / 100)}
          hint="Only if the price changed. Earlier records keep the price they were bought at."
          error={form.formState.errors.costPerUnit?.message}
          {...form.register('costPerUnit')}
        />

        <TextAreaField
          label="Note (optional)"
          rows={2}
          placeholder="Supplier, invoice number, anything worth remembering"
          error={form.formState.errors.note?.message}
          {...form.register('note')}
        />
      </form>
    </Modal>
  );
}

export function WastageDialog({
  ingredient,
  onClose,
}: {
  ingredient: Ingredient | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const form = useForm<WastageValues>({
    resolver: zodResolver(wastageSchema),
    defaultValues: { quantity: '', reason: 'SPOILAGE', note: '' },
  });

  const record = useRecordWastage({
    onSuccess: (movement) => {
      toast.success(
        `Recorded ${formatQuantity(movement.quantity, movement.unit)} wasted. Now ` +
          `${formatQuantity(movement.quantityAfter, movement.unit)}.`,
      );
      onClose();
    },
  });

  if (!ingredient) return null;

  const submit = form.handleSubmit((values) =>
    record.mutate({
      ingredientId: ingredient.id,
      body: {
        quantity: Number(values.quantity),
        reason: values.reason,
        note: blank(values.note),
      },
    }),
  );

  return (
    <Modal
      open
      title={`Record wastage: ${ingredient.name}`}
      description={`${formatQuantity(ingredient.currentQuantity, ingredient.unit)} on the shelf now.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={record.isPending} onClick={() => void submit()}>
            Record wastage
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormError error={record.error} />

        <TextField
          label={`How much was wasted (${UNIT_LABELS[ingredient.unit]})`}
          inputMode="decimal"
          autoFocus
          required
          error={form.formState.errors.quantity?.message}
          {...form.register('quantity')}
        />

        <SelectField
          label="What happened"
          required
          error={form.formState.errors.reason?.message}
          {...form.register('reason')}
        >
          {WASTAGE_REASONS.map((value) => (
            <option key={value} value={value}>
              {REASON_LABELS[value]}
            </option>
          ))}
        </SelectField>

        <TextAreaField
          label="Note (optional)"
          rows={2}
          error={form.formState.errors.note?.message}
          {...form.register('note')}
        />
      </form>
    </Modal>
  );
}

export function AdjustStockDialog({
  ingredient,
  onClose,
}: {
  ingredient: Ingredient | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const form = useForm<StockAdjustmentValues>({
    resolver: zodResolver(stockAdjustmentSchema),
    defaultValues: { quantity: '', direction: 'remove', reason: 'COUNT_CORRECTION', note: '' },
  });

  const adjust = useAdjustStock({
    onSuccess: (movement) => {
      toast.success(`Corrected to ${formatQuantity(movement.quantityAfter, movement.unit)}.`);
      onClose();
    },
  });

  if (!ingredient) return null;

  const submit = form.handleSubmit((values) =>
    adjust.mutate({
      ingredientId: ingredient.id,
      body: {
        quantity: Number(values.quantity),
        increase: values.direction === 'add',
        reason: values.reason,
        note: blank(values.note),
      },
    }),
  );

  return (
    <Modal
      open
      title={`Correct stock: ${ingredient.name}`}
      description={`${formatQuantity(ingredient.currentQuantity, ingredient.unit)} on the shelf now. Enter the difference, not the new total.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={adjust.isPending} onClick={() => void submit()}>
            Save correction
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormError error={adjust.error} />

        <SelectField label="Direction" required {...form.register('direction')}>
          <option value="remove">Take away</option>
          <option value="add">Add</option>
        </SelectField>

        <TextField
          label={`How much (${UNIT_LABELS[ingredient.unit]})`}
          inputMode="decimal"
          autoFocus
          required
          error={form.formState.errors.quantity?.message}
          {...form.register('quantity')}
        />

        <SelectField
          label="Why"
          required
          error={form.formState.errors.reason?.message}
          {...form.register('reason')}
        >
          {ADJUSTMENT_REASONS.map((value) => (
            <option key={value} value={value}>
              {REASON_LABELS[value]}
            </option>
          ))}
        </SelectField>

        <TextAreaField
          label="Note (optional)"
          rows={2}
          error={form.formState.errors.note?.message}
          {...form.register('note')}
        />
      </form>
    </Modal>
  );
}
