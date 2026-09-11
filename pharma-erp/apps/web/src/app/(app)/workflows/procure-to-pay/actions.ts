'use server';

import { revalidatePath } from 'next/cache';
import { PROCUREMENT_ROUTES } from '@pharma-erp/types';

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
 * Revalidates every Procure-to-Pay screen.
 *
 * Deliberately all of them rather than just the current one: these documents
 * are chained, so approving a requisition changes the purchase-order screen's
 * "convert" list and the summary counts at the top of all six. Revalidating
 * only the page the user is on is how a stale count survives an action.
 */
function revalidateProcurement(): void {
  for (const route of Object.values(PROCUREMENT_ROUTES)) revalidatePath(route);
}

/** Wraps a POST/PATCH, turning the result into an ActionState. */
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
    // Documents with many lines, and argon2-free but still database-bound.
    timeoutMs: 15_000,
  });

  if (!result.ok) {
    return { status: 'error', message: result.error, values };
  }

  revalidateProcurement();

  return { status: 'success', message: successMessage };
}

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

export async function createItemAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = {
    code: str(form, 'code'),
    name: str(form, 'name'),
    reorderLevel: str(form, 'reorderLevel'),
  };

  return submit(
    `${BASE}/items`,
    {
      code: values.code,
      name: values.name,
      itemType: opt(form, 'itemType') ?? 'RAW_MATERIAL',
      uom: opt(form, 'uom') ?? 'kg',
      reorderLevel: values.reorderLevel || '0',
      reorderQuantity: str(form, 'reorderQuantity') || values.reorderLevel || '0',
      shelfLifeMonths: str(form, 'shelfLifeMonths') ? Number(str(form, 'shelfLifeMonths')) : undefined,
      // GST lives on the item master; there is no separate tax table.
      gstRate: opt(form, 'gstRate'),
      scheduleClassification: opt(form, 'scheduleClassification'),
      brandName: opt(form, 'brandName'),
      genericName: opt(form, 'genericName'),
      storageConditions: opt(form, 'storageConditions'),
      hsnCode: opt(form, 'hsnCode'),
    },
    `Item ${values.code} created.`,
    values,
  );
}

export async function createVendorAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = { code: str(form, 'code'), name: str(form, 'name') };

  return submit(
    `${BASE}/parties`,
    {
      code: values.code,
      name: values.name,
      partyType: 'VENDOR',
      gstin: opt(form, 'gstin'),
      drugLicenceNumber: opt(form, 'drugLicenceNumber'),
      email: opt(form, 'email'),
      phone: opt(form, 'phone'),
      paymentTermsDays: Number(str(form, 'paymentTermsDays') || '30'),
    },
    `Vendor ${values.name} created.`,
    values,
  );
}

/**
 * Creates a production plan.
 *
 * The plan carries no component list of its own: it cites a bill of material
 * from the shared master data, and that BOM's lines are the components. A
 * revised formulation therefore cannot leave stale copies on plans already
 * raised.
 */
export async function createProductionPlanAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  return submit(
    `${BASE}/production-plans`,
    {
      finishedProductId: str(form, 'finishedProductId'),
      packVariant: opt(form, 'packVariant'),
      plannedQuantity: str(form, 'plannedQuantity'),
      plannedDate: toIsoDate(opt(form, 'plannedDate')),
      notes: opt(form, 'notes'),
      bomId: opt(form, 'bomId'),
    },
    'Production plan created.',
  );
}

/**
 * Issues or writes off usable stock.
 *
 * The API runs the reorder check straight after, so a movement that takes an
 * item below its level raises its requisition in the same request rather than
 * waiting for someone to notice.
 */
export async function consumeStockAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = { quantity: str(form, 'quantity'), reason: str(form, 'reason') };

  return submit(
    `${BASE}/stock/consume`,
    {
      itemId: str(form, 'itemId'),
      quantity: values.quantity,
      reason: values.reason || 'Manual stock issue',
    },
    'Stock issued. Any item that fell below its reorder level has been requisitioned.',
    values,
  );
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

export async function createRequisitionAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const values = { requiredQuantity: str(form, 'requiredQuantity'), notes: str(form, 'notes') };

  return submit(
    `${BASE}/requisitions`,
    {
      itemId: str(form, 'itemId'),
      requiredQuantity: values.requiredQuantity,
      preferredVendorId: opt(form, 'preferredVendorId'),
      requiredByDate: toIsoDate(opt(form, 'requiredByDate')),
      notes: opt(form, 'notes'),
      productionPlanId: opt(form, 'productionPlanId'),
    },
    'Requisition raised.',
    values,
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
