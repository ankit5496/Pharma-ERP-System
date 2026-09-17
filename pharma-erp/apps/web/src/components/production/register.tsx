'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { MasterDataDrawer } from '@/components/master-data-drawer';

/**
 * How a form tells the register it has saved.
 *
 * The form reports the confirmation; the REGISTER decides what to do with it —
 * which here means closing the form and putting the message in a dialog of its
 * own. The form does not close itself and does not know a dialog exists.
 *
 * CONTEXT RATHER THAN A PROP, and the reason is the server/client boundary.
 * `form` is built by a SERVER component — it needs the session token to fetch
 * what the form offers — so it arrives here as an already-constructed element.
 * A server component cannot pass a function to a client one at all ("Functions
 * cannot be passed directly to Client Components"), which rules out both
 * handing `onSaved` to the form and taking `form` as a render prop.
 *
 * Context crosses that boundary the other way round: this client component
 * provides the callback, and the client form inside reads it, with the server
 * element passing through in between untouched.
 *
 * Defaults to a no-op so a form rendered outside a drawer — the packing and
 * release forms sit inline on a batch card — simply reports into nothing.
 */
/**
 * The default: no drawer is listening.
 *
 * A named no-op rather than an inline one, so a form can tell whether it is
 * inside a drawer by comparing against it — which decides whether its own
 * success banner would be redundant. See `Result` in ./forms.
 */
export const NO_DRAWER = (_message: string): void => {};

const SavedContext = createContext<(message: string) => void>(NO_DRAWER);

export function useReportSaved(): (message: string) => void {
  return useContext(SavedContext);
}

/**
 * A Production step as a register: the records, and a button that opens the
 * form over them.
 *
 * WHY THIS SHAPE. Every step used to lead with its form and put the records
 * underneath, which reads as "fill this in" — but a work order is raised
 * occasionally and looked at constantly, so the page opened on the rare task
 * and pushed the common one below the fold. Master Data settled on the grid
 * being the page and the form being a detour, and this is the same arrangement
 * for the same reason.
 *
 * A CLIENT wrapper around SERVER content. The records are rendered on the
 * server — they need the session token, and the API's role checks have to apply
 * to the read — so they arrive here as `children` rather than being fetched.
 * Only the drawer's open/closed state lives on the client, which is the only
 * part that is genuinely interactive.
 *
 * `newLabel` is absent for a step that creates nothing. Batch release decides
 * on batches that already exist; giving it a New button would be inventing an
 * action the workflow does not have.
 */
export function ProductionRegister({
  title,
  description,
  newLabel,
  newTitle,
  newDescription,
  formWidth,
  form,
  children,
}: {
  title: string;
  description?: string;
  /** Omit to render no New button — see the note above. */
  newLabel?: string;
  newTitle?: string;
  newDescription?: string;
  /** 'wide' for a form that carries a table; see MasterDataDrawer. */
  formWidth?: 'default' | 'wide';
  /**
   * The form, rendered only while the drawer is open.
   *
   * A ready-made element, built on the server. It reports a save through
   * SavedContext rather than a prop — see the note on that above for why a
   * callback cannot travel this way.
   */
  form?: ReactNode;
  /** The records. Rendered on the server and passed through. */
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  // The confirmation, once something has saved. Null means nothing to confirm.
  const [saved, setSaved] = useState<string | null>(null);

  // Stable across renders: the forms hold this in an effect's dependency list,
  // and a new function each render would re-fire it on every keystroke.
  const close = useCallback(() => setIsOpen(false), []);

  /**
   * Saved: put the form away and say so, in that order.
   *
   * The confirmation used to live inside the form, which then closed itself
   * after a second and a half — so the message a person was still reading took
   * itself off the screen, and the only way to keep it was to read faster. The
   * form closing is the system's business; dismissing the confirmation is the
   * reader's, so they are now two separate things and only the first happens
   * on its own.
   */
  const reportSaved = useCallback((message: string) => {
    setIsOpen(false);
    setSaved(message);
  }, []);

  return (
    <>
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
          </div>

          {newLabel && form && (
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="whitespace-nowrap rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              {newLabel}
            </button>
          )}
        </header>

        {children}
      </section>

      {isOpen && form && (
        <MasterDataDrawer
          title={newTitle ?? newLabel ?? ''}
          description={newDescription}
          // Centred, not a right-hand drawer: these forms are short — three
          // fields for a work order — and a short form pinned to the edge of a
          // wide screen sits a long way from where the eye already is.
          placement="center"
          width={formWidth}
          onClose={close}
        >
          {/* The form reports a SUCCESS through this, and the register decides
              what follows. A failure is not reported — it stays in the form,
              beside the fields it is about, which is the case that most needs
              reading. */}
          <SavedContext.Provider value={reportSaved}>{form}</SavedContext.Provider>
        </MasterDataDrawer>
      )}

      {saved !== null && <SavedDialog message={saved} onClose={() => setSaved(null)} />}
    </>
  );
}

/**
 * The confirmation, after the form has closed.
 *
 * Dismissed by the reader, never on a timer. What was created — a work order
 * number, a batch number — is the one thing they need to carry to the next
 * step, and a message that removes itself is one they have to catch.
 *
 * Its own small dialog rather than a toast in the corner: the record it names
 * is the result of the thing they just did, and the corner of the screen is
 * where notifications go to be missed.
 */
function SavedDialog({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-slate-900/40"
      />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="saved-dialog-title"
        className="relative w-full max-w-sm rounded-lg bg-white p-6 text-center shadow-xl"
      >
        <span
          aria-hidden
          className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <path d="m5 10.5 3.5 3.5L15 7" />
          </svg>
        </span>

        <h2 id="saved-dialog-title" className="mt-3 text-base font-semibold text-slate-900">
          {message}
        </h2>

        <button
          type="button"
          onClick={onClose}
          // Focused on mount so Enter and Escape both dismiss, and so a
          // keyboard user is not left hunting for where focus went when the
          // form under this disappeared.
          autoFocus
          className="mt-5 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
        >
          Close
        </button>
      </div>
    </div>
  );
}
