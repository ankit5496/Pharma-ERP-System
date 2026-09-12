'use server';

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
  method: 'POST' | 'PATCH' = 'POST',
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

  return submit(
    `${BASE}/purchase-orders/${id}/status`,
    { status },
    status === 'ISSUED' ? 'Purchase order issued to the vendor.' : `Purchase order ${status.toLowerCase()}.`,
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
