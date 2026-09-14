'use client';

import { useState } from 'react';
import { type PurchaseOrderListItem } from '@pharma-erp/types';

import { createGoodsReceiptAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, Field, SubmitButton, useAction } from './form-kit';

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
                {candidate.number} — {candidate.vendor.name}
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
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full min-w-[60rem] text-left text-xs">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
                <th scope="col" className="px-3 py-2 font-medium">
                  Item
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  PO qty
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Already received
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Remaining
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Receiving now
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Rejected at gate
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Vendor batch no.
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Mfg date
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Expiry date
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Location
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {openLines.map((line) => {
                const tracked = line.item.requiresBatchTracking;

                return (
                  <tr key={line.id}>
                    <td className="px-3 py-2">
                      <input type="hidden" name="lineId" value={line.id} />
                      <span className="font-medium text-slate-800">{line.item.name}</span>
                      <span className="ml-2 font-mono text-[11px] text-slate-500">
                        {line.item.code}
                      </span>
                      {tracked && (
                        <span className="ml-2 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-900">
                          batch tracked
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {line.quantity} {line.item.uom}
                    </td>

                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {line.quantityReceived === '0' ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        `${line.quantityReceived} ${line.item.uom}`
                      )}
                    </td>

                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                      {line.quantityPending} {line.item.uom}
                    </td>

                    <td className="px-3 py-2">
                      <label className="sr-only" htmlFor={`recv-${line.id}`}>
                        Quantity received for {line.item.name}
                      </label>
                      {/* `max` is the remaining quantity, so the browser
                          refuses an over-receipt before a round trip. The API
                          checks the same thing against the live figure, which
                          is what counts when two people receive at once. */}
                      <input
                        id={`recv-${line.id}`}
                        name={`quantityReceived_${line.id}`}
                        type="number"
                        step="any"
                        min="0"
                        max={line.quantityPending}
                        placeholder="0"
                        title={`At most ${line.quantityPending} ${line.item.uom} remain on this line.`}
                        className="field-sm w-24"
                      />
                    </td>

                    <td className="px-3 py-2">
                      <label className="sr-only" htmlFor={`rej-${line.id}`}>
                        Quantity rejected at gate for {line.item.name}
                      </label>
                      <input
                        id={`rej-${line.id}`}
                        name={`quantityRejected_${line.id}`}
                        inputMode="decimal"
                        placeholder="0"
                        className="field-sm w-20"
                      />
                    </td>

                    <td className="px-3 py-2">
                      <label className="sr-only" htmlFor={`batch-${line.id}`}>
                        Vendor batch number for {line.item.name}
                      </label>
                      <input
                        id={`batch-${line.id}`}
                        name={`vendorBatchNumber_${line.id}`}
                        maxLength={64}
                        className="field-sm w-32"
                      />
                    </td>

                    <td className="px-3 py-2">
                      <label className="sr-only" htmlFor={`mfg-${line.id}`}>
                        Manufacturing date for {line.item.name}
                      </label>
                      <input
                        id={`mfg-${line.id}`}
                        name={`manufacturingDate_${line.id}`}
                        type="date"
                        className="field-sm"
                      />
                    </td>

                    <td className="px-3 py-2">
                      <label className="sr-only" htmlFor={`exp-${line.id}`}>
                        Expiry date for {line.item.name}
                      </label>
                      <input
                        id={`exp-${line.id}`}
                        name={`expiryDate_${line.id}`}
                        type="date"
                        className="field-sm"
                      />
                    </td>

                    <td className="px-3 py-2">
                      <label className="sr-only" htmlFor={`loc-${line.id}`}>
                        Storage location for {line.item.name}
                      </label>
                      <input
                        id={`loc-${line.id}`}
                        name={`storageLocation_${line.id}`}
                        maxLength={128}
                        placeholder="Store A"
                        className="field-sm w-24"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Creating…">Create GRN</SubmitButton>
        <p className="text-xs text-slate-500">
          Batch number and expiry are required for batch-tracked items. Received material goes to
          quarantine and cannot be used until incoming QC accepts it.
        </p>
      </div>
    </form>
  );
}
