'use server';

import { revalidatePath } from 'next/cache';

import type { BatchView, MaterialIssueView, ProductionOrderSummary } from '@pharma-erp/types';

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

  const result = await apiFetch<MaterialIssueView>(`/api/v1/production/orders/${orderId}/issue`, {
    method: 'POST',
    authenticated: true,
    timeoutMs: 30_000,
  });

  if (!result.ok) return { ok: false, message: result.error };

  revalidateWorkflow();

  return {
    ok: true,
    message: `Dispensed ${result.data.lines.length} lot${
      result.data.lines.length === 1 ? '' : 's'
    } against the order.`,
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
  const notes = String(formData.get('notes') ?? '').trim();

  if (!batchId || !packedQuantity) {
    return { ok: false, message: 'Enter the quantity packed.' };
  }

  const result = await apiFetch<BatchView>(`/api/v1/production/batches/${batchId}/packing`, {
    method: 'POST',
    authenticated: true,
    json: { packedQuantity, ...(notes ? { notes } : {}) },
    timeoutMs: 20_000,
  });

  if (!result.ok) return { ok: false, message: result.error };

  revalidateWorkflow();

  return { ok: true, message: `Packing recorded for ${result.data.batchNumber}.` };
}

/**
 * The quality gate.
 *
 * No confirmation step here — the form itself is the confirmation, and the
 * button is labelled with what it does. What matters is that the API refuses a
 * second decision, so a double-submit cannot quietly overwrite a verdict.
 */
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
