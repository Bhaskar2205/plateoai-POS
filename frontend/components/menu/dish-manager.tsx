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
  useMoveDishesToSection,
  useSaveDish,
  useToggleDishAvailability,
  type DishPayload,
} from '@/lib/queries';
import { dishSchema, type DishValues } from '@/lib/schemas';
import type { Dish } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
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
import { DishForm } from './dish-form';

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
  taxGroup: 'STANDARD' as const,
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
  /** Dishes ticked for a bulk move. Cleared whenever the move lands. */
  const [picked, setPicked] = useState<Set<number>>(new Set());
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
  const moveToSection = useMoveDishesToSection({
    onSuccess: (moved) => {
      toast.success(
        `Moved ${moved.length} dish${moved.length === 1 ? '' : 'es'} to a new section.`,
      );
      setPicked(new Set());
    },
    onError: (moveError) => toast.error(moveError),
  });

  const togglePicked = (id: number) =>
    setPicked((current) => {
      const next = new Set(current);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });

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
      taxGroup: dish.taxGroup ?? 'STANDARD',
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
      taxGroup: values.taxGroup ?? 'STANDARD',
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
          title={filterName ? `Dishes in ${filterName}` : 'Your dishes'}
          description={
            dishes
              ? `${visible.length} of ${dishes.length} shown · ${dishes.filter((dish) => dish.isAvailable).length} available`
              : 'Everything on your menu, with prices and availability.'
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
            description="A name and a price is all it takes to start. You can add a photo, what's in it and nutrition later."
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
              <label className="flex items-center gap-2 text-sm text-muted sm:order-last">
                <input
                  type="checkbox"
                  checked={visible.length > 0 && visible.every((dish) => picked.has(dish.id))}
                  onChange={(event) =>
                    setPicked(event.target.checked ? new Set(visible.map((dish) => dish.id)) : new Set())
                  }
                  aria-label="Select every dish shown"
                  className="size-4 cursor-pointer accent-brand-600"
                />
                Select all shown
              </label>

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
              {/* On the menu screen the section chips above already filter, so this
                  dropdown only appears where the list stands on its own. */}
              {controlledFilter === undefined && (
                <select
                  id="dish-category-filter"
                  value={filterValue}
                  onChange={(event) => {
                    const { value } = event.target;
                    setCategoryFilter(
                      value === 'all' || value === 'uncategorised' ? value : Number(value),
                    );
                  }}
                  aria-label="Filter by section"
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-card transition-[border-color,box-shadow] hover:border-muted/40 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none sm:w-52"
                >
                  <option value="all">All sections</option>
                  {(categories.data ?? []).map((category) => (
                    <option key={category.id} value={String(category.id)}>
                      {category.name}
                    </option>
                  ))}
                  <option value="uncategorised">Not in a section</option>
                </select>
              )}
            </div>

            {picked.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-50 px-4 py-2.5 sm:px-5">
                <p className="text-sm font-medium text-brand-700">
                  {picked.size} dish{picked.size === 1 ? '' : 'es'} selected
                </p>
                <label htmlFor="bulk-move-section" className="sr-only">
                  Move the selected dishes to a section
                </label>
                <select
                  id="bulk-move-section"
                  defaultValue=""
                  disabled={moveToSection.isPending}
                  onChange={(event) => {
                    const { value } = event.target;
                    if (value === '') return;

                    moveToSection.mutate({
                      ids: [...picked],
                      categoryId: value === 'none' ? null : Number(value),
                    });
                    event.target.value = '';
                  }}
                  className="h-9 rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:border-brand-500 focus:outline-none"
                >
                  <option value="">Move to section…</option>
                  {(categories.data ?? []).map((category) => (
                    <option key={category.id} value={String(category.id)}>
                      {category.name}
                    </option>
                  ))}
                  <option value="none">No section</option>
                </select>
                <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
                  Clear
                </Button>
              </div>
            )}

            {visible.length === 0 ? (
              <EmptyState
                title={term ? 'No dishes match your search' : 'No dishes in this section yet'}
                description={
                  term
                    ? `Nothing matches “${search.trim()}”.`
                    : 'Add one, or pick another section above.'
                }
              />
            ) : (
              <ul className="divide-y divide-line">
                {visible.map((dish) => {
                  return (
                    <li key={dish.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:px-5">
                      <div className="flex min-w-0 flex-1 gap-3">
                        <input
                          type="checkbox"
                          checked={picked.has(dish.id)}
                          onChange={() => togglePicked(dish.id)}
                          aria-label={`Select ${dish.name}`}
                          className="mt-1 size-4 shrink-0 cursor-pointer accent-brand-600"
                        />
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
                                {dish.category ? dish.category.name : 'No section'}
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
        size="lg"
        title={editing ? `Edit ${editing.name}` : 'Add a dish'}
        description="Only a name and a price are required. Everything else can be added later."
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

          <DishForm
            form={form}
            categories={categories.data ?? []}
            pantry={pantry.data}
            recipeSlot={
              pantry.isError ? (
                <ErrorState error={pantry.error} onRetry={() => void pantry.refetch()} />
              ) : pantry.isPending || recipeLoading ? (
                <LoadingState label="Loading ingredients…" />
              ) : recipeFailed ? (
                <div className="rounded-lg border border-warn-600/30 bg-warn-50 px-3 py-2 text-sm text-warn-600">
                  This dish’s ingredients couldn’t be loaded, so saving will keep its current recipe
                  unchanged.{' '}
                  <button
                    type="button"
                    className="font-medium underline"
                    onClick={() => void recipe.refetch()}
                  >
                    Try again
                  </button>
                </div>
              ) : undefined
            }
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
