'use client';

import { setAutoCreationAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { useFormStatus } from 'react-dom';

import { ActionMessage, useAction } from './form-kit';

/**
 * Auto Creation — whether the system may raise requisitions by itself.
 *
 * ON, an item whose usable stock falls below its reorder level gets an
 * AUTO_REORDER requisition raised for it, for the item's configured reorder
 * quantity, with no author because the system raised it. OFF, the same
 * shortage is still detected and still reported on the low-stock list — it
 * simply produces no document, and somebody raises one on the form instead.
 *
 * A FORM, NOT A CHECKBOX THAT SAVES ON CHANGE. The setting governs whether the
 * system creates records on its own, so it is worth one deliberate press
 * rather than a stray click while scrolling; the submit button also gives the
 * pending and error handling every other action here has, which an onChange
 * handler would need written again.
 *
 * The state lives in this component rather than in the button, because a
 * successful save re-renders the row from the server and swaps the button —
 * a message owned by the old button would disappear with it.
 *
 * NO CAPTION UNDER IT. The pill reports the setting and the button says what
 * pressing it will do, which is the whole of what a reader needs here; the
 * sentence that used to explain the consequence of each state was a permanent
 * paragraph on two screens restating what the control already showed.
 */
export function AutoCreationToggle({ enabled }: { enabled: boolean }) {
  const [state, action] = useAction(setAutoCreationAction);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <form action={action} className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-600">Auto Creation</span>

        {/* The NEW value, not the current one — pressing the switch is a
            request to change it. */}
        <input type="hidden" name="autoRequisitionEnabled" value={enabled ? 'false' : 'true'} />

        {/* ONE CONTROL THAT BOTH REPORTS AND CHANGES THE SETTING. It used to be
            a pill saying On or Off beside a button saying Turn off or Turn on,
            which is two things to read to learn one fact. The switch shows the
            state by which side the knob is on, and pressing it is the change.

            `role="switch"` with `aria-checked` so a screen reader announces it
            as a setting that is on or off, rather than as a button whose label
            happens to say ON. */}
        <SwitchButton enabled={enabled} />
      </form>

      <div className="max-w-[22rem] text-left">
        <ActionMessage state={state} />
      </div>
    </div>
  );
}

/**
 * The switch itself.
 *
 * Separate from the form above because it needs `useFormStatus`, which only
 * reports on a form it is rendered INSIDE — called in the same component as the
 * `<form>` it would always say idle.
 */
function SwitchButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      role="switch"
      aria-checked={enabled}
      aria-label="Auto Creation"
      disabled={pending}
      title={
        enabled
          ? 'On — low stock raises a requisition automatically.'
          : 'Off — low stock is reported only.'
      }
      className={`inline-flex h-7 w-[4.25rem] shrink-0 items-center rounded-full px-1 text-[10px] font-bold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-60 ${
        enabled
          ? 'justify-end bg-green-600 text-white'
          : 'justify-start bg-slate-300 text-slate-700'
      }`}
    >
      {/* The word sits on the side the knob is NOT on, so both are readable. */}
      <span className={enabled ? 'pl-1.5 pr-1' : 'pl-1 pr-1.5'}>{enabled ? 'On' : 'Off'}</span>
      <span
        aria-hidden="true"
        className={`h-5 w-5 rounded-full bg-white shadow ${enabled ? 'order-first' : 'order-last'}`}
      />
    </button>
  );
}
