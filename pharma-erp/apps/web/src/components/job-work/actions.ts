'use server';

import { revalidatePath } from 'next/cache';

import type {
  JobWorkInvoiceView,
  JobWorkMaterialReadiness,
  JobWorkOrderMaterial,
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
 * Whether one job-work order could be manufactured, and if not, why not.
 *
 * FETCHED WHEN THE FORM OPENS. The same call the work-order service makes when
 * the button is pressed, so the table and the refusal cannot disagree — but
 * made once, for the order somebody is actually looking at, rather than once
 * per row of the list.
 *
 * Null when the check itself could not be run. The form says so and leaves the
 * button enabled: the API re-decides regardless, and refusing to let somebody
 * try because a preview failed would be the wrong way round.
 */
export async function loadJobWorkReadinessAction(
  jobWorkOrderId: string,
  batchSize?: string,
): Promise<JobWorkMaterialReadiness | null> {
  if (!jobWorkOrderId) return null;

  const query = batchSize ? `?batchSize=${encodeURIComponent(batchSize)}` : '';

  const result = await apiFetch<JobWorkMaterialReadiness>(
    `/api/v1/job-work/orders/${jobWorkOrderId}/readiness${query}`,
    { authenticated: true },
  );

  return result.ok ? result.data : null;
}

/**
 * What one job-work order's masters call for.
 *
 * A SERVER ACTION RATHER THAN A PAGE FETCH. The receipt form needs the material
 * list of whichever order is chosen, which is not known until it is chosen —
 * and pre-loading every order's list to have it ready cost a call each and made
 * the screen take half a minute to draw.
 *
 * Returns an empty list when the order has no usable formulation. The API says
 * so with a 400 and the form turns that absence into its own message, which is
 * the same thing it did when the list arrived with the page.
 */
export async function loadJobWorkMaterialsAction(
  jobWorkOrderId: string,
): Promise<JobWorkOrderMaterial[]> {
  if (!jobWorkOrderId) return [];

  const result = await apiFetch<JobWorkOrderMaterial[]>(
    `/api/v1/job-work/orders/${jobWorkOrderId}/materials`,
    { authenticated: true },
  );

  return result.ok ? result.data : [];
}

/**
 * Records material the principal supplied, against their delivery challan.
 *
 * NO OWNERSHIP FIELD is sent, because the tag is system-set. The form shows it
 * as a read-only SYSTEM-SET value so the store officer can see what it will be,
 * which is what section 17 asks for.
 *
 * NO MATERIAL IS CHOSEN HERE EITHER. The form lays out a row per material in
 * the order's formulation and this reads the quantities typed against them. A
 * row left blank is a material that did not arrive on this challan — partial
 * deliveries are ordinary — so blank rows are dropped rather than refused, and
 * a challan with nothing on it at all is what gets sent back.
 */
export async function createJobWorkReceiptAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const jobWorkOrderId = text(form, 'jobWorkOrderId');
  const deliveryChallanNumber = text(form, 'deliveryChallanNumber');
  const receiptDate = text(form, 'receiptDate');
  const notes = text(form, 'notes');

  // An unticked checkbox posts nothing at all, so its absence is the "no", and
  // the API's own default of true only applies when the field is omitted
  // entirely — which this form never does.
  const qcRequired = form.get('qcRequired') !== null;

  if (!jobWorkOrderId) return { status: 'error', message: 'Choose the job-work order.' };
  if (!deliveryChallanNumber) {
    return { status: 'error', message: "Enter the principal's delivery challan number." };
  }
  if (!receiptDate) return { status: 'error', message: 'Enter the date on the challan.' };

  const lines = readReceiptLines(form);

  if ('message' in lines) return { status: 'error', message: lines.message };

  if (lines.rows.length === 0) {
    return {
      status: 'error',
      message:
        'Enter the quantity received for at least one material. Leave a material blank if it ' +
        'did not arrive on this challan.',
    };
  }

  const result = await apiFetch<JobWorkMaterialReceiptView>(
    '/api/v1/job-work/material-receipts',
    {
      method: 'POST',
      authenticated: true,
      json: {
        jobWorkOrderId,
        deliveryChallanNumber,
        receiptDate,
        qcRequired,
        ...(notes ? { notes } : {}),
        lines: lines.rows,
      },
    },
  );

  revalidateFlow();

  const recorded = result.ok ? (result.data as JobWorkMaterialReceiptView) : null;

  return toState(
    result,
    recorded
      ? `Receipt ${recorded.receiptNumber} recorded — ${recorded.lines.length} ` +
          `material${recorded.lines.length === 1 ? '' : 's'} on challan ${deliveryChallanNumber}, ` +
          (recorded.qcRequired
            ? 'held in quarantine for incoming QC.'
            : 'added to principal-owned stock.')
      : '',
  );
}

/**
 * Reads the material rows off the receipt form.
 *
 * The form names them `lines.0.itemId`, `lines.0.receivedQuantity` and so on,
 * one group per material in the formulation. A group with no quantity typed
 * into it is skipped — that material simply did not come on this challan.
 *
 * The batch marking is required for the ones that DID come: a principal-owned
 * lot with no batch number on it cannot be traced back to what the principal
 * shipped, which is the whole reason this record exists.
 */
function readReceiptLines(
  form: FormData,
):
  | { rows: ReceiptLinePayload[] }
  | { message: string } {
  const rows: ReceiptLinePayload[] = [];

  for (let index = 0; ; index += 1) {
    const itemId = text(form, `lines.${index}.itemId`);

    if (!itemId) break;

    const receivedQuantity = text(form, `lines.${index}.receivedQuantity`);

    if (!receivedQuantity) continue;

    const batchNumber = text(form, `lines.${index}.batchNumber`);

    if (!batchNumber) {
      return {
        message:
          'Enter the batch or lot number for every material you received. It is what ties the ' +
          'stock back to what the principal shipped.',
      };
    }

    const manufacturingDate = text(form, `lines.${index}.manufacturingDate`);
    const expiryDate = text(form, `lines.${index}.expiryDate`);

    rows.push({
      itemId,
      batchNumber,
      receivedQuantity,
      ...(manufacturingDate ? { manufacturingDate } : {}),
      ...(expiryDate ? { expiryDate } : {}),
    });
  }

  return { rows };
}

/** One material on the challan, as the API takes it. */
interface ReceiptLinePayload {
  itemId: string;
  batchNumber: string;
  receivedQuantity: string;
  manufacturingDate?: string;
  expiryDate?: string;
  notes?: string;
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
