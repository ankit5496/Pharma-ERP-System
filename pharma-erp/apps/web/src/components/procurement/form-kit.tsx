'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
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
 * Binds a server action to a form, hands back its state, and refreshes the
 * screen once the action succeeds.
 *
 * WHY THE REFRESH IS HERE AND NOT IN THE ACTION. The actions used to call
 * `revalidatePath` for every Procure-to-Pay route, which had two effects. The
 * useful one was nil: every fetch in this app is `cache: 'no-store'` and every
 * one of these pages is `force-dynamic`, so there was no cached data for it to
 * invalidate. The harmful one was that revalidating the route the form is on
 * makes Next re-render it from the server as part of the action, and THAT
 * DISCARDS THE ACTION'S RETURN VALUE — so every successful save silently
 * showed no confirmation at all. It was not specific to one form; it affected
 * every mutation on all six sub-tabs.
 *
 * `router.refresh()` re-fetches the same server components but is documented
 * to preserve React state, so the row appears in the table AND the message
 * saying it was saved is still on screen.
 *
 * Guarded by a ref rather than firing on every render: the refresh itself
 * re-renders this component, and refreshing in response to that would spin.
 */
export function useAction(action: (state: ActionState, form: FormData) => Promise<ActionState>) {
  const [state, formAction, isPending] = useActionState(action, IDLE);
  const router = useRouter();
  const wasPending = useRef(false);

  // KEYED OFF THE SUBMISSION FINISHING, not off the returned state. Most forms
  // here do surface their result and show a message, but the row-action
  // buttons do not — React does not deliver the returned state to a form that
  // is replaced by its own success (approving a requisition removes the
  // Approve button). Refreshing on the returned state would leave exactly
  // those screens stale, which is the one thing the old `revalidatePath` did
  // get right.
  useEffect(() => {
    if (isPending) {
      wasPending.current = true;
      return;
    }

    if (!wasPending.current) return;

    wasPending.current = false;

    // A rejected submit changed nothing, so there is nothing to re-read.
    if (state.status === 'error') return;

    router.refresh();
  }, [isPending, state.status, router]);

  return [state, formAction] as const;
}
