'use client';

import { useState } from 'react';
import { type PurchaseOrderListItem } from '@pharma-erp/types';

import { createGoodsReceiptAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, Disclosure, Field, SubmitButton, useAction } from './form-kit';
import { noWheelChange } from '@/lib/number-input';

/**
 * Books a goods receipt against an open purchase order.
 *
 * NO ITEM IS ENTERED HERE. The lines are generated from the chosen order, so a
 * receipt can only ever be booked against something actually on order, against
 * items that already exist in the item master. Lines left blank are skipped — a
 * delivery rarely covers a whole order, and forcing a zero onto the others
 * would post movements that never happened.
 *
 * EACH LINE SHOWS FOUR QUANTITIES, which is what makes partial receiving
 * legible: what was ordered, what previous receipts already brought in, what
 * is therefore still outstanding, and what is being received now. Showing only
 * the last of those leaves the receiver doing arithmetic to answer "how much
 * am I allowed to take".
 *
 * THE BATCH FIELDS ARE NOT MARKED `required` IN THE BROWSER, on purpose. A
 * receipt usually covers some lines and not others, and an HTML `required`
 * applies to a row whether or not anything is being received on it — so
 * marking them would make a partial receipt impossible to submit. The API
 * demands a batch number, manufacturing date and expiry for every line that
 * actually carries a quantity, which is the rule that matters.
 *
 * The browser checks that do exist — the remaining-quantity ceiling — are a
 * courtesy that answers without a round trip. The API checks the same things
 * again against live figures, and that is what refuses a bad receipt.
 *
 * IT OPENS IN A DIALOG FROM THE GRN SCREEN rather than sitting above the list
 * of receipts. The form is long — a line per outstanding order line, four
 * fields each — and permanently expanded it pushed the receipts it produces
 * off the bottom of the screen. It opens by itself when the user arrived from
 * "Create GRN" on a purchase order, since that click was the request to fill
 * it in.
 */
export function BookReceiptForm({
  orders,
  preselectedOrderId,
  receivedBy,
}: {
  orders: readonly PurchaseOrderListItem[];
  /** Set when the user arrived from "Create GRN" on a purchase order. */
  preselectedOrderId?: string;
  receivedBy: string;
}) {
  const [state, formAction] = useAction(createGoodsReceiptAction);
  const [orderId, setOrderId] = useState(
    // Falls back rather than showing an empty form if the order has since been
    // closed or fully received and is no longer in the receivable list.
    preselectedOrderId && orders.some((o) => o.id === preselectedOrderId)
      ? preselectedOrderId
      : (orders[0]?.id ?? ''),
  );

  const order = orders.find((candidate) => candidate.id === orderId) ?? orders[0];

  // Fully received lines are dropped: there is nothing left to receive on them
  // and the API would refuse an over-receipt anyway.
  const openLines = order?.lines.filter((line) => line.quantityPending !== '0') ?? [];

  return (
    <Disclosure
      label="Create GRN"
      title="Create goods receipt note"
      subtitle="Record material arriving against an issued purchase order. Each line creates a batch, in quarantine until incoming QC clears it."
      closeWhen={state.status === 'success'}
      defaultOpen={Boolean(preselectedOrderId)}
      width="46rem"
    >
      {() => (
        <form action={formAction} className="space-y-4">
          <ActionMessage state={state} />

          {/* What the system fills in, stated rather than presented as empty
          boxes someone might think they forgot. None of it is submitted: the
          API allocates the number, stamps the time and attributes the receipt
          to the signed-in user. */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-4">
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">GRN no.</dt>
              <dd className="mt-0.5 text-slate-800">Generated on save</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Received by</dt>
              <dd className="mt-0.5 text-slate-800">{receivedBy}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Linked PO</dt>
              <dd className="mt-0.5 font-mono text-slate-800">{order?.number ?? '—'}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Vendor</dt>
              <dd className="mt-0.5 text-slate-800">{order?.vendor.name ?? '—'}</dd>
            </div>
          </dl>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Purchase order" htmlFor="grn-order" required className="sm:col-span-2">
              <select
                id="grn-order"
                name="purchaseOrderId"
                required
                value={orderId}
                onChange={(event) => setOrderId(event.target.value)}
                className="field-sm w-full"
              >
                {orders.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.number} — {candidate.vendor.name} (
                    {candidate.lines.filter((l) => l.quantityPending !== '0').length} line(s)
                    pending)
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Receipt date" htmlFor="grn-date">
              <input id="grn-date" name="receiptDate" type="date" className="field-sm w-full" />
            </Field>

            <Field label="Vendor document no." htmlFor="grn-doc">
              <input
                id="grn-doc"
                name="vendorDocumentNumber"
                maxLength={64}
                placeholder="Delivery note / invoice ref"
                className="field-sm w-full"
              />
            </Field>

            <Field label="Remarks" htmlFor="grn-remarks" className="sm:col-span-2">
              <input id="grn-remarks" name="remarks" maxLength={1000} className="field-sm w-full" />
            </Field>
          </div>

          {openLines.length === 0 ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              Every line on this order has been received in full.
            </p>
          ) : (
            /* ONE CARD PER LINE, NOT A ROW OF INPUTS IN A TABLE. As a table
               every field was a column, so the form was far wider than the
               dialog and had to be filled in while scrolling sideways — and
               each input's label lived in a header row that scrolled out of
               view as soon as you reached the fields that needed it. A card
               keeps a line's fields under that line's own name, two to a row,
               with every label attached to the box it names. */
            <div className="space-y-3">
              {openLines.map((line) => {
                const tracked = line.item.requiresBatchTracking;

                return (
                  <fieldset key={line.id} className="rounded-md border border-slate-200 px-4 pb-4">
                    <input type="hidden" name="lineId" value={line.id} />

                    <legend className="flex flex-wrap items-center gap-2 px-1.5 text-sm">
                      <span className="font-medium text-slate-900">{line.item.name}</span>
                      <span className="font-mono text-xs text-slate-500">{line.item.code}</span>
                      {tracked && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                          batch tracked
                        </span>
                      )}
                    </legend>

                    {/* What is already true of this line, so the quantity typed
                        below has something to be judged against. Read-only:
                        these are facts about the order, not fields. */}
                    <dl className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
                      <div className="flex gap-1.5">
                        <dt>On order</dt>
                        <dd className="font-medium tabular-nums text-slate-800">
                          {line.quantity} {line.item.uom}
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt>Already received</dt>
                        <dd className="font-medium tabular-nums text-slate-800">
                          {line.quantityReceived} {line.item.uom}
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt>Remaining</dt>
                        <dd className="font-semibold tabular-nums text-slate-900">
                          {line.quantityPending} {line.item.uom}
                        </dd>
                      </div>
                    </dl>

                    <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                      <Field label="Received quantity" htmlFor={`recv-${line.id}`}>
                        {/* `max` is the remaining quantity, so the browser
                            refuses an over-receipt without a round trip. The
                            API checks the same thing against the live figure,
                            which is what counts when two people receive at
                            once. */}
                        <input
                          id={`recv-${line.id}`}
                          name={`quantityReceived_${line.id}`}
                          type="number"
                          step="any"
                          min="0"
                          max={line.quantityPending}
                          placeholder="0"
                          {...noWheelChange}
                          title={`At most ${line.quantityPending} ${line.item.uom} remain on this line.`}
                          className="field"
                        />
                      </Field>

                      <Field label="Rejected at gate" htmlFor={`rej-${line.id}`}>
                        <input
                          id={`rej-${line.id}`}
                          name={`quantityRejected_${line.id}`}
                          inputMode="decimal"
                          placeholder="0"
                          className="field"
                        />
                      </Field>

                      <Field
                        label="Vendor batch / lot no."
                        htmlFor={`batch-${line.id}`}
                        hint={tracked ? 'Required for this item.' : undefined}
                      >
                        <input
                          id={`batch-${line.id}`}
                          name={`vendorBatchNumber_${line.id}`}
                          maxLength={64}
                          className="field"
                        />
                      </Field>

                      <Field label="Storage location" htmlFor={`loc-${line.id}`}>
                        <input
                          id={`loc-${line.id}`}
                          name={`storageLocation_${line.id}`}
                          maxLength={128}
                          placeholder="Store A"
                          className="field"
                        />
                      </Field>

                      <Field label="Manufacturing date" htmlFor={`mfg-${line.id}`}>
                        <input
                          id={`mfg-${line.id}`}
                          name={`manufacturingDate_${line.id}`}
                          type="date"
                          className="field"
                        />
                      </Field>

                      <Field
                        label="Expiry date"
                        htmlFor={`exp-${line.id}`}
                        hint={tracked ? 'Required for this item.' : undefined}
                      >
                        <input
                          id={`exp-${line.id}`}
                          name={`expiryDate_${line.id}`}
                          type="date"
                          className="field"
                        />
                      </Field>
                    </div>
                  </fieldset>
                );
              })}
            </div>
          )}

          <div className="flex justify-end">
            <SubmitButton pendingLabel="Creating…">Create GRN</SubmitButton>
          </div>
        </form>
      )}
    </Disclosure>
  );
}
