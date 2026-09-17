'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { cn } from '@/lib/cn';
import { useCategories, useDeleteCategory, useDishes, useSaveCategory } from '@/lib/queries';
import { categorySchema, type CategoryValues } from '@/lib/schemas';
import type { Category } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { CheckboxField, TextField } from '@/components/ui/field';
import { ConfirmDialog, Modal } from '@/components/ui/modal';
import { EmptyState, ErrorState, FormError, TableSkeleton } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';

/** Which dishes the menu screen is showing. */
export type CategoryFilter = 'all' | 'uncategorised' | number;

/**
 * Category list with create, edit and delete.
 *
 * Pass `selected` and `onSelect` to make rows act as a filter for a dish list
 * next to it (the menu screen); without them it is a plain management list.
 */
export function CategoryManager({
  selected,
  onSelect,
  autoOpenCreate = false,
  onAutoOpened,
}: {
  selected?: CategoryFilter;
  onSelect?: (filter: CategoryFilter) => void;
  /** Open the "Add category" dialog once, e.g. from a dashboard quick action. */
  autoOpenCreate?: boolean;
  onAutoOpened?: () => void;
}) {
  const toast = useToast();
  const { data: categories, isPending, isError, error, refetch } = useCategories();
  const dishes = useDishes();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const isSelectable = onSelect !== undefined;
  const isFormOpen = creating || editing !== null;

  const save = useSaveCategory({
    onSuccess: (category, variables) => {
      toast.success(variables.id ? `Saved “${category.name}”.` : `Added “${category.name}”.`);
      setCreating(false);
      setEditing(null);
    },
  });
  const remove = useDeleteCategory();

  const form = useForm<CategoryValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: '', sortOrder: 0, isActive: true },
  });

  // Fill the form before the dialog renders. Resetting in an effect after it
  // opened showed the previous record for a frame and could wipe early input.
  const openCreate = () => {
    save.reset();
    form.reset({ name: '', sortOrder: (categories?.length ?? 0) + 1, isActive: true });
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (category: Category) => {
    save.reset();
    form.reset({ name: category.name, sortOrder: category.sortOrder, isActive: category.isActive });
    setCreating(false);
    setEditing(category);
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  // Wait for the list so the suggested sort order is right, then open once.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpenCreate || isPending || autoOpened.current) return;
    autoOpened.current = true;
    openCreate();
    onAutoOpened?.();
    // openCreate/onAutoOpened are recreated each render; this should run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenCreate, isPending]);

  const onSubmit = form.handleSubmit((values) => save.mutate({ id: editing?.id, body: values }));

  const dishCount = (filter: CategoryFilter): number | undefined => {
    if (!dishes.data) return undefined;
    if (filter === 'all') return dishes.data.length;
    if (filter === 'uncategorised') return dishes.data.filter((dish) => dish.categoryId === null).length;
    return dishes.data.filter((dish) => dish.categoryId === filter).length;
  };

  const deletingCount = deleting ? dishCount(deleting.id) : undefined;

  return (
    <>
      <Card>
        <CardHeader
          title="Categories"
          description={isSelectable ? 'Choose one to filter dishes.' : 'Menu sections, shown in sort order.'}
          action={
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" aria-hidden />
              Add
            </Button>
          }
        />

        {isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isPending ? (
          <TableSkeleton rows={3} />
        ) : (
          <ul className="divide-y divide-line">
            {isSelectable && (
              <FilterRow
                label="All dishes"
                count={dishCount('all')}
                active={selected === 'all'}
                onClick={() => onSelect('all')}
              />
            )}

            {categories.length === 0 && (
              <li>
                <EmptyState
                  title="No categories yet"
                  description="Group dishes into sections like Starters, Bowls or Drinks."
                  action={
                    <Button size="sm" onClick={openCreate}>
                      <Plus className="size-4" aria-hidden />
                      Add your first category
                    </Button>
                  }
                />
              </li>
            )}

            {categories.map((category) => {
              const active = selected === category.id;
              const count = dishCount(category.id);

              return (
                <li
                  key={category.id}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 sm:px-4',
                    active && 'bg-brand-50',
                  )}
                >
                  <button
                    type="button"
                    disabled={!isSelectable}
                    onClick={() => onSelect?.(category.id)}
                    aria-pressed={isSelectable ? active : undefined}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1 text-left',
                      isSelectable ? 'cursor-pointer' : 'cursor-default',
                    )}
                  >
                    <span className="w-7 shrink-0 text-xs text-muted tabular-nums">
                      #{category.sortOrder}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-sm',
                          active ? 'font-semibold text-brand-700' : 'font-medium text-ink',
                        )}
                      >
                        {category.name}
                      </span>
                      <span className="block text-xs text-muted">
                        {count === undefined ? '…' : `${count} ${count === 1 ? 'dish' : 'dishes'}`}
                        {!category.isActive && ' · hidden from menu'}
                      </span>
                    </span>
                  </button>

                  {!category.isActive && <Badge>Inactive</Badge>}

                  <Button variant="ghost" size="sm" onClick={() => openEdit(category)} aria-label={`Edit ${category.name}`}>
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(category)} aria-label={`Delete ${category.name}`}>
                    <Trash2 className="size-4 text-danger-500" aria-hidden />
                  </Button>
                </li>
              );
            })}

            {isSelectable && (dishCount('uncategorised') ?? 0) > 0 && (
              <FilterRow
                label="Uncategorised"
                count={dishCount('uncategorised')}
                active={selected === 'uncategorised'}
                onClick={() => onSelect('uncategorised')}
              />
            )}
          </ul>
        )}
      </Card>

      <Modal
        open={isFormOpen}
        title={editing ? 'Edit category' : 'Add category'}
        description="Category names must be unique within your restaurant."
        onClose={closeForm}
        footer={
          <>
            <Button variant="secondary" onClick={closeForm} disabled={save.isPending}>
              Cancel
            </Button>
            <Button onClick={() => void onSubmit()} loading={save.isPending}>
              {editing ? 'Save changes' : 'Add category'}
            </Button>
          </>
        }
      >
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError error={save.error} />

          <TextField
            id="category-name"
            label="Name"
            placeholder="Signature Bowls"
            required
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />

          <TextField
            id="category-sort-order"
            label="Sort order"
            type="number"
            min={0}
            hint="Lower numbers appear first on the menu."
            error={form.formState.errors.sortOrder?.message}
            {...form.register('sortOrder')}
          />

          <CheckboxField
            id="category-active"
            label="Active"
            hint="Inactive categories stay in your admin but are hidden from customers."
            {...form.register('isActive')}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete “${deleting?.name}”?`}
        message={
          deletingCount
            ? `Its ${deletingCount} ${deletingCount === 1 ? 'dish stays' : 'dishes stay'} on your menu as uncategorised. This cannot be undone.`
            : 'This cannot be undone.'
        }
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          const { id, name } = deleting;

          remove.mutate(id, {
            onSuccess: () => {
              toast.success(`Deleted “${name}”.`);
              if (selected === id) onSelect?.('all');
              setDeleting(null);
            },
            onError: (mutationError) => toast.error(mutationError),
          });
        }}
      />
    </>
  );
}

function FilterRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number | undefined;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li className={cn(active && 'bg-brand-50')}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className={cn('text-sm', active ? 'font-semibold text-brand-700' : 'font-medium text-ink')}>
          {label}
        </span>
        <span className="text-xs text-muted tabular-nums">{count ?? '…'}</span>
      </button>
    </li>
  );
}
