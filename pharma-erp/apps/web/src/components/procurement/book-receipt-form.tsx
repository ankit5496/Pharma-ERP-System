'use client';

import { useState } from 'react';
import { type PurchaseOrderListItem } from '@pharma-erp/types';

import { createGoodsReceiptAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, Field, SubmitButton, useAction } from './form-kit';

/**
 * Books a goods receipt against an open purchase order.
 *
 * The form is generated from the chosen order's outstanding lines, so a
 * receipt can only ever be booked against something actually on order. Lines
 * left blank are skipped — a delivery rarely covers a whole order, and forcing
 * a zero onto the others would post movements that never happened.
 *
 * Batch fields are marked required for items flagged `requiresBatchTracking`.
 * The browser check is a courtesy; the API enforces the same rule against the
 * item record and refuses the receipt without it.
 */
export function BookReceiptForm({ orders }: { orders: readonly PurchaseOrderListItem[] }) {
  const [state, formAction] = useAction(createGoodsReceiptAction);
  const [orderId, setOrderId] = useState(orders[0]?.id ?? '');

  const order = orders.find((candidate) => candidate.id === orderId) ?? orders[0];

  // Fully received lines are dropped: there is nothing left to receive on them
  // and the API would refuse an over-receipt anyway.
  const openLines = order?.lines.filter((line) => line.quantityPending !== '0') ?? [];

  return (
    <form action={formAction} className="space-y-4">
      <ActionMessage state={state} />

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
                  Pending
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Received
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
                      {line.quantityPending} {line.item.uom}
                    </td>

                    <td className="px-3 py-2">
                      <label className="sr-only" htmlFor={`recv-${line.id}`}>
                        Quantity received for {line.item.name}
                      </label>
                      <input
                        id={`recv-${line.id}`}
                        name={`quantityReceived_${line.id}`}
                        inputMode="decimal"
                        placeholder="0"
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
        <SubmitButton pendingLabel="Booking…">Book receipt</SubmitButton>
        <p className="text-xs text-slate-500">
          Batch number and expiry are required for batch-tracked items. Received material goes to
          quarantine and cannot be used until incoming QC accepts it.
        </p>
      </div>
    </form>
  );
}
