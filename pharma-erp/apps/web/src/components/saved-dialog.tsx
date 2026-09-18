'use client';

import { useEffect, useRef } from 'react';

/**
 * The box that confirms a save.
 *
 * SEPARATE FROM MasterDataDrawer, which is the layer forms open in. The two
 * look like the same thing — a panel over a dimmed page — but they are shaped
 * by opposite needs. A form is wide, scrolls, and carries a titled header with
 * a Close button because there is something in it worth abandoning. A
 * confirmation is small, says one sentence, and has exactly one thing to do:
 * a header with its own Close would offer a second way out of a box whose only
 * purpose is the single button in the middle of it.
 *
 * Trying to serve both from one component meant a flag for the header, a flag
 * for the width and a flag for the alignment — at which point the shared part
 * was the backdrop and nothing else.
 *
 * What IS worth sharing is the behaviour, and that is duplicated here on
 * purpose: Escape, the focus trap and returning focus to whatever opened it are
 * what a keyboard user needs from any modal, and a confirmation that skipped
 * them would strand them on a box they cannot dismiss.
 */
export function SavedDialog({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const doneRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Remembered before focus moves, so dismissing returns the keyboard to
    // whatever was focused when the save completed rather than to the top of
    // the document.
    const opener = document.activeElement as HTMLElement | null;

    // Focus lands on Done, which is both the primary action and the only
    // control — so Enter dismisses without anybody having to reach for a mouse.
    doneRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismiss();
        return;
      }

      // The trap is trivial here because there is one focusable control: Tab
      // and Shift+Tab both have to land back on it. Without this, Tab walks
      // into the page behind and the dialog is lost.
      if (event.key !== 'Tab') return;

      event.preventDefault();
      doneRef.current?.focus();
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      opener?.focus?.();
    };
  }, [onDismiss]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      {/* A button, not a div with onClick: clicking away is a real way to
          dismiss this, so it should be a control for anything that is not a
          mouse. */}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="absolute inset-0 h-full w-full cursor-default bg-slate-900/30 backdrop-blur-[1px]"
      />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="saved-title"
        aria-describedby="saved-message"
        className="relative w-full max-w-sm rounded-xl bg-white px-6 py-7 text-center shadow-2xl"
      >
        {/* Decorative: the heading and message below already say what happened,
            so announcing a tick as well would just be noise to a screen
            reader. */}
        <span
          aria-hidden="true"
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-7 w-7 text-emerald-600"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>

        <h2 id="saved-title" className="mt-4 text-lg font-semibold text-slate-900">
          Saved
        </h2>

        <p id="saved-message" className="mt-1.5 text-sm text-slate-600">
          {message}
        </p>

        <button
          ref={doneRef}
          type="button"
          onClick={onDismiss}
          className="mt-6 rounded-md bg-blue-600 px-8 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Done
        </button>
      </div>
    </div>
  );
}
