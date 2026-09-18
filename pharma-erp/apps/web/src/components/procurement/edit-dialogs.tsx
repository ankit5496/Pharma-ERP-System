'use client';

import { PURCHASE_ORDER_STATUS_LABELS } from '@pharma-erp/types';
import type {
  GoodsReceiptListItem,
  PartySummary,
  PurchaseInvoiceListItem,
  PurchaseOrderListItem,
  PurchaseOrderStatus,
  RequisitionListItem,
  VendorPaymentItem,
} from '@pharma-erp/types';

import {
  updateGoodsReceiptAction,
  updateInvoiceAction,
  updatePaymentAction,
  updatePurchaseOrderAction,
  updateRequisitionAction,
} from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, Disclosure, Field, SubmitButton, useAction } from './form-kit';
import { noWheelChange } from '@/lib/number-input';

/**
 * The Edit dialog for every Procure-to-Pay document that has one.
 *
 * WHAT IS EDITABLE IS DECIDED BY THE API, NOT BY THIS FILE, and each document
 * draws a different line:
 *
 *  - A REQUISITION, while it is still Open. Past that it has been approved or
 *    turned into an order, and changing what was asked for would rewrite what
 *    somebody agreed to.
 *  - A PURCHASE ORDER — its terms while it is a draft or open, its STATUS at
 *    any stage the transition rules allow. A partially received order must
 *    still be closable.
 *  - A GOODS RECEIPT — the paperwork only. The quantities created batches and
 *    wrote to the append-only stock ledger; re-typing one would leave the
 *    ledger describing a delivery that never happened. A wrong quantity is
 *    corrected by receiving the difference or rejecting the batch at QC.
 *  - AN INVOICE — what was transcribed from the vendor's document. Not the
 *    amounts: those were matched against the order and the receipt, and editing
 *    a total by hand breaks that match silently.
 *  - A PAYMENT — how it was recorded, never how much. The amount decides what
 *    the vendor is still owed; money sent in error is corrected by another
 *    payment, not by editing the record of the first.
 *
 * INCOMING QC HAS NO EDIT ACTION, and that one is not a judgement call: the
 * `qc_results` table carries an append-only trigger, so an UPDATE is refused by
 * the database itself. The decision, who made it and when are the record an
 * inspector asks for. A wrong decision is superseded by a new one.
 *
 * EVERY DIALOG REUSES THE SHARED FORM KIT rather than restating a create form:
 * the fields are the subset the API accepts, prefilled from the record, and a
 * rejected save keeps the dialog open with what was typed still in it.
 */

/**
 * Lets a row's Actions menu own the open/closed state of a dialog.
 *
 * Optional throughout: a dialog with neither prop keeps its own trigger button,
 * which is still how the create forms and the payment row work.
 */
interface DialogControl {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Requisition statuses the API will still accept an edit on. */
const REQUISITION_EDITABLE = ['OPEN'] as const;

export function EditRequisitionButton({
  requisition,
  vendors,
  isOpen,
  onOpenChange,
}: {
  requisition: RequisitionListItem;
  vendors: readonly PartySummary[];
} & DialogControl) {
  const [state, formAction] = useAction(updateRequisitionAction);

  // Nothing is drawn at all once the requisition has moved on. A disabled
  // button that explains itself is better than an error, but a row already
  // carries a status saying exactly this, so a second copy is noise.
  if (!REQUISITION_EDITABLE.includes(requisition.status as (typeof REQUISITION_EDITABLE)[number])) {
    return null;
  }

  // Whatever was typed on a rejected attempt, then the stored value. In that
  // order: a refusal must not throw away the correction just made.
  const typed = (field: string, stored: string | null) => state.values?.[field] ?? stored ?? '';

  return (
    <Disclosure
      label="Edit"
      title="Edit requisition"
      subtitle={`${requisition.number} — ${requisition.item.name}`}
      closeWhen={state.status === 'success'}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      width="34rem"
    >
      {() => (
        <form action={formAction} className="space-y-4">
          <ActionMessage state={state} />

          <input type="hidden" name="id" value={requisition.id} />

          {/* Shown, not editable. The item a requisition is for is what it IS;
              changing it would rewrite the document rather than correct it. */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Item</dt>
              <dd className="mt-0.5 text-slate-800">{requisition.item.name}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Code</dt>
              <dd className="mt-0.5 font-mono text-slate-800">{requisition.item.code}</dd>
            </div>
          </dl>

          <Field label="Requested quantity" htmlFor={`rq-${requisition.id}`} required>
            <input
              id={`rq-${requisition.id}`}
              name="requiredQuantity"
              type="text"
              inputMode="decimal"
              required
              defaultValue={typed('requiredQuantity', requisition.requiredQuantity)}
              className="field"
            />
          </Field>

          <Field label="Preferred vendor" htmlFor={`rv-${requisition.id}`}>
            <select
              id={`rv-${requisition.id}`}
              name="preferredVendorId"
              defaultValue={typed('preferredVendorId', requisition.preferredVendor?.id ?? null)}
              className="field"
            >
              <option value="">No preference</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Required by" htmlFor={`rd-${requisition.id}`}>
            <input
              id={`rd-${requisition.id}`}
              name="requiredByDate"
              type="date"
              defaultValue={typed(
                'requiredByDate',
                requisition.requiredByDate?.slice(0, 10) ?? null,
              )}
              className="field"
            />
          </Field>

          <Field label="Notes" htmlFor={`rn-${requisition.id}`}>
            <textarea
              id={`rn-${requisition.id}`}
              name="notes"
              rows={3}
              defaultValue={typed('notes', requisition.notes)}
              className="field"
            />
          </Field>

          <div className="flex justify-end">
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          </div>
        </form>
      )}
    </Disclosure>
  );
}

/** Listed in workflow order, which is how a reader expects to scan them. */
const PURCHASE_ORDER_STATUSES_IN_ORDER: readonly PurchaseOrderStatus[] = [
  'DRAFT',
  'OPEN',
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'CLOSED',
  'CANCELLED',
];

export function EditPurchaseOrderButton({
  order,
  isOpen,
  onOpenChange,
}: { order: PurchaseOrderListItem } & DialogControl) {
  const [state, formAction] = useAction(updatePurchaseOrderAction);

  // IT OPENS FOR EVERY ORDER, including ones whose terms are settled. The
  // status is edited here now — a partially received order must still be
  // closable, and a live one cancellable — so refusing to open the dialog past
  // OPEN would leave those orders with no way to change at all. The fields
  // below go read-only instead, which says the same thing in the right place.
  const termsEditable = order.status === 'DRAFT' || order.status === 'OPEN';

  const typed = (field: string, stored: string | null) => state.values?.[field] ?? stored ?? '';

  // Mirrors ALLOWED_TRANSITIONS in purchase-orders.service.ts. The server list
  // is the one that decides; this only decides what to draw.
  const blockedBecause = (status: PurchaseOrderStatus): string | null => {
    if (status === order.status) return null;

    switch (status) {
      case 'APPROVED':
        return order.status === 'OPEN' ? null : 'Only an open order can be approved.';
      case 'OPEN':
        return order.status === 'APPROVED' ? null : 'Set from what has been received.';
      case 'DRAFT':
        return 'Set when the order is saved as a draft.';
      case 'PARTIALLY_RECEIVED':
        return 'Set automatically when material is received.';
      // Both always available: closing early is a judgement the buyer is
      // entitled to make, and it does not lock the order out of receiving.
      case 'CLOSED':
      case 'CANCELLED':
        return null;
      default:
        return null;
    }
  };

  return (
    <Disclosure
      label="Edit"
      title="Edit purchase order"
      subtitle={`${order.number} — ${order.vendor.name}`}
      closeWhen={state.status === 'success'}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      width="34rem"
    >
      {() => (
        <form action={formAction} className="space-y-4">
          <ActionMessage state={state} />

          <input type="hidden" name="id" value={order.id} />

          {/* Read-only, and shown rather than omitted: the order number and the
              requisition behind it are what identify this record, and a form
              that hides them is a form you cannot be sure you are editing the
              right thing in. */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">PO number</dt>
              <dd className="mt-0.5 font-mono text-slate-800">{order.number}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Vendor</dt>
              <dd className="mt-0.5 text-slate-800">{order.vendor.name}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Requisitions</dt>
              <dd className="mt-0.5 font-mono text-slate-800">
                {order.lines
                  .map((line) => line.requisition?.number)
                  .filter(Boolean)
                  .join(', ') || '—'}
              </dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Order total</dt>
              <dd className="mt-0.5 tabular-nums text-slate-800">{order.totalAmount}</dd>
            </div>
          </dl>

          {/* THE STATUS LIVES HERE NOW, not in a second control on the row. All
              six are listed with the unreachable ones disabled and the reason
              attached: that makes it read as a status field rather than a menu
              of actions, and answers "why not?" in place. */}
          <Field label="Status" htmlFor={`edit-po-status-${order.id}`}>
            <select
              id={`edit-po-status-${order.id}`}
              name="status"
              defaultValue={typed('status', order.status)}
              className="field"
            >
              {PURCHASE_ORDER_STATUSES_IN_ORDER.map((status) => {
                const blocked = blockedBecause(status);

                return (
                  <option
                    key={status}
                    value={status}
                    disabled={blocked !== null}
                    title={blocked ?? PURCHASE_ORDER_STATUS_LABELS[status]}
                  >
                    {PURCHASE_ORDER_STATUS_LABELS[status]}
                  </option>
                );
              })}
            </select>
          </Field>

          {/* The lines are not here. What is on order is what a vendor agreed
              to supply; the terms below are what gets renegotiated. */}
          <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            {order.lines.length} line{order.lines.length === 1 ? '' : 's'} on this order. To change
            what is being bought, raise a new order — a line already received against cannot be
            rewritten without making the receipt untrue.
            {!termsEditable && (
              <>
                {' '}
                The terms below are read-only because this order has been received against; the
                status above can still be changed.
              </>
            )}
          </p>

          <Field label="Expected delivery" htmlFor={`od-${order.id}`}>
            <input
              id={`od-${order.id}`}
              name="expectedDeliveryDate"
              disabled={!termsEditable}
              type="date"
              defaultValue={typed(
                'expectedDeliveryDate',
                order.expectedDeliveryDate?.slice(0, 10) ?? null,
              )}
              className="field"
            />
          </Field>

          <Field
            label="Payment terms (days)"
            htmlFor={`op-${order.id}`}
            hint="Days from the invoice date. Leave as it is to keep the current terms."
          >
            <input
              id={`op-${order.id}`}
              name="paymentTermsDays"
              disabled={!termsEditable}
              type="number"
              min={0}
              max={365}
              {...noWheelChange}
              defaultValue={typed('paymentTermsDays', String(order.paymentTermsDays))}
              className="field"
            />
          </Field>

          <Field label="Notes" htmlFor={`on-${order.id}`}>
            <textarea
              id={`on-${order.id}`}
              name="notes"
              disabled={!termsEditable}
              rows={3}
              defaultValue={typed('notes', order.notes)}
              className="field"
            />
          </Field>

          <div className="flex justify-end">
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          </div>
        </form>
      )}
    </Disclosure>
  );
}

export function EditGoodsReceiptButton({
  receipt,
  isOpen,
  onOpenChange,
}: { receipt: GoodsReceiptListItem } & DialogControl) {
  const [state, formAction] = useAction(updateGoodsReceiptAction);

  const typed = (field: string, stored: string | null) => state.values?.[field] ?? stored ?? '';

  return (
    <Disclosure
      label="Edit"
      title="Edit goods receipt"
      subtitle={`${receipt.number} — ${receipt.vendor.name}`}
      closeWhen={state.status === 'success'}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      width="34rem"
    >
      {() => (
        <form action={formAction} className="space-y-4">
          <ActionMessage state={state} />

          <input type="hidden" name="id" value={receipt.id} />

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">GRN number</dt>
              <dd className="mt-0.5 font-mono text-slate-800">{receipt.number}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Purchase order</dt>
              <dd className="mt-0.5 font-mono text-slate-800">{receipt.purchaseOrder.number}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Vendor</dt>
              <dd className="mt-0.5 text-slate-800">{receipt.vendor.name}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Received by</dt>
              <dd className="mt-0.5 text-slate-800">{receipt.receivedBy ?? '—'}</dd>
            </div>
          </dl>

          {/* Why the quantities are absent, said once where somebody looking
              for them will be. */}
          <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            {receipt.lines.length} line{receipt.lines.length === 1 ? '' : 's'}, already batched and
            posted to stock. To correct a quantity, receive the difference against the order or
            reject the batch at incoming QC — the stock ledger cannot be rewritten.
          </p>

          <Field label="Receipt date" htmlFor={`grn-date-${receipt.id}`}>
            <input
              id={`grn-date-${receipt.id}`}
              name="receiptDate"
              type="date"
              defaultValue={typed('receiptDate', receipt.receiptDate.slice(0, 10))}
              className="field"
            />
          </Field>

          <Field label="Vendor document no." htmlFor={`grn-doc-${receipt.id}`}>
            <input
              id={`grn-doc-${receipt.id}`}
              name="vendorDocumentNumber"
              maxLength={64}
              placeholder="Delivery note / invoice ref"
              defaultValue={typed('vendorDocumentNumber', receipt.vendorDocumentNumber)}
              className="field"
            />
          </Field>

          <Field label="Remarks" htmlFor={`grn-rem-${receipt.id}`}>
            <textarea
              id={`grn-rem-${receipt.id}`}
              name="remarks"
              rows={3}
              maxLength={1000}
              defaultValue={typed('remarks', receipt.remarks)}
              className="field"
            />
          </Field>

          <div className="flex justify-end">
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          </div>
        </form>
      )}
    </Disclosure>
  );
}

export function EditInvoiceButton({
  invoice,
  isOpen,
  onOpenChange,
}: { invoice: PurchaseInvoiceListItem } & DialogControl) {
  const [state, formAction] = useAction(updateInvoiceAction);

  // The API refuses a cancelled invoice, so the button is not offered on one.
  // The row already shows the status, which is the explanation.
  if (invoice.status === 'CANCELLED') return null;

  const typed = (field: string, stored: string | null) => state.values?.[field] ?? stored ?? '';

  return (
    <Disclosure
      label="Edit"
      title="Edit invoice"
      subtitle={`${invoice.number} — ${invoice.vendor.name}`}
      closeWhen={state.status === 'success'}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      width="34rem"
    >
      {() => (
        <form action={formAction} className="space-y-4">
          <ActionMessage state={state} />

          <input type="hidden" name="id" value={invoice.id} />

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Invoice no.</dt>
              <dd className="mt-0.5 font-mono text-slate-800">{invoice.number}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Goods receipt</dt>
              <dd className="mt-0.5 font-mono text-slate-800">{invoice.goodsReceipt.number}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Purchase order</dt>
              <dd className="mt-0.5 font-mono text-slate-800">{invoice.purchaseOrder.number}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Total</dt>
              <dd className="mt-0.5 tabular-nums text-slate-800">{invoice.totalAmount}</dd>
            </div>
          </dl>

          <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            The amounts came from matching this invoice against the order and the receipt, so they
            are not editable here. If the vendor billed a different figure, cancel this invoice and
            book the one they actually sent.
          </p>

          <Field label="Vendor invoice no." htmlFor={`inv-ref-${invoice.id}`} required>
            <input
              id={`inv-ref-${invoice.id}`}
              name="vendorInvoiceNumber"
              maxLength={64}
              required
              defaultValue={typed('vendorInvoiceNumber', invoice.vendorInvoiceNumber)}
              className="field"
            />
          </Field>

          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <Field label="Invoice date" htmlFor={`inv-date-${invoice.id}`}>
              <input
                id={`inv-date-${invoice.id}`}
                name="invoiceDate"
                type="date"
                defaultValue={typed('invoiceDate', invoice.invoiceDate.slice(0, 10))}
                className="field"
              />
            </Field>

            <Field
              label="Due date"
              htmlFor={`inv-due-${invoice.id}`}
              hint="Decides where this sits on the payables ageing."
            >
              <input
                id={`inv-due-${invoice.id}`}
                name="dueDate"
                type="date"
                defaultValue={typed('dueDate', invoice.dueDate.slice(0, 10))}
                className="field"
              />
            </Field>
          </div>

          <Field label="Notes" htmlFor={`inv-notes-${invoice.id}`}>
            <textarea
              id={`inv-notes-${invoice.id}`}
              name="notes"
              rows={3}
              maxLength={1000}
              defaultValue={typed('notes', invoice.notes)}
              className="field"
            />
          </Field>

          <div className="flex justify-end">
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          </div>
        </form>
      )}
    </Disclosure>
  );
}

export function EditPaymentButton({
  payment,
  isOpen,
  onOpenChange,
}: { payment: VendorPaymentItem } & DialogControl) {
  const [state, formAction] = useAction(updatePaymentAction);

  const typed = (field: string, stored: string | null) => state.values?.[field] ?? stored ?? '';

  return (
    <Disclosure
      label="Edit"
      title="Edit payment"
      subtitle={`${payment.number} — ${payment.amount}`}
      closeWhen={state.status === 'success'}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      width="32rem"
    >
      {() => (
        <form action={formAction} className="space-y-4">
          <ActionMessage state={state} />

          <input type="hidden" name="id" value={payment.id} />

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Payment no.</dt>
              <dd className="mt-0.5 font-mono text-slate-800">{payment.number}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Amount</dt>
              <dd className="mt-0.5 tabular-nums text-slate-800">{payment.amount}</dd>
            </div>
          </dl>

          <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            The amount is not editable: it decides what this vendor is still owed. Correct a wrong
            payment by recording another one.
          </p>

          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <Field label="Payment date" htmlFor={`pay-date-${payment.id}`}>
              <input
                id={`pay-date-${payment.id}`}
                name="paymentDate"
                type="date"
                defaultValue={typed('paymentDate', payment.paymentDate.slice(0, 10))}
                className="field"
              />
            </Field>

            <Field label="Method" htmlFor={`pay-method-${payment.id}`}>
              <input
                id={`pay-method-${payment.id}`}
                name="method"
                maxLength={32}
                placeholder="NEFT / RTGS / cheque"
                defaultValue={typed('method', payment.method)}
                className="field"
              />
            </Field>
          </div>

          <Field
            label="Reference"
            htmlFor={`pay-ref-${payment.id}`}
            hint="How this payment is matched against the bank statement."
          >
            <input
              id={`pay-ref-${payment.id}`}
              name="reference"
              maxLength={64}
              defaultValue={typed('reference', payment.reference)}
              className="field"
            />
          </Field>

          <Field label="Notes" htmlFor={`pay-notes-${payment.id}`}>
            <textarea
              id={`pay-notes-${payment.id}`}
              name="notes"
              rows={3}
              maxLength={500}
              defaultValue={typed('notes', payment.notes)}
              className="field"
            />
          </Field>

          <div className="flex justify-end">
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          </div>
        </form>
      )}
    </Disclosure>
  );
}
