'use client';

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

import { SECONDARY_BUTTON } from './ui';

/**
 * The Order-to-Cash edit dialog.
 *
 * A real `<dialog>` rather than a positioned div, so the browser supplies the
 * things a hand-rolled modal usually gets wrong: focus is trapped inside it,
 * the rest of the page is inert to the screen reader, and Escape closes it
 * without a key handler of our own.
 *
 * Rendered only when open. Keeping a closed dialog mounted would leave its
 * fields in the tab order and its stale values in the DOM, and an edit form
 * that quietly holds yesterday's figures is worse than one that is not there.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    // showModal() is what makes it modal — `open` as an attribute does not.
    if (!dialog.open) dialog.showModal();

    // Escape fires `cancel`; routing it through onClose keeps React state and
    // the dialog's own open state from disagreeing.
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };

    dialog.addEventListener('cancel', onCancel);
    return () => dialog.removeEventListener('cancel', onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="w-[min(46rem,92vw)] rounded-lg border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
      // A click on the backdrop lands on the dialog itself, never on its
      // children, which is how the two are told apart without a wrapper div.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
        </div>
        {/* An icon, not a labelled button: the dialog's real exits are the
            Cancel and the submit in its footer, and a second full-sized button
            up here competed with them. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1.5 -mt-1.5 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>

      <div className="px-6 py-5">
        <DialogCloseContext.Provider value={onClose}>{children}</DialogCloseContext.Provider>
      </div>
    </dialog>
  );
}

/**
 * How a form inside the dialog closes it.
 *
 * The form is built by the panel — a server component — and handed to the
 * dialog as an element, so the dialog cannot pass it a callback: props are
 * fixed by then, and a function could not cross that boundary anyway. Context
 * travels down the rendered tree instead, where both ends are client
 * components.
 *
 * Null outside a dialog. The same forms are also used inline, where there is
 * nothing to close.
 */
const DialogCloseContext = createContext<(() => void) | null>(null);

export function useDialogClose(): (() => void) | null {
  return useContext(DialogCloseContext);
}

/**
 * The dialog's footer: Cancel on the left, the action on the right.
 *
 * Pulled out to the dialog's own edges with negative margins so the rule above
 * it spans the full width, the way it does under the header.
 */
export function DialogFooter({
  children,
  className = '',
}: {
  children: ReactNode;
  /** Lets the footer keep its place in a form laid out as a grid. */
  className?: string;
}) {
  const close = useDialogClose();

  if (!close) return <div className={`mt-5 ${className}`}>{children}</div>;

  return (
    <div
      className={`-mx-6 -mb-5 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-6 py-4 ${className}`}
    >
      <button type="button" onClick={close} className={SECONDARY_BUTTON}>
        Cancel
      </button>
      {children}
    </div>
  );
}
