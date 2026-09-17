import type { Metadata } from 'next';
import {
  PACKAGING_LEVEL_LABELS,
  PROCUREMENT_ROUTES,
  REQUISITION_STATUSES,
  REQUISITION_STATUS_LABELS,
  REQUISITION_TRIGGER_HINTS,
  REQUISITION_TRIGGER_LABELS,
  REQUISITION_TRIGGER_TYPES,
  type RequisitionListItem,
} from '@pharma-erp/types';

import { FilterButton, FilterPanel } from '@/components/procurement/filter-bar';
import { Pagination } from '@/components/procurement/pagination';
import {
  RequisitionActions,
  RequisitionStatusSelect,
} from '@/components/procurement/requisition-actions';
import { RequisitionForm } from '@/components/procurement/requisition-form';
import {
  Blank,
  DateText,
  EmptyState,
  ErrorState,
  Panel,
  Pill,
  Qty,
  TableWrap,
  Td,
  Th,
} from '@/components/procurement/ui';
import {
  fetchItems,
  fetchProductionPlans,
  fetchRequisitions,
  fetchVendors,
  toListQuery,
  toOptions,
} from '@/lib/procurement';
import { requireSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Purchase requisitions' };
export const dynamic = 'force-dynamic';

/**
 * Sub-tab 2 — Purchase requisitions.
 *
 * ONE SECTION. This screen used to be two panels plus a toolbar of unrelated
 * create buttons — Add item, Add vendor, New production plan, Issue stock —
 * which made "raise a requisition" one option among five on a screen named
 * after requisitions. Master data belongs to the Masters module; this page
 * consumes it and creates exactly one kind of record.
 *
 * The low-stock list has its own tab alongside this one. It used to be a
 * strip at the top of this screen, which meant the page named after
 * requisitions opened on something else.
 *
 * WHAT IS NOT HERE, deliberately: no button that creates an item, a vendor, a
 * product, a production plan, or moves stock. Everything selectable on the
 * form is master data that already exists.
 */
export default async function RequisitionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = toListQuery(await searchParams);
  const isFiltered = Object.values(query).some(Boolean);

  const [user, requisitions, items, vendors, plans, unfiltered] = await Promise.all([
    requireSession(),
    fetchRequisitions(query),
    fetchItems(),
    fetchVendors(),
    fetchProductionPlans(),
    // The 'Raised by' options come from the requisitions themselves, since
    // there is no people endpoint to read them from. They must come from the
    // UNFILTERED list: derived from the filtered one, choosing a person would
    // narrow the list to them and then drop everyone else from the dropdown,
    // stranding the user with no way back. Only fetched when something is
    // actually filtered — otherwise the list already on the page is the
    // unfiltered one.
    isFiltered ? fetchRequisitions({}) : Promise.resolve(null),
  ]);

  const itemOptions = items.ok ? toOptions(items.data) : [];
  const vendorOptions = vendors.ok ? toOptions(vendors.data) : [];

  // Auto-reorder rows have no author, so they contribute nothing here.
  const raisedByOptions = (() => {
    const source = unfiltered ?? requisitions;

    if (!source.ok) return [];

    const byId = new Map<string, string>();

    for (const row of source.data.rows) {
      if (row.requestedById && row.requestedBy) byId.set(row.requestedById, row.requestedBy);
    }

    return [...byId].map(([value, label]) => ({ value, label }));
  })();

  return (
    <Panel
      title="Purchase requisitions"
      subtitle={
        requisitions.ok
          ? `${requisitions.data.total} requisition${requisitions.data.total === 1 ? '' : 's'}`
          : undefined
      }
      action={
        <>
          <FilterButton />
          <RequisitionForm
            items={items.ok ? items.data : []}
            vendors={vendors.ok ? vendors.data : []}
            plans={plans.ok ? plans.data : []}
            raisedBy={user.fullName}
          />
        </>
      }
    >
      <FilterPanel
        statuses={REQUISITION_STATUSES.map((status) => ({
          value: status,
          label: REQUISITION_STATUS_LABELS[status],
        }))}
        triggerTypes={REQUISITION_TRIGGER_TYPES.map((trigger) => ({
          value: trigger,
          label: REQUISITION_TRIGGER_LABELS[trigger],
        }))}
        vendors={vendorOptions}
        items={itemOptions}
        raisedBy={raisedByOptions}
        searchPlaceholder="Search by number, item or vendor…"
      />

      {!requisitions.ok ? (
        <ErrorState message={`Could not load requisitions: ${requisitions.error}`} />
      ) : requisitions.data.rows.length === 0 ? (
        <EmptyState
          title="No requisitions yet."
          hint="Use Create purchase requisition above, or let the reorder check raise one when stock runs low."
          filtered={isFiltered}
        />
      ) : (
        <>
          <TableWrap>
            <table className="w-full min-w-[86rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <Th>Requisition no.</Th>
                  <Th>Date</Th>
                  <Th>Item</Th>
                  <Th align="right">Requested qty</Th>
                  <Th>Trigger type</Th>
                  <Th>Raised by</Th>
                  <Th>Why</Th>
                  <Th>For</Th>
                  <Th>Preferred vendor</Th>
                  <Th>Linked PO</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requisitions.data.rows.map((requisition) => (
                  <tr key={requisition.id}>
                    <Td>
                      <span className="font-mono text-xs font-medium text-slate-900">
                        {requisition.number}
                      </span>
                    </Td>

                    <Td>
                      <DateText value={requisition.requestDate} />
                      {requisition.requiredByDate && (
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          needed by <DateText value={requisition.requiredByDate} />
                        </p>
                      )}
                    </Td>

                    <Td>
                      <p className="font-medium text-slate-900">{requisition.item.name}</p>
                      <p className="font-mono text-xs text-slate-500">{requisition.item.code}</p>
                    </Td>

                    <Td align="right">
                      <Qty value={requisition.requiredQuantity} uom={requisition.item.uom} />
                      {requisition.quantityPerUnit && (
                        <p className="text-[11px] text-slate-500">
                          {requisition.quantityPerUnit} per unit/batch
                        </p>
                      )}
                    </Td>

                    <Td>
                      <TriggerCell requisition={requisition} />
                    </Td>

                    {/* "System" rather than a dash: an auto-created requisition
                        has no author because nobody raised it, which is a fact
                        about it rather than a missing value. */}
                    <Td>
                      <span className="text-xs text-slate-700">
                        {requisition.requestedBy ?? 'System'}
                      </span>
                    </Td>

                    {/* The justification, as it stood when the requisition was
                        raised — not today's figures. The shortfall is gone from
                        here: it was the arithmetic difference between the two
                        numbers printed beside it, so the column was saying the
                        same thing twice. */}
                    <Td>
                      <p className="whitespace-nowrap text-xs text-slate-600">
                        Stock {requisition.stockAtRequest} | Reorder{' '}
                        {requisition.reorderLevelAtRequest}
                      </p>
                    </Td>

                    <Td valign="top">
                      <PurposeCell requisition={requisition} />
                    </Td>

                    <Td>{requisition.preferredVendor?.name ?? <Blank />}</Td>

                    <Td valign="top">
                      {requisition.linkedPurchaseOrders.length === 0 ? (
                        <Blank />
                      ) : (
                        <ul className="space-y-0.5">
                          {requisition.linkedPurchaseOrders.map((order) => (
                            <li key={order.id}>
                              <a
                                href={`${PROCUREMENT_ROUTES.purchaseOrders}?search=${order.number}`}
                                className="font-mono text-xs text-sky-800 underline decoration-sky-300 underline-offset-2"
                              >
                                {order.number}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>

                    {/* The status column IS the control that changes it. */}
                    <Td>
                      <RequisitionStatusSelect requisition={requisition} />
                    </Td>

                    <Td>
                      <RequisitionActions
                        requisition={requisition}
                        vendors={vendors.ok ? vendors.data : []}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>

          <Pagination
            total={requisitions.data.total}
            page={requisitions.data.page}
            pageSize={requisitions.data.pageSize}
            noun="requisitions"
          />
        </>
      )}
    </Panel>
  );
}

/**
 * Why this requisition exists.
 *
 * An auto-reorder requisition has no author and needs none; a manual one was
 * raised by somebody. Worth a column rather than a footnote, because it is the
 * first thing a buyer checks before acting on one.
 */
function TriggerCell({ requisition }: { requisition: RequisitionListItem }) {
  const isAuto = requisition.triggerType === 'AUTO_REORDER';

  return (
    // The explanation is a `title` rather than a positioned tooltip on purpose.
    // The table scrolls inside its own container, and an absolutely positioned
    // bubble is clipped by that container the moment the row is near an edge —
    // which is exactly the row someone is most likely to be hovering. A native
    // tooltip escapes the scroll box and cannot alter the layout.
    <span title={REQUISITION_TRIGGER_HINTS[requisition.triggerType]} className="cursor-help">
      <Pill tone={isAuto ? 'info' : 'neutral'}>
        {REQUISITION_TRIGGER_LABELS[requisition.triggerType]}
      </Pill>
    </span>
  );
}

/**
 * What the material is for: the run, the product, and where it sits in the
 * pack.
 *
 * All optional, so the cell renders only what was actually filled in — a
 * requisition for a bulk raw material shows a dash rather than four empty
 * labels.
 */
function PurposeCell({ requisition }: { requisition: RequisitionListItem }) {
  const plan = requisition.productionPlan;
  const product = requisition.finishedProduct ?? plan?.finishedProduct ?? null;
  const packVariant = requisition.packVariant ?? plan?.packVariant ?? null;
  const component = requisition.packagingComponent;

  const hasAnything = plan || product || packVariant || component || requisition.packagingLevel;

  if (!hasAnything) return <Blank />;

  return (
    <div className="space-y-0.5 text-[11px] leading-snug">
      {plan && <p className="font-mono text-slate-700">{plan.number}</p>}
      {product && <p className="text-slate-700">{product.name}</p>}
      {packVariant && <p className="text-slate-500">{packVariant}</p>}

      {component && (
        <p className="text-slate-500">
          {component.name}
          {requisition.packagingLevel
            ? ` · ${PACKAGING_LEVEL_LABELS[requisition.packagingLevel]}`
            : ''}
        </p>
      )}

      {!requisition.isMandatory && <Pill tone="muted">Optional</Pill>}
    </div>
  );
}
