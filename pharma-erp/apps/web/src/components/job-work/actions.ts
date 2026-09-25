'use server';

import { revalidatePath } from 'next/cache';

import type {
  JobWorkBatchView,
  JobWorkInvoiceView,
  JobWorkIssuableMaterial,
  JobWorkIssuePlan,
  JobWorkMaterialSufficiency,
  JobWorkMaterialIssueView,
  JobWorkMaterialReadiness,
  JobWorkOrderMaterial,
  JobWorkProductionOrderView,
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
    'quality-check',
    'production-to-batch-release',
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
 * The receipts booked against one job-work order.
 *
 * FOR THE WORK-ORDER FORM, which shows what the principal actually sent rather
 * than only what the formulation asks for. Read from the receipts because that
 * is the record of arrival — a second list assembled from the lots would be a
 * second answer to the same question.
 */
export async function loadJobWorkReceiptsAction(
  jobWorkOrderId: string,
): Promise<JobWorkMaterialReceiptView[]> {
  if (!jobWorkOrderId) return [];

  const result = await apiFetch<JobWorkMaterialReceiptView[]>(
    `/api/v1/job-work/material-receipts?jobWorkOrderId=${jobWorkOrderId}`,
    { authenticated: true },
  );

  return result.ok ? result.data : [];
}

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
      ? `${recorded.receiptNumber}: ${lines.rows.length} material${
          lines.rows.length === 1 ? '' : 's'
        } recorded on challan ${deliveryChallanNumber}. ` +
          `The receipt now holds ${recorded.lines.length} in total, quarantined until it is ` +
          'approved.'
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
/**
 * Says the delivery is completely recorded, and asks for it to be approved.
 *
 * NOT THE APPROVAL. The store officer states that what is on the receipt is
 * what arrived; the quality decision is somebody else's, on Quality check.
 * Naming this action "Approve" would collapse the two, which is the one thing
 * the stage exists to prevent.
 */
export async function submitJobWorkReceiptAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = text(form, 'receiptId');

  if (!id) return { status: 'error', message: 'No receipt was identified.' };

  const result = await apiFetch<JobWorkMaterialReceiptView>(
    `/api/v1/job-work/material-receipts/${id}/submit`,
    { method: 'POST', authenticated: true },
  );

  revalidateFlow();

  return toState(
    result,
    result.ok
      ? `${(result.data as JobWorkMaterialReceiptView).receiptNumber} sent for approval — it is ` +
          'now waiting on Quality check.'
      : '',
  );
}

/**
 * The quality decision on a whole consignment.
 *
 * One decision for the receipt, and every lot under it follows. A reason is
 * required for anything but an approval, and the API refuses without one.
 */
export async function decideJobWorkReceiptAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = text(form, 'receiptId');
  const decision = text(form, 'decision');

  if (!id) return { status: 'error', message: 'No receipt was identified.' };
  if (!decision) return { status: 'error', message: 'Choose approve, hold or reject.' };

  const notes = text(form, 'notes');

  if (decision !== 'APPROVED' && !notes) {
    return {
      status: 'error',
      message: 'Record why the consignment is being held or rejected.',
    };
  }

  const result = await apiFetch<JobWorkMaterialReceiptView>(
    `/api/v1/job-work/material-receipts/${id}/decision`,
    {
      method: 'POST',
      authenticated: true,
      json: {
        decision,
        ...(text(form, 'testReference') ? { testReference: text(form, 'testReference') } : {}),
        ...(notes ? { notes } : {}),
      },
    },
  );

  revalidateFlow();

  return toState(
    result,
    result.ok
      ? decision === 'APPROVED'
        ? `${(result.data as JobWorkMaterialReceiptView).receiptNumber} approved — the material ` +
            'is now issuable to production.'
        : `${(result.data as JobWorkMaterialReceiptView).receiptNumber} recorded as ` +
            `${decision === 'ON_HOLD' ? 'on hold' : 'rejected'}. None of it may be issued.`
      : '',
  );
}

// ---------------------------------------------------------------------------
// Job-work production orders — the module's own manufacturing record
//
// Deliberately separate from the internal production order: see the service.
// ---------------------------------------------------------------------------

/**
 * The approved consignments an order could be manufactured from.
 *
 * Fetched when the form opens rather than with the page, for the same reason
 * the readiness check is: one order's worth of receipts, asked for when there
 * is something to ask it about.
 */
export async function loadEligibleReceiptsAction(
  jobWorkOrderId: string,
): Promise<JobWorkMaterialReceiptView[]> {
  if (!jobWorkOrderId) return [];

  const result = await apiFetch<JobWorkMaterialReceiptView[]>(
    `/api/v1/job-work/orders/${jobWorkOrderId}/eligible-receipts`,
    { authenticated: true },
  );

  return result.ok ? result.data : [];
}

/** Raises the production order against an approved consignment. */
export async function raiseJobWorkProductionOrderAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const jobWorkOrderId = text(form, 'jobWorkOrderId');
  const materialReceiptId = text(form, 'materialReceiptId');

  if (!jobWorkOrderId) return { status: 'error', message: 'No job-work order was identified.' };

  // NO CHECK FOR A CONSIGNMENT HERE. Whether one is required depends on the
  // job-work order's billing model, which this layer does not know and should
  // not guess — the API reads it off the order and refuses either way round:
  // a pure-conversion order with no receipt, or an own-procurement order with
  // one. The form simply does not render the field where it does not apply.
  const result = await apiFetch<JobWorkProductionOrderView>('/api/v1/job-work/production-orders', {
    method: 'POST',
    authenticated: true,
    json: {
      jobWorkOrderId,
      ...(materialReceiptId ? { materialReceiptId } : {}),
      // NO plannedQuantity. It is the job-work order's own figure, read by the
      // service from the order; the API rejects the field outright.
      ...(text(form, 'plannedStartOn') ? { plannedStartOn: text(form, 'plannedStartOn') } : {}),
      ...(text(form, 'plannedCompletionOn')
        ? { plannedCompletionOn: text(form, 'plannedCompletionOn') }
        : {}),
      ...(text(form, 'notes') ? { notes: text(form, 'notes') } : {}),
    },
  });

  revalidateFlow();

  return toState(
    result,
    result.ok
      ? `Production order ${(result.data as JobWorkProductionOrderView).orderNumber} raised.`
      : '',
  );
}

/** Changes the plan, or moves the order to its next stage. */
export async function updateJobWorkProductionOrderAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = text(form, 'id');

  if (!id) return { status: 'error', message: 'No production order was identified.' };

  const body: Record<string, unknown> = {};

  if (text(form, 'plannedQuantity')) body.plannedQuantity = text(form, 'plannedQuantity');
  if (text(form, 'status')) body.status = text(form, 'status');

  body.plannedStartOn = text(form, 'plannedStartOn') || null;
  body.plannedCompletionOn = text(form, 'plannedCompletionOn') || null;
  body.notes = text(form, 'notes') || null;

  const result = await apiFetch<JobWorkProductionOrderView>(
    `/api/v1/job-work/production-orders/${id}`,
    { method: 'PATCH', authenticated: true, json: body },
  );

  revalidateFlow();

  return toState(result, 'Production order updated.');
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
// Material issue, batch record and batch release — the job-work module's own
// ---------------------------------------------------------------------------

/**
 * The number a form is about to take, for the field that shows it.
 *
 * ADVISORY, and the API says so: nothing is reserved by asking, so two people
 * with the same form open see the same number and one of them is wrong. The
 * real number is allocated inside the transaction that writes the document.
 *
 * Null on failure rather than an error — a form whose number preview could not
 * load should still be usable, and it says "Assigned automatically" instead.
 */
export async function nextJobWorkNumberAction(
  document: 'production-order' | 'issue' | 'batch',
): Promise<string | null> {
  const path =
    document === 'production-order'
      ? '/api/v1/job-work/production-orders/next-number'
      : document === 'issue'
        ? '/api/v1/job-work/material-issues/next-number'
        : '/api/v1/job-work/batches/next-number';

  const result = await apiFetch<Record<string, string>>(path, { authenticated: true });

  if (!result.ok) return null;

  return (
    result.data.orderNumber ?? result.data.issueNumber ?? result.data.batchNumber ?? null
  );
}

/**
 * Has the principal sent enough to make this batch?
 *
 * The answer the production-order form shows before the button is pressed. The
 * create endpoint re-computes it and refuses on its own account, so this is a
 * courtesy rather than the rule.
 */
export async function loadJobWorkMaterialSufficiencyAction(
  jobWorkOrderId: string,
  /** Omitted under own procurement, which has no consignment to measure. */
  materialReceiptId?: string,
): Promise<
  { ok: true; data: JobWorkMaterialSufficiency } | { ok: false; message: string }
> {
  if (!jobWorkOrderId) {
    return { ok: false, message: 'Choose a job-work order first.' };
  }

  const query = materialReceiptId ? `?materialReceiptId=${materialReceiptId}` : '';

  const result = await apiFetch<JobWorkMaterialSufficiency>(
    `/api/v1/job-work/orders/${jobWorkOrderId}/material-sufficiency${query}`,
    { authenticated: true },
  );

  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.error };
}

/**
 * What issuing this order would consume, and out of which drums.
 *
 * The plan the dispensing form opens on. Its refusal travels as a message
 * rather than being swallowed: "this consignment has not passed Quality check"
 * is the answer somebody needs, and an empty table does not say it.
 */
export async function jobWorkIssuePlanAction(
  productionOrderId: string,
): Promise<{ ok: true; data: JobWorkIssuePlan } | { ok: false; message: string }> {
  if (!productionOrderId) return { ok: false, message: 'No production order was identified.' };

  const result = await apiFetch<JobWorkIssuePlan>(
    `/api/v1/job-work/production-orders/${productionOrderId}/issue-plan`,
    { authenticated: true },
  );

  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.error };
}

/**
 * The drums this production order may still draw on.
 *
 * FROM THE INWARD RECEIPT, not from a copy of it. The API subtracts what has
 * already been issued, so the form offers each drum's remainder.
 */
export async function loadIssuableMaterialAction(productionOrderId: string) {
  if (!productionOrderId) return [];

  const result = await apiFetch<JobWorkIssuableMaterial[]>(
    `/api/v1/job-work/production-orders/${productionOrderId}/issuable-material`,
    { authenticated: true },
  );

  return result.ok ? result.data : [];
}

/**
 * Issues the principal's material to a batch.
 *
 * The lines arrive as `quantity:<lotId>` fields — one per drum on the form —
 * and blank ones are dropped here rather than sent as zeros, because a zero is
 * a quantity and an empty box is somebody not dispensing from that drum.
 */
export async function recordJobWorkIssueAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const jobWorkProductionOrderId = text(form, 'jobWorkProductionOrderId');

  if (!jobWorkProductionOrderId) {
    return { status: 'error', message: 'No production order was identified.' };
  }

  const lines: { lotId: string; quantityIssued: string }[] = [];

  for (const [key, value] of form.entries()) {
    if (!key.startsWith('quantity:')) continue;
    if (typeof value !== 'string' || !value.trim()) continue;

    lines.push({ lotId: key.slice('quantity:'.length), quantityIssued: value.trim() });
  }

  if (lines.length === 0) {
    return {
      status: 'error',
      message: 'Enter a quantity against at least one drum before issuing.',
    };
  }

  const result = await apiFetch<JobWorkMaterialIssueView>('/api/v1/job-work/material-issues', {
    method: 'POST',
    authenticated: true,
    json: {
      jobWorkProductionOrderId,
      lines,
      ...(text(form, 'notes') ? { notes: text(form, 'notes') } : {}),
    },
  });

  revalidateFlow();

  return toState(
    result,
    result.ok
      ? `Material issue ${(result.data as JobWorkMaterialIssueView).issueNumber} recorded.`
      : '',
  );
}

/** Opens the batch record against a production order material has gone to. */
export async function recordJobWorkBatchAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const jobWorkProductionOrderId = text(form, 'jobWorkProductionOrderId');
  const manufacturedOn = text(form, 'manufacturedOn');
  const expiryDate = text(form, 'expiryDate');

  if (!jobWorkProductionOrderId) {
    return { status: 'error', message: 'No production order was identified.' };
  }

  if (!manufacturedOn) return { status: 'error', message: 'Enter the date of manufacture.' };
  if (!expiryDate) return { status: 'error', message: 'Enter the expiry date.' };

  const result = await apiFetch<JobWorkBatchView>('/api/v1/job-work/batches', {
    method: 'POST',
    authenticated: true,
    json: {
      jobWorkProductionOrderId,
      manufacturedOn,
      expiryDate,
      ...(text(form, 'actualQuantity') ? { actualQuantity: text(form, 'actualQuantity') } : {}),
      ...(text(form, 'notes') ? { notes: text(form, 'notes') } : {}),
    },
  });

  revalidateFlow();

  return toState(
    result,
    result.ok ? `Batch ${(result.data as JobWorkBatchView).batchNumber} opened.` : '',
  );
}

/** Adds the packing figures to a batch already recorded. */
export async function recordJobWorkPackingAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = text(form, 'batchId');

  if (!id) return { status: 'error', message: 'No batch was identified.' };

  const body: Record<string, unknown> = {};

  for (const field of ['actualQuantity', 'packedQuantity', 'rejectedQuantity', 'packVariant', 'packedOn', 'notes']) {
    const value = text(form, field);

    if (value) body[field] = value;
  }

  // WHAT THE PACK CONSUMED, component by component. The rows are named
  // `component.<row>.itemId`, so they are found by walking the field names
  // rather than by guessing how many the specification put on screen.
  const consumptions: { itemId: string; quantityConsumed: string }[] = [];

  for (const [key, value] of form.entries()) {
    const match = /^component\.(\d+)\.itemId$/.exec(key);

    if (!match || typeof value !== 'string' || !value) continue;

    const quantity = String(form.get(`component.${match[1]}.quantityConsumed`) ?? '').trim();

    // A component left blank is a row nobody filled in, not an error: the form
    // offers a line per component the specification expects, and a run that
    // used none of one is a real answer.
    if (!quantity) continue;

    consumptions.push({ itemId: value, quantityConsumed: quantity });
  }

  // CONSUMPTION WITHOUT A VARIANT IS NOT RECORDABLE. The component rows exist
  // because a pack specification named them, so figures arriving with no
  // variant mean the select was left on --None-- while the rows were filled
  // in, and the record would carry consumption nobody could tie back to a
  // presentation.
  if (consumptions.length > 0 && !body.packVariant) {
    return { status: 'error', message: 'Choose the pack variant that was run.' };
  }

  if (consumptions.length > 0) body.consumptions = consumptions;

  const result = await apiFetch<JobWorkBatchView>(`/api/v1/job-work/batches/${id}`, {
    method: 'PATCH',
    authenticated: true,
    json: body,
  });

  revalidateFlow();

  return toState(result, 'Packing recorded.');
}

/**
 * The release decision on a finished batch.
 *
 * A reason is required for anything but a release — checked here so the person
 * sees it immediately, and again by the API, which is what actually enforces
 * it.
 */
export async function decideJobWorkBatchAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = text(form, 'batchId');
  const decision = text(form, 'decision');
  const notes = text(form, 'notes');

  if (!id) return { status: 'error', message: 'No batch was identified.' };
  if (!decision) return { status: 'error', message: 'Choose a decision.' };

  if (decision !== 'RELEASED' && !notes) {
    return { status: 'error', message: 'Give the reason for holding or rejecting this batch.' };
  }

  const result = await apiFetch<JobWorkBatchView>(`/api/v1/job-work/batches/${id}/release`, {
    method: 'POST',
    authenticated: true,
    json: { decision, ...(notes ? { notes } : {}) },
  });

  revalidateFlow();

  return toState(
    result,
    decision === 'RELEASED' ? 'Batch released.' : 'Decision recorded.',
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
