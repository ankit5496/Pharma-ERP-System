'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The layer a register's form opens in.
 *
 * Over a page rather than a separate route, because creating a record is a
 * detour from the grid and not a destination: you come back to the same scroll
 * position in the same register, which a navigation would throw away.
 *
 * TWO PLACEMENTS, same component. A drawer down the right edge suits the long
 * master-data forms — a dozen fields and several sections, which want height
 * more than they want to be centred. A centred modal suits a short one: the
 * work-order form is three fields, and pinning three fields to the right edge
 * of a wide screen puts them a long way from where the eye already is.
 *
 * One component rather than two because everything that is easy to get wrong —
 * the focus trap, Escape, returning focus to whatever opened it — is identical
 * either way, and duplicating it is how one copy quietly loses a behaviour.
 *
 * Not a `<dialog>`: the native element's `showModal()` has to be called
 * imperatively after mount and then kept in step with React's idea of whether
 * it is open, which in practice means an effect that fights the component
 * every render. This is mounted only while open, so open/closed is just
 * whether it exists.
 */
export function MasterDataDrawer({
  title,
  description,
  placement = 'drawer',
  width = 'default',
  onClose,
  children,
}: {
  title: string;
  description?: string;
  /** 'drawer' fills the right edge; 'center' is a modal box. */
  placement?: 'drawer' | 'center';
  /**
   * How wide a CENTRED box may grow. Ignored by the edge drawer, which takes
   * its width from the viewport.
   *
   * Default fits a form of short fields. 'wide' is for a form carrying a table
   * — the dispensing plan lists every material with its lots and quantities,
   * and at the narrow width those columns wrapped into a block that had to be
   * scrolled sideways to read.
   */
  width?: 'default' | 'wide';
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Remembered before focus moves, so closing returns the keyboard to the
    // button that opened the drawer rather than to the top of the document.
    const opener = document.activeElement as HTMLElement | null;

    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      // A minimal focus trap. Not a full implementation — it does not handle
      // controls that become focusable while open — but it stops Tab walking
      // out of the drawer and into the page behind it, which is the failure
      // that makes a keyboard user lose the dialog entirely.
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      opener?.focus?.();
    };
  }, [onClose]);

  const isCentred = placement === 'center';

  return (
    <div
      className={`fixed inset-0 z-40 flex ${
        isCentred ? 'items-center justify-center p-4' : 'justify-end'
      }`}
    >
      {/* A button, not a div with onClick: it is a real control that closes
          the drawer, so it should be one for anything that is not a mouse. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-slate-900/30 backdrop-blur-[1px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className={
          isCentred
            ? `relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-lg bg-white shadow-2xl ${
                width === 'wide' ? 'max-w-5xl' : 'max-w-2xl'
              }`
            : 'relative flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl'
        }
      >
        <div className="flex flex-none items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <h2 id="drawer-title" className="text-base font-semibold text-slate-900">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
          </div>

          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex-none rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        {/* The form is the only thing that scrolls — the drawer's own header
            stays, the same way the register list does behind it. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
          {children}
        </div>
      </div>
    </div>
  );
}
