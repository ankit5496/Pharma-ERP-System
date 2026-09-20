'use client';

import { useState } from 'react';
import { type PurchaseOrderListItem } from '@pharma-erp/types';

import { createInvoiceAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, Disclosure, Field, FormFooter, SubmitButton, useAction } from './form-kit';
import { SearchableSelect } from './searchable-select';

/**
 * Records a vendor invoice against a received purchase order.
 *
 * The lines are pre-filled from the order at the RECEIVED quantity, not the
 * ordered quantity. That is the three-way match made the default: a vendor who
 * shipped 80 of 100 should be billing for 80, and starting from the received
 * figure makes any discrepancy something the person has to deliberately type
 * rather than something they have to notice.
 *
 * IT OPENS IN A DIALOG FROM THE INVOICES SCREEN. A line per order line, each
 * with a quantity and a rate, is a tall form; standing permanently above the
 * list it feeds, it pushed the invoices themselves off the screen on every
 * visit.
 */
export function RecordInvoiceForm({ orders }: { orders: readonly PurchaseOrderListItem[] }) {
  const [state, formAction] = useAction(createInvoiceAction);
  /**
   * NOTHING IS PRESELECTED. The first invoiceable order is not a guess worth
   * making: it is whichever happens to sort first, and an invoice booked
   * against it because nobody noticed the box was already filled is a
   * three-way match against the wrong order.
   */
  const [orderId, setOrderId] = useState('');
  const [receiptId, setReceiptId] = useState('');

  /** Choosing a different order drops the receipt chosen under the old one. */
  const chooseOrder = (next: string) => {
    setOrderId(next);
    setReceiptId('');
  };

  const order = orders.find((candidate) => candidate.id === orderId) ?? null;
  const lines = order?.lines ?? [];

  const orderOptions = orders.map((candidate) => ({
    value: candidate.id,
    label: candidate.number,
    hint: candidate.vendor.name,
  }));

  const receiptOptions = (order?.goodsReceipts ?? []).map((grn) => ({
    value: grn.id,
    label: grn.number,
    hint: grn.receiptDate.slice(0, 10),
  }));

  return (
    <Disclosure
      label="Create Purchase Invoice"
      title="Create purchase invoice"
      closeWhen={state.status === 'success'}
      width="60rem"
      // A floor, not a fixed height: a form with more lines still grows, and
      // 85vh still caps it on a short screen. 36rem rather than 40, with a
      // step taken back off the row padding below: a tenth shorter overall,
      // and no field loses room.
      minHeight="36rem"
    >
      {(close) => (
        <form action={formAction} className="flex grow flex-col gap-5">
          <ActionMessage state={state} />

          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-4">
            {/* Not posted — the API derives the order from the receipt. This is
            a filter for the receipt list below it. */}
            <Field
              label="Purchase order"
              htmlFor="inv-order"
              className="sm:col-span-2"
              hint="Type an order number or a vendor name to find it."
            >
              <SearchableSelect
                id="inv-order"
                options={orderOptions}
                value={orderId}
                onChange={chooseOrder}
                emptyLabel="Select purchase order"
              />
            </Field>

            <Field
              label="Goods receipt"
              htmlFor="inv-grn"
              required
              // The "nothing to invoice" case keeps its hint: it explains why the
              // select below is empty, which is a fact about this order rather than
              // a description of the rules.
              hint={
                !order
                  ? 'Choose a purchase order first.'
                  : order.goodsReceipts.length === 0
                    ? 'No receipts on this order yet — nothing to invoice.'
                    : 'Type a GRN number or a date to find it.'
              }
            >
              <SearchableSelect
                id="inv-grn"
                name="goodsReceiptId"
                options={receiptOptions}
                value={receiptId}
                onChange={setReceiptId}
                required
                emptyLabel="Select goods receipt"
                disabled={!order}
              />
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

          {!order ? (
            <p className="text-sm text-slate-600">
              Choose a purchase order to bill against — its lines appear here, pre-filled at the
              quantity actually received.
            </p>
          ) : lines.length === 0 ? (
            <p className="text-sm text-slate-600">This order has no lines.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Item
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Ordered
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Received
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Billed qty
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Rate
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      GST (from HSN)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((line, index) => (
                    <tr key={line.id}>
                      <td className="px-3 py-2.5">
                        <input type="hidden" name="lineItemId" value={line.item.id} />
                        <span className="font-medium text-slate-800">{line.item.name}</span>
                        <span className="ml-2 font-mono text-[11px] text-slate-500">
                          {line.item.code}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                        {line.quantity} {line.item.uom}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        {line.quantityReceived}
                      </td>
                      <td className="px-3 py-2.5">
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
                      <td className="px-3 py-2.5">
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
                      {/* Read-only, and not posted. GST is computed on the server
                      from the item master's own gstRate; an input here would be
                      a rate the client chose, which is what the brief and the
                      filing rules both rule out. */}
                      <td className="px-3 py-2.5">
                        {line.item.gstRate !== null ? (
                          <span
                            className="text-slate-700"
                            title={`HSN ${line.item.hsnCode ?? 'not set'}`}
                          >
                            {line.item.gstRate}%
                          </span>
                        ) : (
                          <span className="text-red-700" title="Set a GST rate on this item">
                            no GST rate
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <FormFooter onCancel={close}>
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          </FormFooter>
        </form>
      )}
    </Disclosure>
  );
}
