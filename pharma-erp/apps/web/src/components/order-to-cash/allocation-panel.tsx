import {
  ALLOCATION_STATUSES,
  ALLOCATION_STATUS_LABELS,
  SCHEDULE_CATEGORIES,
  SCHEDULE_CATEGORY_LABELS,
  type AllocationRow,
  type SalesOrderListItem,
} from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

import { choicesFrom, matchesChoice, withinDates, paginate, type Filters } from './filtering';
import { FilterPanel, FilterToggle, ListPagerBar, PanelSearch } from './panel-toolbar';

import { AllocateOrderButton, AllocationRowActions } from './allocation-actions';
import {
  Badge,
  Cell,
  col,
  EmptyState,
  ErrorState,
  formatDate,
  Note,
  Panel,
  Quantity,
  StatusBadge,
  Table,
} from './ui';

const ALLOCATION_FILTERS = [
  {
    param: 'status',
    label: 'Status',
    allLabel: 'Any status',
    choices: choicesFrom(ALLOCATION_STATUSES, ALLOCATION_STATUS_LABELS),
  },
  {
    param: 'schedule',
    label: 'Schedule',
    allLabel: 'Any schedule',
    choices: choicesFrom(SCHEDULE_CATEGORIES, SCHEDULE_CATEGORY_LABELS),
  },
  // Which reservations are running out — the question FEFO exists to answer,
  // and one no search term can express.
  { param: 'expiryFrom', label: 'Expires on or after' },
  { param: 'expiryTo', label: 'Expires on or before' },
] as const;

const AWAITING_COLUMNS = [
  'Order',
  'Customer',
  'Date',
  col.right('Lines'),
  'Status',
  'Actions',
] as const;

const COLUMNS = [
  'Order',
  'Product',
  'Batch',
  'Expiry',
  col.right('Qty ordered'),
  col.right('Qty allocated'),
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
export async function AllocationPanel({
  search,
  filters,
}: {
  search?: string;
  filters: Filters;
}) {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';

  const [allocations, orders] = await Promise.all([
    apiFetch<AllocationRow[]>(`/api/v1/order-to-cash/allocation${query}`, { authenticated: true }),
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

  // The reservations, narrowed by the Filter panel. Status and schedule are
  // closed sets and expiry is a date — none of them is something to type.
  const reservations = allocations.ok
    ? allocations.data.filter(
        (row) =>
          matchesChoice(row.status, filters.status) &&
          matchesChoice(row.scheduleCategory, filters.schedule) &&
          withinDates(row.expiryDate, filters.expiryFrom, filters.expiryTo),
      )
    : [];

  // One page of it. The list is already in hand, so paging is a slice.
  const paged = paginate(reservations, filters);

  return (
    <>
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
            <Table columns={AWAITING_COLUMNS} minWidth="min-w-[48rem]">
              {awaiting.map((order) => (
                <AwaitingRow key={order.id} order={order} />
              ))}
            </Table>
          )}
        </Panel>
      </div>

      <Panel
        heading="Reservations"
        count={allocations.ok ? reservations.length : undefined}
        noun="reservation"
        action={
          <>
            <PanelSearch stepKey="allocation" placeholder="Search allocations…" />
            <FilterToggle fields={ALLOCATION_FILTERS} />
          </>
        }
      >
        <FilterPanel fields={ALLOCATION_FILTERS} />
        {!allocations.ok ? (
          <ErrorState what="allocations" message={allocations.error} />
        ) : reservations.length === 0 ? (
          <EmptyState
            title="No stock has been reserved yet."
            hint="Allocate an approved order above. Only RELEASED, unexpired batches with available quantity are eligible."
          />
        ) : (
          <Table columns={COLUMNS}>
            {paged.rows.map((allocation) => (
              <AllocationTableRow key={allocation.id} allocation={allocation} />
            ))}
          </Table>
        )}

        <ListPagerBar
          page={paged.page}
          pageCount={paged.pageCount}
          pageSize={paged.pageSize}
          first={paged.first}
          last={paged.last}
          total={paged.total}
          noun="reservations"
        />
      </Panel>
    </>
  );
}

/**
 * One order waiting for stock.
 *
 * The same columns as every other list in Order-to-Cash: the order, who it is
 * for, when it was raised, how big it is and where it stands. It was a stack of
 * three lines per row, which read differently from the table directly below it
 * holding the same kind of record.
 */
function AwaitingRow({ order }: { order: SalesOrderListItem }) {
  return (
    <tr>
      <Cell>
        <span className="font-mono text-xs font-medium text-slate-900">{order.orderNumber}</span>
      </Cell>

      <Cell>
        <span className="text-sm text-slate-800">{order.customerName}</span>
      </Cell>

      <Cell>
        <span className="whitespace-nowrap text-xs text-slate-700">
          {formatDate(order.orderDate)}
        </span>
      </Cell>

      <Cell align="right">
        <span className="text-sm text-slate-800">{order.itemCount}</span>
      </Cell>

      <Cell>
        <StatusBadge status={order.status} />
      </Cell>

      <Cell align="center">
        <AllocateOrderButton salesOrderId={order.id} orderNumber={order.orderNumber} />
      </Cell>
    </tr>
  );
}

function AllocationTableRow({ allocation }: { allocation: AllocationRow }) {
  return (
    <tr>
      <Cell>
        <p className="font-mono text-xs font-medium text-slate-900">{allocation.orderNumber}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{allocation.customerName}</p>
      </Cell>

      <Cell>
        <p className="text-sm text-slate-800">{allocation.itemName}</p>
        <p className="mt-0.5 font-mono text-[11px] text-slate-500">{allocation.itemCode}</p>
        {allocation.scheduleCategory !== 'NONE' && (
          <span className="mt-1 inline-block">
            <Badge tone="slate">
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
