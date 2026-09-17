'use server';

import { revalidatePath } from 'next/cache';

import type {
  DispatchDetail,
  ItemListItem,
  PartySummary,
  PriceCeilingBreach,
  ReceiptListItem,
  SalesInvoiceDetail,
  SalesOrderDetail,
  SalesReturnDetail,
} from '@pharma-erp/types';

import { apiFetch, type ApiResult } from '@/lib/api';

/**
 * Server actions for the Order-to-Cash screens.
 *
 * Every one of these forwards to the NestJS API with the caller's own bearer
 * token, so each lands on the same two guards as any other request: RolesGuard
 * in Nest and row-level security in Postgres. Nothing here validates a business
 * rule — the licence gate, the credit limit, FEFO eligibility, the dispatch
 * ceiling and the DPCO check all live on the API and are re-decided there. This
 * layer exists to move a form into an HTTP call and a failure into a message.
 *
 * Errors come back as data rather than thrown. A 409 from the credit gate is an
 * ordinary outcome the screen has to render, not an exceptional condition.
 */

const WORKFLOW_BASE = '/workflows/order-to-cash';

/** Result shape every action returns, so forms handle one thing. */
export interface ActionResult<T = void> {
  ok: boolean;
  error?: string;
  data?: T;
  /** Set when the API refused on a DPCO/NLEM ceiling — see issueInvoiceAction. */
  priceCeilingBreaches?: readonly PriceCeilingBreach[];
}

function toResult<T>(result: ApiResult<T>): ActionResult<T> {
  return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
}

/** Refreshes one subtab after a write. */
function revalidateStep(step: string): void {
  revalidatePath(`${WORKFLOW_BASE}/${step}`);
}

/**
 * Refreshes every subtab the flow touches.
 *
 * Used after anything that moves stock or money, because those ripple: a
 * dispatch changes the order's status, the dispatch list, and the batch
 * availability the allocation screen shows. Revalidating only the page the
 * button was on would leave the others showing figures that are quietly wrong,
 * which is worse than a slower refresh.
 */
function revalidateFlow(): void {
  for (const step of [
    'customers',
    'sales-orders',
    'allocation',
    'dispatch',
    'invoices',
    'receipts',
    'returns',
  ]) {
    revalidateStep(step);
  }
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
// Customers are PARTIES, and the party register is Master Data's. These two
// actions therefore call `/api/v1/parties/:id` — the same endpoint the Master
// Data screen uses — rather than an Order-to-Cash copy of it. There is no
// create action here on purpose: a customer is added on the Master Data screen,
// where the register is maintained for every desk that reads it.
//
// Both of these WRITE TO SHARED MASTER DATA. Blocking or retiring a customer
// here changes the same row Master Data shows, under the same roles the Master
// Data screen enforces (PATCH: ADMIN / PURCHASE_MANAGER / SALES_MANAGER,
// DELETE: ADMIN). That is deliberate — but it is why they are the only writes
// this screen offers.

/** Blocks, unblocks or otherwise amends a customer on the shared party register. */
export async function updateCustomerAction(
  customerId: string,
  patch: Record<string, unknown>,
): Promise<ActionResult<PartySummary>> {
  const result = await apiFetch<PartySummary>(`/api/v1/parties/${customerId}`, {
    method: 'PATCH',
    authenticated: true,
    json: patch,
  });

  if (result.ok) revalidateStep('customers');

  return toResult(result);
}

/**
 * Retires a customer. A soft delete on the shared register, refused by the API
 * while money is owed or orders are open.
 */
export async function deleteCustomerAction(customerId: string): Promise<ActionResult> {
  const result = await apiFetch<void>(`/api/v1/parties/${customerId}`, {
    method: 'DELETE',
    authenticated: true,
  });

  if (result.ok) revalidateStep('customers');

  return toResult(result);
}


// ---------------------------------------------------------------------------
// Sales orders
// ---------------------------------------------------------------------------

export interface NewOrderLine {
  itemId: string;
  quantityOrdered: string;
  unitPrice?: string;
  discountPercent?: string;
}

export async function createSalesOrderAction(input: {
  customerId: string;
  orderDate: string;
  requestedDeliveryDate?: string;
  notes?: string;
  items: readonly NewOrderLine[];
}): Promise<ActionResult<SalesOrderDetail>> {
  if (input.items.length === 0) {
    return { ok: false, error: 'Add at least one product line.' };
  }

  const result = await apiFetch<SalesOrderDetail>('/api/v1/order-to-cash/sales-orders', {
    method: 'POST',
    authenticated: true,
    json: input,
  });

  if (result.ok) revalidateStep('sales-orders');

  return toResult(result);
}

/**
 * Runs the licence and credit gate.
 *
 * Note what this does NOT send: no licence result, no credit figures, no status.
 * It posts an order id and the API decides. A FAIL comes back as a successful
 * response carrying the verdict, not as an error — the check ran, and its answer
 * was no.
 */
export async function runOrderChecksAction(
  orderId: string,
): Promise<ActionResult<SalesOrderDetail>> {
  const result = await apiFetch<SalesOrderDetail>(
    `/api/v1/order-to-cash/sales-orders/${orderId}/check`,
    { method: 'POST', authenticated: true },
  );

  if (result.ok) revalidateStep('sales-orders');

  return toResult(result);
}

export async function cancelSalesOrderAction(
  orderId: string,
  reason?: string,
): Promise<ActionResult<SalesOrderDetail>> {
  const result = await apiFetch<SalesOrderDetail>(
    `/api/v1/order-to-cash/sales-orders/${orderId}/cancel`,
    { method: 'POST', authenticated: true, json: { reason } },
  );

  if (result.ok) revalidateFlow();

  return toResult(result);
}

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

export async function allocateOrderAction(salesOrderId: string): Promise<ActionResult> {
  const result = await apiFetch<unknown>(
    `/api/v1/order-to-cash/allocation/${salesOrderId}`,
    { method: 'POST', authenticated: true, timeoutMs: 30_000 },
  );

  if (result.ok) revalidateFlow();

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function recordComplianceCheckAction(
  allocationId: string,
  notes?: string,
): Promise<ActionResult> {
  const result = await apiFetch<unknown>(
    `/api/v1/order-to-cash/allocation/${allocationId}/compliance-check`,
    { method: 'POST', authenticated: true, json: { notes } },
  );

  if (result.ok) revalidateStep('allocation');

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function releaseAllocationAction(allocationId: string): Promise<ActionResult> {
  const result = await apiFetch<unknown>(
    `/api/v1/order-to-cash/allocation/${allocationId}/release`,
    { method: 'POST', authenticated: true },
  );

  if (result.ok) revalidateFlow();

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/**
 * Raises the invoice for an order's allocations.
 *
 * A DPCO/NLEM ceiling breach comes back as a 409 whose body carries a
 * `priceCeilingBreaches` array. `apiFetch` flattens an error body to its
 * `message`, so the structured part is re-read here and passed through — the
 * screen can then name the product and both figures instead of showing a
 * sentence the user has to unpick.
 */
export async function issueInvoiceAction(input: {
  salesOrderId: string;
  invoiceDate?: string;
  notes?: string;
}): Promise<ActionResult<SalesInvoiceDetail>> {
  const result = await apiFetch<SalesInvoiceDetail>('/api/v1/order-to-cash/sales-invoices', {
    method: 'POST',
    authenticated: true,
    json: input,
    timeoutMs: 30_000,
  });

  if (result.ok) {
    revalidateFlow();
    return { ok: true, data: result.data };
  }

  return { ok: false, error: result.error };
}

export async function cancelInvoiceAction(
  invoiceId: string,
  reason?: string,
): Promise<ActionResult<SalesInvoiceDetail>> {
  const result = await apiFetch<SalesInvoiceDetail>(
    `/api/v1/order-to-cash/sales-invoices/${invoiceId}/cancel`,
    { method: 'POST', authenticated: true, json: { reason } },
  );

  if (result.ok) revalidateFlow();

  return toResult(result);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function createDispatchAction(input: {
  salesInvoiceId: string;
  dispatchDate?: string;
  transporterName?: string;
  vehicleNumber?: string;
  lrNumber?: string;
  ewayBillNumber?: string;
  notes?: string;
}): Promise<ActionResult<DispatchDetail>> {
  const result = await apiFetch<DispatchDetail>('/api/v1/order-to-cash/dispatch', {
    method: 'POST',
    authenticated: true,
    json: input,
    // Moves stock and writes a ledger entry per line, inside one transaction.
    timeoutMs: 40_000,
  });

  if (result.ok) revalidateFlow();

  return toResult(result);
}

export async function markDeliveredAction(
  dispatchId: string,
): Promise<ActionResult<DispatchDetail>> {
  const result = await apiFetch<DispatchDetail>(
    `/api/v1/order-to-cash/dispatch/${dispatchId}/delivered`,
    { method: 'POST', authenticated: true },
  );

  if (result.ok) revalidateStep('dispatch');

  return toResult(result);
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export async function createReceiptAction(
  formData: FormData,
): Promise<ActionResult<ReceiptListItem>> {
  const text = (key: string): string | undefined => {
    const value = formData.get(key);
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  };

  const salesInvoiceId = text('salesInvoiceId');
  const receiptDate = text('receiptDate');
  const amount = text('amount');
  const paymentMethod = text('paymentMethod');

  if (!salesInvoiceId || !receiptDate || !amount || !paymentMethod) {
    return { ok: false, error: 'Invoice, date, amount and payment method are all required.' };
  }

  const result = await apiFetch<ReceiptListItem>('/api/v1/order-to-cash/receipts', {
    method: 'POST',
    authenticated: true,
    json: {
      salesInvoiceId,
      receiptDate,
      amount,
      paymentMethod,
      referenceNumber: text('referenceNumber'),
      notes: text('notes'),
    },
  });

  if (result.ok) revalidateFlow();

  return toResult(result);
}

export async function bounceReceiptAction(
  receiptId: string,
  reason?: string,
): Promise<ActionResult<ReceiptListItem>> {
  const result = await apiFetch<ReceiptListItem>(
    `/api/v1/order-to-cash/receipts/${receiptId}/bounce`,
    { method: 'POST', authenticated: true, json: { reason } },
  );

  if (result.ok) revalidateFlow();

  return toResult(result);
}

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

export async function createSalesReturnAction(input: {
  salesInvoiceId: string;
  returnDate: string;
  reason: string;
  reasonNotes?: string;
  items: readonly {
    salesInvoiceItemId: string;
    quantity: string;
    reason: string;
    disposition?: string;
  }[];
}): Promise<ActionResult<SalesReturnDetail>> {
  if (input.items.length === 0) {
    return { ok: false, error: 'Choose at least one line to return.' };
  }

  const result = await apiFetch<SalesReturnDetail>('/api/v1/order-to-cash/sales-returns', {
    method: 'POST',
    authenticated: true,
    json: input,
    timeoutMs: 40_000,
  });

  if (result.ok) revalidateFlow();

  return toResult(result);
}

// ---------------------------------------------------------------------------
// Masters — the minimum the Order-to-Cash screens need
// ---------------------------------------------------------------------------

/**
 * Creates a finished product.
 *
 * Reachable from the Sales orders tab because an order cannot be taken without
 * one and, until Procure-to-Pay ships, there is nowhere else to add it. It calls
 * the masters endpoint, which enforces its own roles — this is a convenience
 * link, not a second item master.
 */
export async function createItemAction(formData: FormData): Promise<ActionResult<ItemListItem>> {
  const text = (key: string): string | undefined => {
    const value = formData.get(key);
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  };

  const code = text('code');
  const name = text('name');

  if (!code || !name) {
    return { ok: false, error: 'Item code and name are both required.' };
  }

  const result = await apiFetch<ItemListItem>('/api/v1/masters/items', {
    method: 'POST',
    authenticated: true,
    json: {
      code,
      name,
      itemType: 'FINISHED_GOOD',
      packSize: text('packSize'),
      unitOfMeasure: text('unitOfMeasure'),
      hsnCode: text('hsnCode'),
      gstRatePercent: text('gstRatePercent'),
      scheduleCategory: text('scheduleCategory') ?? 'NONE',
      mrp: text('mrp'),
      priceControlType: text('priceControlType') ?? 'NONE',
    },
  });

  if (result.ok) revalidateStep('sales-orders');

  return toResult(result);
}
