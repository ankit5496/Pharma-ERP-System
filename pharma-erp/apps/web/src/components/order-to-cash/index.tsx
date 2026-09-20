import { Suspense } from 'react';

import type { Filters } from './filtering';

import { AllocationPanel } from './allocation-panel';
import { CustomersPanel } from './customers-panel';
import { DispatchPanel } from './dispatch-panel';
import { InvoicesPanel } from './invoices-panel';
import { ReceiptsPanel } from './receipts-panel';
import { ReturnsPanel } from './returns-panel';
import { SalesOrdersPanel } from './sales-orders-panel';

/**
 * Maps an Order-to-Cash step key to its screen.
 *
 * The workflow route stays a single dynamic page — `[workflow]/[step]` — and
 * this is the one branch inside it, which keeps the promise the existing route
 * makes: adding a step is a data change in WORKFLOWS, not a new route file.
 *
 * Returning null for an unknown step lets the page fall back to its own
 * placeholder, so a step whose `state` is still 'planned' keeps saying so
 * honestly rather than rendering an empty table.
 */
export function OrderToCashStep({
  step,
  search,
  filters = {},
}: {
  step: string;
  search?: string;
  /**
   * Every query parameter the Filter panel has written. Each tab reads the
   * ones it declares and ignores the rest, so a filter can be added to one tab
   * without touching the page that renders all of them.
   */
  filters?: Filters;
}) {
  switch (step) {
    case 'customers':
      return <Loading label="customers">{<CustomersPanel search={search} filters={filters} />}</Loading>;
    case 'sales-orders':
      return <Loading label="sales orders">{<SalesOrdersPanel search={search} filters={filters} />}</Loading>;
    case 'allocation':
      return <Loading label="allocations">{<AllocationPanel search={search} filters={filters} />}</Loading>;
    case 'dispatch':
      return <Loading label="dispatches">{<DispatchPanel search={search} filters={filters} />}</Loading>;
    case 'invoices':
      return <Loading label="invoices">{<InvoicesPanel search={search} filters={filters} />}</Loading>;
    case 'receipts':
      return <Loading label="receipts">{<ReceiptsPanel search={search} filters={filters} />}</Loading>;
    case 'returns':
      return <Loading label="returns">{<ReturnsPanel search={search} filters={filters} />}</Loading>;
    default:
      return null;
  }
}

/** Whether a step key has a real screen behind it in this module. */
export const ORDER_TO_CASH_STEPS = [
  'customers',
  'sales-orders',
  'allocation',
  'dispatch',
  'invoices',
  'receipts',
  'returns',
] as const;

export function isOrderToCashStep(step: string): boolean {
  return (ORDER_TO_CASH_STEPS as readonly string[]).includes(step);
}

/**
 * The loading state, as a skeleton rather than a spinner.
 *
 * Every panel is a server component that awaits the API, and this project's API
 * can be cold — `COLD_START_MESSAGE` in lib/api.ts exists because a first
 * request after idle takes up to a minute. Streaming the shell immediately and
 * filling the table in means the subtab bar and heading are usable while that
 * happens, instead of the whole page hanging on the slowest fetch.
 */
function Loading({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" aria-live="polite">
          <div className="mb-5">
            <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
            <div className="mt-2 h-4 w-96 max-w-full animate-pulse rounded bg-slate-100" />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-3.5">
              <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
            </div>
            <div className="divide-y divide-slate-100">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="flex gap-4 px-5 py-4">
                  <div className="h-4 w-1/4 animate-pulse rounded bg-slate-100" />
                  <div className="h-4 w-1/5 animate-pulse rounded bg-slate-100" />
                  <div className="h-4 w-1/6 animate-pulse rounded bg-slate-100" />
                  <div className="h-4 w-1/6 animate-pulse rounded bg-slate-100" />
                </div>
              ))}
            </div>
          </div>

          <p className="mt-3 text-xs text-slate-500">
            Loading {label}. The API can take up to a minute to wake after a period of inactivity.
          </p>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
