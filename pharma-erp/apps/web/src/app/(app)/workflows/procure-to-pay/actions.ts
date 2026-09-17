'use server';

import {
  PURCHASE_ORDER_STATUS_LABELS,
  type PurchaseOrderStatus,
} from '@pharma-erp/types';

import type { ActionState } from '@/components/procurement/action-state';
import { apiFetch } from '@/lib/api';

/**
 * Server actions for every Procure-to-Pay mutation.
 *
 * All of them share one shape — `ActionState`, defined in ./action-state — so
 * the forms can share one error-rendering component and one submit button.
 * They also share one rule: the action forwards to the API and reports
 * whatever it says. No validation is duplicated here. The API owns the state
 * machines, the batch-tracking rule and the over-receipt check, and a second
 * copy in the browser layer would be the copy that goes out of date.
 *
 * EVERY EXPORT BELOW MUST BE AN ASYNC FUNCTION. Next turns each one into a
 * callable server endpoint, so exporting a constant or an object from here
 * fails at runtime — and it fails on first form submit rather than at build
 * time, which is exactly the sort of bug that reaches a user. Shared values
 * and types belong in ./action-state.
 */

const BASE = '/api/v1/procurement';

/** Reads a trimmed string field; '' when absent. */
function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

/** Reads an optional field, returning undefined rather than an empty string. */
function opt(form: FormData, key: string): string | undefined {
  const value = str(form, key);

  return value.length > 0 ? value : undefined;
}

/**
 * Wraps a POST/PATCH, turning the result into an ActionState.
 *
 * NOTHING IS REVALIDATED HERE, and that is a fix rather than an omission.
 * These actions used to call `revalidatePath` for all six Procure-to-Pay
 * routes. It bought nothing — every fetch in this app is `cache: 'no-store'`
 * and every one of these pages is `force-dynamic`, so there was no cached data
 * to invalidate — and it cost the confirmation message: revalidating the route
 * a form is on makes Next re-render it from the server as part of the action,
 * which discards the action's return value. Every successful save on all six
 * sub-tabs completed correctly and then said nothing at all.
 *
 * The refresh now happens on the client, in `useAction`, where
 * `router.refresh()` re-fetches the server components while preserving React
 * state — so the table updates and the message survives.
 */
async function submit(
  path: string,
  body: unknown,
  successMessage: string,
  values?: Record<string, string>,
  method: 'POST' | 'PATCH' | 'DELETE' = 'POST',
): Promise<ActionState> {
  const result = await apiFetch<unknown>(path, {
    method,
    json: body,
    authenticated: true,
    // LONGER THAN A READ, because giving up early on a write is far worse than
    // waiting. These documents are many statements — allocate the number,
    // insert the header, insert each line, create each batch, post each ledger
    // entry, then recompute the order's status — and every one of them is a
    // network round trip to the database.
    //
    // Booking a goods receipt against the remote database was measured at over
    // 15 seconds, and the old 15s budget produced the worst possible outcome:
    // the browser reported "is the API running?" while the API had in fact
    // created the receipt. A user who believes a save failed will do it again,
    // and the second attempt is a duplicate GRN with duplicate stock.
    //
    // So this is deliberately generous. A slow save is an inconvenience; a
    // phantom failure that invites a double submission is a data problem.
    timeoutMs: 60_000,
  });

  if (!result.ok) {
    return { status: 'error', message: result.error, values };
  }

  return { status: 'success', message: successMessage };
}

/** Runs the reorder check by hand. Idempotent — safe to press twice. */
export async function runReorderCheckAction(
  _previous: ActionState,
  _form: FormData,
): Promise<ActionState> {
  return submit(`${BASE}/reorder-check`, {}, 'Reorder check complete.');
}

// ---------------------------------------------------------------------------
// 1. Requisitions
// ---------------------------------------------------------------------------

/**
 * Creates one purchase requisition, and nothing else.
 *
 * Every id forwarded below is a selection from master data that already
 * exists. This action creates no item, vendor, product or production plan, and
 * the API refuses any id that is not the caller's own company's.
 *
 * What is NOT sent is as deliberate as what is: no number, no date, no
 * requester, no status, no trigger type. The API owns all five — the form only
 * displays what they will be.
 */
export async function createRequisitionAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  // Echoed back on failure so a rejected submit does not empty the form.
  const values = {
    itemId: str(form, 'itemId'),
    requiredQuantity: str(form, 'requiredQuantity'),
    packVariant: str(form, 'packVariant'),
    quantityPerUnit: str(form, 'quantityPerUnit'),
    notes: str(form, 'notes'),
  };

  return submit(
    `${BASE}/requisitions`,
    {
      itemId: values.itemId,
      requiredQuantity: values.requiredQuantity,
      preferredVendorId: opt(form, 'preferredVendorId'),
      requiredByDate: toIsoDate(opt(form, 'requiredByDate')),
      notes: opt(form, 'notes'),
      productionPlanId: opt(form, 'productionPlanId'),

      finishedProductId: opt(form, 'finishedProductId'),
      packVariant: opt(form, 'packVariant'),
      packagingComponentId: opt(form, 'packagingComponentId'),
      packagingLevel: opt(form, 'packagingLevel'),
      quantityPerUnit: opt(form, 'quantityPerUnit'),
      // A <select> yields the string "true"/"false"; the API wants a boolean.
      // Absent means mandatory, which is what the API defaults to anyway.
      isMandatory: opt(form, 'isMandatory') === undefined
        ? undefined
        : str(form, 'isMandatory') === 'true',
    },
    'Purchase requisition created.',
    values,
  );
}

/**
 * Turns automatic low-stock requisition creation on or off for the company.
 *
 * The form posts the value it wants, not a toggle instruction, so pressing it
 * twice quickly cannot leave the setting in whichever state the race happened
 * to produce.
 */
export async function setAutoCreationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const enabled = str(form, 'autoRequisitionEnabled') === 'true';

  return submit(
    `${BASE}/settings`,
    { autoRequisitionEnabled: enabled },
    enabled
      ? 'Auto creation is on. Low stock will raise a requisition automatically.'
      : 'Auto creation is off. Low stock will be reported but raise nothing.',
    undefined,
    'PATCH',
  );
}

export async function changeRequisitionStatusAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = str(form, 'id');
  const status = str(form, 'status');

  return submit(
    `${BASE}/requisitions/${id}/status`,
    { status },
    `Requisition ${status.replace(/_/g, ' ').toLowerCase()}.`,
  );
}

/**
 * Edits an open requisition.
 *
 * ONLY THE FOUR FIELDS THE API WILL ACCEPT: quantity, preferred vendor,
 * required-by date and notes. The item is not among them, and deliberately so —
 * a requisition for a different item is a different requisition, and changing
 * it underneath a purchase order raised from it would rewrite what was agreed
 * with a vendor. The API refuses anything past Open outright.
 *
 * An empty vendor or date is sent as `null`, not omitted: omitting a key means
 * "leave it alone", so clearing a field would silently do nothing.
 */
export async function updateRequisitionAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = str(form, 'id');

  const values = {
    requiredQuantity: str(form, 'requiredQuantity'),
    preferredVendorId: str(form, 'preferredVendorId'),
    requiredByDate: str(form, 'requiredByDate'),
    notes: str(form, 'notes'),
  };

  return submit(
    `${BASE}/requisitions/${id}`,
    {
      requiredQuantity: values.requiredQuantity,
      preferredVendorId: values.preferredVendorId || null,
      requiredByDate: values.requiredByDate || null,
      notes: values.notes || null,
    },
    'Requisition updated.',
    values,
    'PATCH',
  );
}

export async function convertRequisitionAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = str(form, 'id');
  const values = { rate: str(form, 'rate'), taxRatePercent: str(form, 'taxRatePercent') };

  return submit(
    `${BASE}/requisitions/${id}/convert`,
    {
      vendorId: str(form, 'vendorId'),
      rate: values.rate,
      taxRatePercent: values.taxRatePercent || '0',
      expectedDeliveryDate: toIsoDate(opt(form, 'expectedDeliveryDate')),
    },
    'Purchase order raised from this requisition.',
    values,
  );
}

// ---------------------------------------------------------------------------
// 2. Purchase orders
// ---------------------------------------------------------------------------

export async function changePurchaseOrderStatusAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = str(form, 'id');
  const status = str(form, 'status');

  // The shared label, not the raw enum: lower-casing PARTIALLY_RECEIVED gave
  // 'Purchase order partially_received.' — the underscore visible to the user.
  // 'ISSUED' was also special-cased here long after that status was removed.
  const label = PURCHASE_ORDER_STATUS_LABELS[status as PurchaseOrderStatus] ?? status;

  return submit(
    `${BASE}/purchase-orders/${id}/status`,
    { status },
    `Purchase order marked ${label.toLowerCase()}.`,
  );
}

/**
 * Creates a purchase order from an approved requisition.
 *
 * ONE ACTION, TWO OUTCOMES, decided by which button was pressed: a draft that
 * commits to nothing, or a placed order. The browser sends only the pressed
 * button's value, so the choice needs no hidden state.
 *
 * The requisition id travels on every line — that link is what makes the order
 * traceable back to the request that caused it, and the API refuses a line
 * without one.
 */
export async function createPurchaseOrderAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = {
    vendorId: str(form, 'vendorId'),
    quantity: str(form, 'quantity'),
    rate: str(form, 'rate'),
    taxRatePercent: str(form, 'taxRatePercent'),
  };

  const asDraft = str(form, 'saveAsDraft') === 'true';

  return submit(
    `${BASE}/purchase-orders`,
    {
      vendorId: values.vendorId,
      expectedDeliveryDate: toIsoDate(opt(form, 'expectedDeliveryDate')),
      paymentTermsDays: opt(form, 'paymentTermsDays')
        ? Number(str(form, 'paymentTermsDays'))
        : undefined,
      notes: opt(form, 'notes'),
      saveAsDraft: asDraft,
      lines: [
        {
          itemId: str(form, 'itemId'),
          requisitionId: str(form, 'requisitionId'),
          quantity: values.quantity,
          rate: values.rate,
          taxRatePercent: values.taxRatePercent || '0',
        },
      ],
    },
    asDraft
      ? 'Draft purchase order saved. Nothing can be received against it until you place it.'
      : 'Purchase order created.',
    values,
  );
}

/** Places a draft: it becomes a real order and its requisition is converted. */
/**
 * Throws a draft away.
 *
 * Drafts only, and the API enforces that: a placed order is cancelled instead,
 * which leaves it on the record. The row is soft-deleted, like every deletion
 * in this module.
 */
export async function discardDraftPurchaseOrderAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = str(form, 'id');

  return submit(`${BASE}/purchase-orders/${id}`, undefined, 'Draft discarded.', undefined, 'DELETE');
}

export async function submitDraftPurchaseOrderAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = str(form, 'id');

  return submit(
    `${BASE}/purchase-orders/${id}/submit`,
    {},
    'Purchase order placed. The requisition behind it is now marked converted.',
  );
}

/**
 * Edits a purchase order that has not yet been received against.
 *
 * THE LINES ARE NOT TOUCHED HERE. The API accepts wholesale line replacement on
 * a draft, but doing it from this form would mean rebuilding every line from
 * scratch on each save, and a line already carrying a goods receipt cannot be
 * deleted at all — the foreign key refuses it. The order-level terms are what a
 * buyer actually renegotiates; changing what is on order is a new order.
 */
export async function updatePurchaseOrderAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = str(form, 'id');

  const values = {
    expectedDeliveryDate: str(form, 'expectedDeliveryDate'),
    paymentTermsDays: str(form, 'paymentTermsDays'),
    notes: str(form, 'notes'),
    status: str(form, 'status'),
  };

  return submit(
    `${BASE}/purchase-orders/${id}`,
    {
      expectedDeliveryDate: values.expectedDeliveryDate || null,
      // Omitted rather than nulled when blank: the column is a number with no
      // null state, so "leave it as it is" is the only sane reading of empty.
      ...(values.paymentTermsDays ? { paymentTermsDays: Number(values.paymentTermsDays) } : {}),
      notes: values.notes || null,
      // The API treats "the status it already has" as a no-op, so this is sent
      // unconditionally rather than diffed here — the server owns the rules
      // about what a purchase order may become.
      ...(values.status ? { status: values.status } : {}),
    },
    'Purchase order updated.',
    values,
    'PATCH',
  );
}

// ---------------------------------------------------------------------------
// 3. Goods receipts
// ---------------------------------------------------------------------------

/**
 * Books a receipt.
 *
 * The form posts one set of fields per order line, suffixed with the line id,
 * and lines left blank are skipped — a delivery rarely covers every line of an
 * order, and forcing a zero on the others would post meaningless movements.
 */
export async function createGoodsReceiptAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const purchaseOrderId = str(form, 'purchaseOrderId');
  const lineIds = form.getAll('lineId').map(String);

  const lines = lineIds
    .map((lineId) => ({
      purchaseOrderLineId: lineId,
      quantityReceived: str(form, `quantityReceived_${lineId}`),
      quantityRejected: str(form, `quantityRejected_${lineId}`) || '0',
      vendorBatchNumber: opt(form, `vendorBatchNumber_${lineId}`),
      manufacturingDate: toIsoDate(opt(form, `manufacturingDate_${lineId}`)),
      expiryDate: toIsoDate(opt(form, `expiryDate_${lineId}`)),
      storageLocation: opt(form, `storageLocation_${lineId}`),
    }))
    .filter((line) => line.quantityReceived.length > 0 && Number(line.quantityReceived) > 0);

  if (lines.length === 0) {
    return {
      status: 'error',
      message: 'Enter a received quantity on at least one line.',
    };
  }

  return submit(
    `${BASE}/goods-receipts`,
    {
      purchaseOrderId,
      receiptDate: toIsoDate(opt(form, 'receiptDate')),
      vendorDocumentNumber: opt(form, 'vendorDocumentNumber'),
      remarks: opt(form, 'remarks'),
      lines,
    },
    'Goods receipt booked. The batches are in quarantine awaiting incoming QC.',
  );
}

/**
 * Corrects the paperwork on a booked goods receipt.
 *
 * Quantities and batches are absent, and the API would refuse them anyway: the
 * receipt has already created batches and written to the append-only stock
 * ledger. A wrong quantity is corrected by receiving the difference or by
 * rejecting the batch at QC.
 */
export async function updateGoodsReceiptAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = str(form, 'id');

  const values = {
    receiptDate: str(form, 'receiptDate'),
    vendorDocumentNumber: str(form, 'vendorDocumentNumber'),
    remarks: str(form, 'remarks'),
  };

  return submit(
    `${BASE}/goods-receipts/${id}`,
    {
      ...(values.receiptDate ? { receiptDate: values.receiptDate } : {}),
      vendorDocumentNumber: values.vendorDocumentNumber || null,
      remarks: values.remarks || null,
    },
    'Goods receipt updated.',
    values,
    'PATCH',
  );
}

// ---------------------------------------------------------------------------
// 4. Incoming QC
// ---------------------------------------------------------------------------

export async function recordQcDecisionAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const lotId = str(form, 'lotId');
  const decision = str(form, 'decision');
  const values = { remarks: str(form, 'remarks'), testReference: str(form, 'testReference') };

  const message =
    decision === 'ACCEPTED'
      ? 'Batch accepted and released into usable stock.'
      : decision === 'REJECTED'
        ? 'Batch rejected. It stays in quarantine and cannot be used in production.'
        : 'Batch placed on hold. It cannot be used until released.';

  return submit(
    `${BASE}/qc/lots/${lotId}/decision`,
    { decision, testReference: opt(form, 'testReference'), remarks: opt(form, 'remarks') },
    message,
    values,
  );
}

// ---------------------------------------------------------------------------
// 5. Purchase invoices
// ---------------------------------------------------------------------------

export async function createInvoiceAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = { vendorInvoiceNumber: str(form, 'vendorInvoiceNumber') };
  const lineIds = form.getAll('lineItemId').map(String);

  // No tax field is posted: GST comes from the item's tax master entry on the
  // API side. Sending one from here would be a rate a client chose.
  const lines = lineIds
    .map((itemId, index) => ({
      itemId,
      quantity: str(form, `quantity_${index}`),
      rate: str(form, `rate_${index}`),
    }))
    .filter((line) => line.quantity.length > 0 && Number(line.quantity) > 0);

  if (lines.length === 0) {
    return { status: 'error', message: 'Enter a quantity on at least one line.', values };
  }

  return submit(
    `${BASE}/invoices`,
    {
      goodsReceiptId: str(form, 'goodsReceiptId'),
      vendorInvoiceNumber: values.vendorInvoiceNumber,
      invoiceDate: toIsoDate(str(form, 'invoiceDate')) ?? new Date().toISOString(),
      notes: opt(form, 'notes'),
      lines,
    },
    'Invoice recorded.',
    values,
  );
}

/**
 * Corrects what was transcribed from a vendor's invoice.
 *
 * The amounts are not here: they were matched against the order and the
 * receipt, and editing a total by hand would break that match without anything
 * recording it. A wrong amount means a wrong invoice — cancel it and book the
 * one the vendor actually sent.
 */
export async function updateInvoiceAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = str(form, 'id');

  const values = {
    vendorInvoiceNumber: str(form, 'vendorInvoiceNumber'),
    invoiceDate: str(form, 'invoiceDate'),
    dueDate: str(form, 'dueDate'),
    notes: str(form, 'notes'),
  };

  return submit(
    `${BASE}/invoices/${id}`,
    {
      ...(values.vendorInvoiceNumber ? { vendorInvoiceNumber: values.vendorInvoiceNumber } : {}),
      ...(values.invoiceDate ? { invoiceDate: values.invoiceDate } : {}),
      ...(values.dueDate ? { dueDate: values.dueDate } : {}),
      notes: values.notes || null,
    },
    'Invoice updated.',
    values,
    'PATCH',
  );
}

export async function changeInvoiceStatusAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = str(form, 'id');
  const status = str(form, 'status');

  return submit(
    `${BASE}/invoices/${id}/status`,
    { status },
    status === 'APPROVED'
      ? 'Invoice approved. It now appears on the payables ledger.'
      : `Invoice ${status.toLowerCase()}.`,
  );
}

// ---------------------------------------------------------------------------
// 6. Payments
// ---------------------------------------------------------------------------

/**
 * Corrects how a payment was recorded, never how much it was.
 *
 * The amount and the invoice decide what the vendor is still owed. Changing
 * either here would move a payables balance with nothing recording that it
 * moved; a payment sent in error is corrected by another payment.
 */
export async function updatePaymentAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = str(form, 'id');

  const values = {
    paymentDate: str(form, 'paymentDate'),
    reference: str(form, 'reference'),
    method: str(form, 'method'),
    notes: str(form, 'notes'),
  };

  return submit(
    `${BASE}/payments/${id}`,
    {
      ...(values.paymentDate ? { paymentDate: values.paymentDate } : {}),
      reference: values.reference || null,
      method: values.method || null,
      notes: values.notes || null,
    },
    'Payment updated.',
    values,
    'PATCH',
  );
}

export async function recordPaymentAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = { amount: str(form, 'amount'), reference: str(form, 'reference') };

  return submit(
    `${BASE}/payments`,
    {
      purchaseInvoiceId: str(form, 'purchaseInvoiceId'),
      amount: values.amount,
      paymentDate: toIsoDate(opt(form, 'paymentDate')),
      reference: opt(form, 'reference'),
      method: opt(form, 'method'),
      notes: opt(form, 'notes'),
    },
    'Payment recorded against the invoice.',
    values,
  );
}

/**
 * `<input type="date">` yields `YYYY-MM-DD`; the API validates ISO 8601.
 *
 * Anchored at midnight UTC rather than local, so a date does not shift a day
 * when the server and the browser disagree about the timezone — which for an
 * expiry date is the difference between usable and expired.
 */
function toIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;

  return `${value.slice(0, 10)}T00:00:00.000Z`;
}
