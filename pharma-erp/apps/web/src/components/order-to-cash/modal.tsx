'use client';

import { useEffect, useRef, type ReactNode } from 'react';

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
        <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
          Close
        </button>
      </div>

      <div className="px-6 py-5">{children}</div>
    </dialog>
  );
}
