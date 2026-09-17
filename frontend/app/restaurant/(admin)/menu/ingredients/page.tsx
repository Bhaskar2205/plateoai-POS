'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useDeleteIngredient, useIngredients, useSaveIngredient } from '@/lib/queries';
import { ingredientSchema, type IngredientValues } from '@/lib/schemas';
import type { Ingredient } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextAreaField, TextField } from '@/components/ui/field';
import { ConfirmDialog, Modal } from '@/components/ui/modal';
import { EmptyState, ErrorState, FormError, TableSkeleton } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';

export default function IngredientsPage() {
  // useSearchParams needs a Suspense boundary for static prerendering.
  return (
    <Suspense fallback={null}>
      <IngredientsScreen />
    </Suspense>
  );
}

function IngredientsScreen() {
  const router = useRouter();
  const openFromLink = useSearchParams().get('new') === '1';
  const { data: ingredients, isPending, isError, error, refetch } = useIngredients();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [deleting, setDeleting] = useState<Ingredient | null>(null);

  const toast = useToast();

  const save = useSaveIngredient({
    onSuccess: (ingredient, variables) => {
      toast.success(variables.id ? `Saved “${ingredient.name}”.` : `Added “${ingredient.name}”.`);
      setCreating(false);
      setEditing(null);
    },
  });
  const remove = useDeleteIngredient();

  const form = useForm<IngredientValues>({
    resolver: zodResolver(ingredientSchema),
    defaultValues: { name: '', description: '', allergenInfo: '' },
  });

  const isFormOpen = creating || editing !== null;

  // Fill the form before the dialog renders, so it never shows stale values.
  const openCreate = () => {
    save.reset();
    form.reset({ name: '', description: '', allergenInfo: '' });
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (ingredient: Ingredient) => {
    save.reset();
    form.reset({
      name: ingredient.name,
      description: ingredient.description ?? '',
      allergenInfo: ingredient.allergenInfo ?? '',
    });
    setCreating(false);
    setEditing(ingredient);
  };

  // A dashboard quick action links here with ?new=1: open "Add ingredient" once.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!openFromLink || autoOpened.current) return;
    autoOpened.current = true;
    openCreate();
    router.replace('/restaurant/menu/ingredients', { scroll: false });
    // openCreate is recreated each render; this should run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFromLink]);

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const onSubmit = form.handleSubmit((values) => {
    save.mutate({
      id: editing?.id,
      body: {
        name: values.name,
        // Always send both: the API stores '' as null, so clearing a field on
        // edit really clears it instead of leaving the old text behind.
        description: values.description ?? '',
        allergenInfo: values.allergenInfo ?? '',
      },
    });
  });

  // Filtering client-side: an ingredient list is small enough that a round trip
  // per keystroke would be slower than the filter itself.
  const visible = (ingredients ?? []).filter((ingredient) =>
    ingredient.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Ingredients"
        description="Your pantry. Create each ingredient once, then reuse it across dishes."
        action={
          <Button onClick={openCreate}>
            <Plus className="size-4" aria-hidden />
            Add ingredient
          </Button>
        }
      />

      <Card>
        {isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isPending ? (
          <TableSkeleton />
        ) : ingredients.length === 0 ? (
          <EmptyState
            title="No ingredients yet"
            description="Add the components you cook with, then assign them to dishes with quantities."
            action={
              <Button onClick={openCreate}>
                <Plus className="size-4" aria-hidden />
                Add your first ingredient
              </Button>
            }
          />
        ) : (
          <>
            <div className="border-b border-line px-5 py-3">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search ingredients"
                aria-label="Search ingredients"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70 shadow-card transition-[border-color,box-shadow] hover:border-muted/40 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none sm:max-w-xs"
              />
            </div>

            {visible.length === 0 ? (
              <EmptyState
                title="No matches"
                description={`Nothing in your pantry matches "${search}".`}
              />
            ) : (
              <ul className="divide-y divide-line">
                {visible.map((ingredient) => (
                  <li
                    key={ingredient.id}
                    className="flex flex-wrap items-start justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">{ingredient.name}</p>
                      {ingredient.description && (
                        <p className="mt-0.5 text-xs text-muted">{ingredient.description}</p>
                      )}
                      {ingredient.allergenInfo && (
                        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-warn-600">
                          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                          {ingredient.allergenInfo}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(ingredient)}>
                        <Pencil className="size-4" aria-hidden />
                        <span className="sr-only sm:not-sr-only">Edit</span>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(ingredient)}>
                        <Trash2 className="size-4 text-danger-500" aria-hidden />
                        <span className="sr-only">Delete {ingredient.name}</span>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>

      <Modal
        open={isFormOpen}
        title={editing ? 'Edit ingredient' : 'Add ingredient'}
        description="Ingredient names must be unique within your restaurant, so each one stays reusable."
        onClose={closeForm}
        footer={
          <>
            <Button variant="secondary" onClick={closeForm} disabled={save.isPending}>
              Cancel
            </Button>
            <Button onClick={() => void onSubmit()} loading={save.isPending}>
              {editing ? 'Save changes' : 'Create ingredient'}
            </Button>
          </>
        }
      >
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError error={save.error} />

          <TextField
            label="Name"
            placeholder="Paneer"
            required
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />

          <TextAreaField
            label="Description"
            placeholder="Fresh cottage cheese, made in house."
            error={form.formState.errors.description?.message}
            {...form.register('description')}
          />

          <TextField
            label="Allergen information"
            placeholder="Contains milk"
            hint="Shown to customers exactly as you write it. Plateo does not verify allergen claims."
            error={form.formState.errors.allergenInfo?.message}
            {...form.register('allergenInfo')}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete "${deleting?.name}"?`}
        message="This also removes the ingredient from every dish recipe that uses it. This cannot be undone."
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
