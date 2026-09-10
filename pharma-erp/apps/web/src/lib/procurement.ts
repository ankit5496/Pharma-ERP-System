import type {
  GoodsReceiptListItem,
  ItemStockPosition,
  ItemSummary,
  LowStockItem,
  PartySummary,
  ProcurementListQuery,
  ProcurementSummary,
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
    dateFrom: first('dateFrom'),
    dateTo: first('dateTo'),
  };
}

function queryString(query: ProcurementListQuery): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }

  return params.toString() ? `?${params}` : '';
}

const BASE = '/api/v1/procurement';

export async function fetchSummary(): Promise<ApiResult<ProcurementSummary>> {
  return apiFetch<ProcurementSummary>(`${BASE}/summary`, { authenticated: true });
}

export async function fetchLowStock(): Promise<ApiResult<LowStockItem[]>> {
  return apiFetch<LowStockItem[]>(`${BASE}/low-stock`, { authenticated: true });
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

export async function fetchRequisitions(
  query: ProcurementListQuery,
): Promise<ApiResult<RequisitionListItem[]>> {
  return apiFetch<RequisitionListItem[]>(`${BASE}/requisitions${queryString(query)}`, {
    authenticated: true,
  });
}

export async function fetchPurchaseOrders(
  query: ProcurementListQuery,
): Promise<ApiResult<PurchaseOrderListItem[]>> {
  return apiFetch<PurchaseOrderListItem[]>(`${BASE}/purchase-orders${queryString(query)}`, {
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
): Promise<ApiResult<GoodsReceiptListItem[]>> {
  return apiFetch<GoodsReceiptListItem[]>(`${BASE}/goods-receipts${queryString(query)}`, {
    authenticated: true,
  });
}

export async function fetchQcQueue(
  query: ProcurementListQuery,
): Promise<ApiResult<QcQueueItem[]>> {
  return apiFetch<QcQueueItem[]>(`${BASE}/qc/lots${queryString(query)}`, { authenticated: true });
}

export async function fetchInvoices(
  query: ProcurementListQuery,
): Promise<ApiResult<PurchaseInvoiceListItem[]>> {
  return apiFetch<PurchaseInvoiceListItem[]>(`${BASE}/invoices${queryString(query)}`, {
    authenticated: true,
  });
}

export async function fetchPayables(
  query: ProcurementListQuery,
): Promise<ApiResult<VendorPayableRow[]>> {
  return apiFetch<VendorPayableRow[]>(`${BASE}/payables${queryString(query)}`, {
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
