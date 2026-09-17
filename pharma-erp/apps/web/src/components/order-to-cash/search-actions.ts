'use server';

import type {
  AllocationRow,
  DispatchListItem,
  PartySummary,
  ReceiptListItem,
  SalesInvoiceListItem,
  SalesOrderListItem,
  SalesReturnListItem,
} from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

/** What the dropdown renders: the term to search for, plus context for the eye. */
export interface Suggestion {
  /** Put into the search box when chosen. */
  value: string;
  /** Secondary line — the customer, the status, whatever disambiguates. */
  hint: string;
}

/** Enough to be useful, few enough to scan without scrolling. */
const LIMIT = 8;

/**
 * Autocomplete for the Order-to-Cash search boxes.
 *
 * REUSES THE LIST ENDPOINTS EACH TAB ALREADY CALLS — there is no suggestion
 * API, and adding one would mean a second definition of what "matches" means.
 * The list is fetched with the caller's own token and filtered here, so a role
 * the API refuses gets no suggestions rather than someone else's data.
 *
 * Returns [] rather than throwing for every failure. A suggestion list is a
 * convenience: if it cannot load, the search box must still work exactly as it
 * did before, and a dropdown is not the place to report an API outage.
 */
export async function suggestO2cAction(step: string, term: string): Promise<Suggestion[]> {
  const query = term.trim();

  // One character matches nearly everything, which is noise rather than help.
  if (query.length < 2) return [];

  const needle = query.toLowerCase();
  const matches = (...fields: (string | null | undefined)[]): boolean =>
    fields.some((field) => field?.toLowerCase().includes(needle));

  const take = (items: Suggestion[]): Suggestion[] => items.slice(0, LIMIT);

  switch (step) {
    case 'customers': {
      const result = await apiFetch<PartySummary[]>('/api/v1/parties?type=CUSTOMER', {
        authenticated: true,
      });
      if (!result.ok) return [];

      return take(
        result.data
          .filter((party) => matches(party.code, party.name, party.gstin))
          .map((party) => ({ value: party.name, hint: `${party.code} · ${party.status}` })),
      );
    }

    case 'sales-orders': {
      const result = await apiFetch<SalesOrderListItem[]>('/api/v1/order-to-cash/sales-orders', {
        authenticated: true,
      });
      if (!result.ok) return [];

      return take(
        result.data
          .filter((order) => matches(order.orderNumber, order.customerName))
          .map((order) => ({
            value: order.orderNumber,
            hint: `${order.customerName} · ${order.status}`,
          })),
      );
    }

    case 'allocation': {
      const result = await apiFetch<AllocationRow[]>('/api/v1/order-to-cash/allocation', {
        authenticated: true,
      });
      if (!result.ok) return [];

      // One order can hold many allocations; the same order number twice in a
      // dropdown is noise, so the first of each wins.
      const seen = new Set<string>();

      return take(
        result.data
          .filter((row) => matches(row.orderNumber, row.customerName, row.batchNumber))
          .filter((row) => {
            if (seen.has(row.orderNumber)) return false;
            seen.add(row.orderNumber);
            return true;
          })
          .map((row) => ({
            value: row.orderNumber,
            hint: `${row.customerName} · batch ${row.batchNumber}`,
          })),
      );
    }

    case 'dispatch': {
      const result = await apiFetch<DispatchListItem[]>('/api/v1/order-to-cash/dispatch', {
        authenticated: true,
      });
      if (!result.ok) return [];

      return take(
        result.data
          .filter((dispatch) =>
            matches(dispatch.dispatchNumber, dispatch.orderNumber, dispatch.customerName),
          )
          .map((dispatch) => ({
            value: dispatch.dispatchNumber,
            hint: `${dispatch.customerName} · ${dispatch.status}`,
          })),
      );
    }

    case 'invoices': {
      const result = await apiFetch<SalesInvoiceListItem[]>(
        '/api/v1/order-to-cash/sales-invoices',
        { authenticated: true },
      );
      if (!result.ok) return [];

      return take(
        result.data
          .filter((invoice) => matches(invoice.invoiceNumber, invoice.customerName))
          .map((invoice) => ({
            value: invoice.invoiceNumber,
            hint: `${invoice.customerName} · ${invoice.paymentStatus}`,
          })),
      );
    }

    case 'receipts': {
      const result = await apiFetch<ReceiptListItem[]>('/api/v1/order-to-cash/receipts', {
        authenticated: true,
      });
      if (!result.ok) return [];

      return take(
        result.data
          .filter((receipt) =>
            matches(
              receipt.receiptNumber,
              receipt.customerName,
              receipt.invoiceNumber,
              receipt.referenceNumber,
            ),
          )
          .map((receipt) => ({
            value: receipt.receiptNumber,
            hint: `${receipt.customerName} · ${receipt.invoiceNumber}`,
          })),
      );
    }

    case 'returns': {
      const result = await apiFetch<SalesReturnListItem[]>(
        '/api/v1/order-to-cash/sales-returns',
        { authenticated: true },
      );
      if (!result.ok) return [];

      return take(
        result.data
          .filter((salesReturn) =>
            matches(
              salesReturn.returnNumber,
              salesReturn.customerName,
              salesReturn.invoiceNumber,
            ),
          )
          .map((salesReturn) => ({
            value: salesReturn.returnNumber,
            hint: `${salesReturn.customerName} · ${salesReturn.status}`,
          })),
      );
    }

    default:
      return [];
  }
}
