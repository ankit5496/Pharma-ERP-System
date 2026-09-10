'use client';

import { useState } from 'react';
import type { QcQueueItem } from '@pharma-erp/types';

import { recordQcDecisionAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, Field, SubmitButton, useAction } from './form-kit';

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

  const needsReason = decision === 'REJECTED' || decision === 'ON_HOLD';

  return (
    <form action={formAction} className="w-[15rem] space-y-2">
      <ActionMessage state={state} />

      <input type="hidden" name="lotId" value={lot.lot.id} />

      <Field label="Decision" htmlFor={`decision-${lot.lot.id}`} required>
        <select
          id={`decision-${lot.lot.id}`}
          name="decision"
          required
          value={decision}
          onChange={(event) => setDecision(event.target.value)}
          className="field-sm w-full"
        >
          <option value="">Choose…</option>
          {/* Already-usable lots can still be pulled back, so Accept is only
              offered when it would change something. */}
          {lot.lot.status !== 'USABLE' && <option value="ACCEPTED">Accept → usable stock</option>}
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
          className="field-sm w-full"
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
          className="field-sm w-full"
        />
      </Field>

      <SubmitButton
        variant={needsReason ? 'danger' : 'primary'}
        pendingLabel="Recording…"
      >
        Record decision
      </SubmitButton>
    </form>
  );
}
