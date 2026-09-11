'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

import { IDLE, type ActionState } from './action-state';

/**
 * Form building blocks shared by every Procure-to-Pay form.
 *
 * The loading and error handling is here rather than in each form, so all six
 * behave the same way under a slow API and a rejected submit: the button
 * disables and says what it is doing, the error appears in the same place with
 * the same wording, and what was typed survives.
 */

/** Submit button that reflects the pending state of its enclosing form. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const { pending } = useFormStatus();

  const styles = {
    primary: 'bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400',
    secondary:
      'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400',
    danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-300',
  }[variant];

  return (
    <button
      type="submit"
      disabled={pending}
      // aria-busy so a screen reader announces the wait, not just the sighted
      // change of label.
      aria-busy={pending}
      className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed ${styles}`}
    >
      {pending ? (pendingLabel ?? 'Working…') : children}
    </button>
  );
}

/** Result banner for a completed action. */
export function ActionMessage({ state }: { state: ActionState }) {
  if (state.status === 'idle' || !state.message) return null;

  const isError = state.status === 'error';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={`mb-4 rounded-md border p-3 text-sm ${
        isError
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-green-200 bg-green-50 text-green-900'
      }`}
    >
      {state.message}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  required,
  children,
  className = '',
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="field-label text-xs">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      <div className="mt-1">{children}</div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

/**
 * A form that opens from a button rather than sitting permanently on the page.
 *
 * The lists are the point of these screens; a create form always expanded
 * pushes the rows below the fold on every visit. It closes itself on success,
 * which is the signal that the new row is now in the table behind it.
 */
export function Disclosure({
  label,
  title,
  children,
  openLabel,
}: {
  label: string;
  title: string;
  openLabel?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="whitespace-nowrap rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="w-full rounded-lg border border-slate-300 bg-slate-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{openLabel ?? title}</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
        >
          Cancel
        </button>
      </div>
      {children(() => setOpen(false))}
    </div>
  );
}

/**
 * Binds a server action to a form and hands back its state.
 *
 * A thin wrapper over `useActionState`, but it means the forms below do not
 * each import and initialise it, and it gives one place to change how a
 * successful action is acknowledged.
 */
export function useAction(action: (state: ActionState, form: FormData) => Promise<ActionState>) {
  return useActionState(action, IDLE);
}
