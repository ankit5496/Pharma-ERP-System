import type { Metadata } from 'next';
import {
  PROCUREMENT_ROUTES,
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_STATUS_LABELS,
  UNIT_LABELS,
} from '@pharma-erp/types';

import { FilterBar } from '@/components/procurement/filter-bar';
import { PurchaseOrderActions } from '@/components/procurement/purchase-order-actions';
import {
  Blank,
  DateText,
  EmptyState,
  ErrorState,
  Money,
  Panel,
  Qty,
  RecordLink,
  StatusPill,
  TableWrap,
} from '@/components/procurement/ui';
import {
  fetchItems,
  fetchPurchaseOrders,
  fetchVendors,
  toListQuery,
  toOptions,
} from '@/lib/procurement';

export const metadata: Metadata = { title: 'Purchase orders' };
export const dynamic = 'force-dynamic';

/**
 * Sub-tab 2 — Purchase orders.
 *
 * Each order expands to its lines, because the line is where the useful
 * information is: what is still outstanding on it decides whether a GRN can
 * be booked, and the requisition it came from is the traceability link the
 * brief asks for.
 */
export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = toListQuery(await searchParams);

  const [orders, vendors, items] = await Promise.all([
    fetchPurchaseOrders(query),
    fetchVendors(),
    fetchItems(),
  ]);

  const isFiltered = Object.values(query).some(Boolean);

  return (
    <Panel
      title="Purchase orders"
      subtitle={
        orders.ok
          ? `${orders.data.length} order${orders.data.length === 1 ? '' : 's'}`
          : undefined
      }
    >
      <FilterBar
        statuses={PURCHASE_ORDER_STATUSES.map((status) => ({
          value: status,
          label: PURCHASE_ORDER_STATUS_LABELS[status],
        }))}
        vendors={vendors.ok ? toOptions(vendors.data) : []}
        items={items.ok ? toOptions(items.data) : []}
        searchPlaceholder="Search by PO number, vendor or item…"
      />

      {!orders.ok ? (
        <ErrorState message={`Could not load purchase orders: ${orders.error}`} />
      ) : orders.data.length === 0 ? (
        <EmptyState
          title="No purchase orders yet."
          hint="Approve a requisition and use Convert to PO to raise the first one."
          filtered={isFiltered}
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {orders.data.map((order) => (
            <li key={order.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-slate-900">
                      {order.number}
                    </span>
                    <StatusPill
                      status={order.status}
                      label={PURCHASE_ORDER_STATUS_LABELS[order.status]}
                    />
                  </div>

                  <p className="mt-1 text-sm text-slate-700">{order.vendor.name}</p>

                  <p className="mt-0.5 text-xs text-slate-500">
                    Raised <DateText value={order.poDate} />
                    {order.expectedDeliveryDate && (
                      <>
                        {' · expected '}
                        <DateText value={order.expectedDeliveryDate} />
                      </>
                    )}
                    {' · net '}
                    {order.paymentTermsDays} days
                    {order.createdBy && ` · by ${order.createdBy}`}
                  </p>

                  {(order.goodsReceipts.length > 0 || order.invoices.length > 0) && (
                    <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {order.goodsReceipts.map((grn) => (
                        <RecordLink
                          key={grn.id}
                          href={`${PROCUREMENT_ROUTES.goodsReceipts}?search=${grn.number}`}
                        >
                          {grn.number}
                        </RecordLink>
                      ))}
                      {order.invoices.map((invoice) => (
                        <RecordLink
                          key={invoice.id}
                          href={`${PROCUREMENT_ROUTES.invoices}?search=${invoice.number}`}
                        >
                          {invoice.number}
                        </RecordLink>
                      ))}
                    </p>
                  )}
                </div>

                <div className="text-right">
                  <p className="text-lg font-semibold text-slate-900">
                    <Money amount={order.totalAmount} />
                  </p>
                  <p className="text-xs text-slate-500">
                    <Money amount={order.taxableAmount} /> + <Money amount={order.taxAmount} /> GST
                  </p>
                  <div className="mt-2">
                    <PurchaseOrderActions order={order} />
                  </div>
                </div>
              </div>

              <TableWrap>
                <table className="mt-3 w-full min-w-[48rem] text-left text-xs">
                  <thead>
                    <tr className="border-y border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Item
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        From requisition
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        Ordered
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        Received
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        Pending
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        Rate
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        GST
                      </th>
                      <th scope="col" className="py-2 text-right font-medium">
                        Line total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {order.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="py-2 pr-4">
                          <span className="font-medium text-slate-800">{line.item.name}</span>
                          <span className="ml-2 font-mono text-[11px] text-slate-500">
                            {line.item.code}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          {line.requisition ? (
                            <RecordLink
                              href={`${PROCUREMENT_ROUTES.requisitions}?search=${line.requisition.number}`}
                            >
                              <span className="font-mono text-[11px]">
                                {line.requisition.number}
                              </span>
                            </RecordLink>
                          ) : (
                            <Blank />
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          <Qty value={line.quantity} uom={UNIT_LABELS[line.item.uom]} />
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {line.quantityReceived === '0' ? (
                            <Blank />
                          ) : (
                            <Qty value={line.quantityReceived} />
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {line.quantityPending === '0' ? (
                            <span className="font-medium text-green-800">complete</span>
                          ) : (
                            <span className="font-medium text-amber-800">
                              {line.quantityPending}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          <Money amount={line.rate} />
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {line.taxRatePercent}%
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          <Money amount={line.totalAmount} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>

              {order.notes && <p className="mt-2 text-xs text-slate-500">{order.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
