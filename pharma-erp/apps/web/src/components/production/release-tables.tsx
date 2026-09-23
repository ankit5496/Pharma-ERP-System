'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { BatchView, FinishedGoodsLotView } from '@pharma-erp/types';
import {
  BATCH_RELEASE_STATUSES,
  BATCH_RELEASE_STATUS_LABELS,
  formatDateDMY,
} from '@pharma-erp/types';

import { MasterDataDrawer } from '@/components/master-data-drawer';

import { DateCell, ExpiryHint, Quantity, ReleaseBadge } from './shared';
import { RegisterPager, RegisterToolbar, useRegisterView } from './register-toolbar';

/**
 * The queue at the quality gate.
 *
 * A REGISTER, like every other step. The decision form used to be rendered
 * inline under each batch, which put a textarea and three buttons inside every
 * row — two batches filled a screen, the list stopped resembling the other four
 * registers, and the figures a verdict actually turns on were pushed out of
 * sight by the controls. The row now carries the facts and a Decide button, and
 * the form opens in the same centred drawer every other form in the
 * application uses.
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

  // Which batch is being decided, or null. Holds the BATCH rather than its id
  // so the drawer can title itself without looking the row up again — and so a
  // batch that leaves the list mid-decision keeps its form populated.
  const [deciding, setDeciding] = useState<BatchView | null>(null);

  // A decided batch drops out of `batches` on the next refresh, so the drawer
  // would otherwise sit open over a row that no longer exists.
  useEffect(() => {
    if (!deciding) return;
    if (batches.some((batch) => batch.id === deciding.id)) return;

    setDeciding(null);
  }, [batches, deciding]);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      {/* The toolbar is the heading — see StockTable for why a separate one
          above it named the same table twice. Rendered even when empty, so the
          panel always says what it is rather than opening on a bare sentence. */}
      <RegisterToolbar
        title="Awaiting a Decision"
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
        <div className="table-scroll overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead>
              <tr className="text-xs tracking-wide text-slate-500">
                <Th>Batch</Th>
                <Th>Product</Th>
                <Th>Work Order</Th>
                <Th>Manufactured</Th>
                <Th>Expiry</Th>
                <Th align="right">Packed</Th>
                <Th>Status</Th>
                {/* No label: the column holds one button per row, and heading
                    it "Actions" names the obvious. */}
                <Th align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {view.visible.map((batch) => {
                const flagged = batch.materialVariances.some((variance) => variance.flagged);

                return (
                  <tr key={batch.id}>
                    <td className="px-6 py-3 font-mono text-xs font-semibold text-slate-900">
                      {batch.batchNumber}
                    </td>
                    <td className="px-6 py-3">
                      <span className="font-mono text-xs text-slate-700">{batch.product.code}</span>
                      <div className="text-slate-800">{batch.product.name}</div>
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-slate-700">
                      {batch.orderNumber}
                    </td>
                    <td className="px-6 py-3">
                      <DateCell value={batch.manufacturedOn} />
                    </td>
                    <td className="px-6 py-3">
                      <DateCell value={batch.expiryDate} />
                      <ExpiryHint date={batch.expiryDate} />
                    </td>
                    {/* Null until packing is recorded, and that is the whole
                        point: a batch with nothing packed has no quantity to
                        release into stock. */}
                    <td className="px-6 py-3 text-right">
                      {batch.packedQuantity === null ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <Quantity value={batch.packedQuantity} uom={batch.product.uom} />
                      )}
                    </td>
                    {/* The variance flag takes the Status column rather than a
                        banner of its own: it is the one fact that changes how
                        this row should be read, and a pill states it without
                        spending three lines on it. The full sentence is inside
                        the drawer, next to the decision it qualifies. */}
                    <td className="px-6 py-3">
                      {flagged ? (
                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                          Variance ±{batch.varianceThresholdPercent}%
                        </span>
                      ) : (
                        <ReleaseBadge status={batch.releaseStatus} />
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setDeciding(batch)}
                        className="whitespace-nowrap rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800"
                      >
                        {/* "Release", though the drawer it opens also offers
                            Hold and Reject. Naming the outcome people are
                            looking for reads better on the row than the neutral
                            "Decide" did; the three buttons inside still make
                            clear that releasing is a choice, not the only one. */}
                        Release
                      </button>
                    </td>
                  </tr>
                );
              })}
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
        noun="batches"
        pageSize={view.pageSize}
        onPage={view.goTo}
        onPageSize={view.setPageSize}
      />

      {/* The decision, in the same layer every other form in the application
          opens in — so the focus trap, Escape and focus return are the ones
          already built rather than three more chances to get them wrong.

          The form inside is the SERVER-built one for this batch, unchanged: it
          still carries its own action binding, and it reports its success
          through the toast as it always did. */}
      {deciding && (
        <MasterDataDrawer
          title={`${deciding.batchNumber} — ${deciding.product.name}`}
          description={`${deciding.orderNumber} · manufactured ${formatDateDMY(deciding.manufacturedOn)} · expires ${formatDateDMY(deciding.expiryDate)}`}
          placement="center"
          onClose={() => setDeciding(null)}
        >
          <div className="flex flex-col gap-4">
            {/* The figures the verdict turns on, stated before the controls.
                They used to be absent from the decision entirely — an officer
                had to remember the packed quantity from the row above. */}
            <dl className="grid grid-cols-2 gap-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-3">
              <Figure label="Planned">
                <Quantity value={deciding.plannedQuantity} uom={deciding.product.uom} />
              </Figure>
              <Figure label="Manufactured">
                {deciding.actualQuantity === null ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <Quantity value={deciding.actualQuantity} uom={deciding.product.uom} />
                )}
              </Figure>
              <Figure label="Packed">
                {deciding.packedQuantity === null ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <Quantity value={deciding.packedQuantity} uom={deciding.product.uom} />
                )}
              </Figure>
            </dl>

            {deciding.materialVariances.some((variance) => variance.flagged) && (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                This batch has a material variance beyond ±{deciding.varianceThresholdPercent}%.
                Review the batch record before deciding.
              </p>
            )}

            {formFor[deciding.id]}
          </div>
        </MasterDataDrawer>
      )}
    </div>
  );
}

/** One figure in the decision drawer's summary. */
function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children}</dd>
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
        title="Sellable Stock"
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
              <tr className="text-xs tracking-wide text-slate-500">
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
        title="Released"
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
              <tr className="text-xs tracking-wide text-slate-500">
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
