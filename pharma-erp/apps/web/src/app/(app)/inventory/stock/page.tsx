import type { Metadata } from 'next';
import {
  EXPIRING_WITHIN_OPTIONS,
  ITEM_TYPE_LABELS,
  RESERVATION_STATES,
  RESERVATION_STATE_LABELS,
  STOCK_BATCH_STATUSES,
  STOCK_BATCH_STATUS_LABELS,
  type ItemSummary,
  type ItemType,
  type StockEnquiry,
} from '@pharma-erp/types';

import { StockGroups } from '@/components/inventory/stock-groups';
import { FilterButton, FilterPanel, SearchBox } from '@/components/procurement/filter-bar';
import { EmptyState, ErrorState, Panel } from '@/components/procurement/ui';
import { apiFetch } from '@/lib/api';

export const metadata: Metadata = { title: 'Stock Enquiry · Dashboard & Reports' };

/** The URL keys the API accepts; anything else in the URL stays in the browser. */
const FORWARDED = [
  'search',
  'itemId',
  'itemType',
  'status',
  'reservation',
  'expiringWithin',
] as const;

function param(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

/**
 * Stock enquiry — US-INV-01.
 *
 * What is physically held, item by item and batch by batch, with expiry and
 * whether each batch is reserved to a sales order. Read-only: every figure
 * comes from the goods receipts, QC decisions, issues, releases and dispatches
 * that already happened.
 */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const query = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = param(params[key]);
    if (value) query.set(key, value);
  }

  const isFiltered = query.size > 0;

  const [result, items] = await Promise.all([
    apiFetch<StockEnquiry>(`/api/v1/inventory/stock${query.size > 0 ? `?${query}` : ''}`, {
      authenticated: true,
    }),
    // Every item, not only those in stock, so the filter's choices do not
    // shrink as other filters narrow the list.
    apiFetch<ItemSummary[]>('/api/v1/production/items', { authenticated: true }),
  ]);

  const itemOptions = items.ok
    ? items.data.map((item) => ({ value: item.id, label: `${item.name} (${item.code})` }))
    : [];

  const groups = result.ok ? result.data.groups : [];
  const batchCount = groups.reduce((sum, group) => sum + group.batches.length, 0);

  return (
    <Panel
      title="Stock Enquiry"
      subtitle={
        result.ok
          ? `${groups.length} item${groups.length === 1 ? '' : 's'} · ${batchCount} batch${batchCount === 1 ? '' : 'es'}`
          : undefined
      }
      action={
        <>
          <SearchBox placeholder="Search item, code or batch…" />
          <FilterButton />
        </>
      }
    >
      <FilterPanel
        items={itemOptions}
        itemTypes={(Object.keys(ITEM_TYPE_LABELS) as ItemType[]).map((value) => ({
          value,
          label: ITEM_TYPE_LABELS[value],
        }))}
        statuses={STOCK_BATCH_STATUSES.map((value) => ({
          value,
          label: STOCK_BATCH_STATUS_LABELS[value],
        }))}
        reservations={RESERVATION_STATES.map((value) => ({
          value,
          label: RESERVATION_STATE_LABELS[value],
        }))}
        expiringWithin={EXPIRING_WITHIN_OPTIONS.map((days) => ({
          value: String(days),
          label: `Within ${days} days`,
        }))}
        showDates={false}
      />

      {!result.ok ? (
        <ErrorState
          message={
            result.status === 403
              ? 'Your role cannot view stock. Stock enquiry is for Store Officers, Management and Admins.'
              : `Could not load stock: ${result.error}`
          }
        />
      ) : groups.length === 0 ? (
        <EmptyState
          title="No stock on hand."
          hint="Batches appear here once a goods receipt arrives or a batch is released."
          filtered={isFiltered}
        />
      ) : (
        // Keyed on the filters, so a new search or filter starts on page 1
        // and re-opens what it found rather than keeping what was open.
        <StockGroups key={query.toString()} groups={groups} expandAll={query.has('search')} />
      )}
    </Panel>
  );
}
