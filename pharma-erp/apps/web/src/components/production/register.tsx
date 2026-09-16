'use client';

import { useState, type ReactNode } from 'react';

import { MasterDataDrawer } from '@/components/master-data-drawer';

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
  form,
  children,
}: {
  title: string;
  description?: string;
  /** Omit to render no New button — see the note above. */
  newLabel?: string;
  newTitle?: string;
  newDescription?: string;
  /** The form, rendered only while the drawer is open. */
  form?: ReactNode;
  /** The records. Rendered on the server and passed through. */
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

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
          onClose={() => setIsOpen(false)}
        >
          {/* The form closes the drawer itself once its action succeeds; see
              each form's `onSaved`. Closing on submit instead would hide the
              refusal when the API says no. */}
          {form}
        </MasterDataDrawer>
      )}
    </>
  );
}
