import type { Metadata } from 'next';
import {
  PACKAGING_LEVEL_LABELS,
  PROCUREMENT_ROUTES,
  REQUISITION_STATUSES,
  REQUISITION_STATUS_LABELS,
  REQUISITION_TRIGGER_LABELS,
  type RequisitionListItem,
} from '@pharma-erp/types';

import { AutoCreationToggle } from '@/components/procurement/auto-creation-toggle';
import { FilterBar } from '@/components/procurement/filter-bar';
import { RequisitionActions } from '@/components/procurement/requisition-actions';
import { RequisitionForm } from '@/components/procurement/requisition-form';
import {
  Blank,
  DateText,
  EmptyState,
  ErrorState,
  Panel,
  Pill,
  Qty,
  StatusPill,
  TableWrap,
  Td,
  Th,
} from '@/components/procurement/ui';
import {
  fetchItems,
  fetchProcurementSettings,
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

  const [user, requisitions, items, vendors, plans, settings] = await Promise.all([
    requireSession(),
    fetchRequisitions(query),
    fetchItems(),
    fetchVendors(),
    fetchProductionPlans(),
    fetchProcurementSettings(),
  ]);

  const itemOptions = items.ok ? toOptions(items.data) : [];
  const vendorOptions = vendors.ok ? toOptions(vendors.data) : [];
  const isFiltered = Object.values(query).some(Boolean);

  // A failed settings read must not hide the screen. Treated as on, because
  // that is the default and the toggle will show the real value once the API
  // answers; the toggle itself reports the error if the write fails.
  const autoCreationEnabled = settings.ok ? settings.data.autoRequisitionEnabled : true;

  return (
    <Panel
      title="Purchase requisitions"
      subtitle={
        requisitions.ok
          ? `${requisitions.data.length} requisition${requisitions.data.length === 1 ? '' : 's'}`
          : undefined
      }
      action={
        <div className="flex flex-wrap items-start justify-end gap-4">
          <AutoCreationToggle enabled={autoCreationEnabled} />
          <RequisitionForm
            items={items.ok ? items.data : []}
            vendors={vendors.ok ? vendors.data : []}
            plans={plans.ok ? plans.data : []}
            raisedBy={user.fullName}
          />
        </div>
      }
    >
      <FilterBar
        statuses={REQUISITION_STATUSES.map((status) => ({
          value: status,
          label: REQUISITION_STATUS_LABELS[status],
        }))}
        vendors={vendorOptions}
        items={itemOptions}
        searchPlaceholder="Search by number, item or vendor…"
      />

      {!requisitions.ok ? (
        <ErrorState message={`Could not load requisitions: ${requisitions.error}`} />
      ) : requisitions.data.length === 0 ? (
        <EmptyState
          title="No requisitions yet."
          hint="Use Create purchase requisition above, or let the reorder check raise one when stock runs low."
          filtered={isFiltered}
        />
      ) : (
        <TableWrap>
          <table className="w-full min-w-[72rem] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <Th>Number</Th>
                <Th>Trigger</Th>
                <Th>Item</Th>
                <Th>Why</Th>
                <Th align="right">Requested</Th>
                <Th>For</Th>
                <Th>Preferred vendor</Th>
                <Th>Raised</Th>
                <Th>Status</Th>
                <Th>Linked PO</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {requisitions.data.map((requisition) => (
                <tr key={requisition.id}>
                  <Td>
                    <span className="font-mono text-xs font-medium text-slate-900">
                      {requisition.number}
                    </span>
                  </Td>

                  <Td>
                    <TriggerCell requisition={requisition} />
                  </Td>

                  <Td>
                    <p className="font-medium text-slate-900">{requisition.item.name}</p>
                    <p className="font-mono text-xs text-slate-500">{requisition.item.code}</p>
                  </Td>

                  {/* The justification, as it stood when the requisition was
                      raised — not today's figures. */}
                  <Td>
                    <p className="whitespace-nowrap text-xs text-slate-600">
                      Stock {requisition.stockAtRequest} | Reorder{' '}
                      {requisition.reorderLevelAtRequest} |{' '}
                      <span className="font-semibold text-amber-800">
                        Shortfall {requisition.shortfallAtRequest}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">at time of request</p>
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
                    <PurposeCell requisition={requisition} />
                  </Td>

                  <Td>{requisition.preferredVendor?.name ?? <Blank />}</Td>

                  <Td>
                    <p className="text-xs text-slate-700">{requisition.requestedBy ?? 'System'}</p>
                    <p className="text-xs text-slate-500">
                      <DateText value={requisition.requestDate} />
                    </p>
                    {requisition.requiredByDate && (
                      <p className="text-[11px] text-slate-400">
                        needed by <DateText value={requisition.requiredByDate} />
                      </p>
                    )}
                  </Td>

                  <Td>
                    <StatusPill
                      status={requisition.status}
                      label={REQUISITION_STATUS_LABELS[requisition.status]}
                    />
                    {requisition.approvedBy && (
                      <p className="mt-1 text-[11px] text-slate-500">by {requisition.approvedBy}</p>
                    )}
                  </Td>

                  <Td>
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
    <div className="space-y-1">
      <Pill tone={isAuto ? 'info' : 'neutral'}>
        {REQUISITION_TRIGGER_LABELS[requisition.triggerType]}
      </Pill>
      {isAuto && <p className="text-[11px] text-slate-400">raised by the system</p>}
    </div>
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
