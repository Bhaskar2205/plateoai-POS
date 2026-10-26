'use client';

import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';

/**
 * Minimal accessible dialog: focus stays in the page, Escape closes, and the
 * body stops scrolling behind it.
 */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * 'lg' for dialogs that hold a form and a preview side by side. 'full' is for
   * the ones a till operator works *inside* rather than fills in - it takes
   * nearly the whole screen and hands its own layout the space, padding
   * included, instead of boxing it into a column.
   */
  size?: 'md' | 'lg' | 'full';
}) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          'flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl',
          size === 'full'
            ? 'h-[92vh] max-w-[96rem] sm:w-[96vw]'
            : size === 'lg'
              ? 'max-w-4xl'
              : 'max-w-lg',
        )}
      >
        {/* The brand hairline the sign-in screen and the takings band carry.
            Only on the full size, where the dialog is a screen in its own
            right rather than a box on top of one. */}
        {size === 'full' && (
          <div
            aria-hidden
            className="h-1 shrink-0 rounded-t-2xl bg-gradient-to-r from-brand-700 via-brand-500 to-saffron-500"
          />
        )}

        <div
          className={cn(
            'flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4',
            size === 'full' && 'bg-ground/40',
          )}
        >
          <div className="space-y-0.5">
            <h2
              className={cn(
                'font-semibold text-ink',
                size === 'full' ? 'text-lg tracking-tight' : 'text-base',
              )}
            >
              {title}
            </h2>
            {description && <p className="text-sm text-muted">{description}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X className="size-4" aria-hidden />
          </Button>
        </div>

        <div
          className={cn(
            'flex-1',
            // A full-size dialog lays itself out: scrolling belongs to its own
            // panes, not to one bar down the side of everything.
            size === 'full' ? 'min-h-0 overflow-hidden' : 'overflow-y-auto px-5 py-4',
          )}
        >
          {children}
        </div>

        {footer && (
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}

/** Destructive-action confirmation. Deletes are never one click. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{message}</p>
    </Modal>
  );
}
