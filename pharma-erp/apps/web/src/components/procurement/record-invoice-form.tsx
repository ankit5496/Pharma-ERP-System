'use client';

import { useState } from 'react';
import { unitLabel, type PurchaseOrderListItem } from '@pharma-erp/types';

import { createInvoiceAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, Field, SubmitButton, useAction } from './form-kit';

/**
 * Records a vendor invoice against a received purchase order.
 *
 * The lines are pre-filled from the order at the RECEIVED quantity, not the
 * ordered quantity. That is the three-way match made the default: a vendor who
 * shipped 80 of 100 should be billing for 80, and starting from the received
 * figure makes any discrepancy something the person has to deliberately type
 * rather than something they have to notice.
 */
export function RecordInvoiceForm({ orders }: { orders: readonly PurchaseOrderListItem[] }) {
  const [state, formAction] = useAction(createInvoiceAction);
  const [orderId, setOrderId] = useState(orders[0]?.id ?? '');

  const order = orders.find((candidate) => candidate.id === orderId) ?? orders[0];
  const lines = order?.lines ?? [];

  return (
    <form action={formAction} className="space-y-4">
      <ActionMessage state={state} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Purchase order" htmlFor="inv-order" required className="sm:col-span-2">
          <select
            id="inv-order"
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

        <Field
          label="Match to GRN"
          htmlFor="inv-grn"
          hint={order?.goodsReceipts.length === 0 ? 'No receipts on this order yet.' : undefined}
        >
          <select id="inv-grn" name="goodsReceiptId" className="field-sm w-full" defaultValue="">
            <option value="">Not matched</option>
            {order?.goodsReceipts.map((grn) => (
              <option key={grn.id} value={grn.id}>
                {grn.number} ({grn.receiptDate.slice(0, 10)})
              </option>
            ))}
          </select>
        </Field>

        <Field label="Vendor invoice no." htmlFor="inv-number" required>
          <input
            id="inv-number"
            name="vendorInvoiceNumber"
            required
            maxLength={64}
            defaultValue={state.values?.vendorInvoiceNumber ?? ''}
            className="field-sm w-full"
          />
        </Field>

        <Field label="Invoice date" htmlFor="inv-date" required>
          <input
            id="inv-date"
            name="invoiceDate"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="field-sm w-full"
          />
        </Field>

        <Field label="Notes" htmlFor="inv-notes" className="sm:col-span-3">
          <input id="inv-notes" name="notes" maxLength={1000} className="field-sm w-full" />
        </Field>
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-slate-600">This order has no lines.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full min-w-[44rem] text-left text-xs">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
                <th scope="col" className="px-3 py-2 font-medium">
                  Item
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Ordered
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Received
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Billed qty
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Rate
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  GST %
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line, index) => (
                <tr key={line.id}>
                  <td className="px-3 py-2">
                    <input type="hidden" name="lineItemId" value={line.item.id} />
                    <span className="font-medium text-slate-800">{line.item.name}</span>
                    <span className="ml-2 font-mono text-[11px] text-slate-500">
                      {line.item.code}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {line.quantity} {unitLabel(line.item.uom)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                    {line.quantityReceived}
                  </td>
                  <td className="px-3 py-2">
                    <label className="sr-only" htmlFor={`inv-qty-${index}`}>
                      Billed quantity for {line.item.name}
                    </label>
                    <input
                      id={`inv-qty-${index}`}
                      name={`quantity_${index}`}
                      inputMode="decimal"
                      defaultValue={line.quantityReceived}
                      className="field-sm w-24"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <label className="sr-only" htmlFor={`inv-rate-${index}`}>
                      Rate for {line.item.name}
                    </label>
                    <input
                      id={`inv-rate-${index}`}
                      name={`rate_${index}`}
                      inputMode="decimal"
                      defaultValue={line.rate}
                      className="field-sm w-24"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <label className="sr-only" htmlFor={`inv-tax-${index}`}>
                      GST percent for {line.item.name}
                    </label>
                    <input
                      id={`inv-tax-${index}`}
                      name={`taxRatePercent_${index}`}
                      inputMode="decimal"
                      defaultValue={line.taxRatePercent}
                      className="field-sm w-20"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Recording…">Record invoice</SubmitButton>
        <p className="text-xs text-slate-500">
          Quantities default to what was received. The invoice is created as a draft; approve it to
          put it on the payables ledger.
        </p>
      </div>
    </form>
  );
}
