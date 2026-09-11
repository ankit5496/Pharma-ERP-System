import type { Metadata } from 'next';
import {
  PROCUREMENT_ROUTES,
  REQUISITION_STATUSES,
  REQUISITION_STATUS_LABELS,
  unitLabel,
} from '@pharma-erp/types';

import { FilterBar } from '@/components/procurement/filter-bar';
import { LowStockPanel } from '@/components/procurement/low-stock-panel';
import { MastersToolbar } from '@/components/procurement/masters-toolbar';
import { RequisitionActions } from '@/components/procurement/requisition-actions';
import {
  Blank,
  DateText,
  EmptyState,
  ErrorState,
  Panel,
  Qty,
  StatusPill,
  TableWrap,
  Td,
  Th,
} from '@/components/procurement/ui';
import {
  fetchItems,
  fetchLowStock,
  fetchRequisitions,
  fetchVendors,
  toListQuery,
  toOptions,
} from '@/lib/procurement';

export const metadata: Metadata = { title: 'Purchase requisitions' };
export const dynamic = 'force-dynamic';

/**
 * Sub-tab 1 — Purchase requisitions.
 *
 * Two panels, in the order the work happens: what needs buying, then what has
 * been requested. The low-stock panel is the trigger for the whole workflow,
 * so it sits above the list rather than behind a tab — a buyer opening this
 * screen should see the shortages without looking for them.
 */
export default async function RequisitionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = toListQuery(params);

  const [requisitions, lowStock, items, vendors] = await Promise.all([
    fetchRequisitions(query),
    fetchLowStock(),
    fetchItems(),
    fetchVendors(),
  ]);

  const itemOptions = items.ok ? toOptions(items.data) : [];
  const vendorOptions = vendors.ok ? toOptions(vendors.data) : [];
  const isFiltered = Object.values(query).some(Boolean);

  return (
    <div className="space-y-6">
      <LowStockPanel
        result={lowStock}
        vendors={vendors.ok ? vendors.data : []}
        highlighted={params.view === 'low-stock'}
      />

      <Panel
        title="Requisitions"
        subtitle={
          requisitions.ok
            ? `${requisitions.data.length} requisition${requisitions.data.length === 1 ? '' : 's'}`
            : undefined
        }
        action={<MastersToolbar items={items.ok ? items.data : []} vendors={vendors.ok ? vendors.data : []} />}
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
            hint="Raise one from a low-stock item above, or with the Raise requisition button."
            filtered={isFiltered}
          />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[64rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <Th>Number</Th>
                  <Th>Item</Th>
                  <Th>Why</Th>
                  <Th align="right">Required</Th>
                  <Th>Preferred vendor</Th>
                  <Th>Requested</Th>
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
                      <p className="font-medium text-slate-900">{requisition.item.name}</p>
                      <p className="font-mono text-xs text-slate-500">{requisition.item.code}</p>
                    </Td>

                    {/* The justification, in the exact form the brief asked
                        for. These are the figures as they were when the
                        requisition was raised, not today's. */}
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
                      <Qty
                        value={requisition.requiredQuantity}
                        uom={unitLabel(requisition.item.uom)}
                      />
                    </Td>

                    <Td>{requisition.preferredVendor?.name ?? <Blank />}</Td>

                    <Td>
                      <p className="text-xs text-slate-700">{requisition.requestedBy ?? '—'}</p>
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
                        <p className="mt-1 text-[11px] text-slate-500">
                          by {requisition.approvedBy}
                        </p>
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
    </div>
  );
}
