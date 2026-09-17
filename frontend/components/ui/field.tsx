'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const CONTROL_CLASS =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-card placeholder:text-muted/70 ' +
  'transition-[border-color,box-shadow] hover:border-muted/40 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 ' +
  'focus:outline-none disabled:cursor-not-allowed disabled:bg-ground';

const ERROR_CLASS = 'border-danger-500 hover:border-danger-500 focus:border-danger-500 focus:ring-danger-500/10';

interface FieldShellProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
}

/** Label + control + hint + error, wired up for screen readers. */
function FieldShell({ label, htmlFor, error, hint, required, children }: FieldShellProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
        {required && (
          <span className="ml-0.5 text-danger-500" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, className, id, required, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <FieldShell label={label} htmlFor={fieldId} error={error} hint={hint} required={required}>
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={cn(CONTROL_CLASS, error && ERROR_CLASS, className)}
        {...props}
      />
    </FieldShell>
  );
});

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField({ label, error, hint, className, id, required, ...props }, ref) {
    const generatedId = useId();
    const fieldId = id ?? generatedId;

    return (
      <FieldShell label={label} htmlFor={fieldId} error={error} hint={hint} required={required}>
        <textarea
          ref={ref}
          id={fieldId}
          rows={props.rows ?? 3}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className={cn(CONTROL_CLASS, 'resize-y', error && ERROR_CLASS, className)}
          {...props}
        />
      </FieldShell>
    );
  },
);

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, error, hint, className, id, required, children, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <FieldShell label={label} htmlFor={fieldId} error={error} hint={hint} required={required}>
      <select
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={cn(CONTROL_CLASS, 'cursor-pointer', error && ERROR_CLASS, className)}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
});

export interface CheckboxFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export const CheckboxField = forwardRef<HTMLInputElement, CheckboxFieldProps>(
  function CheckboxField({ label, hint, className, id, ...props }, ref) {
    const generatedId = useId();
    const fieldId = id ?? generatedId;

    return (
      <div className="flex items-start gap-2.5">
        <input
          ref={ref}
          id={fieldId}
          type="checkbox"
          className={cn(
            'mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line text-brand-600 accent-brand-600',
            className,
          )}
          {...props}
        />
        <div className="space-y-0.5">
          <label htmlFor={fieldId} className="cursor-pointer text-sm font-medium text-ink">
            {label}
          </label>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
      </div>
    );
  },
);
