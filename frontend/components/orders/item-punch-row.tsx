'use client';

import { Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import type { OrderItemInput } from '@/lib/queries';
import { useDishes } from '@/lib/queries';
import type { Dish } from '@/lib/types';
import { Button } from '@/components/ui/button';

/**
 * Punching an item onto a bill, the way a till does it.
 *
 * Built for someone who is looking at a guest, not at the screen: type two or
 * three letters, press Enter to take the top match, type the quantity, press
 * Enter again. The focus returns to the item box every time, so a five-item order
 * is one continuous run of typing with no mouse.
 *
 * Unavailable dishes are listed but cannot be picked - staff need to see that a
 * dish exists and is off, rather than wonder why it has vanished from the till.
 */
export function ItemPunchRow({
  onAdd,
  disabled,
  adding,
}: {
  onAdd: (item: OrderItemInput) => void;
  disabled?: boolean;
  adding?: boolean;
}) {
  const dishes = useDishes();

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Dish | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');

  const itemRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    const all = dishes.data ?? [];

    if (!term) return all.slice(0, 8);

    return all.filter((dish) => dish.name.toLowerCase().includes(term)).slice(0, 8);
  }, [dishes.data, query]);

  useEffect(() => setHighlight(0), [query]);

  const choose = (dish: Dish) => {
    if (!dish.isAvailable) return;

    setSelected(dish);
    setQuery(dish.name);
    setOpen(false);
    // Straight to quantity, which is the only other thing most lines need.
    quantityRef.current?.select();
  };

  const reset = () => {
    setSelected(null);
    setQuery('');
    setQuantity('1');
    setNote('');
    setOpen(false);
    itemRef.current?.focus();
  };

  const submit = () => {
    const count = Number.parseInt(quantity, 10);
    const dish = selected ?? (matches.length === 1 && matches[0].isAvailable ? matches[0] : null);

    if (!dish || !Number.isFinite(count) || count < 1) return;

    onAdd({ dishId: dish.id, quantity: Math.min(count, 99), ...(note.trim() ? { note: note.trim() } : {}) });
    reset();
  };

  const onItemKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlight((current) => Math.min(current + 1, matches.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const dish = matches[highlight];
      if (dish) choose(dish);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-card">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_5.5rem_auto]">
        <div className="relative">
          <label htmlFor="punch-item" className="sr-only">
            Item
          </label>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            id="punch-item"
            ref={itemRef}
            value={query}
            disabled={disabled}
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls="punch-item-list"
            aria-autocomplete="list"
            placeholder="Type a dish name, then Enter"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(null);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            // A click on an option must land before the list unmounts.
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onKeyDown={onItemKeyDown}
            className="h-11 w-full rounded-lg border border-line bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted/70 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none disabled:bg-ground"
          />

          {open && matches.length > 0 && (
            <ul
              id="punch-item-list"
              role="listbox"
              className="absolute top-12 z-30 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-raised"
            >
              {matches.map((dish, index) => (
                <li key={dish.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlight}
                    disabled={!dish.isAvailable}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(dish)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm',
                      index === highlight && dish.isAvailable && 'bg-brand-50',
                      dish.isAvailable ? 'text-ink' : 'cursor-not-allowed text-muted',
                    )}
                  >
                    <span className="min-w-0 truncate">
                      {dish.name}
                      {!dish.isAvailable && <span className="ml-2 text-xs">· off today</span>}
                    </span>
                    <span className="shrink-0 text-xs font-medium tabular-nums">
                      {formatMoney(dish.price)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <label htmlFor="punch-note" className="sr-only">
            Special note for the kitchen
          </label>
          <input
            id="punch-note"
            value={note}
            disabled={disabled}
            maxLength={255}
            placeholder="Special note (optional)"
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
            className="h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none disabled:bg-ground"
          />
        </div>

        <div>
          <label htmlFor="punch-qty" className="sr-only">
            Quantity
          </label>
          <input
            id="punch-qty"
            ref={quantityRef}
            type="number"
            min="1"
            max="99"
            value={quantity}
            disabled={disabled}
            onChange={(event) => setQuantity(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
            className="h-11 w-full rounded-lg border border-line bg-surface px-3 text-center text-sm font-semibold text-ink focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none disabled:bg-ground"
          />
        </div>

        <Button onClick={submit} loading={adding} disabled={disabled} className="h-11">
          <Plus className="size-4" aria-hidden />
          Add
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted">
        {selected ? (
          <>
            <span className="font-medium text-ink">{selected.name}</span> ·{' '}
            {formatMoney(selected.price)} each — set the quantity and press Enter.
          </>
        ) : (
          'Type a few letters, press Enter to pick the top match, then Enter again to add it.'
        )}
      </p>
    </div>
  );
}
