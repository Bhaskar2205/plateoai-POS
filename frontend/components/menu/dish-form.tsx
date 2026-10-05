'use client';

import { Clock, Eye, Flame, ImageOff, TriangleAlert, UtensilsCrossed } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import type { DishValues } from '@/lib/schemas';
import type { Category, Ingredient } from '@/lib/types';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { DishIngredientPicker } from './dish-ingredient-picker';
import { PhotoUpload } from './photo-upload';

/**
 * The add/edit dish form, written for someone who runs a restaurant rather than
 * someone who fills in database records.
 *
 * Three ideas hold it together:
 *
 *  - **Only two things are required** - a name and a price. Everything else is
 *    marked optional and can be added later, so a new restaurant can get its
 *    menu up in ten minutes and enrich it afterwards.
 *  - **Every field says where it shows up.** The whole form is things diners
 *    see, so the live preview beside it answers "what will this look like?"
 *    without publishing and checking.
 *  - **Plain words.** "What's in it" rather than ingredients-and-quantities,
 *    "Veg or non-veg" rather than diet type, "Section" rather than category.
 */

/**
 * Which tax rules a dish follows.
 *
 * Here because not everything on a menu is taxed alike: alcohol is outside GST
 * and pays state VAT instead, and a sealed packaged item can carry its own rate.
 * A restaurant that sells only cooked food never has to touch this.
 */
const TAX_GROUP_CHOICES = [
  { value: 'STANDARD' as const, label: 'Food & drink', hint: 'Cooked and served. The usual.' },
  { value: 'ALCOHOL' as const, label: 'Alcohol', hint: 'Outside GST; state VAT instead.' },
  { value: 'PACKAGED' as const, label: 'Packaged', hint: 'Sold sealed, as bought.' },
  { value: 'EXEMPT' as const, label: 'No tax', hint: 'Carries nothing.' },
];

const DIET_CHOICES = [
  { value: 'VEG', label: 'Veg', colour: '#1f8a3b' },
  { value: 'NON_VEG', label: 'Non-veg', colour: '#963a14' },
  { value: 'EGG', label: 'Egg', colour: '#963a14' },
  { value: 'VEGAN', label: 'Vegan', colour: '#1f8a3b' },
] as const;

export function DishForm({
  form,
  categories,
  pantry,
  recipeSlot,
}: {
  form: UseFormReturn<DishValues>;
  categories: Category[];
  pantry: Ingredient[] | undefined;
  /** Replaces the ingredients block while the saved recipe is loading or failed. */
  recipeSlot?: ReactNode;
}) {
  const values = form.watch();
  const errors = form.formState.errors;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
      <div className="space-y-5">
        <Step number={1} title="The basics" hint="The only two things a dish really needs.">
          <TextField
            id="dish-name"
            label="Dish name"
            placeholder="Paneer Tikka Bowl"
            required
            hint="Exactly as you want diners to read it."
            error={errors.name?.message}
            {...form.register('name')}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="dish-price"
              label="Price (₹)"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              required
              error={errors.price?.message}
              {...form.register('price')}
            />

            <SelectField
              id="dish-category"
              label="Section on the menu"
              hint={
                categories.length === 0
                  ? 'No sections yet — dishes appear under “More dishes”.'
                  : 'Which heading it sits under.'
              }
              error={errors.categoryId?.message}
              {...form.register('categoryId')}
            >
              <option value="">No section</option>
              {categories.map((category) => (
                <option key={category.id} value={String(category.id)}>
                  {category.name}
                </option>
              ))}
            </SelectField>
          </div>

          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium text-ink">Veg or non-veg</legend>
            <p className="mb-2 text-xs text-muted">
              Shows the green or brown mark diners look for. Leave blank if you would rather not say.
            </p>
            <div className="flex flex-wrap gap-2">
              <ChoiceChip
                selected={!values.dietType}
                onClick={() => form.setValue('dietType', '', { shouldDirty: true })}
              >
                Not stated
              </ChoiceChip>
              {DIET_CHOICES.map((choice) => (
                <ChoiceChip
                  key={choice.value}
                  selected={values.dietType === choice.value}
                  onClick={() => form.setValue('dietType', choice.value, { shouldDirty: true })}
                >
                  <span
                    aria-hidden
                    className="inline-grid size-3.5 place-items-center rounded-[3px] border-[1.5px] bg-white"
                    style={{ borderColor: choice.colour }}
                  >
                    <span
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: choice.colour }}
                    />
                  </span>
                  {choice.label}
                </ChoiceChip>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium text-ink">How it is taxed</legend>
            <p className="mb-2 text-xs text-muted">
              Leave this on Food &amp; drink unless the dish is an exception. Alcohol is outside GST
              and takes state VAT, so it has to be marked.
            </p>
            <div className="flex flex-wrap gap-2">
              {TAX_GROUP_CHOICES.map((choice) => (
                <ChoiceChip
                  key={choice.value}
                  selected={(values.taxGroup ?? 'STANDARD') === choice.value}
                  onClick={() => form.setValue('taxGroup', choice.value, { shouldDirty: true })}
                >
                  {choice.label}
                </ChoiceChip>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              {TAX_GROUP_CHOICES.find((choice) => choice.value === (values.taxGroup ?? 'STANDARD'))?.hint}{' '}
              The rates themselves live on the Taxes &amp; Charges page.
            </p>
          </fieldset>
        </Step>

        <Step
          number={2}
          title="Tell diners about it"
          hint="Optional, but this is what sells the dish."
        >
          <TextAreaField
            id="dish-description"
            label="Description"
            placeholder="Char-grilled paneer with peppers and onion, over lemon rice."
            hint="One or two lines. Shown under the dish name."
            error={errors.description?.message}
            {...form.register('description')}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="dish-prep-time"
              label="Ready in (minutes)"
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              step={1}
              placeholder="15"
              hint="Sets expectations at the table."
              error={errors.preparationTimeMinutes?.message}
              {...form.register('preparationTimeMinutes')}
            />

          </div>

          <PhotoUpload
            value={values.imageUrl ?? ''}
            error={errors.imageUrl?.message}
            onChange={(url) => form.setValue('imageUrl', url, { shouldDirty: true })}
          />
        </Step>

        <Step
          number={3}
          title="What's in it"
          hint="Diners open this to check what they are eating, and anything you mark as an allergen is shown as a warning."
        >
          {recipeSlot ?? (pantry ? <DishIngredientPicker form={form} pantry={pantry} /> : null)}
        </Step>

        <Step
          number={4}
          title="Nutrition"
          hint="Optional. Shown per serving, exactly as you type it — Plateo does not calculate or check these."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <TextField
              id="dish-calories"
              label="Calories"
              type="number"
              min={0}
              step="0.01"
              placeholder="kcal"
              error={errors.calories?.message}
              {...form.register('calories')}
            />
            <TextField
              id="dish-protein"
              label="Protein"
              type="number"
              min={0}
              step="0.01"
              placeholder="g"
              error={errors.proteinGrams?.message}
              {...form.register('proteinGrams')}
            />
            <TextField
              id="dish-carbs"
              label="Carbs"
              type="number"
              min={0}
              step="0.01"
              placeholder="g"
              error={errors.carbsGrams?.message}
              {...form.register('carbsGrams')}
            />
            <TextField
              id="dish-fat"
              label="Fat"
              type="number"
              min={0}
              step="0.01"
              placeholder="g"
              error={errors.fatGrams?.message}
              {...form.register('fatGrams')}
            />
          </div>
        </Step>

        <label className="flex items-start gap-3 rounded-xl border border-line bg-ground/60 p-3">
          <input
            type="checkbox"
            className="mt-0.5 size-4 cursor-pointer accent-brand-600"
            {...form.register('isAvailable')}
          />
          <span>
            <span className="block text-sm font-medium text-ink">Available to order today</span>
            <span className="block text-xs text-muted">
              Turn this off when the kitchen runs out. The dish stays on your menu, greyed out, and
              cannot be ordered.
            </span>
          </span>
        </label>
      </div>

      <DinerPreview values={values} pantry={pantry ?? []} />
    </div>
  );
}

function Step({
  number,
  title,
  hint,
  children,
}: {
  number: number;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">
          {number}
        </span>
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
          <p className="text-xs text-muted">{hint}</p>
        </div>
      </div>
      <div className="space-y-4 pl-8">{children}</div>
    </section>
  );
}

function ChoiceChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors',
        selected
          ? 'border-brand-600 bg-brand-50 text-brand-700'
          : 'border-line bg-surface text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

/**
 * The same card the diner sees, built from what is in the form right now.
 *
 * This is the whole point of the screen: everything typed here ends up in front
 * of a guest, and the fastest way to make that concrete is to show it changing
 * as they type.
 */
function DinerPreview({ values, pantry }: { values: DishValues; pantry: Ingredient[] }) {
  const [imageFailed, setImageFailed] = useState(false);

  const price = Number(values.price);
  const calories = Number(values.calories);
  const prep = Number(values.preparationTimeMinutes);

  const byId = new Map(pantry.map((ingredient) => [ingredient.id, ingredient]));
  const allergens = [
    ...new Set(
      (values.ingredients ?? [])
        .map((line) => byId.get(line.ingredientId)?.allergenInfo?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  const vegetarian = values.dietType === 'VEG' || values.dietType === 'VEGAN';
  const colour = vegetarian ? '#1f8a3b' : '#963a14';

  return (
    <aside className="lg:sticky lg:top-0">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
        <Eye className="size-3.5" aria-hidden />
        What diners will see
      </p>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <div className="flex gap-3 p-3">
          <div className="relative size-24 shrink-0 overflow-hidden rounded-xl border border-line bg-ground">
            {values.imageUrl && !imageFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={values.imageUrl}
                alt=""
                onError={() => setImageFailed(true)}
                className="size-full object-cover"
              />
            ) : (
              <div className="grid size-full place-items-center bg-gradient-to-br from-brand-50 via-ground to-saffron-50">
                {values.imageUrl ? (
                  <ImageOff className="size-5 text-muted/50" aria-hidden />
                ) : (
                  <UtensilsCrossed className="size-5 text-brand-600/25" aria-hidden />
                )}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1.5">
              {values.dietType && (
                <span
                  aria-hidden
                  className="mt-[3px] inline-grid size-3.5 shrink-0 place-items-center rounded-[3px] border-[1.5px] bg-white"
                  style={{ borderColor: colour }}
                >
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: colour }} />
                </span>
              )}
              <p className="min-w-0 text-sm leading-snug font-semibold text-ink">
                {values.name?.trim() || 'Your dish name'}
              </p>
            </div>

            <p className="mt-0.5 text-sm font-bold text-ink tabular-nums">
              {Number.isFinite(price) && price > 0 ? formatMoney(price) : '₹—'}
            </p>

            {values.description && (
              <p className="mt-1 line-clamp-2 text-xs text-muted">{values.description}</p>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted">
              {Number.isFinite(prep) && prep > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3" aria-hidden />
                  {prep} min
                </span>
              )}
              {Number.isFinite(calories) && calories > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Flame className="size-3" aria-hidden />
                  {calories} kcal
                </span>
              )}
            </div>
          </div>
        </div>

        {allergens.length > 0 && (
          <p className="mx-3 mb-2 flex items-start gap-1.5 rounded-lg bg-warn-50 px-2 py-1.5 text-[11px] font-medium text-warn-600">
            <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
            <span>Contains: {allergens.join(', ')}</span>
          </p>
        )}

        {(values.ingredients?.length ?? 0) > 0 && (
          <p className="border-t border-line px-3 py-2 text-[11px] font-semibold text-brand-700">
            What&apos;s inside · {values.ingredients.length} ingredients
          </p>
        )}

        {!values.isAvailable && (
          <p className="border-t border-line bg-ground px-3 py-2 text-[11px] text-muted">
            Hidden from the menu while it is unavailable.
          </p>
        )}
      </div>

      <p className="mt-2 text-xs text-muted">
        Your menu updates the moment you save — diners with the page open see it on their next
        refresh.
      </p>
    </aside>
  );
}
