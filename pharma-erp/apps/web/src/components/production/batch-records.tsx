'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { BatchView } from '@pharma-erp/types';
import {
  BATCH_RELEASE_STATUSES,
  BATCH_RELEASE_STATUS_LABELS,
  formatDateDMY,
} from '@pharma-erp/types';

import { Quantity, ReleaseBadge } from './shared';
import { ProductionTabs } from './tabs';
import {
  createdFilters,
  matchesCreated,
  RegisterPager,
  RegisterToolbar,
  useRegisterView,
} from './register-toolbar';

/**
 * The filter value for the derived "Packaging due" state.
 *
 * Prefixed so it cannot collide with a real `BatchReleaseStatus`, now or when
 * one is added: this travels through the same filter field as the stored
 * values, and a clash would silently match the wrong rows.
 */
const PACKAGING_DUE = '__packagingDue';

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

  const matchesFilter = useCallback((batch: BatchView, value: string) => {
    // The derived state, which is not a `releaseStatus` value — see
    // ReleaseBadge for why it is not stored as one.
    if (value === PACKAGING_DUE) {
      return batch.releaseStatus === 'PENDING' && batch.packedOn === null;
    }

    // "Pending" now means awaiting a DECISION, so a batch still waiting on its
    // packing belongs under the option above rather than in both.
    if (value === 'PENDING') {
      return batch.releaseStatus === 'PENDING' && batch.packedOn !== null;
    }

    return batch.releaseStatus === value;
  }, []);

  // MANUFACTURED ON, not a creation timestamp. A batch carries no createdBy —
  // nothing records who opened it — and the date a batch is looked up by is
  // the day it was made, which is what goes on the carton. Filtering by the
  // row's insert time would be a different question nobody asks.
  const matchesField = useCallback(
    (batch: BatchView, name: string, value: string) =>
      matchesCreated(batch.manufacturedOn, null, name, value),
    [],
  );

  const view = useRegisterView({ rows: batches, searchText, matchesFilter, matchesField });

  /**
   * Opens a batch that was not in the register a moment ago.
   *
   * Recording one and being left looking at the batch that was already open is
   * the thing this fixes: the list refreshes, the new batch appears at the top
   * — the endpoint returns newest first — and the pane beside it carried on
   * showing the previous selection, so the record just saved was the one thing
   * not on screen.
   *
   * KEYED ON ARRIVAL, not on the list simply changing. `seen` remembers the ids
   * already rendered, so a refresh that only reorders or updates rows moves
   * nothing; solely an id never shown before takes the pane. That matters
   * because this list re-renders whenever a batch is packed or released too,
   * and neither of those should pull the reader somewhere else.
   *
   * IT ALSO CLEARS THE SEARCH AND FILTERS. A new batch is PENDING and lands
   * first, so a register left showing "released" — or on page 3 — would not
   * have it among the visible rows at all, and `open` below would quietly fall
   * back to the top of the current page. Clearing puts the register where the
   * new batch actually is rather than reporting it opened something it did not.
   */
  const seen = useRef<Set<string> | null>(null);
  const reveal = useRef(view.reset);
  reveal.current = view.reset;

  useEffect(() => {
    // First render: everything present counts as already seen, so an existing
    // register does not open its newest row as though it had just been made.
    if (seen.current === null) {
      seen.current = new Set(batches.map((batch) => batch.id));
      return;
    }

    const arrived = batches.find((batch) => !seen.current?.has(batch.id));

    seen.current = new Set(batches.map((batch) => batch.id));

    if (!arrived) return;

    setOpenId(arrived.id);
    reveal.current();
  }, [batches]);

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
          // PENDING SPLIT IN TWO, to match what the badges actually say. The
          // filter offered "Pending" while no row on screen carried that word:
          // an unpacked batch reads "Packaging due" and a packed one "Pending",
          // and a filter naming a state nobody can see is one that looks
          // broken when it returns rows that all say something else.
          filterOptions={[
            { value: PACKAGING_DUE, label: 'Packaging due' },
            ...BATCH_RELEASE_STATUSES.map((status) => ({
              value: status,
              label: BATCH_RELEASE_STATUS_LABELS[status],
            })),
          ]}
          fields={createdFilters([], 'Manufactured')}
          fieldValues={view.fieldValues}
          onField={view.setField}
          onClearFields={view.clearFields}
          shown={view.filtered.length}
          total={view.total}
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
                      <ReleaseBadge status={batch.releaseStatus} packedOn={batch.packedOn} />
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

      {/* AFTER the list, not under the toolbar. This register is a master/detail
          split rather than a table, so the pager sat in the toolbar's own box
          with the batches below it — a footer above the thing it pages through.
          In its own box here, it reads as the foot of the list the way it does
          on every other register. */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
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
            {formatDateDMY(batch.manufacturedOn)} · expires {formatDateDMY(batch.expiryDate)}
          </p>
        </div>
        <ReleaseBadge status={batch.releaseStatus} packedOn={batch.packedOn} />
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

      {/* TWO TABS, not one long page. The batch record and the packaging record
          are separate documents that happen to share a batch: one reports what
          was MADE and is read, the other records what was PACKED and is filled
          in. Stacked, the form sat below a consumption table that grows with the
          formulation, so on a batch with several materials the fields somebody
          came here to complete started below the fold.

          The hidden panel stays MOUNTED — see ProductionTabs — so a
          half-filled packing form survives a look at the consumption figures,
          which is exactly what somebody checks before entering it. */}
      {/* Inset to match the header and the figures above: ProductionTabs draws
          a full-width rule under its strip, which run edge to edge would cut
          across a card whose every other row is padded. */}
      <div className="px-6 pt-4">
        <ProductionTabs
          // REMOUNTED PER BATCH, so choosing another one opens on its record
          // rather than on whichever tab was last looked at. The packing form is
          // keyed by batch anyway; without this, switching batches would leave
          // the pane showing a form for a batch nobody had asked about.
          key={batch.id}
          tabs={[
            {
              key: 'record',
              label: 'Batch record',
              panel: <BatchRecordPanel batch={batch} />,
            },
            {
              key: 'packing',
              label: 'Packaging record',
              panel: packingForm ?? (
                // Nothing to show only when a DECIDED batch never had packing
                // recorded — a rejected batch, usually. A decided batch that was
                // packed renders its record read-only, and a pending one
                // renders the form, so both arrive as `packingForm`.
                <p className="text-sm text-slate-600">
                  No packing was recorded for this batch before it went through the quality gate.
                </p>
              ),
            },
          ]}
        />
      </div>
    </section>
  );
}

/** What the batch made, and what it consumed doing so. */
function BatchRecordPanel({ batch }: { batch: BatchView }) {
  return (
    <div className="pb-1">
      <div>
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
    </div>
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
