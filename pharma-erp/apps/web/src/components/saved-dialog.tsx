'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
 *
 * IT ANIMATES BOTH WAYS. The card eases up into place and fades out again when
 * dismissed — which needs the component's help, because the exit cannot be a
 * plain CSS transition: the element is unmounted the moment it is dismissed,
 * and there is nothing left on screen to transition. See `leave` below.
 */

/**
 * How long the exit animation runs. Matches `saved-dialog-out` in globals.css;
 * the two have to agree or the card is removed mid-fade or lingers after it.
 */
const LEAVE_MS = 420;

/**
 * How long the card stays before it starts fading, in milliseconds.
 *
 * Two seconds is long enough to read one sentence and short enough that it is
 * gone before anybody reaches for a button. It replaced a Done button: a
 * confirmation is news, not a question, and asking somebody to acknowledge
 * their own successful save put a click between them and the next thing they
 * were going to do.
 */
const HOLD_MS = 2000;

export function SavedDialog({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Dismissing plays an animation before the card is removed, so `onDismiss`
  // is delayed rather than called straight away. Without this the element is
  // unmounted on the click and there is nothing left to animate out — which is
  // why a CSS transition alone cannot do this.
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);

  // Held in a ref so `leave` can stay stable across renders. Two call sites
  // pass an inline arrow for `onDismiss`, which is a new function every render
  // — and the focus effect below depends on `leave`, so without this it would
  // re-run constantly and yank focus back to Done while the page worked.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const leave = useCallback(() => {
    // Guarded: Escape, the backdrop and Done all lead here, and two of them in
    // quick succession would otherwise queue two dismissals.
    if (leavingRef.current) return;

    leavingRef.current = true;
    setLeaving(true);

    setTimeout(() => onDismissRef.current(), LEAVE_MS);
  }, []);

  /**
   * GOES BY ITSELF after two seconds.
   *
   * The card used to wait for a Done button. A save that has already succeeded
   * is news rather than a question, and making somebody acknowledge it put a
   * click between them and whatever they were about to do next — on a form
   * they may be about to fill in again.
   *
   * Escape and a click on the backdrop still dismiss it early; `leave` is
   * guarded, so whichever happens first wins and the timer firing afterwards
   * does nothing.
   */
  useEffect(() => {
    const timer = setTimeout(leave, HOLD_MS);

    return () => clearTimeout(timer);
  }, [leave]);

  useEffect(() => {
    // Remembered before focus moves, so dismissing returns the keyboard to
    // whatever was focused when the save completed rather than to the top of
    // the document.
    const opener = document.activeElement as HTMLElement | null;

    // FOCUS MOVES TO THE CARD, which is what makes a screen reader announce it
    // and what gives Escape somewhere to be pressed. It used to land on Done;
    // with no control left, the card takes focus itself — `tabIndex={-1}` on
    // it is what allows that.
    //
    // Captured now, for the cleanup below: by the time this effect tears down
    // the card is on its way out and the ref may already read null, which would
    // leave the keyboard stranded where the dialog used to be.
    const card = cardRef.current;

    card?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        leave();
        return;
      }

      // NO FOCUS TRAP any more, deliberately. Trapping Tab is for a modal
      // somebody must answer; this one leaves on its own, and holding the
      // keyboard hostage for two seconds would be worse than letting Tab
      // move on into the page that is about to be usable anyway.
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);

      // Only if focus is still inside this card. By the time it goes the
      // person may already be typing somewhere else — the card does not wait
      // for them — and yanking the caret back would be the rudest possible
      // moment to do it.
      if (card?.contains(document.activeElement)) opener?.focus?.();
    };
  }, [leave]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      {/* A button, not a div with onClick: clicking away is a real way to
          dismiss this, so it should be a control for anything that is not a
          mouse. */}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={leave}
        data-leaving={leaving}
        className="saved-dialog-backdrop absolute inset-0 h-full w-full cursor-default bg-slate-900/30 backdrop-blur-[1px]"
      />

      {/* `alert`, not `alertdialog`, and no `aria-modal`. Both of those describe
          a box that is waiting for an answer; this one states what happened and
          leaves. `alert` is what makes a screen reader read it out where it
          stands, which is the whole job now that there is nothing to press. */}
      <div
        ref={cardRef}
        role="alert"
        aria-labelledby="saved-title"
        aria-describedby="saved-message"
        tabIndex={-1}
        data-leaving={leaving}
        className="saved-dialog-card relative w-full max-w-sm rounded-xl bg-white px-6 py-7 text-center shadow-2xl focus:outline-none"
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
      </div>
    </div>
  );
}
