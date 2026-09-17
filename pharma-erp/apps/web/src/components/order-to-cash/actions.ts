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
// Only ONE action remains. Block and Remove were taken out of this screen:
// halting or withdrawing a customer reaches past the sales desk to purchasing
// and job work, which read the same row, so both belong on the Master Data
// screen. Amending one still WRITES TO SHARED MASTER DATA, under the roles the
// Master Data screen enforces (ADMIN / PURCHASE_MANAGER / SALES_MANAGER).

/** Amends a customer on the shared party register. */
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
    // Creating an order is now FOUR steps server-side — the released-stock
    // check, the order itself, the licence/credit gate, then FEFO allocation.
    // Against a remote database each step is several round trips, so the
    // default 30s budget expires while the work is still succeeding. Timing out
    // here is the worst outcome available: the order is created and allocated,
    // and the screen says it failed, which invites a duplicate.
    timeoutMs: 90_000,
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
 * Raises the tax invoice for a CONFIRMED DISPATCH.
 *
 * The dispatch, not the order, is what the API bills — `CreateSalesInvoiceDto`
 * takes `{ dispatchId, invoiceDate, notes? }` and the service reads the lines
 * from what actually shipped. Posting `salesOrderId` is what produced
 * "property salesOrderId should not exist": the DTO uses a whitelisting
 * validation pipe, so an unknown field is a refusal rather than an ignored key.
 *
 * `invoiceDate` is REQUIRED and must parse as ISO 8601. It is defaulted here
 * rather than made optional on the API: an invoice with no date is not a
 * document anyone can file, and the server should not have to guess which day
 * the user meant.
 *
 * A DPCO/NLEM ceiling breach comes back as a 409 whose body carries a
 * `priceCeilingBreaches` array. `apiFetch` flattens an error body to its
 * `message`, so the structured part is re-read here and passed through — the
 * screen can then name the product and both figures instead of showing a
 * sentence the user has to unpick.
 */
export async function issueInvoiceAction(input: {
  dispatchId: string;
  invoiceDate?: string;
  notes?: string;
}): Promise<ActionResult<SalesInvoiceDetail>> {
  const result = await apiFetch<SalesInvoiceDetail>('/api/v1/order-to-cash/sales-invoices', {
    method: 'POST',
    authenticated: true,
    json: {
      dispatchId: input.dispatchId,
      // Full ISO 8601 with offset. `new Date().toISOString()` satisfies
      // @IsISO8601(); a bare "YYYY-MM-DD" would too, but sending the instant
      // keeps the client and server agreeing on which day it is near midnight.
      invoiceDate: input.invoiceDate ?? new Date().toISOString(),
      ...(input.notes ? { notes: input.notes } : {}),
    },
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

/**
 * Records a dispatch against an order's ALLOCATIONS.
 *
 * The allocation is what is shipped, not an invoice — the invoice is raised
 * afterwards, against what actually left (see WORKFLOWS: step 4 is Dispatch,
 * step 5 is "Tax invoices raised against a dispatch"). `CreateDispatchDto`
 * takes `{ dispatchDate, lines: [{ batchAllocationId, quantityDispatched }] }`.
 *
 * Quantities are not typed by the user: each line ships what remains allocated
 * on that batch, which is what makes "cannot dispatch more than allocated"
 * structural rather than a rule someone could get around. The API re-checks it
 * anyway, along with the allocated ceiling.
 */
export async function createDispatchAction(input: {
  dispatchDate: string;
  lines: readonly { batchAllocationId: string; quantityDispatched: string }[];
  transporterName?: string;
  vehicleNumber?: string;
  lrNumber?: string;
  ewayBillNumber?: string;
  notes?: string;
}): Promise<ActionResult<DispatchDetail>> {
  if (input.lines.length === 0) {
    return { ok: false, error: 'Nothing is left to ship on that order.' };
  }

  const result = await apiFetch<DispatchDetail>('/api/v1/order-to-cash/dispatch', {
    method: 'POST',
    authenticated: true,
    json: {
      // Full ISO 8601: the date input gives "YYYY-MM-DD", which @IsISO8601
      // accepts, but sending the instant keeps client and server agreeing on
      // the day near midnight.
      dispatchDate: new Date(`${input.dispatchDate}T00:00:00.000Z`).toISOString(),
      lines: input.lines.map((line) => ({
        batchAllocationId: line.batchAllocationId,
        quantityDispatched: line.quantityDispatched,
      })),
      ...(input.transporterName ? { transporterName: input.transporterName } : {}),
      ...(input.vehicleNumber ? { vehicleNumber: input.vehicleNumber } : {}),
      ...(input.lrNumber ? { lrNumber: input.lrNumber } : {}),
      ...(input.ewayBillNumber ? { ewayBillNumber: input.ewayBillNumber } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
    },
    // Moves stock and writes a ledger entry per line, inside one transaction.
    timeoutMs: 40_000,
  });

  if (result.ok) revalidateFlow();

  return toResult(result);
}

/**
 * Confirms a draft dispatch: stock leaves the lot and the allocations advance.
 *
 * Separate from creating it because creating writes the picking list and
 * confirming is what actually moves inventory — and it is the point at which
 * the API re-checks the allocated ceiling.
 */
export async function confirmDispatchAction(
  dispatchId: string,
): Promise<ActionResult<DispatchDetail>> {
  const result = await apiFetch<DispatchDetail>(
    `/api/v1/order-to-cash/dispatch/${dispatchId}/confirm`,
    { method: 'POST', authenticated: true, timeoutMs: 40_000 },
  );

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

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------
// Every one of these is guarded server-side by state, and the field lists below
// are exactly what each DTO whitelists. Nothing here decides what may change —
// the API does, and it refuses the rest. These exist to turn a form into a
// request and a refusal into a sentence.

export async function updateSalesOrderAction(
  salesOrderId: string,
  patch: Record<string, unknown>,
): Promise<ActionResult<SalesOrderDetail>> {
  const result = await apiFetch<SalesOrderDetail>(
    `/api/v1/order-to-cash/sales-orders/${salesOrderId}`,
    { method: 'PATCH', authenticated: true, json: patch },
  );

  if (result.ok) revalidateFlow();

  return toResult(result);
}

export async function updateAllocationAction(
  allocationId: string,
  patch: Record<string, unknown>,
): Promise<ActionResult> {
  const result = await apiFetch<unknown>(
    `/api/v1/order-to-cash/allocation/${allocationId}`,
    { method: 'PATCH', authenticated: true, json: patch },
  );

  if (result.ok) revalidateFlow();

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function updateDispatchAction(
  dispatchId: string,
  patch: Record<string, unknown>,
): Promise<ActionResult<DispatchDetail>> {
  const result = await apiFetch<DispatchDetail>(`/api/v1/order-to-cash/dispatch/${dispatchId}`, {
    method: 'PATCH',
    authenticated: true,
    json: patch,
  });

  if (result.ok) revalidateFlow();

  return toResult(result);
}

export async function updateInvoiceAction(
  invoiceId: string,
  patch: Record<string, unknown>,
): Promise<ActionResult<SalesInvoiceDetail>> {
  const result = await apiFetch<SalesInvoiceDetail>(
    `/api/v1/order-to-cash/sales-invoices/${invoiceId}`,
    { method: 'PATCH', authenticated: true, json: patch },
  );

  if (result.ok) revalidateFlow();

  return toResult(result);
}

export async function updateReceiptAction(
  receiptId: string,
  patch: Record<string, unknown>,
): Promise<ActionResult<ReceiptListItem>> {
  const result = await apiFetch<ReceiptListItem>(`/api/v1/order-to-cash/receipts/${receiptId}`, {
    method: 'PATCH',
    authenticated: true,
    json: patch,
  });

  if (result.ok) revalidateFlow();

  return toResult(result);
}

export async function updateSalesReturnAction(
  salesReturnId: string,
  patch: Record<string, unknown>,
): Promise<ActionResult<SalesReturnDetail>> {
  const result = await apiFetch<SalesReturnDetail>(
    `/api/v1/order-to-cash/sales-returns/${salesReturnId}`,
    { method: 'PATCH', authenticated: true, json: patch },
  );

  if (result.ok) revalidateFlow();

  return toResult(result);
}
