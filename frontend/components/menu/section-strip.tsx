'use client';

import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { useCategories, useDeleteCategory, useDishes, useSaveCategory } from '@/lib/queries';
import type { Category } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { ConfirmDialog, Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import type { CategoryFilter } from './category-manager';

/**
 * Menu sections, where they are actually used: as a row of chips above the dish
 * list.
 *
 * A section is a heading on the diner's menu ("Starters", "Breads") and nothing
 * more, so it does not deserve a page of its own with a form of its own. Here,
 * tapping a chip filters the dishes, and everything else - renaming, reordering,
 * hiding, deleting - lives behind one "Edit sections" button.
 *
 * The words are the restaurant's, not the database's: "section" rather than
 * "category", "Hidden" rather than "inactive", arrows rather than a sort-order
 * number nobody wants to compute.
 */
export function SectionStrip({
  selected,
  onSelect,
}: {
  selected: CategoryFilter;
  onSelect: (filter: CategoryFilter) => void;
}) {
  const categories = useCategories();
  const dishes = useDishes();
  const [managing, setManaging] = useState(false);
  const [focusAdd, setFocusAdd] = useState(false);

  const openManager = (addFirst: boolean) => {
    setFocusAdd(addFirst);
    setManaging(true);
  };

  const countIn = (filter: CategoryFilter): number => {
    const all = dishes.data ?? [];

    if (filter === 'all') return all.length;
    if (filter === 'uncategorised') return all.filter((dish) => dish.categoryId === null).length;

    return all.filter((dish) => dish.categoryId === filter).length;
  };

  const uncategorised = countIn('uncategorised');

  if (categories.isPending) {
    return <Skeleton className="h-10 w-full" />;
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={selected === 'all'} onClick={() => onSelect('all')}>
          All dishes <Count>{countIn('all')}</Count>
        </Chip>

        {(categories.data ?? []).map((category) => (
          <Chip
            key={category.id}
            active={selected === category.id}
            onClick={() => onSelect(category.id)}
          >
            {category.name} <Count>{countIn(category.id)}</Count>
            {!category.isActive && <span className="text-xs font-normal">· hidden</span>}
          </Chip>
        ))}

        {uncategorised > 0 && (
          <Chip
            active={selected === 'uncategorised'}
            onClick={() => onSelect('uncategorised')}
            muted
          >
            Not in a section <Count>{uncategorised}</Count>
          </Chip>
        )}

        <button
          type="button"
          onClick={() => openManager(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-brand-500 px-3.5 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50"
        >
          <Plus className="size-4" aria-hidden />
          New section
        </button>

        {(categories.data?.length ?? 0) > 0 && (
          <Button variant="ghost" size="sm" onClick={() => openManager(false)}>
            <Pencil className="size-4" aria-hidden />
            Edit sections
          </Button>
        )}
      </div>

      <SectionManagerDialog
        open={managing}
        focusAdd={focusAdd}
        categories={categories.data ?? []}
        countIn={countIn}
        onClose={() => setManaging(false)}
      />
    </>
  );
}

function Chip({
  active,
  muted = false,
  onClick,
  children,
}: {
  active: boolean;
  muted?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors',
        active
          ? 'border-brand-600 bg-brand-600 text-white'
          : muted
            ? 'border-dashed border-line bg-surface text-muted hover:text-ink'
            : 'border-line bg-surface text-ink shadow-card hover:border-brand-500',
      )}
    >
      {children}
    </button>
  );
}

const Count = ({ children }: { children: React.ReactNode }) => (
  <span className="text-xs opacity-70 tabular-nums">{children}</span>
);

/**
 * One dialog for every section job.
 *
 * Reordering is two arrows rather than a "sort order" field: the person doing it
 * knows that breads come after mains, not that breads are 4 and mains are 3.
 */
function SectionManagerDialog({
  open,
  focusAdd,
  categories,
  countIn,
  onClose,
}: {
  open: boolean;
  /** Opened from "New section", so the name box should be ready to type in. */
  focusAdd: boolean;
  categories: Category[];
  countIn: (filter: CategoryFilter) => number;
  onClose: () => void;
}) {
  const toast = useToast();
  const save = useSaveCategory();
  const remove = useDeleteCategory();

  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<Category | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const [deleting, setDeleting] = useState<Category | null>(null);

  const add = () => {
    const name = newName.trim();
    if (!name) return;

    save.mutate(
      { body: { name, sortOrder: categories.length + 1, isActive: true } },
      {
        onSuccess: (category) => {
          toast.success(`Added the “${category.name}” section.`);
          setNewName('');
        },
        onError: (error) => toast.error(error),
      },
    );
  };

  const rename = () => {
    if (!renaming) return;
    const name = renameTo.trim();
    if (!name) return;

    save.mutate(
      { id: renaming.id, body: { name, sortOrder: renaming.sortOrder, isActive: renaming.isActive } },
      {
        onSuccess: () => {
          toast.success('Section renamed.');
          setRenaming(null);
        },
        onError: (error) => toast.error(error),
      },
    );
  };

  const setVisible = (category: Category, isActive: boolean) =>
    save.mutate(
      { id: category.id, body: { name: category.name, sortOrder: category.sortOrder, isActive } },
      {
        onSuccess: () =>
          toast.success(
            isActive
              ? `“${category.name}” is back on your menu.`
              : `“${category.name}” is hidden from diners.`,
          ),
        onError: (error) => toast.error(error),
      },
    );

  /** Swaps this section's place with its neighbour, which is what an arrow means. */
  const move = (index: number, direction: -1 | 1) => {
    const current = categories[index];
    const neighbour = categories[index + direction];

    if (!current || !neighbour) return;

    save.mutate({
      id: current.id,
      body: { name: current.name, sortOrder: neighbour.sortOrder, isActive: current.isActive },
    });
    save.mutate({
      id: neighbour.id,
      body: { name: neighbour.name, sortOrder: current.sortOrder, isActive: neighbour.isActive },
    });
  };

  return (
    <>
      <Modal
        open={open}
        title="Menu sections"
        description="Sections are the headings diners see on your menu — Starters, Main course, Breads, Drinks."
        onClose={onClose}
        footer={
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                label="Add a section"
                placeholder="Chinese, Starters, Breads…"
                autoFocus={focusAdd}
                value={newName}
                maxLength={120}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    add();
                  }
                }}
              />
            </div>
            <Button onClick={add} loading={save.isPending} disabled={!newName.trim()}>
              <Plus className="size-4" aria-hidden />
              Add
            </Button>
          </div>

          {categories.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-muted">
              No sections yet. Dishes without a section still show on your menu, under “More dishes”.
            </p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              {categories.map((category, index) => (
                <li key={category.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${category.name} up`}
                      className="rounded p-0.5 text-muted hover:text-ink disabled:opacity-30"
                    >
                      <ArrowUp className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === categories.length - 1}
                      aria-label={`Move ${category.name} down`}
                      className="rounded p-0.5 text-muted hover:text-ink disabled:opacity-30"
                    >
                      <ArrowDown className="size-3.5" aria-hidden />
                    </button>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'truncate text-sm font-medium',
                        category.isActive ? 'text-ink' : 'text-muted',
                      )}
                    >
                      {category.name}
                    </p>
                    <p className="text-xs text-muted">
                      {countIn(category.id)} dish(es)
                      {!category.isActive && ' · hidden from diners'}
                    </p>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setVisible(category, !category.isActive)}
                    aria-label={
                      category.isActive
                        ? `Hide ${category.name} from the menu`
                        : `Show ${category.name} on the menu`
                    }
                    title={category.isActive ? 'Hide from diners' : 'Show to diners'}
                  >
                    {category.isActive ? (
                      <Eye className="size-4" aria-hidden />
                    ) : (
                      <EyeOff className="size-4" aria-hidden />
                    )}
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRenaming(category);
                      setRenameTo(category.name);
                    }}
                    aria-label={`Rename ${category.name}`}
                    title="Rename"
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleting(category)}
                    aria-label={`Delete ${category.name}`}
                    title="Delete"
                  >
                    <Trash2 className="size-4 text-danger-500" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-muted">
            Hiding a section takes it off the diner menu along with its dishes, without deleting
            anything.
          </p>
        </div>
      </Modal>

      <Modal
        open={renaming !== null}
        title={`Rename “${renaming?.name}”`}
        onClose={() => setRenaming(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button onClick={rename} loading={save.isPending} disabled={!renameTo.trim()}>
              Save
            </Button>
          </>
        }
      >
        <TextField
          label="Section name"
          value={renameTo}
          maxLength={120}
          onChange={(event) => setRenameTo(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              rename();
            }
          }}
        />
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete the “${deleting?.name}” section?`}
        message={
          deleting && countIn(deleting.id) > 0
            ? `Its ${countIn(deleting.id)} dish(es) stay on your menu and move to “More dishes”. Nothing is deleted except the section itself.`
            : 'The section is removed. This cannot be undone.'
        }
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          const { id, name } = deleting;

          remove.mutate(id, {
            onSuccess: () => {
              toast.success(`Deleted the “${name}” section.`);
              setDeleting(null);
            },
            onError: (error) => toast.error(error),
          });
        }}
      />
    </>
  );
}
