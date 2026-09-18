'use client';

import { useEffect } from 'react';

/**
 * Stops the scroll wheel ever changing a `<input type="number">`, anywhere.
 *
 * A focused number input increments on wheel, natively, in every major
 * browser. Somebody types 500 into a reorder level, scrolls the drawer to
 * reach the save button, and arrives with 512 — silently, because the pointer
 * happened to be over the field on the way past. On a long form that scrolls,
 * this is the most likely way a wrong number reaches the database, and it
 * leaves no trace that anything changed.
 *
 * GLOBAL RATHER THAN PER FIELD. Each form component can guard its own inputs —
 * and the master-data `TextField` does — but that only protects the controls
 * somebody remembered to route through it. A number input added to a dialog
 * next month, by someone who never read this file, is guarded by this and by
 * nothing else. There are already four raw `<input type="number">` outside the
 * form kit, which is how the per-field version came to be incomplete.
 *
 * BLUR, NOT `preventDefault`. Cancelling the wheel event does stop the
 * increment — but it stops the PAGE scrolling too, for as long as the field
 * has focus. The gesture was "scroll the page"; answering it by freezing the
 * page is a worse bug than the one being fixed. Dropping focus ends the
 * increment behaviour, which belongs to the focused element, and the scroll
 * then does exactly what was asked of it.
 *
 * CAPTURE, so this runs before anything else reacts to the wheel. Passive is
 * fine here precisely because nothing is cancelled — which is also why React's
 * own `onWheel` prop could do this, as the master-data `TextField` does; this
 * exists to cover every input that does not go through it.
 */
export function NoNumberScroll() {
  useEffect(() => {
    function onWheel(event: WheelEvent) {
      const active = document.activeElement as HTMLInputElement | null;

      // Only a FOCUSED number input increments, so nothing else needs touching
      // — and blurring on any other wheel event would steal focus from
      // whatever the person was typing in.
      if (!active || active.tagName !== 'INPUT' || active.type !== 'number') return;

      // Only when the wheel is over that same field. Scrolling elsewhere on
      // the page while a number field happens to hold focus is not a gesture
      // aimed at it, and blurring would close any dialog watching for it.
      if (event.target !== active) return;

      active.blur();
    }

    window.addEventListener('wheel', onWheel, { capture: true });

    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, []);

  return null;
}
