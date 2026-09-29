'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  JobWorkBatchView,
  JobWorkIssuableMaterial,
  JobWorkMaterialIssueView,
  JobWorkProductionOrderView,
} from '@pharma-erp/types';
import {
  BATCH_RELEASE_STATUSES,
  BATCH_RELEASE_STATUS_LABELS,
  BILLING_MODEL_LABELS,
  JOB_WORK_MATERIAL_KIND_LABELS,
  JOB_WORK_PRODUCTION_STATUSES,
  JOB_WORK_PRODUCTION_STATUS_LABELS,
  STOCK_LOT_STATUS_LABELS,
  STOCK_LOT_STATUSES,
} from '@pharma-erp/types';

import { MasterDataDrawer } from '@/components/master-data-drawer';
import {
  RegisterPager,
  RegisterToolbar,
  useRegisterView,
} from '@/components/production/register-toolbar';
import {
  serverCreatedFilters,
  useJobWorkRegisterView,
  type PersonOption,
} from '@/components/job-work/register-query';
import { DateCell, ExpiryHint, Quantity, ReleaseBadge } from '@/components/production/shared';
import { ProductionTabs } from '@/components/production/tabs';

/**
 * The four Job Work registers, built from the Production & Quality Gate ones.
 *
 * THE SAME COMPONENTS, NOT A COPY OF THEM. `useRegisterView`, `RegisterToolbar`,
 * `RegisterPager`, `Quantity`, `DateCell`, `ExpiryHint` and `ReleaseBadge` are
 * imported from `components/production` and used unchanged — they carry the
 * search, the filter panel, the pager and the cell formatting that make those
 * screens what they are, and none of them knows anything about own-brand
 * manufacturing. Reimplementing them here is how the two workflows would drift
 * into looking alike without behaving alike.
 *
 * Nothing in `components/production` is modified. This file only reads.
 *
 * WHAT DIFFERS IS THE DATA, and only where the workflows genuinely differ: a
 * job-work register names the principal and their brand, and the material it
 * draws on is the consignment they sent rather than stock we bought.
 */

/** Table header cell. The same one the production registers draw. */
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

/** The stage a job-work production order has reached. */
function StageBadge({ status }: { status: JobWorkProductionOrderView['status'] }) {
  const tone =
    status === 'BATCH_RELEASED'
      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
      : status === 'CANCELLED'
        ? 'bg-slate-100 text-slate-500 ring-slate-200'
        : status === 'DRAFT'
          ? 'bg-slate-100 text-slate-700 ring-slate-200'
          : status === 'PRODUCTION_COMPLETED' || status === 'READY_FOR_BATCH_RELEASE'
            ? 'bg-indigo-50 text-indigo-800 ring-indigo-200'
            : 'bg-blue-50 text-blue-800 ring-blue-200';

  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tone}`}
    >
      {JOB_WORK_PRODUCTION_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Whose work this is.
 *
 * The same violet pill the internal order table puts on a job-work row — on
 * every row here, because every row is job work, and the billing model is what
 * decides which stock the issue may draw from.
 */
function PrincipalTag({ order }: { order: JobWorkProductionOrderView }) {
  return (
    <div className="mt-1 space-y-0.5">
      <span className="inline-block whitespace-nowrap rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800 ring-1 ring-inset ring-violet-200">
        Job work · {BILLING_MODEL_LABELS[order.billingModel]}
      </span>
      <div className="text-[11px] text-slate-600">{order.principalName}</div>
      <div className="font-mono text-[11px] text-slate-500">{order.jobWorkOrderNumber}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Production orders
// ---------------------------------------------------------------------------

/** Job-work production orders, searchable and filtered by stage. */
export function JobWorkOrderTable({
  orders,
  people,
  actionFor,
  toolbarAction,
}: {
  orders: JobWorkProductionOrderView[];
  /** Colleagues, for the Created By filter. From the API, not from the rows. */
  people: readonly PersonOption[];
  /** View/Edit for one order, built by the server component above. */
  actionFor?: Record<string, ReactNode>;
  /**
   * The New button, beside the search and filter controls.
   *
   * Passed in rather than taken from ProductionRegister's context because the
   * form it opens carries its own modal — the requisition form's — so the
   * button that opens it belongs to the form, not to the register.
   */
  toolbarAction?: ReactNode;
}) {
  // FILTERED BY THE DATABASE. `orders` is the answer to the current query,
  // not a list to sift — see useJobWorkRegisterView.
  const view = useJobWorkRegisterView({ rows: orders });

  return (
    <>
      <RegisterToolbar
        title="Production Orders"
        query={view.query}
        onQuery={view.setQuery}
        placeholder="Search order, job work order, principal or product…"
        noun="production orders"
        filter={view.filter}
        onFilter={view.setFilter}
        filterLabel="Stage"
        filterOptions={JOB_WORK_PRODUCTION_STATUSES.map((status) => ({
          value: status,
          label: JOB_WORK_PRODUCTION_STATUS_LABELS[status],
        }))}
        fields={serverCreatedFilters(people)}
        fieldValues={view.fieldValues}
        onField={view.setField}
        onClearFields={view.clearFields}
        shown={view.filtered.length}
        total={view.total}
      >
        {toolbarAction}
      </RegisterToolbar>

      {view.filtered.length === 0 ? (
        <p className="px-6 py-8 text-sm text-slate-600">
          {view.isFiltered
            ? 'No production order matches those filters.'
            : 'No production order raised yet. One is raised against a consignment that has passed Quality check.'}
        </p>
      ) : (
        <div className="table-scroll overflow-x-auto">
          <table className="w-full min-w-[64rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Order</Th>
                <Th>Product</Th>
                <Th align="right">Planned</Th>
                <Th>Status</Th>
                <Th>Material receipt</Th>
                <Th>Batch</Th>
                <Th>Raised by</Th>
                {actionFor && <Th align="right" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {view.visible.map((order) => (
                <tr key={order.id} className="align-top">
                  <td className="px-6 py-3">
                    <span className="font-mono text-xs font-semibold text-slate-800">
                      {order.orderNumber}
                    </span>
                    <div className="text-xs text-slate-500">
                      {order.principalBrandName}
                    </div>
                    <PrincipalTag order={order} />
                  </td>

                  <td className="px-6 py-3">
                    <span className="font-mono text-xs text-slate-700">{order.product.code}</span>
                    <div className="text-slate-800">{order.product.name}</div>
                  </td>

                  <td className="px-6 py-3 text-right">
                    <Quantity value={order.plannedQuantity} uom={order.product.uom} />
                  </td>

                  <td className="px-6 py-3">
                    <StageBadge status={order.status} />
                    {order.issueCount > 0 && (
                      <div className="mt-1 text-[11px] text-slate-500">
                        {order.issueCount} issue{order.issueCount === 1 ? '' : 's'}
                      </div>
                    )}
                  </td>

                  {/* WHERE THE MATERIAL CAME FROM. Under pure conversion that
                      is the principal's consignment and what it carried — the
                      figure a production officer checks before dispensing.
                      Under own procurement we bought it, so there is no
                      consignment to name and the column says so. */}
                  <td className="px-6 py-3">
                    {order.materialReceipt ? (
                      <>
                        <span className="font-mono text-xs text-slate-700">
                          {order.materialReceipt.receiptNumber}
                        </span>
                        <div className="text-[11px] text-slate-500">
                          {order.materialReceipt.rawMaterialCount} raw ·{' '}
                          {order.materialReceipt.packingMaterialCount} packing
                        </div>
                      </>
                    ) : (
                      <span className="text-[11px] text-slate-500">Our own inventory</span>
                    )}
                  </td>

                  <td className="px-6 py-3">
                    {order.batchNumber ? (
                      <>
                        <span className="font-mono text-xs text-slate-800">
                          {order.batchNumber}
                        </span>
                        {order.releaseStatus && (
                          <div className="mt-1">
                            <ReleaseBadge status={order.releaseStatus} />
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>

                  <td className="px-6 py-3 text-slate-600">{order.createdBy ?? '—'}</td>

                  {actionFor && (
                    <td className="px-6 py-3 text-right">{actionFor[order.id]}</td>
                  )}
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
        noun="production orders"
        pageSize={view.pageSize}
        onPage={view.goTo}
        onPageSize={view.setPageSize}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// 2. Material issue
// ---------------------------------------------------------------------------

/** Dispensing records, searchable by issue number, order, material or lot. */
export function JobWorkIssueTable({
  issues,
  people,
  toolbarAction,
}: {
  issues: JobWorkMaterialIssueView[];
  /** Colleagues, for the Created By filter. */
  people: readonly PersonOption[];
  /** The Dispense button — see JobWorkOrderTable for why it arrives this way. */
  toolbarAction?: ReactNode;
}) {
  const view = useJobWorkRegisterView({ rows: issues });

  return (
    <>
      <RegisterToolbar
        title="Material Issue"
        query={view.query}
        onQuery={view.setQuery}
        placeholder="Search issue, order, material or lot…"
        noun="dispensing records"
        // NO STATUS CONTROL. A dispensing record has no status — the material
        // either left the store or the record was never written — so a
        // dropdown here would have one option meaning "all".
        fields={serverCreatedFilters(people, 'Issued date')}
        fieldValues={view.fieldValues}
        onField={view.setField}
        onClearFields={view.clearFields}
        shown={view.filtered.length}
        total={view.total}
      >
        {toolbarAction}
      </RegisterToolbar>

      {view.filtered.length === 0 ? (
        <p className="px-6 py-8 text-sm text-slate-600">
          {view.isFiltered
            ? 'No dispensing record matches those filters.'
            : 'Nothing dispensed yet. Material is drawn from the consignment the principal sent.'}
        </p>
      ) : (
        <div className="table-scroll overflow-x-auto">
          <table className="w-full min-w-[60rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Issue</Th>
                <Th>Order</Th>
                <Th>Dispensed</Th>
                <Th>Materials</Th>
                <Th>By</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {view.visible.map((issue) => (
                <tr key={issue.id} className="align-top">
                  <td className="px-6 py-3">
                    <span className="font-mono text-xs font-semibold text-slate-800">
                      {issue.issueNumber}
                    </span>
                    <div className="text-[11px] text-slate-500">{issue.principalName}</div>
                  </td>

                  <td className="px-6 py-3">
                    <span className="font-mono text-xs text-slate-700">
                      {issue.productionOrderNumber}
                    </span>
                    <div className="font-mono text-[11px] text-slate-500">
                      {issue.jobWorkOrderNumber}
                    </div>
                  </td>

                  <td className="px-6 py-3">
                    <DateCell value={issue.issuedAt.slice(0, 10)} />
                  </td>

                  {/* One line per drum, with the principal's own batch marking
                      beside our lot number: a challan query names theirs. */}
                  <td className="px-6 py-3">
                    <ul className="space-y-1">
                      {issue.lines.map((line) => (
                        <li key={line.id} className="flex flex-wrap items-center gap-x-2">
                          <span className="font-mono text-xs text-slate-700">{line.item.code}</span>
                          <span className="font-mono text-xs text-slate-500">{line.lotNumber}</span>
                          <Quantity value={line.quantityIssued} uom={line.item.uom} />
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                            {JOB_WORK_MATERIAL_KIND_LABELS[line.kind]}
                          </span>
                          {line.deliveryChallanNumber && (
                            <span className="text-[10px] text-slate-500">
                              challan {line.deliveryChallanNumber}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </td>

                  <td className="px-6 py-3 text-slate-600">{issue.issuedBy ?? '—'}</td>
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
        noun="dispensing records"
        pageSize={view.pageSize}
        onPage={view.goTo}
        onPageSize={view.setPageSize}
      />
    </>
  );
}

/**
 * The principal's material on hand — the Stock on hand tab, for job work.
 *
 * THE INWARD RECEIPT'S OWN LINES, and never a copy of them: what a drum holds
 * is the lot's balance, and what arrived is the receipt line's figure. This is
 * the "received Raw Materials and Packing Materials" the brief asks to see in
 * the flow, shown where the internal screen shows company stock.
 */
export function JobWorkReceivedMaterialTable({
  material,
}: {
  material: (JobWorkIssuableMaterial & {
    productionOrderNumber: string;
    principalName: string;
  })[];
}) {
  const searchText = useCallback(
    (line: (typeof material)[number]) =>
      [
        line.item.code,
        line.item.name,
        line.lotNumber,
        line.batchNumber,
        line.deliveryChallanNumber,
        line.productionOrderNumber,
        line.principalName,
      ]
        .filter(Boolean)
        .join(' '),
    [],
  );

  const matchesFilter = useCallback(
    (line: (typeof material)[number], value: string) => line.lotStatus === value,
    [],
  );

  const view = useRegisterView({ rows: material, searchText, matchesFilter });

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <RegisterToolbar
        title="Material Received From Principal"
        query={view.query}
        onQuery={view.setQuery}
        placeholder="Search material, lot, batch or challan…"
        noun="drums"
        filter={view.filter}
        onFilter={view.setFilter}
        filterOptions={STOCK_LOT_STATUSES.map((status) => ({
          value: status,
          label: STOCK_LOT_STATUS_LABELS[status],
        }))}
        shown={view.filtered.length}
        total={view.total}
      />

      {view.filtered.length === 0 ? (
        <p className="px-6 py-8 text-sm text-slate-600">
          {material.length === 0
            ? 'No material received against a production order yet. Record the principal’s delivery challan under Material received from principal.'
            : 'No drum matches that search.'}
        </p>
      ) : (
        <div className="table-scroll overflow-x-auto">
          <table className="w-full min-w-[62rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Material</Th>
                <Th>Kind</Th>
                <Th>Lot</Th>
                <Th>Batch / challan</Th>
                <Th>Expiry</Th>
                <Th>Status</Th>
                <Th align="right">Received</Th>
                <Th align="right">Available</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {view.visible.map((line) => (
                <tr
                  key={`${line.lotId}-${line.productionOrderNumber}`}
                  className={line.lotStatus === 'USABLE' ? '' : 'bg-slate-50/60'}
                >
                  <td className="px-6 py-3">
                    <span className="font-mono text-xs text-slate-700">{line.item.code}</span>
                    <div className="text-slate-800">{line.item.name}</div>
                    <div className="font-mono text-[11px] text-slate-500">
                      {line.productionOrderNumber}
                    </div>
                  </td>

                  <td className="px-6 py-3">
                    <span className="whitespace-nowrap rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800 ring-1 ring-inset ring-violet-200">
                      {JOB_WORK_MATERIAL_KIND_LABELS[line.kind]}
                    </span>
                  </td>

                  <td className="px-6 py-3 font-mono text-xs text-slate-700">{line.lotNumber}</td>

                  <td className="px-6 py-3">
                    <div className="text-slate-700">{line.batchNumber}</div>
                    {line.deliveryChallanNumber && (
                      <div className="text-[11px] text-slate-500">
                        challan {line.deliveryChallanNumber}
                      </div>
                    )}
                  </td>

                  <td className="px-6 py-3">
                    <DateCell value={line.expiryDate} />
                    {line.expiryDate && <ExpiryHint date={line.expiryDate} />}
                  </td>

                  <td className="px-6 py-3">
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                        line.lotStatus === 'USABLE'
                          ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                          : line.lotStatus === 'QUARANTINE' || line.lotStatus === 'ON_HOLD'
                            ? 'bg-amber-50 text-amber-800 ring-amber-200'
                            : 'bg-red-50 text-red-800 ring-red-200'
                      }`}
                    >
                      {STOCK_LOT_STATUS_LABELS[
                        line.lotStatus as keyof typeof STOCK_LOT_STATUS_LABELS
                      ] ?? line.lotStatus}
                    </span>
                  </td>

                  <td className="px-6 py-3 text-right">
                    <Quantity value={line.receivedQuantity} uom={line.item.uom} />
                  </td>

                  <td className="px-6 py-3 text-right">
                    <Quantity value={line.quantityAvailable} uom={line.item.uom} />
                    {Number(line.alreadyIssued) > 0 && (
                      <div className="text-[11px] text-slate-500">
                        {line.alreadyIssued} issued
                      </div>
                    )}
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
        noun="drums"
        pageSize={view.pageSize}
        onPage={view.goTo}
        onPageSize={view.setPageSize}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Batch record
// ---------------------------------------------------------------------------

/**
 * The job-work batch register: a toolbar, a list, and one batch open at a time.
 *
 * The same master/detail arrangement `BatchRecords` uses, for the same reason —
 * a page of expanded batches is a page nobody can scan.
 */
/**
 * The filter value for the derived "Packaging due" state.
 *
 * THE API'S SPELLING, not a local one. This now travels to the server as
 * `?status=PACKAGING_DUE` and the batch query turns it into
 * `release_status = 'PENDING' AND packed_on IS NULL` — so the constant has to
 * be the string that endpoint recognises. It cannot collide with a stored
 * `BatchReleaseStatus`, because no status is called that.
 *
 * Kept in step with PACKAGING_DUE in apps/api/src/job-work/job-work-list-query.ts.
 */
const PACKAGING_DUE = 'PACKAGING_DUE';

export function JobWorkBatchRecords({
  batches,
  people,
  packingFormFor,
  toolbarAction,
}: {
  batches: JobWorkBatchView[];
  /** Colleagues, for the Created By filter. */
  people: readonly PersonOption[];
  /** The packing form for a batch, or absent once it has been decided. */
  packingFormFor: Record<string, ReactNode>;
  /** The New batch button — see JobWorkOrderTable for why it arrives this way. */
  toolbarAction?: ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(batches[0]?.id ?? null);

  // TWO DATE RANGES, and both of them real questions. A batch is looked up by
  // the day it was MADE — the date that goes on the carton — and also by when
  // the record was written, and those are different days because manufacturing
  // is entered afterwards. The register used to offer only the first; dropping
  // it to add the second would have traded one working filter for another.
  //
  // PACKAGING_DUE and PENDING are told apart BY THE QUERY now — see the batch
  // list in job-work-workflow.service.ts. The screen used to derive the
  // difference over the rows it held, which a page holding only the first ten
  // cannot do.
  const view = useJobWorkRegisterView({
    rows: batches,
    extraKeys: ['manufacturedFrom', 'manufacturedTo'],
  });

  /**
   * Opens a batch that was not in the register a moment ago.
   *
   * Recording one and being left looking at the batch that was already open is
   * what this fixes: the list refreshes, the new batch appears, and the pane
   * beside it carried on showing the previous selection — so the record just
   * saved was the one thing not on screen.
   *
   * KEYED ON ARRIVAL, not on the list simply changing: this list re-renders
   * whenever a batch is packed or released too, and neither of those should
   * pull the reader somewhere else. It also clears the search and filters,
   * because a new batch is PENDING and a register left filtered to "released"
   * would not have it among the visible rows at all.
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

  // Derived, not stored: filtering or paging can hide whatever was open, and a
  // detail pane showing a batch that is not in the list beside it reads as a bug.
  const open = view.visible.find((batch) => batch.id === openId) ?? view.visible[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <RegisterToolbar
          title="Batch Record"
          query={view.query}
          onQuery={view.setQuery}
          placeholder="Search batch, production order, principal or product…"
          noun="batches"
          filter={view.filter}
          onFilter={view.setFilter}
          // PENDING SPLIT IN TWO, to match what the badges actually say. An
          // unpacked batch reads "Packaging due" and a packed one "Pending",
          // and a filter naming a state nobody can see on a row is one that
          // looks broken when it returns rows all saying something else.
          filterOptions={[
            { value: PACKAGING_DUE, label: 'Packaging due' },
            ...BATCH_RELEASE_STATUSES.map((status) => ({
              value: status,
              label: BATCH_RELEASE_STATUS_LABELS[status],
            })),
          ]}
          fields={[
            { name: 'manufactured', label: 'Manufactured', kind: 'dateRange' },
            ...serverCreatedFilters(people),
          ]}
          fieldValues={view.fieldValues}
          onField={view.setField}
          onClearFields={view.clearFields}
          shown={view.filtered.length}
          total={view.total}
        >
          {toolbarAction}
        </RegisterToolbar>
      </div>

      {view.visible.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white px-6 py-8 text-sm text-slate-600 shadow-sm">
          {view.isFiltered
            ? 'No batch matches those filters.'
            : 'No batch recorded yet. A batch is opened against a production order material has been issued to.'}
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
                    // THE ONE PLACE THIS REGISTER DOES NOT COPY THE REFERENCE.
                    // The internal list outlines its open row in near-black
                    // with a ring on top of it — a 2px dark box — and that was
                    // reported here as a border that looked too heavy. A tinted
                    // fill says "open" just as clearly without drawing a frame
                    // around every row the eye passes.
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                      isOpen
                        ? 'border-slate-300 bg-slate-50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-900">
                        {batch.batchNumber}
                      </span>
                      {/* `packedOn` is what separates "Packaging due" from
                          "Pending": a batch is pending from the moment it is
                          opened, and the badge saying so on a batch nobody has
                          finished making is the reason the filter above splits
                          the two. */}
                      <ReleaseBadge status={batch.releaseStatus} packedOn={batch.packedOn} />
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-700">{batch.product.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-600">
                      {batch.principalName}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                      {batch.productionOrderNumber} · {batch.manufacturedOn}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>

          {open && <JobWorkBatchDetail batch={open} packingForm={packingFormFor[open.id]} />}
        </div>
      )}

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
function JobWorkBatchDetail({
  batch,
  packingForm,
}: {
  batch: JobWorkBatchView;
  packingForm?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900">
            <span className="font-mono">{batch.batchNumber}</span> — {batch.product.name}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            <span className="font-mono">{batch.productionOrderNumber}</span> · manufactured{' '}
            {batch.manufacturedOn} · expires {batch.expiryDate}
          </p>
          {/* WHOSE BATCH THIS IS. Under pure conversion the goods are the
              principal's before they are released, and that is what stops them
              being dispatched to the wrong party. */}
          <p className="mt-1 text-xs text-slate-600">
            For <span className="font-medium">{batch.principalName}</span>, sold as{' '}
            {batch.principalBrandName} · {batch.jobWorkOrderNumber}
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

      {/* TWO TABS, not one long page — the arrangement the internal batch
          record settled on, for the same reason. The batch record and the
          packaging record are separate documents that happen to share a batch:
          one reports what was MADE and is read, the other records what was
          PACKED and is filled in. Stacked, the form sat below a consumption
          table that grows with the formulation, so on a batch with several
          materials the fields somebody came here to complete started below the
          fold.

          The hidden panel stays MOUNTED — see ProductionTabs — so a
          half-filled packing form survives a look at the consumption figures,
          which is exactly what somebody checks before entering it. */}
      {/* Inset to match the header and the figures above: ProductionTabs draws
          a full-width rule under its strip, which run edge to edge would cut
          across a card whose every other row is padded. */}
      <div className="px-6 pt-4">
        <ProductionTabs
          // REMOUNTED PER BATCH, so choosing another one opens on its record
          // rather than on whichever tab was last looked at.
          key={batch.id}
          tabs={[
            {
              key: 'record',
              label: 'Batch Record',
              panel: <JobWorkBatchRecordTab batch={batch} />,
            },
            {
              key: 'packing',
              label: 'Packaging Record',
              panel: packingForm ?? (
                // Nothing to show only when a DECIDED batch never had packing
                // recorded — a rejected batch, usually. A decided batch that
                // was packed renders its record read-only, and a pending one
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

/**
 * What the formulation called for against what was actually drawn.
 *
 * ITS OWN COMPONENT so the tab above has something to name. It was inline in
 * the card, above the packing form; the content is unchanged.
 */
function JobWorkBatchRecordTab({ batch }: { batch: JobWorkBatchView }) {
  return (
    <div className="pb-1">
      <h4 className="text-xs font-medium tracking-wide text-slate-600">
        Manufacturing &amp; Consumption
      </h4>
      <p className="mt-1 text-xs text-slate-500">
        What the formulation called for against what was drawn from the principal’s consignment.
        Anything beyond ±{batch.varianceThresholdPercent}% is flagged for review.
      </p>

      {batch.materialVariances.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          No active formulation behind this product, so there is nothing to compare against.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] tracking-wide text-slate-500">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Material
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Kind
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
                  <td className="py-2 pr-4 text-slate-600">
                    {JOB_WORK_MATERIAL_KIND_LABELS[variance.kind]}
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
      )}
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

/** Manufactured against planned, as a percentage. */
function YieldVariance({ batch }: { batch: JobWorkBatchView }) {
  const planned = Number(batch.plannedQuantity);
  const actual = batch.actualQuantity === null ? null : Number(batch.actualQuantity);

  if (actual === null || !Number.isFinite(planned) || planned === 0) {
    return <span className="text-slate-300">—</span>;
  }

  const percent = ((actual - planned) / planned) * 100;
  const label = `${percent > 0 ? '+' : ''}${percent.toFixed(percent === 0 ? 0 : 1)}%`;

  const tone =
    Math.abs(percent) <= batch.varianceThresholdPercent
      ? 'text-slate-800'
      : 'font-semibold text-amber-800';

  return <span className={`tabular-nums ${tone}`}>{label}</span>;
}

// ---------------------------------------------------------------------------
// 4. Batch release
// ---------------------------------------------------------------------------

/** The queue at the job-work quality gate. */
export function JobWorkPendingReleaseList({
  batches,
  people,
  formFor,
}: {
  batches: JobWorkBatchView[];
  /** Colleagues, for the Created By filter. */
  people: readonly PersonOption[];
  /** The release form for a batch, built by the server component above. */
  formFor: Record<string, ReactNode>;
}) {
  const view = useJobWorkRegisterView({ rows: batches });

  const [deciding, setDeciding] = useState<JobWorkBatchView | null>(null);

  // A decided batch drops out of `batches` on the next refresh, so the drawer
  // would otherwise sit open over a row that no longer exists.
  useEffect(() => {
    if (!deciding) return;
    if (batches.some((batch) => batch.id === deciding.id)) return;

    setDeciding(null);
  }, [batches, deciding]);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <RegisterToolbar
        title="Awaiting a Decision"
        query={view.query}
        onQuery={view.setQuery}
        placeholder="Search batch, order, principal or product…"
        noun="batches"
        // NO STATUS CONTROL: this tab IS a status. Everything on it is awaiting
        // a decision, so a dropdown would have one option that changes nothing
        // and four that empty the list.
        fields={serverCreatedFilters(people)}
        fieldValues={view.fieldValues}
        onField={view.setField}
        onClearFields={view.clearFields}
        shown={view.filtered.length}
        total={view.total}
      />

      {view.filtered.length === 0 ? (
        <p className="px-6 py-8 text-sm text-slate-600">
          {view.isFiltered
            ? 'No batch awaiting a decision matches those filters.'
            : 'Nothing is waiting at the gate.'}
        </p>
      ) : (
        <div className="table-scroll overflow-x-auto">
          <table className="w-full min-w-[62rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Batch</Th>
                <Th>Product</Th>
                <Th>Production order</Th>
                <Th>Manufactured</Th>
                <Th>Expiry</Th>
                <Th align="right">Packed</Th>
                <Th>Status</Th>
                <Th align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {view.visible.map((batch) => {
                const flagged = batch.materialVariances.some((variance) => variance.flagged);

                return (
                  <tr key={batch.id}>
                    <td className="px-6 py-3">
                      <span className="font-mono text-xs font-semibold text-slate-900">
                        {batch.batchNumber}
                      </span>
                      <div className="text-[11px] text-slate-600">{batch.principalName}</div>
                    </td>

                    <td className="px-6 py-3">
                      <span className="font-mono text-xs text-slate-700">{batch.product.code}</span>
                      <div className="text-slate-800">{batch.product.name}</div>
                      <div className="text-[11px] text-slate-500">
                        sold as {batch.principalBrandName}
                      </div>
                    </td>

                    <td className="px-6 py-3">
                      <span className="font-mono text-xs text-slate-700">
                        {batch.productionOrderNumber}
                      </span>
                      <div className="font-mono text-[11px] text-slate-500">
                        {batch.jobWorkOrderNumber}
                      </div>
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
                        return to the principal. */}
                    <td className="px-6 py-3 text-right">
                      <Quantity value={batch.packedQuantity} uom={batch.product.uom} />
                    </td>

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
                        {/* RELEASE, not Decide. The dialog it opens still
                            offers all three verdicts — release, hold, reject —
                            because the decision is genuinely three-way; what
                            changed is the name of the act somebody came to
                            this row to perform. */}
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

      {deciding && (
        <MasterDataDrawer
          title={`${deciding.batchNumber} — ${deciding.product.name}`}
          description={`${deciding.productionOrderNumber} · ${deciding.principalName} · manufactured ${deciding.manufacturedOn} · expires ${deciding.expiryDate}`}
          placement="center"
          onClose={() => setDeciding(null)}
        >
          <div className="flex flex-col gap-4">
            {/* The figures the verdict turns on, stated before the controls. */}
            <dl className="grid grid-cols-2 gap-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-3">
              <Figure label="Planned">
                <Quantity value={deciding.plannedQuantity} uom={deciding.product.uom} />
              </Figure>
              <Figure label="Manufactured">
                <Quantity value={deciding.actualQuantity} uom={deciding.product.uom} />
              </Figure>
              <Figure label="Packed">
                <Quantity value={deciding.packedQuantity} uom={deciding.product.uom} />
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

/**
 * Released batches, waiting to go back to the principal.
 *
 * WHERE THE INTERNAL SCREEN SHOWS SELLABLE STOCK. A job-work batch is not ours
 * to sell — it is made from the principal's material and returned to them — so
 * what this reports is what is cleared for dispatch under Outward dispatch.
 */
export function JobWorkReleasedTable({
  batches,
  people,
}: {
  batches: JobWorkBatchView[];
  /** Colleagues, for the Created By filter. */
  people: readonly PersonOption[];
}) {
  const view = useJobWorkRegisterView({ rows: batches });

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <RegisterToolbar
        title="Released Stock"
        query={view.query}
        onQuery={view.setQuery}
        placeholder="Search batch, product or principal…"
        noun="batches"
        // NO STATUS CONTROL: every row here is released, which is what the tab
        // means.
        fields={serverCreatedFilters(people)}
        fieldValues={view.fieldValues}
        onField={view.setField}
        onClearFields={view.clearFields}
        shown={view.filtered.length}
        total={view.total}
      />

      {view.filtered.length === 0 ? (
        <p className="px-6 py-8 text-sm text-slate-600">
          {view.isFiltered
            ? 'No released batch matches those filters.'
            : 'No batch released yet.'}
        </p>
      ) : (
        <div className="table-scroll overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Product</Th>
                <Th>Batch</Th>
                <Th>Principal</Th>
                <Th>Expiry</Th>
                <Th align="right">Packed</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {view.visible.map((batch) => (
                <tr key={batch.id}>
                  <td className="px-6 py-3">
                    <span className="font-mono text-xs text-slate-700">{batch.product.code}</span>
                    <div className="text-slate-800">{batch.product.name}</div>
                    <div className="text-[11px] text-slate-500">
                      sold as {batch.principalBrandName}
                    </div>
                  </td>
                  <td className="px-6 py-3 font-mono text-xs text-slate-800">
                    {batch.batchNumber}
                  </td>
                  <td className="px-6 py-3 text-slate-700">{batch.principalName}</td>
                  <td className="px-6 py-3">
                    <DateCell value={batch.expiryDate} />
                    <ExpiryHint date={batch.expiryDate} />
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Quantity value={batch.packedQuantity} uom={batch.product.uom} />
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
        noun="batches"
        pageSize={view.pageSize}
        onPage={view.goTo}
        onPageSize={view.setPageSize}
      />
    </div>
  );
}

/** Decisions already made, searchable and filtered by verdict. */
export function JobWorkDecidedTable({
  batches,
  people,
}: {
  batches: JobWorkBatchView[];
  /** Colleagues, for the Created By filter. */
  people: readonly PersonOption[];
}) {
  // THE VERDICT WRITES ITS OWN URL KEY. All three Batch Release tabs share one
  // address bar, and the other two are fixed status slices; a verdict written
  // as `status` would have emptied them.
  const view = useJobWorkRegisterView({ rows: batches, statusKey: 'verdict' });

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
        // the first tab. Offering it here would be a filter that always returns
        // nothing.
        filterOptions={BATCH_RELEASE_STATUSES.filter((status) => status !== 'PENDING').map(
          (status) => ({ value: status, label: BATCH_RELEASE_STATUS_LABELS[status] }),
        )}
        fields={serverCreatedFilters(people, 'Decided date')}
        fieldValues={view.fieldValues}
        onField={view.setField}
        onClearFields={view.clearFields}
        shown={view.filtered.length}
        total={view.total}
      />

      {view.filtered.length === 0 ? (
        <p className="px-6 py-8 text-sm text-slate-600">
          {view.isFiltered
            ? 'No decision matches those filters.'
            : 'No batch has been through the gate yet.'}
        </p>
      ) : (
        <div className="table-scroll overflow-x-auto">
          <table className="w-full min-w-[54rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Batch</Th>
                <Th>Principal</Th>
                <Th>Decision</Th>
                <Th>By</Th>
                <Th>When</Th>
                <Th>Reason</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {view.visible.map((batch) => (
                <tr key={batch.id} className="align-top">
                  <td className="px-6 py-3">
                    <span className="font-mono text-xs text-slate-800">{batch.batchNumber}</span>
                    <div className="font-mono text-[11px] text-slate-500">
                      {batch.productionOrderNumber}
                    </div>
                  </td>
                  <td className="px-6 py-3 text-slate-700">{batch.principalName}</td>
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
