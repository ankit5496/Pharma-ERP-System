'use client';

import { useCallback } from 'react';
import type { ProductionOrderSummary } from '@pharma-erp/types';
import { PRODUCTION_ORDER_STATUS_LABELS, PRODUCTION_ORDER_STATUSES } from '@pharma-erp/types';

import { OrderStatusBadge, Quantity, ReleaseBadge } from './shared';
import { RegisterPager, RegisterToolbar, useRegisterView } from './register-toolbar';

/** Work orders, searchable by number, product or batch, and filtered by status. */
export function OrderTable({ orders }: { orders: ProductionOrderSummary[] }) {
  // Stable identities: the hook holds both in a `useMemo` dependency list, and
  // a new function each render would refilter on every keystroke.
  const searchText = useCallback(
    (order: ProductionOrderSummary) =>
      [
        order.orderNumber,
        order.product.code,
        order.product.name,
        order.batchNumber,
        order.createdBy,
      ]
        .filter(Boolean)
        .join(' '),
    [],
  );

  const matchesFilter = useCallback(
    (order: ProductionOrderSummary, value: string) => order.status === value,
    [],
  );

  const view = useRegisterView({ rows: orders, searchText, matchesFilter });

  return (
    <>
      <RegisterToolbar
        query={view.query}
        onQuery={view.setQuery}
        placeholder="Search order, product or batch…"
        noun="work orders"
        filter={view.filter}
        onFilter={view.setFilter}
        filterOptions={PRODUCTION_ORDER_STATUSES.map((status) => ({
          value: status,
          label: PRODUCTION_ORDER_STATUS_LABELS[status],
        }))}
        shown={view.filtered.length}
        total={view.total}
      />

      {view.filtered.length === 0 ? (
        <p className="px-6 py-8 text-sm text-slate-600">
          {orders.length === 0 ? 'No work orders yet.' : 'No work order matches that search.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <Th>Order</Th>
                <Th>Product</Th>
                <Th align="right">Planned</Th>
                <Th>Status</Th>
                <Th>Batch</Th>
                <Th>Raised by</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {view.visible.map((order) => (
                <tr key={order.id} className="align-top">
                  <td className="px-6 py-3">
                    <span className="font-mono text-xs font-semibold text-slate-800">
                      {order.orderNumber}
                    </span>
                    <div className="text-xs text-slate-500">BOM v{order.bomVersion}</div>
                  </td>
                  <td className="px-6 py-3">
                    <span className="font-mono text-xs text-slate-700">{order.product.code}</span>
                    <div className="text-slate-800">{order.product.name}</div>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Quantity value={order.plannedQuantity} uom={order.product.uom} />
                  </td>
                  <td className="px-6 py-3">
                    <OrderStatusBadge status={order.status} />
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
        noun="work orders"
        pageSize={view.pageSize}
        onPage={view.goTo}
        onPageSize={view.setPageSize}
      />
    </>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-6 py-3 font-medium ${align === 'right' ? 'text-right' : ''}`}
    >
      {children}
    </th>
  );
}
