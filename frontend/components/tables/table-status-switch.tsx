'use client';

import { cn } from '@/lib/cn';

/** Accessible on/off switch for a table's active state. */
export function TableStatusSwitch({
  checked,
  tableName,
  disabled,
  onChange,
}: {
  checked: boolean;
  tableName: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${tableName} is ${checked ? 'active' : 'inactive'}`}
      title={checked ? 'Active: diners can open this table’s menu' : 'Inactive: this table’s QR code is refused'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-60',
        checked ? 'bg-brand-600' : 'bg-line',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block size-5 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
