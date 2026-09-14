'use client';

import { setAutoCreationAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, SubmitButton, useAction } from './form-kit';

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
 */
export function AutoCreationToggle({ enabled }: { enabled: boolean }) {
  const [state, action] = useAction(setAutoCreationAction);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <form action={action} className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-600">Auto creation</span>

        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
            enabled
              ? 'bg-green-50 text-green-800 ring-green-200'
              : 'bg-slate-100 text-slate-600 ring-slate-200'
          }`}
        >
          {enabled ? 'On' : 'Off'}
        </span>

        {/* The NEW value, not the current one — the button says what pressing
            it will do. */}
        <input type="hidden" name="autoRequisitionEnabled" value={enabled ? 'false' : 'true'} />

        <SubmitButton variant="secondary" pendingLabel="Saving…">
          {enabled ? 'Turn off' : 'Turn on'}
        </SubmitButton>
      </form>

      <p className="max-w-[22rem] text-right text-[11px] leading-snug text-slate-500">
        {enabled
          ? 'Low stock raises a requisition automatically, once per item until it is resolved.'
          : 'Low stock is reported but raises nothing. Create requisitions on the form.'}
      </p>

      <div className="max-w-[22rem] text-left">
        <ActionMessage state={state} />
      </div>
    </div>
  );
}
