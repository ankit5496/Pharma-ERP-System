'use server';

import { revalidatePath } from 'next/cache';

import type {
  BatchView,
  MaterialIssueView,
  ProductionOrderSummary,
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
  const overrides: { itemId: string; lotId: string; quantity: string; reason: string }[] = [];
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

    if (!reason) {
      missingReason.add(itemId);
      continue;
    }

    overrides.push({ itemId, lotId: value, quantity, reason });
  }

  if (missingReason.size > 0) {
    return {
      ok: false,
      message:
        'Choosing a lot other than the suggested one needs a reason. Fill in the reason for ' +
        `${missingReason.size === 1 ? 'the material' : 'each material'} you picked lots for.`,
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

  if (!batchId || (decision !== 'RELEASED' && decision !== 'BLOCKED')) {
    return { ok: false, message: 'Choose whether to release or block the batch.' };
  }

  if (decision === 'BLOCKED' && !notes) {
    return { ok: false, message: 'Give a reason before blocking a batch.' };
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
        : `${result.data.batchNumber} blocked. It cannot be sold through any channel.`,
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
