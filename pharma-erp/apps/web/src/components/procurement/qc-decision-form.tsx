'use client';

import { useState } from 'react';
import type { QcQueueItem } from '@pharma-erp/types';

import { recordQcDecisionAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, Disclosure, Field, SubmitButton, useAction } from './form-kit';

/**
 * Records the incoming-QC decision on one batch.
 *
 * The consequence of each option is printed next to it. This is the point in
 * the workflow where material becomes usable or does not, and a Quality
 * Officer choosing between three similar-looking buttons should not have to
 * remember which one puts stock on the shop floor.
 *
 * A reason is required for a rejection or a hold — enforced by the API too,
 * but asked for here so the requirement is visible before submitting rather
 * than after.
 *
 * IT OPENS FROM A BUTTON ON THE ROW. Three fields in every row of the queue
 * made the table almost unreadable — each row was as tall as a form, and the
 * batch, expiry and history a Quality Officer is deciding FROM were squeezed
 * beside the controls they were deciding WITH. In a dialog the row stays a row,
 * and the decision gets the whole width, with the batch it is about named at
 * the top of it.
 */
export function QcDecisionForm({ lot }: { lot: QcQueueItem }) {
  const [state, formAction] = useAction(recordQcDecisionAction);
  const [decision, setDecision] = useState('');

  // A rejection is final: releasing rejected material would defeat rejecting
  // it. The API refuses too; hiding the form avoids offering the attempt.
  //
  // ActionMessage is rendered in these terminal branches as well, and that is
  // not decoration. Recording a rejection revalidates the page, the lot's
  // status becomes REJECTED, and this branch replaces the form — so if the
  // message only lived below, the click that rejected a batch would appear to
  // do nothing at all.
  if (lot.lot.status === 'REJECTED') {
    return (
      <div className="max-w-[15rem] space-y-2">
        <ActionMessage state={state} />
        <p className="text-[11px] text-slate-500">
          Rejected — return to the vendor and receive a replacement against the purchase order.
        </p>
      </div>
    );
  }

  if (lot.lot.status === 'CONSUMED') {
    return (
      <div className="space-y-2">
        <ActionMessage state={state} />
        <span className="text-xs text-slate-400">Consumed</span>
      </div>
    );
  }

  // ACCEPTED IS A DECIDED BATCH, so the queue stops offering to decide it. An
  // accepted decision sets the lot USABLE, which is why this is not covered by
  // the two branches above.
  //
  // The API is unchanged and still refuses a second acceptance on its own
  // (`assertDecidable`), so this is the screen agreeing with the rule rather
  // than being the rule.
  //
  // WORTH KNOWING: the API does still permit a USABLE lot to be REJECTED or put
  // ON HOLD — that is the route for stock released this morning and found
  // contaminated this afternoon. Hiding the control here closes the only way to
  // reach it from this screen. If that route is wanted back, it belongs as its
  // own action ("Quarantine released stock") rather than as a second pass at
  // the incoming-QC decision, which is what this form is.
  if (lot.lot.status === 'USABLE') {
    return (
      <div className="space-y-2">
        <ActionMessage state={state} />
        <span className="text-xs text-slate-400">Accepted — no decision outstanding</span>
      </div>
    );
  }

  const needsReason = decision === 'REJECTED' || decision === 'ON_HOLD';

  return (
    <Disclosure
      label="Record decision"
      title="Incoming QC decision"
      subtitle={`${lot.item.name} — batch ${lot.lot.lotNumber}`}
      closeWhen={state.status === 'success'}
      width="32rem"
    >
      {() => (
        <form action={formAction} className="space-y-4">
          <ActionMessage state={state} />

          <input type="hidden" name="lotId" value={lot.lot.id} />

          {/* What the decision is about, carried from the record so nothing has to
          be looked up in the row behind the dialog. */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Item</dt>
              <dd className="mt-0.5 text-slate-800">{lot.item.name}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Batch</dt>
              <dd className="mt-0.5 font-mono text-slate-800">{lot.lot.lotNumber}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Received</dt>
              <dd className="mt-0.5 tabular-nums text-slate-800">
                {lot.lot.quantityReceived} {lot.item.uom}
              </dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Expiry</dt>
              <dd className="mt-0.5 tabular-nums text-slate-800">
                {lot.lot.expiryDate?.slice(0, 10) ?? '—'}
              </dd>
            </div>
          </dl>

          <Field label="Decision" htmlFor={`decision-${lot.lot.id}`} required>
            <select
              id={`decision-${lot.lot.id}`}
              name="decision"
              required
              value={decision}
              onChange={(event) => setDecision(event.target.value)}
              className="field"
            >
              <option value="">Choose…</option>
              {/* Already-usable lots can still be pulled back, so Accept is only
              offered when it would change something. */}
              {lot.lot.status !== 'USABLE' && (
                <option value="ACCEPTED">Accept → usable stock</option>
              )}
              <option value="REJECTED">Reject → stays quarantined</option>
              <option value="ON_HOLD">Hold → stays quarantined</option>
            </select>
          </Field>

          <Field label="COA / test reference" htmlFor={`coa-${lot.lot.id}`}>
            <input
              id={`coa-${lot.lot.id}`}
              name="testReference"
              maxLength={64}
              defaultValue={state.values?.testReference ?? ''}
              className="field"
            />
          </Field>

          <Field
            label="Remarks"
            htmlFor={`remarks-${lot.lot.id}`}
            required={needsReason}
            hint={needsReason ? 'Required for a rejection or hold.' : undefined}
          >
            <textarea
              id={`remarks-${lot.lot.id}`}
              name="remarks"
              rows={2}
              required={needsReason}
              maxLength={1000}
              defaultValue={state.values?.remarks ?? ''}
              className="field"
            />
          </Field>

          <div className="flex justify-end">
            <SubmitButton variant={needsReason ? 'danger' : 'primary'} pendingLabel="Recording…">
              Record decision
            </SubmitButton>
          </div>
        </form>
      )}
    </Disclosure>
  );
}
