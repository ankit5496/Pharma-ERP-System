'use client';

import { useState } from 'react';
import { STOCK_LOT_STATUS_LABELS } from '@pharma-erp/types';
import type { QcQueueItem } from '@pharma-erp/types';

import { recordQcDecisionAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, Disclosure, Field, FormFooter, SubmitButton, useAction } from './form-kit';

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
      width="46rem"
    >
      {(close) => (
        <form action={formAction} className="flex grow flex-col gap-5">
          <ActionMessage state={state} />

          <input type="hidden" name="lotId" value={lot.lot.id} />

          {/* ONE TWO-COLUMN GRID. What is settled about the lot is rendered as
              disabled fields rather than as a caption above the form: these are
              the record the decision is taken on, and being greyed is what says
              they are not the officer's to change. */}
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <Field label="Item" htmlFor={`qc-item-${lot.lot.id}`}>
              <input
                id={`qc-item-${lot.lot.id}`}
                disabled
                readOnly
                value={lot.item.name}
                className="field"
              />
            </Field>

            <Field label="Item code" htmlFor={`qc-code-${lot.lot.id}`}>
              <input
                id={`qc-code-${lot.lot.id}`}
                disabled
                readOnly
                value={lot.item.code}
                className="field font-mono"
              />
            </Field>

            <Field label="Lot number" htmlFor={`qc-lot-${lot.lot.id}`}>
              <input
                id={`qc-lot-${lot.lot.id}`}
                disabled
                readOnly
                value={lot.lot.lotNumber}
                className="field font-mono"
              />
            </Field>

            <Field label="Vendor batch no." htmlFor={`qc-vbatch-${lot.lot.id}`}>
              <input
                id={`qc-vbatch-${lot.lot.id}`}
                disabled
                readOnly
                value={lot.lot.vendorBatchNumber ?? '—'}
                className="field font-mono"
              />
            </Field>

            {/* WHOSE MATERIAL, AND ON WHAT DOCUMENT. A purchased lot names its
                vendor, order and goods receipt; a principal's names the
                principal, their job-work order and their delivery challan. The
                labels change with it, because calling a principal a "vendor"
                here would be the one thing US-JW-02 is most insistent about. */}
            <Field
              label={lot.jobWork ? 'Principal' : 'Vendor'}
              htmlFor={`qc-source-${lot.lot.id}`}
            >
              <input
                id={`qc-source-${lot.lot.id}`}
                disabled
                readOnly
                value={lot.jobWork?.principal.name ?? lot.vendor?.name ?? '—'}
                className="field"
              />
            </Field>

            <Field
              label={lot.jobWork ? 'Job-work order' : 'Purchase order'}
              htmlFor={`qc-po-${lot.lot.id}`}
            >
              <input
                id={`qc-po-${lot.lot.id}`}
                disabled
                readOnly
                value={lot.jobWork?.jobWorkOrder.number ?? lot.purchaseOrder?.number ?? '—'}
                className="field font-mono"
              />
            </Field>

            <Field
              label={lot.jobWork ? 'Material receipt' : 'Goods receipt'}
              htmlFor={`qc-grn-${lot.lot.id}`}
            >
              <input
                id={`qc-grn-${lot.lot.id}`}
                disabled
                readOnly
                value={
                  lot.jobWork
                    ? `${lot.jobWork.materialReceipt.number} · challan ${lot.jobWork.deliveryChallanNumber}`
                    : (lot.goodsReceipt?.number ?? '—')
                }
                className="field font-mono"
              />
            </Field>

            <Field label="Received on" htmlFor={`qc-recd-${lot.lot.id}`}>
              <input
                id={`qc-recd-${lot.lot.id}`}
                disabled
                readOnly
                value={(lot.jobWork?.materialReceipt.receiptDate ?? lot.goodsReceipt?.receiptDate ?? '').slice(0, 10)}
                className="field tabular-nums"
              />
            </Field>

            <Field label={`Quantity received (${lot.item.uom})`} htmlFor={`qc-qty-${lot.lot.id}`}>
              <input
                id={`qc-qty-${lot.lot.id}`}
                disabled
                readOnly
                value={lot.lot.quantityReceived}
                className="field tabular-nums"
              />
            </Field>

            <Field
              label={`Quantity available (${lot.item.uom})`}
              htmlFor={`qc-avail-${lot.lot.id}`}
            >
              <input
                id={`qc-avail-${lot.lot.id}`}
                disabled
                readOnly
                value={lot.lot.quantityAvailable}
                className="field tabular-nums"
              />
            </Field>

            <Field label="Manufactured" htmlFor={`qc-mfg-${lot.lot.id}`}>
              <input
                id={`qc-mfg-${lot.lot.id}`}
                disabled
                readOnly
                value={lot.lot.manufacturingDate?.slice(0, 10) ?? '—'}
                className="field tabular-nums"
              />
            </Field>

            <Field
              label="Expiry"
              htmlFor={`qc-exp-${lot.lot.id}`}
              // The countdown, where there is one: a lot with weeks left is a
              // different decision from one with two years.
              hint={
                lot.daysToExpiry === null
                  ? undefined
                  : lot.daysToExpiry < 0
                    ? `Expired ${Math.abs(lot.daysToExpiry)} days ago.`
                    : `${lot.daysToExpiry} days remaining.`
              }
            >
              <input
                id={`qc-exp-${lot.lot.id}`}
                disabled
                readOnly
                value={lot.lot.expiryDate?.slice(0, 10) ?? '—'}
                className="field tabular-nums"
              />
            </Field>

            <Field label="Current lot status" htmlFor={`qc-status-${lot.lot.id}`}>
              <input
                id={`qc-status-${lot.lot.id}`}
                disabled
                readOnly
                value={STOCK_LOT_STATUS_LABELS[lot.lot.status]}
                className="field"
              />
            </Field>

            <Field label="Decisions recorded" htmlFor={`qc-history-${lot.lot.id}`}>
              <input
                id={`qc-history-${lot.lot.id}`}
                disabled
                readOnly
                value={
                  lot.history.length === 0
                    ? 'None yet'
                    : `${lot.history.length} — latest ${lot.history[0]!.decision.toLowerCase()}`
                }
                className="field"
              />
            </Field>

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
              className="sm:col-span-2"
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
          </div>

          <FormFooter onCancel={close}>
            <SubmitButton variant={needsReason ? 'danger' : 'primary'} pendingLabel="Recording…">
              Record decision
            </SubmitButton>
          </FormFooter>
        </form>
      )}
    </Disclosure>
  );
}
