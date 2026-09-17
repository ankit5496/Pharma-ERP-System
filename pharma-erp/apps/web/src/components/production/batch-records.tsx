'use client';

import { useCallback, useState, type ReactNode } from 'react';
import type { BatchView } from '@pharma-erp/types';
import { BATCH_RELEASE_STATUSES, BATCH_RELEASE_STATUS_LABELS } from '@pharma-erp/types';

import { Quantity, ReleaseBadge } from './shared';
import { RegisterPager, RegisterToolbar, useRegisterView } from './register-toolbar';

/**
 * The batch register: a toolbar, a list, and one batch open at a time.
 *
 * WHY ONE AT A TIME. Every batch used to render expanded — its quantities, its
 * consumption table and, for a pending batch, the whole packing form. Three
 * batches was already a page nobody could scan, and the answer to "which batch
 * was that" was somewhere in the middle of it. The list is now the register and
 * the detail is what opens, which is the same arrangement the other steps use.
 *
 * Filtering is client-side because everything is already here: the panel fetches
 * every batch to render the list, so searching is a substring test, not a
 * request. If this ever outgrows that, the fix is a server query — not a
 * filter that quietly hides rows the count still claims.
 */
export function BatchRecords({
  batches,
  packingFormFor,
}: {
  batches: BatchView[];
  /**
   * The packing form for a batch, built by the SERVER component that renders
   * this — it needs the product's pack specifications, which this list does not
   * carry. Keyed by batch id, and absent for a batch that has been decided.
   */
  packingFormFor: Record<string, ReactNode>;
}) {
  const [openId, setOpenId] = useState<string | null>(batches[0]?.id ?? null);

  const searchText = useCallback(
    (batch: BatchView) =>
      [batch.batchNumber, batch.orderNumber, batch.product.code, batch.product.name].join(' '),
    [],
  );

  const matchesFilter = useCallback(
    (batch: BatchView, value: string) => batch.releaseStatus === value,
    [],
  );

  const view = useRegisterView({ rows: batches, searchText, matchesFilter });

  // Derived rather than stored: filtering or paging can hide whatever was open,
  // and a detail pane showing a batch that is not in the list beside it reads as
  // a bug. Falling back to the first batch ON THIS PAGE keeps the two in step.
  const open = view.visible.find((batch) => batch.id === openId) ?? view.visible[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <RegisterToolbar
          query={view.query}
          onQuery={view.setQuery}
          placeholder="Search batch, work order or product…"
          noun="batches"
          filter={view.filter}
          onFilter={view.setFilter}
          filterOptions={BATCH_RELEASE_STATUSES.map((status) => ({
            value: status,
            label: BATCH_RELEASE_STATUS_LABELS[status],
          }))}
          shown={view.filtered.length}
          total={view.total}
        />

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

      {view.visible.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white px-6 py-8 text-sm text-slate-600 shadow-sm">
          No batch matches that search.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <ul className="max-h-[70vh] space-y-1.5 overflow-y-auto pr-1">
            {view.visible.map((batch) => {
              const isOpen = open?.id === batch.id;

              return (
                <li key={batch.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(batch.id)}
                    aria-current={isOpen ? 'true' : undefined}
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                      isOpen
                        ? 'border-slate-900 bg-white shadow-sm ring-1 ring-slate-900'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-900">
                        {batch.batchNumber}
                      </span>
                      <ReleaseBadge status={batch.releaseStatus} />
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-700">{batch.product.name}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                      {batch.orderNumber} · {batch.manufacturedOn}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>

          {open && <BatchDetail batch={open} packingForm={packingFormFor[open.id]} />}
        </div>
      )}
    </div>
  );
}

/** One batch, in full: quantities, consumption, and the packing record. */
function BatchDetail({ batch, packingForm }: { batch: BatchView; packingForm?: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900">
            <span className="font-mono">{batch.batchNumber}</span> — {batch.product.name}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            <span className="font-mono">{batch.orderNumber}</span> · manufactured{' '}
            {batch.manufacturedOn} · expires {batch.expiryDate}
          </p>
        </div>
        <ReleaseBadge status={batch.releaseStatus} />
      </header>

      <dl className="grid gap-4 border-b border-slate-200 px-6 py-4 text-sm sm:grid-cols-4">
        <Figure label="Planned">
          <Quantity value={batch.plannedQuantity} uom={batch.product.uom} />
        </Figure>
        <Figure label="Manufactured">
          <Quantity value={batch.actualQuantity} uom={batch.product.uom} />
        </Figure>
        <Figure label="Packed">
          <Quantity value={batch.packedQuantity} uom={batch.product.uom} />
        </Figure>
        <Figure label="Yield">
          <YieldVariance batch={batch} />
        </Figure>
      </dl>

      <div className="border-b border-slate-200 px-6 py-4">
        <h4 className="text-xs font-medium uppercase tracking-wide text-slate-600">
          Manufacturing &amp; consumption
        </h4>
        <p className="mt-1 text-xs text-slate-500">
          Anything beyond ±{batch.varianceThresholdPercent}% is flagged for review.
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-500">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Material
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Planned
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Issued
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Variance
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {batch.materialVariances.map((variance) => (
                <tr key={variance.item.id} className={variance.flagged ? 'bg-amber-50/60' : ''}>
                  <td className="py-2 pr-4">
                    <span className="font-mono text-slate-700">{variance.item.code}</span>{' '}
                    <span className="text-slate-600">{variance.item.name}</span>
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <Quantity value={variance.quantityPlanned} uom={variance.item.uom} />
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <Quantity value={variance.quantityIssued} uom={variance.item.uom} />
                  </td>
                  <td className="py-2 text-right">
                    <span
                      className={`tabular-nums ${
                        variance.flagged ? 'font-semibold text-amber-800' : 'text-slate-600'
                      }`}
                    >
                      {variance.variancePercent}%
                    </span>
                    {variance.flagged && (
                      <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                        review
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Absent once the batch has been through the quality gate — packing
          cannot be amended after a release decision, so the form would be a
          control the API refuses. */}
      {packingForm && (
        <div className="px-6 py-4">
          <h4 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-600">
            Packaging record
          </h4>
          {packingForm}
        </div>
      )}
    </section>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

/**
 * Manufactured against planned, as a percentage.
 *
 * The one figure on this card that is not simply read from the record, and the
 * one a supervisor scans for: a batch that made 8 of a planned 10 is a yield
 * question, and the three quantities beside it do not make that obvious.
 *
 * Shown as a dash until there is a yield — before the manufacturing record is
 * entered there is nothing to compare, and "−100%" would read as a catastrophe
 * rather than as "not recorded yet".
 */
function YieldVariance({ batch }: { batch: BatchView }) {
  const planned = Number(batch.plannedQuantity);
  const actual = batch.actualQuantity === null ? null : Number(batch.actualQuantity);

  if (actual === null || !Number.isFinite(planned) || planned === 0) {
    return <span className="text-slate-300">—</span>;
  }

  const percent = ((actual - planned) / planned) * 100;
  // One decimal, and a sign on anything that is not exactly on plan: "0%" and
  // "-0.4%" mean different things to whoever signs this off.
  const label = `${percent > 0 ? '+' : ''}${percent.toFixed(percent === 0 ? 0 : 1)}%`;

  const tone =
    Math.abs(percent) <= batch.varianceThresholdPercent
      ? 'text-slate-800'
      : 'font-semibold text-amber-800';

  return <span className={`tabular-nums ${tone}`}>{label}</span>;
}
