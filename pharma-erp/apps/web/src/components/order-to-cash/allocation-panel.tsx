import {
  SCHEDULE_CATEGORY_LABELS,
  type AllocationRow,
  type SalesOrderListItem,
} from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

import { AllocateOrderButton, AllocationRowActions } from './allocation-actions';
import {
  Badge,
  Cell,
  EmptyState,
  ErrorState,
  formatDate,
  Note,
  Panel,
  Quantity,
  StatusBadge,
  StepHeader,
  Table,
} from './ui';

const COLUMNS = [
  'Order #',
  'Product',
  'Batch',
  'Expiry',
  'Qty ordered',
  'Qty allocated',
  'Compliance',
  'Status',
  'Actions',
] as const;

/**
 * Subtab 3 — Allocation.
 *
 * Two sections, because there are two questions: which approved orders are
 * waiting for stock, and what has already been reserved. The waiting list comes
 * first — it is the thing that needs an action.
 *
 * The reservations table is ordered by expiry within an order, so the FEFO
 * decision is legible: the batch at the top is the one that was closest to
 * expiring, which is why it was picked.
 */
export async function AllocationPanel() {
  const [allocations, orders] = await Promise.all([
    apiFetch<AllocationRow[]>('/api/v1/order-to-cash/allocation', { authenticated: true }),
    apiFetch<SalesOrderListItem[]>('/api/v1/order-to-cash/sales-orders', { authenticated: true }),
  ]);

  // Approved or part-allocated orders still needing stock. Anything not past
  // both gates is deliberately absent: it is not allocatable, and listing it
  // with a disabled button would invite the question of why.
  const awaiting = orders.ok
    ? orders.data.filter(
        (order) =>
          order.licenceCheck === 'PASS' &&
          order.creditCheck === 'PASS' &&
          ['APPROVED', 'PARTIALLY_ALLOCATED'].includes(order.status),
      )
    : [];

  return (
    <>
      <StepHeader
        title="Allocation"
        description="Reserving released batches against an approved order, nearest expiry first. Quarantined, expired and unreleased stock is never a candidate."
      />

      <div className="mb-6">
        <Panel heading="Awaiting stock" count={awaiting.length} noun="order">
          {!orders.ok ? (
            <ErrorState what="orders awaiting allocation" message={orders.error} />
          ) : awaiting.length === 0 ? (
            <EmptyState
              title="Nothing is waiting for stock."
              hint="An order appears here once it has passed both the licence and the credit check."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {awaiting.map((order) => (
                <li
                  key={order.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                >
                  <div>
                    <p className="font-mono text-xs font-medium text-slate-900">
                      {order.orderNumber}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-700">{order.customerName}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {order.itemCount} line{order.itemCount === 1 ? '' : 's'} ·{' '}
                      {formatDate(order.orderDate)} · <StatusBadgeInline status={order.status} />
                    </p>
                  </div>
                  <AllocateOrderButton salesOrderId={order.id} orderNumber={order.orderNumber} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        heading="Reservations"
        count={allocations.ok ? allocations.data.length : undefined}
        noun="reservation"
        footer="Expiry and schedule are shown as they stood WHEN THE STOCK WAS RESERVED, not as they are now. A later correction to the batch or item master does not rewrite what was checked."
      >
        {!allocations.ok ? (
          <ErrorState what="allocations" message={allocations.error} />
        ) : allocations.data.length === 0 ? (
          <EmptyState
            title="No stock has been reserved yet."
            hint="Allocate an approved order above. Only RELEASED, unexpired batches with available quantity are eligible."
          />
        ) : (
          <Table columns={COLUMNS}>
            {allocations.data.map((allocation) => (
              <AllocationTableRow key={allocation.id} allocation={allocation} />
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

function StatusBadgeInline({ status }: { status: string }) {
  return (
    <span className="align-middle">
      <StatusBadge status={status} />
    </span>
  );
}

function AllocationTableRow({ allocation }: { allocation: AllocationRow }) {
  const needsCheck = allocation.complianceRecheckRequired && !allocation.complianceCheckedAt;

  return (
    <tr className={needsCheck ? 'bg-amber-50/40' : undefined}>
      <Cell>
        <p className="font-mono text-xs font-medium text-slate-900">{allocation.orderNumber}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{allocation.customerName}</p>
      </Cell>

      <Cell>
        <p className="text-sm text-slate-800">{allocation.itemName}</p>
        <p className="mt-0.5 font-mono text-[11px] text-slate-500">{allocation.itemCode}</p>
        {allocation.scheduleCategory !== 'NONE' && (
          <span className="mt-1 inline-block">
            <Badge tone={allocation.complianceRecheckRequired ? 'amber' : 'slate'}>
              {SCHEDULE_CATEGORY_LABELS[allocation.scheduleCategory]}
            </Badge>
          </span>
        )}
      </Cell>

      <Cell>
        <span className="font-mono text-xs text-slate-800">{allocation.batchNumber}</span>
      </Cell>

      <Cell>
        <span className="whitespace-nowrap text-xs text-slate-700">
          {formatDate(allocation.expiryDate)}
        </span>
      </Cell>

      <Cell align="right">
        <Quantity value={allocation.quantityOrdered} />
      </Cell>

      <Cell align="right">
        <Quantity value={allocation.quantityAllocated} />
        {allocation.quantityDispatched !== '0.000' && (
          <p className="mt-0.5 text-[11px] text-slate-500">
            {allocation.quantityDispatched} out
          </p>
        )}
      </Cell>

      <Cell>
        {!allocation.complianceRecheckRequired ? (
          <span className="text-xs text-slate-400">Not required</span>
        ) : allocation.complianceCheckedAt ? (
          <>
            <Badge tone="green">Checked</Badge>
            {allocation.complianceCheckedByName && (
              <p className="mt-1 text-[11px] text-slate-500">
                {allocation.complianceCheckedByName}
              </p>
            )}
          </>
        ) : (
          <Badge tone="amber" title="Dispatch is refused until this is recorded">
            Re-check due
          </Badge>
        )}
      </Cell>

      <Cell>
        <StatusBadge status={allocation.status} />
      </Cell>

      <Cell>
        <AllocationRowActions allocation={allocation} />
      </Cell>
    </tr>
  );
}

/** Re-exported so the step dispatcher can show the shortfall note. */
export { Note };
