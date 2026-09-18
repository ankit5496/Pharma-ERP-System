'use client';

import { useRouter } from 'next/navigation';
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useFormStatus } from 'react-dom';

import { useActionToast } from '../toast';

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
  name,
  value,
  formNoValidate,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  /**
   * Submits a value of its own, so one form can offer two outcomes — save as
   * draft, or place the order — without a second form or a hidden radio. The
   * browser sends only the button that was actually pressed.
   */
  name?: string;
  value?: string;
  /**
   * Skips the browser's required/pattern checks for THIS submit only.
   *
   * What makes "Save as draft" possible on a form whose fields a placed order
   * needs: the constraints stay on the inputs, describing the finished
   * document, and one button opts out of them. The API makes the same
   * distinction from `saveAsDraft`, so nothing rests on the attribute alone.
   */
  formNoValidate?: boolean;
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
      name={name}
      value={value}
      formNoValidate={formNoValidate}
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

/**
 * Kept as a no-op so the forms that render it need no edit.
 *
 * Results are now announced by the centred toast host, raised from `useAction`
 * where every action already passes. This used to print a banner beside the
 * control that was submitted, which put the confirmation wherever the row
 * happened to sit — frequently off-screen on a long table, and on the row
 * actions it appeared next to a button the success had just removed.
 */
export function ActionMessage(_: { state: ActionState }) {
  return null;
}

/** One choice in a {@link StatusSelect}. */
export interface StatusOption {
  value: string;
  label: string;
  /** Why it cannot be chosen. Present means disabled. */
  blocked?: string | null;
}

/**
 * The status control used by every row that has one.
 *
 * FIXED, NARROW WIDTH. A native select sizes itself to its widest option, so a
 * single long entry stretches the control across the row and shunts the button
 * beside it out of line with every other row in the table. Pinning the width
 * means the column is the same width on all rows whatever any one of them
 * happens to contain.
 *
 * THE REASON A STATUS IS UNAVAILABLE IS A TOOLTIP, NOT PART OF THE LABEL. It
 * used to be appended to the option text — "Approved — Only an open order can
 * be approved." — which is what made these controls wide in the first place.
 * The option is still visibly disabled, and the explanation is on hover.
 *
 * The selected value carries its own `title` so a label clipped by the fixed
 * width can still be read in full, which is the only way truncation is
 * acceptable on a control that reports state.
 */
export function StatusSelect({
  id,
  name = 'status',
  label,
  defaultValue,
  options,
}: {
  id: string;
  name?: string;
  /** Names the control for assistive technology; never painted. */
  label: string;
  defaultValue: string;
  options: readonly StatusOption[];
}) {
  const [value, setValue] = useState(defaultValue);

  const selected = options.find((option) => option.value === value);

  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>

      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        title={selected?.label}
        className="field-sm w-36 shrink-0 truncate"
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={Boolean(option.blocked)}
            title={option.blocked ?? option.label}
          >
            {option.label}
          </option>
        ))}
      </select>
    </>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  required,
  error,
  children,
  className = '',
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  required?: boolean;
  /**
   * What is wrong with this field, shown IN PLACE OF the hint.
   *
   * In place of, not beside: once a field is wrong the correction is the only
   * thing worth reading there, and stacking a second line under every control
   * shifts the whole form down as errors appear and clear.
   *
   * Tied to the control with `aria-describedby` by the caller where it
   * matters, and marked `role="alert"` so it is announced when it appears
   * rather than sitting silently in the page.
   */
  error?: string;
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
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  );
}

/**
 * A form that opens from a button, in a modal dialog over the list.
 *
 * WHY A DIALOG AND NOT THE PANEL THIS USED TO BE. The form used to expand in
 * place, which pushed the table it was about down the page: the rows a person
 * came to look at moved the moment they went to add one. In a dialog the list
 * stays exactly where it was and is still readable behind the form.
 *
 * A NATIVE <dialog>, not a div pretending to be one. The element gives focus
 * trapping, Escape-to-close, inertness of the page behind it and top-layer
 * stacking for free — all of which a hand-rolled overlay has to reimplement,
 * and usually reimplements incompletely. Inertness is the one that matters
 * most here: it is what stops someone editing the list underneath a form that
 * is about to change it.
 *
 * CLOSING IS THE CALLER'S DECISION, through `closeWhen`. The dialog cannot see
 * the result of the action inside it, and closing on submit rather than on
 * success would throw away a rejected form and everything typed into it — the
 * one thing a failed save must never do.
 */
export function Disclosure({
  label,
  title,
  subtitle,
  children,
  openLabel,
  closeWhen = false,
  defaultOpen = false,
  width = '48rem',
  minHeight,
  isOpen,
  onOpenChange,
}: {
  label: string;
  title: string;
  subtitle?: string;
  openLabel?: string;
  /** Set once the enclosed action has succeeded; closes and resets the form. */
  closeWhen?: boolean;
  /** Opens on mount — for arriving from another screen ready to fill it in. */
  defaultOpen?: boolean;
  width?: string;
  /**
   * A floor under the dialog's height, e.g. '32rem'.
   *
   * For a form that is cramped at its natural height — where the fields are
   * packed together and a lookup's list has nowhere to drop. It is a MINIMUM,
   * not a fixed height, so a form with more in it still grows, and it is capped
   * by the same 85vh as everything else so a short screen is never overflowed.
   */
  minHeight?: string;
  /**
   * CONTROLLED MODE, for a dialog opened from a row's Actions menu.
   *
   * Passing `isOpen` hands the open/closed decision to the caller and drops
   * this component's own trigger button — the menu item is the trigger. Without
   * it a row would show an Edit button AND an Edit menu entry, which is the
   * duplication the menu exists to remove.
   */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: (close: () => void) => ReactNode;
}) {
  const controlled = isOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);

  const open = controlled ? isOpen : uncontrolledOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlled) onOpenChange?.(next);
      else setUncontrolledOpen(next);
    },
    [controlled, onOpenChange],
  );
  const dialog = useRef<HTMLDialogElement>(null);

  const close = useCallback(() => setOpen(false), [setOpen]);

  // showModal() rather than the `open` attribute: only the former puts the
  // dialog in the top layer and makes the rest of the page inert.
  useEffect(() => {
    const element = dialog.current;

    if (!element) return;

    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  // The pause is deliberate: closing the instant the action returns would take
  // the confirmation off the screen before it could be read.
  useEffect(() => {
    if (!closeWhen || !open) return undefined;

    const timer = setTimeout(close, 900);

    return () => clearTimeout(timer);
  }, [closeWhen, open, close]);

  return (
    <>
      {!controlled && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-9 whitespace-nowrap rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          {label}
        </button>
      )}

      <dialog
        ref={dialog}
        onCancel={(event) => {
          // Escape fires `cancel`; handling it here keeps closing in one place
          // so React state and the element never disagree about being open.
          event.preventDefault();
          close();
        }}
        style={{ width: `min(${width}, 92vw)` }}
        // `overflow-hidden` is load-bearing: a <dialog> is `overflow: auto` in
        // the user-agent stylesheet, so it scrolled sideways itself, underneath
        // the inner container meant to own the scrolling — two horizontal bars
        // for one overflowing table.
        className="overflow-hidden rounded-lg border border-slate-200 p-0 shadow-xl backdrop:bg-slate-900/40"
      >
        {/* Unmounted while closed, so reopening gives a clean form rather than
            whatever was half-typed and abandoned last time. */}
        {open && (
          /* ONE SCROLLBAR, NOT TWO. `overflow-y: auto` alone is not enough:
             CSS will not let one axis stay `visible` while the other scrolls,
             so the browser silently promotes overflow-x to auto as well — and
             wide content inside, such as the receipt-line table, then drew a
             second horizontal scrollbar across the whole dialog underneath the
             table's own. Pinning overflow-x to hidden leaves exactly one
             vertical scrollbar here, and lets wide content scroll in its own
             box where the header stays above the right columns. */
          <div
            className="flex max-h-[85vh] flex-col overflow-y-auto overflow-x-hidden p-5"
            style={minHeight ? { minHeight: `min(${minHeight}, 85vh)` } : undefined}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">{openLabel ?? title}</h3>
                {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
              </div>

              <DialogCloseButton onClose={close} />
            </div>

            {/* grow, so a form given a minimum height spreads into it rather
                than leaving a band of nothing under the last field. */}
            <div className="flex grow flex-col">{children(close)}</div>
          </div>
        )}
      </dialog>
    </>
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

  // Every action in the module passes through here, so announcing the result
  // in one place is what makes success and failure look the same on all of
  // them without editing each form.
  useActionToast(isPending, state.status === 'error' ? 'error' : 'success', state.message);

  // `isPending` is returned as a third element so a caller with no <form> — a
  // row menu dispatching straight from a menu entry — can show that something
  // is happening. A form gets this for free from useFormStatus; a menu does
  // not, and on a database a round trip away, an action with no feedback reads
  // as one that did nothing.
  return [state, formAction, isPending] as const;
}

/**
 * The X on a dialog's title line.
 *
 * CHROME, NOT AN ACTION. It is how a window is put away, which is why it is an
 * icon in the corner rather than a labelled button competing with the Cancel at
 * the bottom for the same decision. Same behaviour as Cancel and as Escape —
 * close, write nothing.
 *
 * Defined once and used by every dialog, including the ones that are hand-rolled
 * <dialog> elements rather than <Disclosure>s.
 */
export function DialogCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      title="Close"
      className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
    >
      {/* Inline rather than from an icon package: this is the only icon these
          screens use, and a dependency for one glyph is not worth its weight. */}
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
        className="h-4 w-4"
      >
        <path d="M5 5l10 10M15 5L5 15" />
      </svg>
    </button>
  );
}

/**
 * The bottom of a form: Cancel on the left, the button that saves on the right.
 *
 * PUSHED APART, not sat side by side. These are the two opposite answers to the
 * same question, and putting them a few pixels from one another makes the
 * destructive one a slip of the mouse away from the constructive one.
 *
 * CANCEL IS A PLAIN BUTTON, never a submit: it must not post the form it
 * closes. It is rendered first so reading order and tab order match the visual
 * order rather than fighting it.
 *
 * `mt-auto` is what keeps it at the BOTTOM of a form given a minimum height,
 * rather than floating under the last field with empty space beneath.
 */
export function FormFooter({
  onCancel,
  children,
  className = '',
}: {
  onCancel: () => void;
  children: ReactNode;
  /**
   * For a form that lays out as a grid, where the footer has to span it.
   * Without this a two-column form puts the footer in one CELL, and the save
   * button ends up in the middle of the form rather than at its right edge.
   */
  className?: string;
}) {
  return (
    <div
      className={`mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 ${className}`}
    >
      <button
        type="button"
        onClick={onCancel}
        // SubmitButton's secondary styling, character for character. A
        // hand-written approximation drifts the moment either one is touched.
        className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
      >
        Cancel
      </button>

      {/* Grouped, so a form with two save buttons keeps them together on the
          right instead of spreading them across the footer. */}
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
