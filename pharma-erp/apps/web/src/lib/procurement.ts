import type {
  GoodsReceiptListItem,
  PayablesReport,
  BomSummary,
  ProductionPlanSummary,
  ItemStockPosition,
  ItemSummary,
  RequiredStockLine,
  PartySummary,
  Paginated,
  ProcurementListQuery,
  ProcurementSettings,
  ProcurementSummary,
  StockLedgerRow,
  PurchaseInvoiceListItem,
  PurchaseOrderListItem,
  QcQueueItem,
  RequisitionListItem,
  VendorPayableRow,
} from '@pharma-erp/types';

import { apiFetch, type ApiResult } from './api';

/**
 * Typed reads for the Procure-to-Pay screens.
 *
 * Every call goes through `apiFetch` with `authenticated: true`, so it carries
 * the caller's own bearer token and lands on the same guards as any other
 * route: role checks in NestJS, row-level security in Postgres. Nothing here
 * decides what a user may see — it only asks.
 */

/** Turns a page's searchParams into the query the API expects. */
export function toListQuery(params: Record<string, string | string[] | undefined>): ProcurementListQuery {
  const first = (key: string): string | undefined => {
    const value = params[key];
    const single = Array.isArray(value) ? value[0] : value;

    return single && single.length > 0 ? single : undefined;
  };

  return {
    search: first('search'),
    status: first('status'),
    vendorId: first('vendorId'),
    itemId: first('itemId'),
    triggerType: first('triggerType'),
    raisedById: first('raisedById'),
    requisitionId: first('requisitionId'),
    dateFrom: first('dateFrom'),
    dateTo: first('dateTo'),
    page: toPositiveInt(first('page')),
    pageSize: toPositiveInt(first('pageSize')),
  };
}

/**
 * A query-string number, or undefined.
 *
 * Anything that is not a positive whole number is dropped rather than passed
 * on: the API clamps what it is given, and a `page=abc` that reaches it as NaN
 * would be a validation error for what is really just a bad link.
 */
function toPositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function queryString(query: ProcurementListQuery): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, String(value));
  }

  return params.toString() ? `?${params}` : '';
}

const BASE = '/api/v1/procurement';

export async function fetchSummary(): Promise<ApiResult<ProcurementSummary>> {
  return apiFetch<ProcurementSummary>(`${BASE}/summary`, { authenticated: true });
}

/** The company's Procure-to-Pay settings — today, the Auto Creation flag. */
export async function fetchProcurementSettings(): Promise<ApiResult<ProcurementSettings>> {
  return apiFetch<ProcurementSettings>(`${BASE}/settings`, { authenticated: true });
}

/**
 * What live sales orders need, against what is free.
 *
 * The endpoint runs the Auto pass before answering, so opening the tab both
 * reports the shortages and raises the requisitions for them where Auto is on.
 */
export async function fetchRequiredStock(): Promise<ApiResult<RequiredStockLine[]>> {
  return apiFetch<RequiredStockLine[]>(`${BASE}/required-stock`, {
    authenticated: true,
    // A requirement is a formulation scaled across every live order, and the
    // pass that raises requisitions runs first. The default is too short for
    // that against this database.
    timeoutMs: 60_000,
  });
}

export async function fetchStockPositions(): Promise<ApiResult<ItemStockPosition[]>> {
  return apiFetch<ItemStockPosition[]>(`${BASE}/stock`, { authenticated: true });
}

export async function fetchItems(): Promise<ApiResult<ItemSummary[]>> {
  return apiFetch<ItemSummary[]>(`${BASE}/items`, { authenticated: true });
}

export async function fetchVendors(): Promise<ApiResult<PartySummary[]>> {
  return apiFetch<PartySummary[]>(`${BASE}/parties?partyType=VENDOR`, { authenticated: true });
}

/** Formulations from the shared master data, for a plan to cite. */
export async function fetchBoms(): Promise<ApiResult<BomSummary[]>> {
  return apiFetch<BomSummary[]>(`${BASE}/boms`, { authenticated: true });
}

export async function fetchProductionPlans(): Promise<ApiResult<ProductionPlanSummary[]>> {
  return apiFetch<ProductionPlanSummary[]>(`${BASE}/production-plans`, { authenticated: true });
}

/** The aged outstanding-payables report, optionally narrowed to one vendor. */
/** The stock ledger — every movement, newest first. Optionally one item. */
export async function fetchStockLedger(itemId?: string): Promise<ApiResult<StockLedgerRow[]>> {
  const suffix = itemId ? `?itemId=${encodeURIComponent(itemId)}` : '';

  return apiFetch<StockLedgerRow[]>(`${BASE}/stock/ledger${suffix}`, { authenticated: true });
}

export async function fetchPayablesReport(vendorId?: string): Promise<ApiResult<PayablesReport>> {
  const suffix = vendorId ? `?vendorId=${encodeURIComponent(vendorId)}` : '';

  return apiFetch<PayablesReport>(`${BASE}/payables/report${suffix}`, { authenticated: true });
}

export async function fetchRequisitions(
  query: ProcurementListQuery,
): Promise<ApiResult<Paginated<RequisitionListItem>>> {
  return apiFetch<Paginated<RequisitionListItem>>(`${BASE}/requisitions${queryString(query)}`, {
    authenticated: true,
  });
}

export async function fetchPurchaseOrders(
  query: ProcurementListQuery,
): Promise<ApiResult<Paginated<PurchaseOrderListItem>>> {
  return apiFetch<Paginated<PurchaseOrderListItem>>(`${BASE}/purchase-orders${queryString(query)}`, {
    authenticated: true,
  });
}

/** Unplaced drafts, for the draft table above the register. */
export async function fetchDraftOrders(): Promise<ApiResult<PurchaseOrderListItem[]>> {
  return apiFetch<PurchaseOrderListItem[]>(`${BASE}/purchase-orders/drafts`, {
    authenticated: true,
  });
}

export async function fetchReceivableOrders(): Promise<ApiResult<PurchaseOrderListItem[]>> {
  return apiFetch<PurchaseOrderListItem[]>(`${BASE}/purchase-orders/receivable`, {
    authenticated: true,
  });
}

export async function fetchInvoiceableOrders(): Promise<ApiResult<PurchaseOrderListItem[]>> {
  return apiFetch<PurchaseOrderListItem[]>(`${BASE}/purchase-orders/invoiceable`, {
    authenticated: true,
  });
}

export async function fetchGoodsReceipts(
  query: ProcurementListQuery,
): Promise<ApiResult<Paginated<GoodsReceiptListItem>>> {
  return apiFetch<Paginated<GoodsReceiptListItem>>(`${BASE}/goods-receipts${queryString(query)}`, {
    authenticated: true,
  });
}

export async function fetchQcQueue(
  query: ProcurementListQuery,
): Promise<ApiResult<Paginated<QcQueueItem>>> {
  return apiFetch<Paginated<QcQueueItem>>(`${BASE}/qc/lots${queryString(query)}`, { authenticated: true });
}

export async function fetchInvoices(
  query: ProcurementListQuery,
): Promise<ApiResult<Paginated<PurchaseInvoiceListItem>>> {
  return apiFetch<Paginated<PurchaseInvoiceListItem>>(`${BASE}/invoices${queryString(query)}`, {
    authenticated: true,
  });
}

export async function fetchPayables(
  query: ProcurementListQuery,
): Promise<ApiResult<Paginated<VendorPayableRow>>> {
  return apiFetch<Paginated<VendorPayableRow>>(`${BASE}/payables${queryString(query)}`, {
    authenticated: true,
  });
}

/** Vendors and items as filter-bar options. */
export function toOptions(
  rows: readonly { id: string; name: string; code?: string }[],
): { value: string; label: string }[] {
  return rows.map((row) => ({
    value: row.id,
    label: row.code ? `${row.code} — ${row.name}` : row.name,
  }));
}

/**
 * Colleagues, for the Created By filter.
 *
 * ONE LOOKUP FOR BOTH MODULES. Procure-to-Pay and Job Work ask the same
 * question of the same table and share the filter control, so a second source
 * would be a second answer free to disagree with this one.
 *
 * Returned as filter options rather than raw rows, because that is the only
 * shape any caller wants.
 */
export async function fetchPeopleOptions(): Promise<{ value: string; label: string }[]> {
  const people = await apiFetch<{ id: string; name: string }[]>(`${BASE}/people`, {
    authenticated: true,
  });

  return people.ok ? people.data.map((person) => ({ value: person.id, label: person.name })) : [];
}
