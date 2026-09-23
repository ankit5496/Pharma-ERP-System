'use server';

import { revalidatePath } from 'next/cache';

import type {
  BatchView,
  MaterialIssuePlan,
  MaterialIssueView,
  ProductionOrderSummary,
  ProductionStockLot,
  WorkOrderFeasibility,
} from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

/**
 * Writes for the Production & Quality Gate workflow.
 *
 * Every action returns `{ ok }` rather than throwing. A refusal here is usually
 * a rule doing its job — not enough usable stock, a batch already decided, the
 * wrong role — and the API's message is written to be read by the person who
 * hit it. Passing it through verbatim is better than this layer inventing a
 * vaguer one.
 */

export interface ActionResult {
  ok: boolean;
  message?: string;
}

/**
 * Both step routes are refreshed after every write, not just the one the form
 * lives on: issuing material changes what Batch record can accept, and a
 * release changes the order's status back on Production orders.
 */
function revalidateWorkflow(): void {
  revalidatePath('/workflows/production-quality', 'layout');
}

export async function createProductionOrderAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const productId = String(formData.get('productId') ?? '');
  const plannedQuantity = String(formData.get('plannedQuantity') ?? '').trim();
  const plannedStartOn = String(formData.get('plannedStartOn') ?? '').trim();

  if (!productId || !plannedQuantity) {
    return { ok: false, message: 'Choose a product and enter a quantity.' };
  }

  const result = await apiFetch<ProductionOrderSummary>('/api/v1/production/orders', {
    method: 'POST',
    authenticated: true,
    json: {
      productId,
      plannedQuantity,
      ...(plannedStartOn ? { plannedStartOn } : {}),
    },
    timeoutMs: 20_000,
  });

  if (!result.ok) return { ok: false, message: result.error };

  revalidateWorkflow();

  return { ok: true, message: `Work order ${result.data.orderNumber} raised.` };
}

export async function issueMaterialAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const orderId = String(formData.get('orderId') ?? '');

  if (!orderId) return { ok: false, message: 'No work order selected.' };

  // US-PROD-02: the lots the store officer chose instead of FEFO's suggestion.
  //
  // Fields are named `override.<itemId>.<row>.lotId`, so the material is in the
  // field name itself and the rows need no hidden inputs and no stable
  // numbering across materials. The reason is per material, not per row:
  // splitting one material across two lots is one decision, explained once.
  const overrides: { itemId: string; lotId: string; quantity: string; reason?: string }[] = [];
  const missingReason = new Set<string>();

  for (const [key, value] of formData.entries()) {
    const match = /^override\.([0-9a-fA-F-]{36})\.(\d+)\.lotId$/.exec(key);

    if (!match || typeof value !== 'string' || !value) continue;

    // Defaults only to satisfy the compiler's indexed-access checking: a match
    // on this pattern always has both groups.
    const [, itemId = '', row = ''] = match;
    const quantity = String(formData.get(`override.${itemId}.${row}.quantity`) ?? '').trim();

    // A row with a lot but no quantity is one somebody started and left; it is
    // not an instruction to dispense an unstated amount.
    if (!quantity) continue;

    const reason = String(formData.get(`override.${itemId}.reason`) ?? '').trim();

    // US-PROD-02: a reason is needed only when the lot named is NOT one the
    // FEFO plan proposed. Naming the suggested lot is confirming it — the
    // story's "Actual Batch Issued, manually confirmed, defaults to the
    // suggestion" — and demanding an explanation for agreeing would both
    // obstruct the normal path and record a deviation that did not occur.
    //
    // The API makes this same comparison against the plan it computes itself;
    // this one only decides whether to spend a round trip to be told so.
    const suggested = String(formData.get(`suggested.${itemId}`) ?? '')
      .split(',')
      .filter(Boolean);

    const deviates = !suggested.includes(value);

    if (deviates && !reason) {
      missingReason.add(itemId);
      continue;
    }

    overrides.push({ itemId, lotId: value, quantity, ...(deviates ? { reason } : {}) });
  }

  if (missingReason.size > 0) {
    return {
      ok: false,
      message: `Add a reason for not using the suggested lot${
        missingReason.size === 1 ? '' : 's'
      }.`,
    };
  }

  const result = await apiFetch<MaterialIssueView>(`/api/v1/production/orders/${orderId}/issue`, {
    method: 'POST',
    authenticated: true,
    json: overrides.length > 0 ? { overrides } : {},
    timeoutMs: 30_000,
  });

  if (!result.ok) return { ok: false, message: result.error };

  revalidateWorkflow();

  const overridden = result.data.lines.filter((line) => line.isFefoOverride).length;

  return {
    ok: true,
    message:
      `Dispensed ${result.data.lines.length} lot${result.data.lines.length === 1 ? '' : 's'} ` +
      `against the order${overridden > 0 ? `, ${overridden} chosen over the suggestion` : ''}.`,
  };
}

export async function recordBatchAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const productionOrderId = String(formData.get('productionOrderId') ?? '');
  const actualQuantity = String(formData.get('actualQuantity') ?? '').trim();
  const manufacturedOn = String(formData.get('manufacturedOn') ?? '').trim();

  if (!productionOrderId || !actualQuantity) {
    return { ok: false, message: 'Choose a work order and enter the quantity manufactured.' };
  }

  const result = await apiFetch<BatchView>('/api/v1/production/batches', {
    method: 'POST',
    authenticated: true,
    json: {
      productionOrderId,
      actualQuantity,
      ...(manufacturedOn ? { manufacturedOn } : {}),
    },
    timeoutMs: 20_000,
  });

  if (!result.ok) return { ok: false, message: result.error };

  revalidateWorkflow();

  return { ok: true, message: `Batch ${result.data.batchNumber} opened.` };
}

export async function recordPackingAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const batchId = String(formData.get('batchId') ?? '');
  const packedQuantity = String(formData.get('packedQuantity') ?? '').trim();
  const rejectedQuantity = String(formData.get('rejectedQuantity') ?? '').trim();
  const packVariant = String(formData.get('packVariant') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();

  if (!batchId || !packedQuantity) {
    return { ok: false, message: 'Quantity packed is required.' };
  }

  // US-PROD-04: what the pack actually consumed. Component rows are named
  // `component.<row>.itemId`, so they are found by walking the field names
  // rather than by guessing how many there are.
  const consumptions: { itemId: string; quantityConsumed: string }[] = [];

  for (const [key, value] of formData.entries()) {
    const match = /^component\.(\d+)\.itemId$/.exec(key);
    if (!match || typeof value !== 'string' || !value) continue;

    const quantity = String(formData.get(`component.${match[1]}.quantityConsumed`) ?? '').trim();

    // A component left blank is a row nobody filled in, not an error: the form
    // offers a line per component the pack specification expects, and a run
    // that used none of one is a real answer.
    if (!quantity) continue;

    consumptions.push({ itemId: value, quantityConsumed: quantity });
  }

  const result = await apiFetch<BatchView>(`/api/v1/production/batches/${batchId}/packing`, {
    method: 'POST',
    authenticated: true,
    json: {
      packedQuantity,
      ...(rejectedQuantity ? { rejectedQuantity } : {}),
      ...(packVariant ? { packVariant } : {}),
      ...(consumptions.length > 0 ? { consumptions } : {}),
      ...(notes ? { notes } : {}),
    },
    timeoutMs: 20_000,
  });

  if (!result.ok) return { ok: false, message: result.error };

  revalidateWorkflow();

  return {
    ok: true,
    message: `Packing recorded for ${result.data.batchNumber}.`,
  };
}

export async function releaseBatchAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const batchId = String(formData.get('batchId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const notes = String(formData.get('notes') ?? '').trim();

  const DECISIONS = ['RELEASED', 'ON_HOLD', 'REJECTED'];

  if (!batchId || !DECISIONS.includes(decision)) {
    return { ok: false, message: 'Choose whether to release, hold or reject the batch.' };
  }

  if (decision !== 'RELEASED' && !notes) {
    return {
      ok: false,
      message: `Give a reason before ${decision === 'ON_HOLD' ? 'holding' : 'rejecting'} a batch.`,
    };
  }

  const result = await apiFetch<BatchView>(`/api/v1/production/batches/${batchId}/release`, {
    method: 'POST',
    authenticated: true,
    json: { decision, ...(notes ? { notes } : {}) },
    timeoutMs: 20_000,
  });

  if (!result.ok) return { ok: false, message: result.error };

  revalidateWorkflow();

  return {
    ok: true,
    message:
      decision === 'RELEASED'
        ? `${result.data.batchNumber} released. ${result.data.packedQuantity} units are now sellable stock.`
        : decision === 'ON_HOLD'
          ? `${result.data.batchNumber} held. It cannot be dispatched until the hold is resolved.`
          : `${result.data.batchNumber} rejected. It cannot be sold or dispatched through any channel.`,
  };
}

/**
 * What a batch of this size would consume, and whether it can be raised —
 * US-PROD-01.
 *
 * Read by the work-order form as the quantity is typed, so the requirement grid
 * and the Pass/Fail come from the SAME endpoint the save will check against.
 * The form deliberately does not do this arithmetic itself: a browser computing
 * its own answer would eventually disagree with the server, and the
 * disagreement surfaces as a save refused for reasons the page said were fine.
 */
export async function checkWorkOrderFeasibilityAction(
  productId: string,
  batchQuantity: string,
): Promise<{ ok: true; data: WorkOrderFeasibility } | { ok: false; message: string }> {
  if (!productId || !batchQuantity) {
    return { ok: false, message: 'Choose a product and enter a quantity.' };
  }

  const result = await apiFetch<WorkOrderFeasibility>(
    `/api/v1/production/orders/feasibility?productId=${encodeURIComponent(productId)}` +
      `&batchQuantity=${encodeURIComponent(batchQuantity)}`,
    { authenticated: true, timeoutMs: 20_000 },
  );

  if (!result.ok) return { ok: false, message: result.error };

  return { ok: true, data: result.data };
}

/**
 * The number the next work order would take — US-PROD-01.
 *
 * Asked of the server rather than worked out in the browser: the form only has
 * the orders on the current page, which a filter or a page boundary can make an
 * incomplete basis for "the highest so far". Nothing is reserved by asking.
 */
export async function nextWorkOrderNumberAction(): Promise<string | null> {
  const result = await apiFetch<{ orderNumber: string }>('/api/v1/production/orders/next-number', {
    authenticated: true,
    timeoutMs: 20_000,
  });

  // Null rather than an error: this is a convenience on a field nobody types
  // into, and a failed prediction must not stop a work order being raised.
  return result.ok ? result.data.orderNumber : null;
}

/**
 * The FEFO plan for one work order — what issuing it would consume.
 *
 * Fetched on demand so the dispense form can offer a CHOICE of work order. The
 * panel used to compute one plan on the server, for the oldest order awaiting
 * material, and the form was wired to that order alone: an officer with three
 * orders on the floor could dispense against exactly one of them, and nothing
 * on screen said why.
 *
 * Per order rather than all at once, because a plan costs an allocation query
 * per material — computing every waiting order's plan on every page load would
 * pay for orders nobody opens.
 */
export async function issuePlanAction(
  productionOrderId: string,
): Promise<{ ok: true; data: MaterialIssuePlan } | { ok: false; message: string }> {
  if (!productionOrderId) return { ok: false, message: 'Choose a work order.' };

  const result = await apiFetch<MaterialIssuePlan>(
    `/api/v1/production/orders/${productionOrderId}/issue-plan`,
    { authenticated: true, timeoutMs: 20_000 },
  );

  if (!result.ok) return { ok: false, message: result.error };

  return { ok: true, data: result.data };
}

/**
 * Stock lots as they stand right now.
 *
 * The dispense form is handed its lots by the server component that renders it
 * and then holds them for as long as it is open. That is a snapshot: a
 * colleague can dispense from the same lot, or QC can quarantine it, while
 * somebody is deciding — and the form would go on offering a quantity that is
 * no longer there, only to be refused at the moment it mattered.
 *
 * Asked for by the panel's Save, so the lot figures beside each chosen lot are
 * the current ones before the dispense is submitted. Nothing is reserved by
 * asking; this is a read.
 */
export async function stockLotsAction(): Promise<
  { ok: true; data: ProductionStockLot[] } | { ok: false; message: string }
> {
  const result = await apiFetch<ProductionStockLot[]>('/api/v1/production/stock-lots', {
    authenticated: true,
    timeoutMs: 20_000,
  });

  if (!result.ok) return { ok: false, message: result.error };

  return { ok: true, data: result.data };
}

/**
 * The number the next dispensing record would take — US-PROD-02.
 *
 * Same shape and same reasoning as the work-order number above: asked of the
 * server so the form shows the real series, null on failure so a field nobody
 * types into cannot stop material being dispensed.
 */
export async function nextIssueNumberAction(): Promise<string | null> {
  const result = await apiFetch<{ issueNumber: string }>('/api/v1/production/issues/next-number', {
    authenticated: true,
    timeoutMs: 20_000,
  });

  return result.ok ? result.data.issueNumber : null;
}
