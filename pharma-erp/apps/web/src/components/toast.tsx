'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Centred, self-dismissing confirmations for every action in the application.
 *
 * WHY A SINGLE HOST RATHER THAN A BANNER PER FORM. The result used to render
 * inline, next to whichever control was submitted. On a long table that put the
 * confirmation wherever the row happened to be — often below the fold, and on
 * the row-action forms it was beside a button that the success had just removed
 * from the page. One host, centred, means the answer appears in the same place
 * whatever was clicked.
 *
 * WHY THE POPOVER API. A modal `<dialog>` is promoted to the browser's TOP
 * LAYER, which sits above every z-index on the page — so an ordinary fixed
 * element, at any z-index, is painted *behind* an open dialog. That matters
 * because the rule for a failed save is that the dialog stays open with the
 * user's data intact, and the error must be readable over it. A popover is the
 * only other thing that reaches the top layer, so the toast is one.
 *
 * Where `showPopover` is missing the element still renders as a plain fixed
 * overlay: correct everywhere except stacked over an open modal.
 */

export type ToastTone = 'success' | 'error';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

// Module scope, not context: actions fire from row buttons, dialogs and forms
// all over the tree, and threading a provider through every one of them buys
// nothing when there is exactly one host.
let toasts: readonly Toast[] = [];
let nextId = 0;

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => toasts;

// The server renders no toasts. A stable frozen array keeps
// `useSyncExternalStore` from looping on a fresh reference each call.
const EMPTY: readonly Toast[] = Object.freeze([]);
const serverSnapshot = () => EMPTY;

export function pushToast(tone: ToastTone, message: string) {
  if (!message) return;

  toasts = [...toasts, { id: ++nextId, tone, message }];
  emit();
}

export function dismissToast(id: number) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

/**
 * Raises a toast when a submission finishes.
 *
 * KEYED OFF THE SUBMISSION ENDING, not off the message changing. Two identical
 * failures in a row produce an identical state, so watching the value would
 * announce the first and stay silent for the second — which reads as the button
 * having stopped working.
 *
 * Takes the tone and message rather than a result object because the modules
 * disagree on the shape: procurement returns `{ status }`, master data and
 * production return `{ ok }`. Converting at the call site is one expression and
 * avoids a union that has to grow every time a module is added.
 */
export function useActionToast(isPending: boolean, tone: ToastTone, message?: string) {
  const wasPending = useRef(false);

  useEffect(() => {
    if (isPending) {
      wasPending.current = true;
      return;
    }

    if (!wasPending.current) return;

    wasPending.current = false;

    if (message) pushToast(tone, message);
  }, [isPending, tone, message]);
}

/** How long a message stays up. */
const DISMISS_AFTER: Record<ToastTone, number> = {
  // Long enough to read and register, short enough not to sit over the row it
  // is describing.
  success: 4000,
  // Errors say what went wrong and often what to do about it, and the user has
  // a half-filled form open behind this one. Twice the reading time.
  error: 8000,
};

/**
 * Mounted once, in the root layout, so every module gets the same behaviour.
 */
export function ToastHost() {
  const items = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const ref = useRef<HTMLDivElement>(null);

  // Promoted to the top layer only while something is showing. A popover left
  // open would sit over the page invisibly and swallow nothing (it is
  // pointer-events:none) but would still be in the a11y tree.
  useEffect(() => {
    const host = ref.current;

    if (!host || typeof host.showPopover !== 'function') return;

    try {
      if (items.length > 0) host.showPopover();
      else host.hidePopover();
    } catch {
      // Already in the requested state; the spec throws rather than no-ops.
    }
  }, [items.length]);

  if (items.length === 0) return null;

  return (
    <div
      ref={ref}
      // `manual` so it is never light-dismissed: clicking the form behind it
      // must not silently remove the error explaining why the form is still
      // open.
      popover="manual"
      id="toast-host"
      className="pointer-events-none fixed inset-0 z-[100] flex flex-col items-center justify-center gap-2 border-0 bg-transparent p-0"
    >
      {items.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const isError = toast.tone === 'error';

  const dismiss = useCallback(() => dismissToast(toast.id), [toast.id]);

  useEffect(() => {
    const timer = setTimeout(dismiss, DISMISS_AFTER[toast.tone]);

    return () => clearTimeout(timer);
  }, [dismiss, toast.tone]);

  return (
    <div
      // `alert` interrupts a screen reader for a failure; `status` waits for a
      // pause, which is right for a confirmation.
      role={isError ? 'alert' : 'status'}
      className={`pointer-events-auto flex max-w-md items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${
        isError
          ? 'border-red-300 bg-red-50 text-red-900'
          : 'border-green-300 bg-green-50 text-green-900'
      }`}
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0">
        {isError ? (
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 3.25a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V5a.75.75 0 0 1 .75-.75ZM8 10.5a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm3.28 5.28-4 4a.75.75 0 0 1-1.06 0l-1.75-1.75a.75.75 0 1 1 1.06-1.06l1.22 1.22 3.47-3.47a.75.75 0 1 1 1.06 1.06Z" />
          </svg>
        )}
      </span>

      <p className="min-w-0 flex-1 font-medium">{toast.message}</p>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className={`-mr-1 -mt-0.5 shrink-0 rounded p-1 transition ${
          isError ? 'hover:bg-red-100' : 'hover:bg-green-100'
        }`}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
          <path d="M4.28 3.22a.75.75 0 0 0-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 1 0 1.06 1.06L8 9.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L9.06 8l3.72-3.72a.75.75 0 0 0-1.06-1.06L8 6.94 4.28 3.22Z" />
        </svg>
      </button>
    </div>
  );
}
