'use client';

import {
  formatUom,
  PAYMENT_STATUS_LABELS,
  PURCHASE_INVOICE_STATUS_LABELS,
  PURCHASE_ORDER_STATUS_LABELS,
} from '@pharma-erp/types';
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

import { useState } from 'react';

import {
  ActionMessage,
  Disclosure,
  Field,
  FormFooter,
  SubmitButton,
  useAction,
} from './form-kit';
import { SearchableSelect } from './searchable-select';
import { formatAmount, lineAmounts, sumLineAmounts } from '@/lib/line-amounts';
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
  isOpen,
  onOpenChange,
}: {
  requisition: RequisitionListItem;
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
      {(close) => (
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

          <FormFooter onCancel={close}>
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          </FormFooter>
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
  vendors = [],
  isOpen,
  onOpenChange,
}: {
  order: PurchaseOrderListItem;
  /**
   * The vendors a draft may be switched to. Empty when the caller has none to
   * hand, in which case the vendor stays read-only rather than becoming an
   * empty select that looks broken.
   */
  vendors?: readonly PartySummary[];
} & DialogControl) {
  const [state, formAction] = useAction(updatePurchaseOrderAction);

  // IT OPENS FOR EVERY ORDER, including ones whose terms are settled. The
  // status is edited here now — a partially received order must still be
  // closable, and a live one cancellable — so refusing to open the dialog past
  // OPEN would leave those orders with no way to change at all. The fields
  // below go read-only instead, which says the same thing in the right place.
  const termsEditable = order.status === 'DRAFT' || order.status === 'OPEN';

  /**
   * A DRAFT IS FULLY EDITABLE, because nothing has happened to it yet: no
   * vendor has been sent it, no goods have arrived, nothing has been invoiced.
   * The lines are rewritable here and nowhere else — once the order is placed,
   * a goods receipt can cite a line, and rewriting it would leave that receipt
   * describing quantities the order no longer has. The API draws the line in
   * exactly the same place.
   */
  const isDraft = order.status === 'DRAFT';

  const vendorEditable = termsEditable && vendors.length > 0;

  /**
   * The line figures as they stand in the form.
   *
   * HELD IN STATE SO THE TOTALS CAN FOLLOW THEM. Uncontrolled inputs would be
   * simpler, but then the only way to know a quantity had changed would be to
   * read the DOM, and the totals beside it would sit at whatever the record
   * said when the dialog opened — which is exactly the behaviour being fixed.
   */
  const [figures, setFigures] = useState(() =>
    Object.fromEntries(
      order.lines.map((line) => [
        line.id,
        { quantity: line.quantity, rate: line.rate, taxRatePercent: line.taxRatePercent },
      ]),
    ),
  );

  const setFigure = (lineId: string, field: 'quantity' | 'rate' | 'taxRatePercent', value: string) =>
    setFigures((current) => {
      // Spreading `current[lineId]` straight in would widen every property to
      // optional, because the lookup itself may be undefined. Naming the
      // fallback keeps the shape whole.
      const existing = current[lineId] ?? { quantity: '', rate: '', taxRatePercent: '' };

      return { ...current, [lineId]: { ...existing, [field]: value } };
    });

  /**
   * What each line comes to, and what the order comes to.
   *
   * Computed for a DRAFT only. Past that the figures are fixed and the stored
   * values are the record — recomputing them would risk showing a number that
   * disagrees with what the order was actually placed at, which is worse than
   * showing nothing new.
   */
  /** The figures for a line, falling back to what is stored on it. */
  const figureFor = (line: PurchaseOrderListItem['lines'][number]) =>
    figures[line.id] ?? {
      quantity: line.quantity,
      rate: line.rate,
      taxRatePercent: line.taxRatePercent,
    };

  const previewByLine = new Map(
    order.lines.map((line) => {
      const figure = figureFor(line);

      return [
        line.id,
        isDraft
          ? lineAmounts(figure.quantity, figure.rate, figure.taxRatePercent)
          : {
              taxableAmount: Number(line.taxableAmount),
              taxAmount: Number(line.taxAmount),
              totalAmount: Number(line.totalAmount),
            },
      ] as const;
    }),
  );

  const orderTotal = isDraft
    ? formatAmount(sumLineAmounts([...previewByLine.values()]).totalAmount)
    : order.totalAmount;

  const typed = (field: string, stored: string | null) => state.values?.[field] ?? stored ?? '';

  // The lookup posts through a hidden input, so the chosen vendor is held here.
  // Seeded from the order, or from the last rejected attempt — EDITING MUST NOT
  // LOSE THE VALUE THAT IS ALREADY ON THE RECORD.
  const [vendorId, setVendorId] = useState(typed('vendorId', order.vendor.id));

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
      width="42rem"
    >
      {(close) => (
        <form action={formAction} className="space-y-5">
          <ActionMessage state={state} />

          <input type="hidden" name="id" value={order.id} />

          {/* ONE TWO-COLUMN GRID for the whole form, so every label sits above
              its control and the two columns share a baseline down the dialog.
              A field that needs the full width says so with `sm:col-span-2`
              rather than breaking out of the grid. */}
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {/* THE SETTLED FACTS ARE FIELDS TOO, disabled rather than omitted
                or rendered as a definition list. They read as part of the same
                form — same label, same box, same column — and being greyed is
                what says they are not yours to change here. */}
            <Field label="PO number" htmlFor={`po-num-${order.id}`}>
              <input
                id={`po-num-${order.id}`}
                disabled
                readOnly
                value={order.number}
                className="field font-mono"
              />
            </Field>

            <Field label="Requisitions" htmlFor={`po-req-${order.id}`}>
              <input
                id={`po-req-${order.id}`}
                disabled
                readOnly
                value={
                  order.lines
                    .map((line) => line.requisition?.number)
                    .filter(Boolean)
                    .join(', ') || '—'
                }
                className="field font-mono"
              />
            </Field>

            {vendorEditable ? (
              <Field label="Vendor" htmlFor={`ov-${order.id}`}>
                <SearchableSelect
                  id={`ov-${order.id}`}
                  name="vendorId"
                  options={vendors.map((vendor) => ({
                    value: vendor.id,
                    label: vendor.name,
                    hint: vendor.code,
                  }))}
                  value={vendorId}
                  onChange={setVendorId}
                  emptyLabel="Choose a vendor"
                  className="field"
                />
              </Field>
            ) : (
              <Field label="Vendor" htmlFor={`ov-${order.id}`}>
                <input
                  id={`ov-${order.id}`}
                  disabled
                  readOnly
                  value={order.vendor.name}
                  className="field"
                />
              </Field>
            )}

            {/* THE STATUS LIVES HERE, not in a second control on the row. All
                six are listed with the unreachable ones disabled and the reason
                on the option: that makes it read as a status field rather than
                a menu of actions, and answers "why not?" in place. */}
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

            <Field label="Payment terms (days)" htmlFor={`op-${order.id}`}>
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

            {/* Follows the line figures as they are typed. Disabled, because
                it is arithmetic rather than an input — the server recomputes it
                from the quantities and rates on save, and its answer is the one
                that is stored. */}
            <Field label="Order total" htmlFor={`po-total-${order.id}`}>
              <input
                id={`po-total-${order.id}`}
                disabled
                readOnly
                value={orderTotal}
                className="field tabular-nums"
              />
            </Field>

            <Field label="Notes" htmlFor={`on-${order.id}`} className="sm:col-span-2">
              <textarea
                id={`on-${order.id}`}
                name="notes"
                disabled={!termsEditable}
                rows={3}
                defaultValue={typed('notes', order.notes)}
                className="field"
              />
            </Field>
          </div>

          {/* THE LINES ARE ALWAYS SHOWN, and editable only on a draft. A placed
              line can be cited by a goods receipt, and rewriting it would leave
              that receipt describing quantities the order no longer has — the
              API draws the line in exactly the same place. */}
          {order.lines.map((line) => (
            <fieldset key={line.id} className="rounded-md border border-slate-200 px-4 pb-4">
              <legend className="flex flex-wrap items-center gap-2 px-1.5 text-xs">
                <span className="font-medium text-slate-900">{line.item.name}</span>
                <span className="font-mono text-[11px] text-slate-500">{line.item.code}</span>
                {line.requisition && (
                  <span className="font-mono text-[11px] text-slate-400">
                    {line.requisition.number}
                  </span>
                )}
              </legend>

              {/* THE IDENTITY FIELDS ARE EMITTED ONLY ON A DRAFT, and that is
                  not cosmetic: a hidden input is submitted even when the
                  visible fields beside it are disabled, so leaving these in
                  place would send a `lines` array for a placed order and earn a
                  409 from an API that is right to refuse it. */}
              {isDraft && (
                <>
                  <input type="hidden" name="lineId" value={line.id} />
                  <input type="hidden" name={`itemId_${line.id}`} value={line.item.id} />
                  <input
                    type="hidden"
                    name={`requisitionId_${line.id}`}
                    value={line.requisition?.id ?? ''}
                  />
                </>
              )}

              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                <Field label={`Quantity (${formatUom(line.item.uom)})`} htmlFor={`lq-${line.id}`}>
                  <input
                    id={`lq-${line.id}`}
                    name={`quantity_${line.id}`}
                    disabled={!isDraft}
                    type="number"
                    step="any"
                    min="0"
                    {...noWheelChange}
                    value={figureFor(line).quantity}
                    onChange={(event) => setFigure(line.id, 'quantity', event.target.value)}
                    className="field"
                  />
                </Field>

                <Field label="Rate" htmlFor={`lr-${line.id}`}>
                  <input
                    id={`lr-${line.id}`}
                    name={`rate_${line.id}`}
                    disabled={!isDraft}
                    type="number"
                    step="any"
                    min="0"
                    {...noWheelChange}
                    value={figureFor(line).rate}
                    onChange={(event) => setFigure(line.id, 'rate', event.target.value)}
                    className="field"
                  />
                </Field>

                <Field label="Tax %" htmlFor={`lt-${line.id}`}>
                  <input
                    id={`lt-${line.id}`}
                    name={`taxRatePercent_${line.id}`}
                    disabled={!isDraft}
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    {...noWheelChange}
                    value={figureFor(line).taxRatePercent}
                    onChange={(event) => setFigure(line.id, 'taxRatePercent', event.target.value)}
                    className="field"
                  />
                </Field>

                <Field label="Line total" htmlFor={`ltot-${line.id}`}>
                  <input
                    id={`ltot-${line.id}`}
                    disabled
                    readOnly
                    value={formatAmount(
                      previewByLine.get(line.id)?.totalAmount ?? Number(line.totalAmount),
                    )}
                    className="field tabular-nums"
                  />
                </Field>
              </div>
            </fieldset>
          ))}

          <FormFooter onCancel={close}>
            {/* A DRAFT IS PLACED FROM HERE. The primary button creates the
                actual purchase order out of this draft — it saves whatever
                has been changed and then places it, against the same record,
                so the requisition links on its lines are untouched and no
                second order is made. Keeping it a draft is the other choice,
                and it is the secondary button because placing is what a draft
                is usually opened to do. */}
            {isDraft ? (
              <>
                <SubmitButton
                  variant="secondary"
                  pendingLabel="Saving…"
                  name="placeOrder"
                  value="false"
                >
                  Save as draft
                </SubmitButton>

                <SubmitButton
                  variant="primary"
                  pendingLabel="Creating…"
                  name="placeOrder"
                  value="true"
                >
                  Create purchase order
                </SubmitButton>
              </>
            ) : (
              <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
            )}
          </FormFooter>
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
      width="42rem"
    >
      {(close) => (
        <form action={formAction} className="space-y-5">
          <ActionMessage state={state} />

          <input type="hidden" name="id" value={receipt.id} />

          {/* WHAT THE SYSTEM SETTLED, shown as disabled fields rather than
              omitted: the number it generated, the order the receipt is against
              and the user it was booked by. */}
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <Field label="GRN no." htmlFor={`grn-no-${receipt.id}`}>
              <input
                id={`grn-no-${receipt.id}`}
                disabled
                readOnly
                value={receipt.number}
                className="field font-mono"
              />
            </Field>

            <Field label="Linked PO" htmlFor={`grn-po-${receipt.id}`}>
              <input
                id={`grn-po-${receipt.id}`}
                disabled
                readOnly
                value={receipt.purchaseOrder.number}
                className="field font-mono"
              />
            </Field>

            <Field label="Received by" htmlFor={`grn-by-${receipt.id}`} className="sm:col-span-2">
              <input
                id={`grn-by-${receipt.id}`}
                disabled
                readOnly
                value={receipt.receivedBy ?? '—'}
                className="field"
              />
            </Field>
          </div>

          {/* ONE FIELDSET PER LINE. The item came from the order and the
              quantity created the batch, so both are disabled; the batch number
              and the two dates are transcribed by hand from the delivery note,
              and are the only things here a typo can land on. The API applies
              the same rules it applies at booking and writes each correction to
              the stock lot as well. */}
          {receipt.lines.map((line) => (
            <fieldset key={line.id} className="rounded-md border border-slate-200 px-4 pb-4">
              <input type="hidden" name="lineId" value={line.id} />

              <legend className="flex flex-wrap items-center gap-2 px-1.5 text-xs">
                <span className="font-medium text-slate-900">{line.item.name}</span>
                <span className="font-mono text-[11px] text-slate-500">{line.item.code}</span>
              </legend>

              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                <Field label="Item" htmlFor={`gl-item-${line.id}`}>
                  <input
                    id={`gl-item-${line.id}`}
                    disabled
                    readOnly
                    value={line.item.name}
                    className="field"
                  />
                </Field>

                <Field
                  label={`Received quantity (${formatUom(line.item.uom)})`}
                  htmlFor={`gl-rec-${line.id}`}
                >
                  <input
                    id={`gl-rec-${line.id}`}
                    disabled
                    readOnly
                    value={line.quantityReceived}
                    className="field tabular-nums"
                  />
                </Field>

                <Field
                  label="Batch / lot no."
                  htmlFor={`gl-batch-${line.id}`}
                  required
                  className="sm:col-span-2"
                >
                  <input
                    id={`gl-batch-${line.id}`}
                    name={`vendorBatchNumber_${line.id}`}
                    maxLength={64}
                    defaultValue={typed(`vendorBatchNumber_${line.id}`, line.vendorBatchNumber)}
                    className="field font-mono"
                  />
                </Field>

                <Field label="Manufacturing date" htmlFor={`gl-mfg-${line.id}`} required>
                  <input
                    id={`gl-mfg-${line.id}`}
                    name={`manufacturingDate_${line.id}`}
                    type="date"
                    defaultValue={typed(`manufacturingDate_${line.id}`, line.manufacturingDate)}
                    className="field"
                  />
                </Field>

                <Field label="Expiry date" htmlFor={`gl-exp-${line.id}`} required>
                  <input
                    id={`gl-exp-${line.id}`}
                    name={`expiryDate_${line.id}`}
                    type="date"
                    defaultValue={typed(`expiryDate_${line.id}`, line.expiryDate)}
                    className="field"
                  />
                </Field>
              </div>
            </fieldset>
          ))}

          <FormFooter onCancel={close}>
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          </FormFooter>
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
      width="46rem"
    >
      {(close) => (
        <form action={formAction} className="flex grow flex-col gap-5">
          <ActionMessage state={state} />

          <input type="hidden" name="id" value={invoice.id} />

          {/* ONE TWO-COLUMN GRID, settled facts and editable fields together.
              THE AMOUNTS ARE SHOWN AND DISABLED rather than explained away in a
              paragraph: they came from matching this invoice against the order
              and the receipt, and being greyed says that better than a note. A
              vendor who billed a different figure needs this invoice cancelled
              and the one they actually sent booked. */}
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <Field label="Invoice no." htmlFor={`inv-no-${invoice.id}`}>
              <input
                id={`inv-no-${invoice.id}`}
                disabled
                readOnly
                value={invoice.number}
                className="field font-mono"
              />
            </Field>

            <Field label="Vendor" htmlFor={`inv-vendor-${invoice.id}`}>
              <input
                id={`inv-vendor-${invoice.id}`}
                disabled
                readOnly
                value={invoice.vendor.name}
                className="field"
              />
            </Field>

            <Field label="Purchase order" htmlFor={`inv-po-${invoice.id}`}>
              <input
                id={`inv-po-${invoice.id}`}
                disabled
                readOnly
                value={invoice.purchaseOrder.number}
                className="field font-mono"
              />
            </Field>

            <Field label="Goods receipt" htmlFor={`inv-grn-${invoice.id}`}>
              <input
                id={`inv-grn-${invoice.id}`}
                disabled
                readOnly
                value={invoice.goodsReceipt.number}
                className="field font-mono"
              />
            </Field>

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

            <Field label="Payment terms (days)" htmlFor={`inv-terms-${invoice.id}`}>
              <input
                id={`inv-terms-${invoice.id}`}
                disabled
                readOnly
                value={String(invoice.paymentTermsDays)}
                className="field tabular-nums"
              />
            </Field>

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

            <Field label="Taxable amount" htmlFor={`inv-taxable-${invoice.id}`}>
              <input
                id={`inv-taxable-${invoice.id}`}
                disabled
                readOnly
                value={invoice.taxableAmount}
                className="field tabular-nums"
              />
            </Field>

            <Field label="GST" htmlFor={`inv-tax-${invoice.id}`}>
              <input
                id={`inv-tax-${invoice.id}`}
                disabled
                readOnly
                value={invoice.taxAmount}
                className="field tabular-nums"
              />
            </Field>

            <Field label="Invoice total" htmlFor={`inv-total-${invoice.id}`}>
              <input
                id={`inv-total-${invoice.id}`}
                disabled
                readOnly
                value={invoice.totalAmount}
                className="field tabular-nums"
              />
            </Field>

            <Field label="Paid to date" htmlFor={`inv-paid-${invoice.id}`}>
              <input
                id={`inv-paid-${invoice.id}`}
                disabled
                readOnly
                value={invoice.amountPaid}
                className="field tabular-nums"
              />
            </Field>

            <Field label="Outstanding" htmlFor={`inv-out-${invoice.id}`}>
              <input
                id={`inv-out-${invoice.id}`}
                disabled
                readOnly
                value={invoice.outstandingAmount}
                className="field tabular-nums"
              />
            </Field>

            <Field label="Status" htmlFor={`inv-status-${invoice.id}`}>
              <input
                id={`inv-status-${invoice.id}`}
                disabled
                readOnly
                value={`${PURCHASE_INVOICE_STATUS_LABELS[invoice.status]} · ${
                  PAYMENT_STATUS_LABELS[invoice.paymentStatus]
                }`}
                className="field"
              />
            </Field>

            <Field label="Recorded by" htmlFor={`inv-by-${invoice.id}`}>
              <input
                id={`inv-by-${invoice.id}`}
                disabled
                readOnly
                value={invoice.recordedBy ?? '—'}
                className="field"
              />
            </Field>

            <Field label="Lines billed" htmlFor={`inv-lines-${invoice.id}`}>
              <input
                id={`inv-lines-${invoice.id}`}
                disabled
                readOnly
                value={`${invoice.lines.length}${
                  invoice.toleranceExceeded ? ' — outside tolerance' : ''
                }`}
                className="field"
              />
            </Field>

            <Field label="Notes" htmlFor={`inv-notes-${invoice.id}`} className="sm:col-span-2">
              <textarea
                id={`inv-notes-${invoice.id}`}
                name="notes"
                rows={3}
                maxLength={1000}
                defaultValue={typed('notes', invoice.notes)}
                className="field"
              />
            </Field>

            {/* Only when there is something to say: which lines differed from
                the order or the receipt, and by how much. */}
            {invoice.matchNotes && (
              <Field
                label="Three-way match"
                htmlFor={`inv-match-${invoice.id}`}
                className="sm:col-span-2"
              >
                <textarea
                  id={`inv-match-${invoice.id}`}
                  disabled
                  readOnly
                  rows={2}
                  value={invoice.matchNotes}
                  className="field"
                />
              </Field>
            )}
          </div>

          <FormFooter onCancel={close}>
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          </FormFooter>
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
      width="42rem"
    >
      {(close) => (
        <form action={formAction} className="flex grow flex-col gap-5">
          <ActionMessage state={state} />

          <input type="hidden" name="id" value={payment.id} />

          {/* ONE TWO-COLUMN GRID, settled facts and editable fields together.
              THE AMOUNT IS SHOWN AND DISABLED: it decides what this vendor is
              still owed, and a wrong payment is corrected by recording another
              one rather than by re-typing this. */}
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <Field label="Payment no." htmlFor={`pay-no-${payment.id}`}>
              <input
                id={`pay-no-${payment.id}`}
                disabled
                readOnly
                value={payment.number}
                className="field font-mono"
              />
            </Field>

            <Field label="Amount" htmlFor={`pay-amt-${payment.id}`}>
              <input
                id={`pay-amt-${payment.id}`}
                disabled
                readOnly
                value={payment.amount}
                className="field tabular-nums"
              />
            </Field>

            <Field label="Recorded by" htmlFor={`pay-by-${payment.id}`}>
              <input
                id={`pay-by-${payment.id}`}
                disabled
                readOnly
                value={payment.recordedBy ?? '—'}
                className="field"
              />
            </Field>

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

            <Field
              label="Notes"
              htmlFor={`pay-notes-${payment.id}`}
              className="sm:col-span-2"
            >
              <textarea
                id={`pay-notes-${payment.id}`}
                name="notes"
                rows={3}
                maxLength={500}
                defaultValue={typed('notes', payment.notes)}
                className="field"
              />
            </Field>
          </div>

          <FormFooter onCancel={close}>
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          </FormFooter>
        </form>
      )}
    </Disclosure>
  );
}
