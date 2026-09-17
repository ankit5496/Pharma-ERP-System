'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

import { MasterDataDrawer } from '@/components/master-data-drawer';

/**
 * How a form tells the register it has saved, so the drawer can close.
 *
 * The CONFIRMATION is not this component's business — the application-wide
 * toast raises that, from inside the form. This only puts the form away.
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
const SavedContext = createContext<(message: string) => void>(() => {});

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

  // Stable across renders: the forms hold this in an effect's dependency list,
  // and a new function each render would re-fire it on every keystroke.
  const close = useCallback(() => setIsOpen(false), []);

  /**
   * Saved: put the form away.
   *
   * Only that. This briefly also raised a confirmation dialog of its own, until
   * the application-wide toast arrived on main doing the same job everywhere —
   * so the message is the toast's and the closing is this component's. The
   * parameter is kept because the forms report it; it is deliberately unused.
   */
  const reportSaved = useCallback(() => setIsOpen(false), []);

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
    </>
  );
}
