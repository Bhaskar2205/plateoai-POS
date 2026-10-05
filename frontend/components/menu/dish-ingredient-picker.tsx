'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import { useFieldArray, type UseFormReturn } from 'react-hook-form';
import { queryKeys, useSaveIngredient } from '@/lib/queries';
import type { DishValues } from '@/lib/schemas';
import type { Ingredient } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import { defaultRecipeUnit, recipeLineCost } from '@/components/inventory/recipe-cost';
import { fromPaise } from '@/components/inventory/stock-units';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

const UNITS = ['g', 'kg', 'ml', 'l', 'piece', 'tbsp', 'tsp', 'cup'] as const;

const CONTROL =
  'rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink shadow-card transition-[border-color,box-shadow] hover:border-muted/40 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none';

/**
 * Recipe editor embedded in the dish form.
 *
 * The lines live in the dish form's own state, so they are validated with the
 * rest of the dish and sent in the same request - the server writes the dish
 * and its recipe in one transaction.
 */
export function DishIngredientPicker({
  form,
  pantry,
}: {
  form: UseFormReturn<DishValues>;
  pantry: Ingredient[];
}) {
  const addId = useId();
  const [pendingId, setPendingId] = useState('');
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'ingredients' });

  const lines = form.watch('ingredients');
  const byId = new Map(pantry.map((ingredient) => [ingredient.id, ingredient]));
  const usedIds = new Set(lines.map((line) => line.ingredientId));
  const available = pantry.filter((ingredient) => !usedIds.has(ingredient.id));

  const allergens = [
    ...new Set(
      lines
        .map((line) => byId.get(line.ingredientId)?.allergenInfo?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  const appendLine = (ingredientId: number) => {
    append(
      // Grams against stock held in kilograms is the ordinary case, so the line
      // starts in the unit a recipe is actually written in.
      { ingredientId, quantity: '', unit: defaultRecipeUnit(byId.get(ingredientId)) },
      { shouldFocus: true, focusName: `ingredients.${fields.length}.quantity` },
    );
  };

  const addExisting = (value: string) => {
    const ingredientId = Number(value);
    if (!ingredientId) return;

    appendLine(ingredientId);
    setPendingId('');
  };

  return (
    <fieldset className="space-y-3 rounded-lg border border-line p-3">
      <legend className="px-1 text-sm font-medium text-ink">
        Ingredients{fields.length > 0 && <span className="ml-1 text-muted">({fields.length})</span>}
      </legend>

      {fields.length === 0 ? (
        <p className="text-sm text-muted">
          {pantry.length === 0
            ? 'You have no ingredients yet. Create one below — it is saved to your ingredient list and reusable across dishes.'
            : 'No ingredients selected.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {fields.map((field, index) => {
            const ingredient = byId.get(lines[index]?.ingredientId ?? field.ingredientId);
            const errors = form.formState.errors.ingredients?.[index];
            const name = ingredient?.name ?? 'Removed ingredient';
            const cost = recipeLineCost(
              lines[index]?.quantity ?? '',
              lines[index]?.unit ?? '',
              ingredient,
            );

            return (
              <li key={field.id} className="rounded-md border border-line bg-ground/60 p-2.5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_6rem_auto]">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{name}</p>
                    {ingredient?.allergenInfo && (
                      <p className="truncate text-xs text-warn-600">{ingredient.allergenInfo}</p>
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="sm:order-last"
                    onClick={() => remove(index)}
                    aria-label={`Remove ${name}`}
                  >
                    <Trash2 className="size-4 text-danger-500" aria-hidden />
                  </Button>

                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Qty"
                    aria-label={`Quantity of ${name}`}
                    aria-invalid={errors?.quantity ? true : undefined}
                    className={`${CONTROL} w-full tabular-nums ${errors?.quantity ? 'border-danger-500' : ''}`}
                    {...form.register(`ingredients.${index}.quantity`)}
                  />

                  <select
                    aria-label={`Unit for ${name}`}
                    className={`${CONTROL} w-full`}
                    {...form.register(`ingredients.${index}.unit`)}
                  >
                    {UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>

                {(errors?.quantity || errors?.unit) && (
                  <p role="alert" className="mt-1.5 text-xs font-medium text-danger-600">
                    {errors.quantity?.message ?? errors.unit?.message}
                  </p>
                )}

                {/* What this line costs, as it is typed. A note instead of a
                    number when the unit is not something that can be weighed. */}
                {cost.costPaise !== null && cost.costPaise > 0 && (
                  <p className="mt-1.5 text-xs text-muted tabular-nums">
                    {formatMoney(fromPaise(cost.costPaise))} per dish
                  </p>
                )}
                {cost.note && <p className="mt-1.5 text-xs text-warn-600">{cost.note}</p>}
              </li>
            );
          })}
        </ul>
      )}

      <RecipeCost lines={lines} byId={byId} />

      {pantry.length > 0 && (
        <div>
          <label htmlFor={addId} className="sr-only">
            Add an ingredient
          </label>
          <select
            id={addId}
            value={pendingId}
            onChange={(event) => addExisting(event.target.value)}
            disabled={available.length === 0}
            className={`${CONTROL} w-full sm:max-w-xs disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <option value="">
              {available.length === 0 ? 'All ingredients added' : '+ Add an existing ingredient…'}
            </option>
            {available.map((ingredient) => (
              <option key={ingredient.id} value={ingredient.id}>
                {ingredient.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <NewIngredientInline onCreated={appendLine} />

      {allergens.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-warn-600">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Declared allergens: {allergens.join(' · ')}. Shown as your ingredients state them;
            Plateo does not verify allergen claims.
          </span>
        </p>
      )}
    </fieldset>
  );
}

/**
 * Creates a pantry ingredient without leaving the dish form, then adds it to
 * the recipe. It sits inside the dish `<form>`, so it uses button-type controls
 * and intercepts Enter rather than nesting a second form.
 */
function NewIngredientInline({ onCreated }: { onCreated: (ingredientId: number) => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const nameId = useId();
  const allergenId = useId();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [allergenInfo, setAllergenInfo] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  const save = useSaveIngredient();

  const close = () => {
    setOpen(false);
    setName('');
    setAllergenInfo('');
    setNameError(null);
    save.reset();
  };

  const submit = () => {
    const trimmed = name.trim();

    if (!trimmed) {
      setNameError('Ingredient name is required');
      return;
    }
    if (trimmed.length > 120) {
      setNameError('Ingredient name is too long');
      return;
    }
    if (allergenInfo.trim().length > 255) {
      setNameError('Allergen note must be 255 characters or fewer');
      return;
    }

    setNameError(null);
    save.mutate(
      { body: { name: trimmed, allergenInfo: allergenInfo.trim() } },
      {
        onSuccess: (created) => {
          // Put it in the cached list now, so the new recipe line shows its
          // name straight away instead of waiting for the refetch.
          queryClient.setQueryData<Ingredient[]>(queryKeys.ingredients, (current) =>
            current?.some((item) => item.id === created.id)
              ? current
              : [...(current ?? []), created].sort((a, b) => a.name.localeCompare(b.name)),
          );
          onCreated(created.id);
          toast.success(`Created “${created.name}” and added it to this dish.`);
          close();
        },
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter would otherwise submit the surrounding dish form.
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        New ingredient
      </Button>
    );
  }

  return (
    <div className="space-y-2.5 rounded-md border border-brand-100 bg-brand-50/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">New ingredient</p>
        <Button variant="ghost" size="sm" onClick={close} aria-label="Cancel new ingredient">
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={nameId} className="block text-xs font-medium text-ink">
            New ingredient name
          </label>
          <input
            id={nameId}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Paneer"
            aria-invalid={nameError ? true : undefined}
            className={`${CONTROL} w-full ${nameError ? 'border-danger-500' : ''}`}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={allergenId} className="block text-xs font-medium text-ink">
            Allergen note (optional)
          </label>
          <input
            id={allergenId}
            value={allergenInfo}
            onChange={(event) => setAllergenInfo(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Contains milk"
            className={`${CONTROL} w-full`}
          />
        </div>
      </div>

      {(nameError || save.error) && (
        <p role="alert" className="text-xs font-medium text-danger-600">
          {nameError ?? save.error?.message}
          {save.error?.message.includes('already exists') && ' Pick it from the list above instead.'}
        </p>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={submit} loading={save.isPending}>
          Create and add
        </Button>
      </div>
    </div>
  );
}

/**
 * What the dish costs to make, from the lines that can be costed.
 *
 * Says how many lines it could not cost rather than quietly leaving them out: a
 * food cost that is wrong because a line said "1 tbsp" is worse than no figure,
 * because it looks right.
 */
function RecipeCost({
  lines,
  byId,
}: {
  lines: DishValues['ingredients'];
  byId: Map<number, Ingredient>;
}) {
  const costs = lines.map((line) =>
    recipeLineCost(line.quantity, line.unit, byId.get(line.ingredientId)),
  );

  const counted = costs.filter((cost) => cost.costPaise !== null && cost.costPaise > 0);
  const uncosted = costs.filter((cost) => cost.costPaise === null && cost.note !== null).length;

  if (counted.length === 0) return null;

  const total = counted.reduce((sum, cost) => sum + (cost.costPaise ?? 0), 0);

  return (
    <p className="mt-3 border-t border-line pt-3 text-sm text-muted">
      Ingredients cost{' '}
      <span className="font-semibold text-ink tabular-nums">{formatMoney(fromPaise(total))}</span>{' '}
      per dish
      {uncosted > 0 &&
        ` · ${uncosted} line${uncosted === 1 ? '' : 's'} not included, see the notes above`}
    </p>
  );
}
