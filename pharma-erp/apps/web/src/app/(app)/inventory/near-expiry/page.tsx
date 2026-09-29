import type { Metadata } from 'next';
import type { ItemSummary, NearExpiryReport } from '@pharma-erp/types';

import { ExpiryWindows } from '@/components/inventory/expiry-windows';
import { NearExpiryTable } from '@/components/inventory/near-expiry-table';
import { StatCards, bucketCards } from '@/components/inventory/stat-cards';
import { FilterButton, FilterPanel, SearchBox } from '@/components/procurement/filter-bar';
import { EmptyState, ErrorState, Panel } from '@/components/procurement/ui';
import { apiFetch } from '@/lib/api';
import { requireSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Near-Expiry Report · Dashboard & Reports' };

/** The URL keys the API accepts. */
const FORWARDED = ['itemId', 'search', 'bucket'] as const;

/** Who may change the windows — mirrors `@Roles` on the PATCH endpoint. */
const CAN_SET_WINDOWS = new Set(['ADMIN', 'STORE_OFFICER']);

function param(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

/**
 * Near-expiry report — US-INV-03.
 *
 * Batches expired or expiring inside this company's windows, soonest first,
 * so slow stock can be moved commercially before it is written off. Filterable
 * by item (filter panel), batch (search) and window (the cards).
 */
export default async function NearExpiryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const user = await requireSession();

  const query = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = param(params[key]);
    if (value) query.set(key, value);
  }

  const [result, items] = await Promise.all([
    apiFetch<NearExpiryReport>(
      `/api/v1/inventory/near-expiry${query.size > 0 ? `?${query}` : ''}`,
      {
        authenticated: true,
      },
    ),
    apiFetch<ItemSummary[]>('/api/v1/production/items', { authenticated: true }),
  ]);

  const itemOptions = items.ok
    ? items.data.map((item) => ({ value: item.id, label: `${item.name} (${item.code})` }))
    : [];

  if (!result.ok) {
    return (
      <Panel title="Near-Expiry Report">
        <ErrorState
          message={
            result.status === 403
              ? 'Your role cannot view stock. The near-expiry report is for Store Officers, Management and Admins.'
              : `Could not load the near-expiry report: ${result.error}`
          }
        />
      </Panel>
    );
  }

  const report = result.data;
  const selected = query.get('bucket');
  const rowCount = report.rows.length;

  return (
    <>
      <div className="mb-6">
        <StatCards
          label="Near-expiry windows"
          cards={bucketCards(report.buckets, selected, query)}
        />
      </div>

      <Panel
        title="Near-Expiry Report"
        subtitle={`${rowCount} batch${rowCount === 1 ? '' : 'es'} · soonest expiry first`}
        action={
          <>
            <SearchBox placeholder="Search batch or item…" />
            <FilterButton />
          </>
        }
      >
        <div className="border-b border-slate-200 px-5 py-3">
          <ExpiryWindows alertDays={report.alertDays} canEdit={CAN_SET_WINDOWS.has(user.role)} />
        </div>

        <FilterPanel items={itemOptions} showDates={false} />

        {rowCount === 0 ? (
          <EmptyState
            title={`Nothing expired or expiring within ${Math.max(...report.alertDays)} days.`}
            hint="Batches appear here as their expiry date comes inside the alert windows."
            filtered={query.size > 0}
          />
        ) : (
          <NearExpiryTable key={query.toString()} rows={report.rows} buckets={report.buckets} />
        )}
      </Panel>
    </>
  );
}
