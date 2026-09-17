'use server';

import { revalidatePath } from 'next/cache';

import type {
  JobWorkInvoiceView,
  JobWorkMaterialReceiptView,
  JobWorkOrderSummary,
} from '@pharma-erp/types';

import type { ActionState } from '@/components/procurement/action-state';
import { apiFetch, type ApiResult } from '@/lib/api';

/**
 * Server actions for the Job Work screens — US-JW-01, US-JW-02, US-JW-05.
 *
 * Every one forwards to the NestJS API with the caller's own bearer token, so
 * each lands on the same two guards as any other request: RolesGuard in Nest
 * and row-level security in Postgres.
 *
 * NOTHING HERE DECIDES A BUSINESS RULE. The active-agreement check, the
 * product-brand mapping check, the billing-model inheritance, the stock bucket,
 * the released-batch gate and the invoice basis are all decided by the API and
 * re-decided there on every call. This layer turns a form into an HTTP request
 * and a refusal into a message.
 *
 * That separation is the point of section 20 of the brief: a request crafted by
 * hand — bypassing these forms entirely — hits exactly the same rules.
 */

const WORKFLOW_BASE = '/workflows/job-work';

// ActionState and IDLE are imported, not redeclared. A 'use server' module may
// export ONLY async functions — everything it exports becomes a callable
// endpoint — so a plain `export const IDLE` here would pass tsc and next build
// and then fail the first time a form was submitted. The procurement module
// learned that already; this reuses its shape rather than rediscovering it.

function toState(result: ApiResult<unknown>, success: string): ActionState {
  if (result.ok) return { status: 'success', message: success };

  // Field-level detail is deliberately flattened into the message: useAction
  // raises it as a centred toast, which is how every other refusal in this app
  // reaches the person who caused it.
  return { status: 'error', message: result.error };
}

/**
 * Refreshes every job-work sub-tab.
 *
 * A write ripples: receiving material changes the order's progress and the
 * register; a dispatch changes the order, the batch's remaining stock, the
 * billing list and the register. Revalidating only the page the button was on
 * would leave the others quietly wrong, which is worse than a slower refresh.
 */
function revalidateFlow(): void {
  for (const step of [
    'principals',
    'job-work-orders',
    'inward-materials',
    'production',
    'quality-release',
    'outward-dispatch',
    'billing',
    'register',
  ]) {
    revalidatePath(`${WORKFLOW_BASE}/${step}`);
  }

  // Job work consumes the same stock and the same work orders as the rest of
  // the plant, so its writes are visible on those screens too.
  revalidatePath('/workflows/production-quality/production-orders');
  revalidatePath('/workflows/production-quality/material-issue');
}

/** Reads a required text field, or null when it is blank. */
function text(form: FormData, name: string): string | null {
  const value = form.get(name);

  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// ---------------------------------------------------------------------------
// US-JW-01 — job-work orders
// ---------------------------------------------------------------------------

/**
 * Raises a job-work order.
 *
 * NOTE WHAT IS NOT SENT: no billing model, no agreement. The form has no
 * control for either, and the API would reject them if it did — the agreement
 * is whichever one owns the chosen mapping, and the billing model is copied off
 * it. That is control 3, and it holds here by omission rather than by a check.
 */
export async function createJobWorkOrderAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const principalId = text(form, 'principalId');
  const mappingId = text(form, 'mappingId');
  const quantity = text(form, 'quantity');
  const deliveryDate = text(form, 'deliveryDate');

  if (!principalId) return { status: 'error', message: 'Choose a principal.' };
  if (!mappingId) return { status: 'error', message: 'Choose a product and brand.' };
  if (!quantity) return { status: 'error', message: 'Enter the quantity ordered.' };
  if (!deliveryDate) return { status: 'error', message: 'Enter the delivery date.' };

  const result = await apiFetch<JobWorkOrderSummary>('/api/v1/job-work/orders', {
    method: 'POST',
    authenticated: true,
    json: {
      principalId,
      mappingId,
      quantity,
      deliveryDate,
      ...(text(form, 'notes') ? { notes: text(form, 'notes') } : {}),
    },
  });

  revalidateFlow();

  return toState(
    result,
    result.ok ? `Job-work order ${(result.data as JobWorkOrderSummary).orderNumber} raised.` : '',
  );
}

/** Changes quantity, delivery date or notes. The terms are not editable. */
export async function updateJobWorkOrderAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = text(form, 'id');

  if (!id) return { status: 'error', message: 'No order was identified.' };

  const body: Record<string, unknown> = {};

  const quantity = text(form, 'quantity');
  const deliveryDate = text(form, 'deliveryDate');

  if (quantity) body.quantity = quantity;
  if (deliveryDate) body.deliveryDate = deliveryDate;
  body.notes = text(form, 'notes');

  const result = await apiFetch<JobWorkOrderSummary>(`/api/v1/job-work/orders/${id}`, {
    method: 'PATCH',
    authenticated: true,
    json: body,
  });

  revalidateFlow();

  return toState(result, 'Job-work order updated.');
}

/** Withdraws an order nothing has happened against. */
export async function withdrawJobWorkOrderAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = text(form, 'id');

  if (!id) return { status: 'error', message: 'No order was identified.' };

  const result = await apiFetch<void>(`/api/v1/job-work/orders/${id}`, {
    method: 'DELETE',
    authenticated: true,
  });

  revalidateFlow();

  return toState(result, 'Job-work order withdrawn.');
}

// ---------------------------------------------------------------------------
// US-JW-02 — the principal's material
// ---------------------------------------------------------------------------

/**
 * Records material the principal supplied, against their delivery challan.
 *
 * NO OWNERSHIP FIELD is sent, because the tag is system-set. The form shows it
 * as a read-only SYSTEM-SET value so the store officer can see what it will be,
 * which is what section 17 asks for.
 */
export async function createJobWorkReceiptAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const jobWorkOrderId = text(form, 'jobWorkOrderId');
  const deliveryChallanNumber = text(form, 'deliveryChallanNumber');
  const itemId = text(form, 'itemId');
  const batchNumber = text(form, 'batchNumber');
  const receivedQuantity = text(form, 'receivedQuantity');

  if (!jobWorkOrderId) return { status: 'error', message: 'Choose the job-work order.' };
  if (!deliveryChallanNumber) {
    return { status: 'error', message: "Enter the principal's delivery challan number." };
  }
  if (!itemId) return { status: 'error', message: 'Choose the material received.' };
  if (!batchNumber) return { status: 'error', message: 'Enter the batch or lot number.' };
  if (!receivedQuantity) return { status: 'error', message: 'Enter the quantity received.' };

  const result = await apiFetch<JobWorkMaterialReceiptView>(
    '/api/v1/job-work/material-receipts',
    {
      method: 'POST',
      authenticated: true,
      json: {
        jobWorkOrderId,
        deliveryChallanNumber,
        itemId,
        batchNumber,
        receivedQuantity,
        ...(text(form, 'manufacturingDate')
          ? { manufacturingDate: text(form, 'manufacturingDate') }
          : {}),
        ...(text(form, 'expiryDate') ? { expiryDate: text(form, 'expiryDate') } : {}),
        ...(text(form, 'notes') ? { notes: text(form, 'notes') } : {}),
      },
    },
  );

  revalidateFlow();

  return toState(
    result,
    result.ok
      ? `Receipt ${(result.data as JobWorkMaterialReceiptView).receiptNumber} recorded — ` +
          'material added to principal-owned stock.'
      : '',
  );
}

// ---------------------------------------------------------------------------
// US-JW-03 — manufacturing, through the EXISTING work order
// ---------------------------------------------------------------------------

/**
 * Raises a production work order against a job-work order.
 *
 * Calls `/api/v1/production/orders` — the SAME endpoint own-brand manufacturing
 * uses — with one extra field. US-JW-03's "do NOT create a new production
 * record" is honoured by there being no job-work production endpoint to call.
 */
export async function createJobWorkProductionOrderAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const jobWorkOrderId = text(form, 'jobWorkOrderId');
  const productId = text(form, 'productId');
  const plannedQuantity = text(form, 'plannedQuantity');

  if (!jobWorkOrderId) return { status: 'error', message: 'No job-work order was identified.' };
  if (!productId) return { status: 'error', message: 'No product was identified.' };
  if (!plannedQuantity) return { status: 'error', message: 'Enter the batch size.' };

  const result = await apiFetch<{ orderNumber: string }>('/api/v1/production/orders', {
    method: 'POST',
    authenticated: true,
    json: {
      productId,
      plannedQuantity,
      jobWorkOrderId,
      ...(text(form, 'plannedStartOn') ? { plannedStartOn: text(form, 'plannedStartOn') } : {}),
    },
  });

  revalidateFlow();

  return toState(
    result,
    result.ok
      ? `Work order ${(result.data as { orderNumber: string }).orderNumber} raised against this ` +
          'job-work order.'
      : '',
  );
}

// ---------------------------------------------------------------------------
// US-JW-05 — dispatch and invoice
// ---------------------------------------------------------------------------

/**
 * Dispatches a released batch back to the principal and raises the invoice.
 *
 * NO INVOICE BASIS IS SENT. `unitValue` is sent only when the order is
 * own-procurement — the form does not render the control otherwise, and the API
 * rejects the field under pure conversion rather than ignoring it.
 */
export async function createJobWorkDispatchAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const jobWorkOrderId = text(form, 'jobWorkOrderId');
  const batchId = text(form, 'batchId');
  const dispatchedQuantity = text(form, 'dispatchedQuantity');
  const unitValue = text(form, 'unitValue');

  if (!jobWorkOrderId) return { status: 'error', message: 'No job-work order was identified.' };
  if (!batchId) return { status: 'error', message: 'Choose the batch to dispatch.' };
  if (!dispatchedQuantity) return { status: 'error', message: 'Enter the quantity dispatched.' };

  const result = await apiFetch<JobWorkInvoiceView>('/api/v1/job-work/dispatches', {
    method: 'POST',
    authenticated: true,
    json: {
      jobWorkOrderId,
      batchId,
      dispatchedQuantity,
      ...(text(form, 'dispatchDate') ? { dispatchDate: text(form, 'dispatchDate') } : {}),
      // Only ever present on an own-procurement order; see the API's `price`.
      ...(unitValue ? { unitValue } : {}),
      ...(text(form, 'notes') ? { notes: text(form, 'notes') } : {}),
    },
  });

  revalidateFlow();

  return toState(
    result,
    result.ok
      ? `Dispatched. Invoice ${(result.data as JobWorkInvoiceView).invoiceNumber} raised for ` +
          `${(result.data as JobWorkInvoiceView).totalValue}.`
      : '',
  );
}
