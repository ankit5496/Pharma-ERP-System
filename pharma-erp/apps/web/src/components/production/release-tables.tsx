'use client';

import { useCallback, type ReactNode } from 'react';
import type { BatchView, FinishedGoodsLotView } from '@pharma-erp/types';
import { BATCH_RELEASE_STATUSES, BATCH_RELEASE_STATUS_LABELS } from '@pharma-erp/types';

import { DateCell, ExpiryHint, Quantity, ReleaseBadge } from './shared';
import { RegisterPager, RegisterToolbar, useRegisterView } from './register-toolbar';

/**
 * The queue at the quality gate.
 *
 * PAGED, but the toolbar always states the full count — "3 of 14" — so a batch
 * on page two is out of sight rather than out of mind. That distinction matters
 * more here than on any other register: a batch nobody decides on is stock that
 * cannot be sold and a work order that never closes.
 */
export function PendingReleaseList({
  batches,
  formFor,
}: {
  batches: BatchView[];
  /**
   * The release form for a batch, built by the SERVER component that renders
   * this — it carries the action binding. Keyed by batch id.
   */
  formFor: Record<string, ReactNode>;
}) {
  const searchText = useCallback(
    (batch: BatchView) =>
      [batch.batchNumber, batch.orderNumber, batch.product.code, batch.product.name].join(' '),
    [],
  );

  const view = useRegisterView({ rows: batches, searchText });

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      {/* The toolbar is the heading — see StockTable for why a separate one
          above it named the same table twice. Rendered even when empty, so the
          panel always says what it is rather than opening on a bare sentence. */}
      <RegisterToolbar
        title="Awaiting a decision"
        query={view.query}
        onQuery={view.setQuery}
        placeholder="Search batch, order or product…"
        noun="batches"
        shown={view.filtered.length}
        total={view.total}
      />

      {view.filtered.length === 0 ? (
        <p className="px-6 py-8 text-sm text-slate-600">
          {batches.length === 0
            ? 'Nothing is waiting at the gate.'
            : 'No batch matches that search.'}
        </p>
      ) : (
        <div className="divide-y divide-slate-100">
          {view.visible.map((batch) => (
            <div key={batch.id} className="space-y-3 px-6 py-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="font-mono text-sm font-semibold text-slate-900">
                    {batch.batchNumber}
                  </span>
                  <span className="ml-2 text-sm text-slate-700">{batch.product.name}</span>
                </div>
                <div className="text-xs text-slate-500">
                  Manufactured {batch.manufacturedOn} · expires {batch.expiryDate}
                </div>
              </div>

              {batch.materialVariances.some((variance) => variance.flagged) && (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  This batch has a material variance beyond ±{batch.varianceThresholdPercent}%.
                  Review the batch record before deciding.
                </p>
              )}

              {formFor[batch.id]}
            </div>
          ))}
        </div>
      )}

      <RegisterPager
        page={view.page}
        pageCount={view.pageCount}
        first={view.first}
        last={view.last}
        total={view.filtered.length}
        noun="batches"
        pageSize={view.pageSize}
        onPage={view.goTo}
        onPageSize={view.setPageSize}
      />
    </div>
  );
}

/** Released stock, searchable by product or batch. */
export function SellableStockTable({ lots }: { lots: FinishedGoodsLotView[] }) {
  const searchText = useCallback(
    (lot: FinishedGoodsLotView) => [lot.item.code, lot.item.name, lot.batchNumber].join(' '),
    [],
  );

  const view = useRegisterView({ rows: lots, searchText });

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <RegisterToolbar
        title="Sellable stock"
        query={view.query}
        onQuery={view.setQuery}
        placeholder="Search product or batch…"
        noun="lots"
        shown={view.filtered.length}
        total={view.total}
      />

      {view.filtered.length === 0 ? (
        <p className="px-6 py-8 text-sm text-slate-600">
          {lots.length === 0 ? 'No released stock yet.' : 'No lot matches that search.'}
        </p>
      ) : (
        <div className="table-scroll overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Product</Th>
                <Th>Batch</Th>
                <Th>Expiry</Th>
                <Th align="right">Available</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {view.visible.map((lot) => (
                <tr key={lot.id}>
                  <td className="px-6 py-3">
                    <span className="font-mono text-xs text-slate-700">{lot.item.code}</span>
                    <div className="text-slate-800">{lot.item.name}</div>
                  </td>
                  <td className="px-6 py-3 font-mono text-xs text-slate-800">{lot.batchNumber}</td>
                  <td className="px-6 py-3">
                    <DateCell value={lot.expiryDate} />
                    <ExpiryHint date={lot.expiryDate} />
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Quantity value={lot.quantityAvailable} uom={lot.item.uom} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RegisterPager
        page={view.page}
        pageCount={view.pageCount}
        first={view.first}
        last={view.last}
        total={view.filtered.length}
        noun="lots"
        pageSize={view.pageSize}
        onPage={view.goTo}
        onPageSize={view.setPageSize}
      />
    </div>
  );
}

/** Decisions already made, searchable and filtered by verdict. */
export function DecidedTable({ batches }: { batches: BatchView[] }) {
  const searchText = useCallback(
    (batch: BatchView) =>
      [
        batch.batchNumber,
        batch.orderNumber,
        batch.product.code,
        batch.releaseDecidedBy,
        batch.releaseNotes,
      ]
        .filter(Boolean)
        .join(' '),
    [],
  );

  const matchesFilter = useCallback(
    (batch: BatchView, value: string) => batch.releaseStatus === value,
    [],
  );

  const view = useRegisterView({ rows: batches, searchText, matchesFilter });

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <RegisterToolbar
        title="Decided"
        query={view.query}
        onQuery={view.setQuery}
        placeholder="Search batch, decider or reason…"
        noun="decisions"
        filter={view.filter}
        onFilter={view.setFilter}
        filterLabel="Verdict"
        // PENDING is excluded: a pending batch is not a decision, and it is on
        // the first tab. Offering it here would be a filter that always
        // returns nothing.
        filterOptions={BATCH_RELEASE_STATUSES.filter((status) => status !== 'PENDING').map(
          (status) => ({ value: status, label: BATCH_RELEASE_STATUS_LABELS[status] }),
        )}
        shown={view.filtered.length}
        total={view.total}
      />

      {view.filtered.length === 0 ? (
        <p className="px-6 py-8 text-sm text-slate-600">
          {batches.length === 0
            ? 'No batch has been through the gate yet.'
            : 'No decision matches that search.'}
        </p>
      ) : (
        <div className="table-scroll overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Batch</Th>
                <Th>Decision</Th>
                <Th>By</Th>
                <Th>When</Th>
                <Th>Reason</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {view.visible.map((batch) => (
                <tr key={batch.id} className="align-top">
                  <td className="px-6 py-3 font-mono text-xs text-slate-800">
                    {batch.batchNumber}
                  </td>
                  <td className="px-6 py-3">
                    <ReleaseBadge status={batch.releaseStatus} />
                  </td>
                  <td className="px-6 py-3 text-slate-700">{batch.releaseDecidedBy ?? '—'}</td>
                  <td className="px-6 py-3">
                    <DateCell value={batch.releaseDecidedAt?.slice(0, 10) ?? null} />
                  </td>
                  <td className="px-6 py-3 text-slate-600">{batch.releaseNotes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RegisterPager
        page={view.page}
        pageCount={view.pageCount}
        first={view.first}
        last={view.last}
        total={view.filtered.length}
        noun="decisions"
        pageSize={view.pageSize}
        onPage={view.goTo}
        onPageSize={view.setPageSize}
      />
    </div>
  );
}

function Th({ children, align = 'left' }: { children?: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-6 py-3 font-medium ${align === 'right' ? 'text-right' : ''}`}
    >
      {children}
    </th>
  );
}
