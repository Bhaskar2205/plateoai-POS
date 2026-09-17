'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Clock, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  useCategories,
  useDeleteDish,
  useDishes,
  useDishIngredients,
  useIngredients,
  useSaveDish,
  useToggleDishAvailability,
  type DishPayload,
} from '@/lib/queries';
import { dishSchema, type DishValues } from '@/lib/schemas';
import type { Dish } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { CheckboxField, SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { ConfirmDialog, Modal } from '@/components/ui/modal';
import {
  EmptyState,
  ErrorState,
  FormError,
  LoadingState,
  TableSkeleton,
} from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import type { CategoryFilter } from './category-manager';
import { DishIngredientPicker } from './dish-ingredient-picker';

const DIET_LABELS: Record<string, string> = {
  VEG: 'Vegetarian',
  NON_VEG: 'Non-vegetarian',
  EGG: 'Contains egg',
  VEGAN: 'Vegan',
};

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

const EMPTY_FORM: DishValues = {
  name: '',
  description: '',
  categoryId: '',
  price: 0,
  imageUrl: '',
  dietType: '',
  isAvailable: true,
  proteinGrams: undefined,
  calories: undefined,
  carbsGrams: undefined,
  fatGrams: undefined,
  preparationTimeMinutes: undefined,
  ingredients: [],
};

/**
 * Dish list with create, edit, delete and availability toggling.
 *
 * The category filter can be controlled by a sibling `CategoryManager` (the
 * menu screen) or left to the component's own dropdown (the dishes page).
 */
export function DishManager({
  categoryFilter: controlledFilter,
  onCategoryFilterChange,
  autoOpenCreate = false,
  onAutoOpened,
}: {
  categoryFilter?: CategoryFilter;
  onCategoryFilterChange?: (filter: CategoryFilter) => void;
  /** Open the "Add dish" dialog once, e.g. from a dashboard quick action. */
  autoOpenCreate?: boolean;
  onAutoOpened?: () => void;
}) {
  const toast = useToast();
  const { data: dishes, isPending, isError, error, refetch } = useDishes();
  const categories = useCategories();
  const pantry = useIngredients();

  const [ownFilter, setOwnFilter] = useState<CategoryFilter>('all');
  const categoryFilter = controlledFilter ?? ownFilter;
  const setCategoryFilter = onCategoryFilterChange ?? setOwnFilter;

  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Dish | null>(null);
  const [deleting, setDeleting] = useState<Dish | null>(null);

  const isFormOpen = creating || editing !== null;
  const recipe = useDishIngredients(editing?.id ?? null);
  /** Which dish's saved recipe has been copied into the form, so a refetch can't clobber edits. */
  const hydratedFor = useRef<number | null>(null);

  const save = useSaveDish({
    onSuccess: (dish, variables) => {
      toast.success(variables.id ? `Saved “${dish.name}”.` : `Added “${dish.name}” to the menu.`);
      setCreating(false);
      setEditing(null);
    },
  });
  const remove = useDeleteDish();
  const toggle = useToggleDishAvailability();

  const form = useForm<DishValues>({
    resolver: zodResolver(dishSchema),
    defaultValues: EMPTY_FORM,
  });

  // Fill the form before the dialog renders. Resetting in an effect after it
  // opened showed the previous dish for a frame and could wipe early input.
  const openCreate = () => {
    save.reset();
    hydratedFor.current = null;
    form.reset({
      ...EMPTY_FORM,
      // Adding a dish while a category is selected puts it in that category.
      categoryId: typeof categoryFilter === 'number' ? String(categoryFilter) : '',
    });
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (dish: Dish) => {
    save.reset();
    hydratedFor.current = null;
    form.reset({
      name: dish.name,
      description: dish.description ?? '',
      categoryId: dish.categoryId ? String(dish.categoryId) : '',
      price: dish.price,
      imageUrl: dish.imageUrl ?? '',
      dietType: dish.dietType ?? '',
      isAvailable: dish.isAvailable,
      proteinGrams: dish.proteinGrams ?? undefined,
      calories: dish.calories ?? undefined,
      carbsGrams: dish.carbsGrams ?? undefined,
      fatGrams: dish.fatGrams ?? undefined,
      preparationTimeMinutes: dish.preparationTimeMinutes ?? undefined,
      // Filled in by the effect below once the saved recipe has loaded.
      ingredients: [],
    });
    setCreating(false);
    setEditing(dish);
  };

  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpenCreate || autoOpened.current) return;
    autoOpened.current = true;
    openCreate();
    onAutoOpened?.();
    // openCreate/onAutoOpened are recreated each render; this should run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenCreate]);

  // Copy the saved recipe into the form once it has loaded for this dish.
  useEffect(() => {
    if (!editing || !recipe.data || hydratedFor.current === editing.id) return;

    hydratedFor.current = editing.id;
    form.setValue(
      'ingredients',
      recipe.data.map((line) => ({
        ingredientId: line.ingredientId,
        quantity: String(line.quantity),
        unit: line.unit,
      })),
    );
  }, [editing, recipe.data, form]);

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const recipeLoading = editing !== null && recipe.isPending;
  const recipeFailed = editing !== null && recipe.isError;

  const onSubmit = form.handleSubmit((values) => {
    const body: DishPayload = {
      name: values.name,
      price: values.price,
      isAvailable: values.isAvailable,
      // Blank optional fields are sent as null so that clearing one on edit
      // really clears it, rather than leaving the old value in place.
      categoryId: values.categoryId ? Number(values.categoryId) : null,
      description: values.description || null,
      imageUrl: values.imageUrl || null,
      dietType: values.dietType || null,
      proteinGrams: values.proteinGrams ?? null,
      calories: values.calories ?? null,
      carbsGrams: values.carbsGrams ?? null,
      fatGrams: values.fatGrams ?? null,
      preparationTimeMinutes: values.preparationTimeMinutes ?? null,
    };

    // If the saved recipe never loaded, omit it: sending the form's empty list
    // would wipe the dish's real recipe.
    if (!recipeFailed) {
      body.ingredients = values.ingredients.map((line) => ({
        ingredientId: line.ingredientId,
        quantity: Number(line.quantity),
        unit: line.unit,
      }));
    }

    save.mutate({ id: editing?.id, body });
  });

  const term = search.trim().toLowerCase();
  const visible = (dishes ?? []).filter((dish) => {
    const inCategory =
      categoryFilter === 'all' ||
      (categoryFilter === 'uncategorised' ? dish.categoryId === null : dish.categoryId === categoryFilter);
    return inCategory && (!term || dish.name.toLowerCase().includes(term));
  });

  const filterValue = typeof categoryFilter === 'number' ? String(categoryFilter) : categoryFilter;
  const filterName =
    typeof categoryFilter === 'number'
      ? categories.data?.find((category) => category.id === categoryFilter)?.name
      : undefined;

  return (
    <>
      <Card>
        <CardHeader
          title={filterName ? `Dishes in ${filterName}` : 'Dishes'}
          description={
            dishes
              ? `${visible.length} of ${dishes.length} shown · ${dishes.filter((dish) => dish.isAvailable).length} available`
              : 'Your menu items, prices and availability.'
          }
          action={
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" aria-hidden />
              Add dish
            </Button>
          }
        />

        {isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isPending ? (
          <TableSkeleton />
        ) : dishes.length === 0 ? (
          <EmptyState
            title="No dishes yet"
            description="Add your first dish with its price, prep time and ingredients."
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="size-4" aria-hidden />
                Add your first dish
              </Button>
            }
          />
        ) : (
          <>
            <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:px-5">
              <div className="relative sm:max-w-xs sm:flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <input
                  id="dish-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search dishes"
                  aria-label="Search dishes"
                  className="w-full rounded-lg border border-line bg-surface py-2 pr-3 pl-8 text-sm placeholder:text-muted/70 shadow-card transition-[border-color,box-shadow] hover:border-muted/40 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none"
                />
              </div>
              <select
                id="dish-category-filter"
                value={filterValue}
                onChange={(event) => {
                  const { value } = event.target;
                  setCategoryFilter(value === 'all' || value === 'uncategorised' ? value : Number(value));
                }}
                aria-label="Filter by category"
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-card transition-[border-color,box-shadow] hover:border-muted/40 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none sm:w-52"
              >
                <option value="all">All categories</option>
                {(categories.data ?? []).map((category) => (
                  <option key={category.id} value={String(category.id)}>
                    {category.name}
                  </option>
                ))}
                <option value="uncategorised">Uncategorised</option>
              </select>
            </div>

            {visible.length === 0 ? (
              <EmptyState
                title={term ? 'No dishes match your search' : 'No dishes here yet'}
                description={term ? `Nothing matches “${search.trim()}”.` : 'Add one, or choose another category.'}
              />
            ) : (
              <ul className="divide-y divide-line">
                {visible.map((dish) => {
                  return (
                    <li key={dish.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:px-5">
                      <div className="flex min-w-0 flex-1 gap-3">
                        {dish.imageUrl && <DishThumbnail key={dish.imageUrl} src={dish.imageUrl} />}

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-ink">{dish.name}</p>
                            <Badge tone={dish.isAvailable ? 'success' : 'neutral'}>
                              {dish.isAvailable ? 'Available' : 'Unavailable'}
                            </Badge>
                            {dish.dietType && <Badge>{DIET_LABELS[dish.dietType]}</Badge>}
                          </div>

                          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                            <span className="font-semibold text-ink tabular-nums">{currency.format(dish.price)}</span>
                            {dish.preparationTimeMinutes !== null && (
                              <span className="inline-flex items-center gap-1 text-xs text-muted">
                                <Clock className="size-3.5" aria-hidden />
                                {dish.preparationTimeMinutes} min
                              </span>
                            )}
                            {categoryFilter === 'all' && (
                              <span className="text-xs text-muted">
                                {dish.category ? dish.category.name : 'Uncategorised'}
                              </span>
                            )}
                          </p>

                          {dish.description && (
                            <p className="mt-1 line-clamp-2 text-xs text-muted">{dish.description}</p>
                          )}

                          <NutritionSummary dish={dish} />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <AvailabilitySwitch
                          dish={dish}
                          onToggle={(isAvailable, done) =>
                            toggle.mutate(
                              { id: dish.id, isAvailable },
                              {
                                onSuccess: (updated) =>
                                  toast.success(
                                    `“${updated.name}” is now ${updated.isAvailable ? 'available' : 'unavailable'}.`,
                                  ),
                                onError: (mutationError) => toast.error(mutationError),
                                onSettled: done,
                              },
                            )
                          }
                        />
                        <Button variant="ghost" size="sm" onClick={() => openEdit(dish)}>
                          <Pencil className="size-4" aria-hidden />
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleting(dish)} aria-label={`Delete ${dish.name}`}>
                          <Trash2 className="size-4 text-danger-500" aria-hidden />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Card>

      <Modal
        open={isFormOpen}
        title={editing ? `Edit ${editing.name}` : 'Add dish'}
        onClose={closeForm}
        footer={
          <>
            <Button variant="secondary" onClick={closeForm} disabled={save.isPending}>
              Cancel
            </Button>
            <Button onClick={() => void onSubmit()} loading={save.isPending} disabled={recipeLoading}>
              {editing ? 'Save changes' : 'Add dish'}
            </Button>
          </>
        }
      >
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError error={save.error} />

          <TextField
            id="dish-name"
            label="Name"
            placeholder="Paneer Tikka Bowl"
            required
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />

          <TextAreaField
            id="dish-description"
            label="Description"
            placeholder="Grilled paneer with fresh vegetables and mint dressing"
            error={form.formState.errors.description?.message}
            {...form.register('description')}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="dish-category"
              label="Category"
              hint={(categories.data ?? []).length === 0 ? 'No categories yet — add one from the category list.' : undefined}
              error={form.formState.errors.categoryId?.message}
              {...form.register('categoryId')}
            >
              <option value="">Uncategorised</option>
              {(categories.data ?? []).map((category) => (
                <option key={category.id} value={String(category.id)}>
                  {category.name}
                </option>
              ))}
            </SelectField>

            <TextField
              id="dish-price"
              label="Price (₹)"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              required
              error={form.formState.errors.price?.message}
              {...form.register('price')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="dish-prep-time"
              label="Preparation time (minutes)"
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              step={1}
              placeholder="15"
              error={form.formState.errors.preparationTimeMinutes?.message}
              {...form.register('preparationTimeMinutes')}
            />

            <SelectField
              id="dish-diet-type"
              label="Diet type"
              error={form.formState.errors.dietType?.message}
              {...form.register('dietType')}
            >
              <option value="">Not specified</option>
              <option value="VEG">Vegetarian</option>
              <option value="NON_VEG">Non-vegetarian</option>
              <option value="EGG">Contains egg</option>
              <option value="VEGAN">Vegan</option>
            </SelectField>
          </div>

          <TextField
            id="dish-image-url"
            label="Image URL"
            placeholder="https://cdn.example.com/dish.jpg"
            error={form.formState.errors.imageUrl?.message}
            {...form.register('imageUrl')}
          />

          {pantry.isError ? (
            <ErrorState error={pantry.error} onRetry={() => void pantry.refetch()} />
          ) : pantry.isPending || recipeLoading ? (
            <LoadingState label="Loading ingredients…" />
          ) : recipeFailed ? (
            <div className="rounded-lg border border-warn-600/30 bg-warn-50 px-3 py-2 text-sm text-warn-600">
              This dish’s ingredients couldn’t be loaded, so saving will keep its current recipe unchanged.{' '}
              <button type="button" className="font-medium underline" onClick={() => void recipe.refetch()}>
                Try again
              </button>
            </div>
          ) : (
            <DishIngredientPicker form={form} pantry={pantry.data} />
          )}

          <fieldset className="space-y-3 rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-medium text-ink">Nutrition (optional)</legend>
            <p className="text-xs text-muted">
              Enter the values you want to show customers. Plateo stores them exactly as typed and does not
              calculate or verify them — this is not nutritional or medical advice.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                id="dish-protein"
                label="Protein (g)"
                type="number"
                min={0}
                step="0.01"
                error={form.formState.errors.proteinGrams?.message}
                {...form.register('proteinGrams')}
              />
              <TextField
                id="dish-calories"
                label="Calories (kcal)"
                type="number"
                min={0}
                step="0.01"
                error={form.formState.errors.calories?.message}
                {...form.register('calories')}
              />
              <TextField
                id="dish-carbs"
                label="Carbohydrates (g)"
                type="number"
                min={0}
                step="0.01"
                error={form.formState.errors.carbsGrams?.message}
                {...form.register('carbsGrams')}
              />
              <TextField
                id="dish-fat"
                label="Fat (g)"
                type="number"
                min={0}
                step="0.01"
                error={form.formState.errors.fatGrams?.message}
                {...form.register('fatGrams')}
              />
            </div>
          </fieldset>

          <CheckboxField
            id="dish-available"
            label="Available"
            hint="Unavailable dishes stay on your menu but cannot be ordered."
            {...form.register('isAvailable')}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete “${deleting?.name}”?`}
        message="The dish and its ingredient list are removed. The ingredients themselves stay in your pantry. This cannot be undone."
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          const { id, name } = deleting;

          remove.mutate(id, {
            onSuccess: () => {
              toast.success(`Deleted “${name}”.`);
              setDeleting(null);
            },
            onError: (mutationError) => toast.error(mutationError),
          });
        }}
      />
    </>
  );
}

/**
 * Availability switch for one dish.
 *
 * Holds the clicked value locally, set inside the click handler, so the switch
 * moves in the same render as the click. A controlled checkbox bound only to
 * server data snaps back until the save lands, which reads as unresponsive.
 * The local value is dropped once the save settles: on success the cache
 * already holds it, on failure the cache has rolled back and so does the switch.
 */
function AvailabilitySwitch({
  dish,
  onToggle,
}: {
  dish: Dish;
  onToggle: (isAvailable: boolean, done: () => void) => void;
}) {
  const [pending, setPending] = useState<boolean | null>(null);
  const checked = pending ?? dish.isAvailable;

  return (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink select-none hover:bg-ground">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-busy={pending !== null}
        aria-label={`${dish.name} available`}
        onChange={() => {
          // Ignore repeat clicks while a save for this dish is still in flight.
          if (pending !== null) return;
          const next = !checked;
          setPending(next);
          onToggle(next, () => setPending(null));
        }}
        className="size-4 cursor-pointer accent-brand-600"
      />
      {pending !== null ? 'Saving…' : 'Available'}
    </label>
  );
}

/**
 * Restaurant-supplied image URL. If it fails to load (typo, expired link), the
 * thumbnail is dropped rather than leaving an empty box in the row. Keyed by
 * URL by the caller, so fixing the URL shows the image again.
 */
function DishThumbnail({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    // External, restaurant-supplied URLs: next/image would need every host allow-listed.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-14 shrink-0 rounded-md border border-line object-cover"
    />
  );
}

function NutritionSummary({ dish }: { dish: Dish }) {
  const values = [
    dish.calories !== null ? `${dish.calories} kcal` : null,
    dish.proteinGrams !== null ? `${dish.proteinGrams}g protein` : null,
    dish.carbsGrams !== null ? `${dish.carbsGrams}g carbs` : null,
    dish.fatGrams !== null ? `${dish.fatGrams}g fat` : null,
  ].filter(Boolean);

  if (values.length === 0) {
    return null;
  }

  return <p className="mt-1.5 text-xs text-muted tabular-nums">{values.join(' · ')}</p>;
}
