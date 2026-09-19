import type { AllocationRow, DispatchListItem } from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

import {
  CreateDialogButton,
  FilterPanel,
  FilterToggle,
  PanelSearch,
} from './panel-toolbar';

import { DispatchRowActions, NewDispatchForm, type ReadyOrder } from './dispatch-actions';
import {
  Cell,
  col,
  EmptyState,
  ErrorState,
  formatDate,
  Panel,
  Quantity,
  StatusBadge,
  Table,
} from './ui';

const DISPATCH_FILTERS = [
  {
    param: 'status',
    label: 'Status',
    allLabel: 'Any status',
    choices: [
      { value: 'DRAFT', label: 'Draft' },
      { value: 'DISPATCHED', label: 'Dispatched' },
      { value: 'DELIVERED', label: 'Delivered' },
      { value: 'CANCELLED', label: 'Cancelled' },
    ],
  },
  { param: 'dateFrom', label: 'Date from' },
  { param: 'dateTo', label: 'Date to' },
] as const;

const COLUMNS = [
  'Dispatch #',
  'Order #',
  'Invoice #',
  'Customer',
  'Dispatch date',
  col.right('Qty'),
  'Transport',
  'Status',
  'Actions',
] as const;

/**
 * Subtab 4 — Dispatch.
 *
 * This is the screen where stock actually leaves. Recording a dispatch writes
 * the document, the stock-ledger OUT entries and the batch draw-down in one
 * transaction, so there is no state in which the paperwork and the inventory
 * disagree.
 *
 * WHAT IS SHIPPED IS AN ALLOCATION, NOT AN INVOICE. Step 4 is Dispatch and
 * step 5 is "Tax invoices raised against a dispatch" - the invoice bills what
 * actually left, so it cannot be a precondition for leaving. This screen
 * therefore lists orders with stock reserved against them, and the invoice
 * becomes available on the next tab once a dispatch is confirmed.
 *
 * Quantities are never typed here: a line ships what remains allocated on that
 * batch. That is both less work and one fewer place for a number to be wrong.
 */
export async function DispatchPanel({
  search,
  status,
}: {
  search?: string;
  /**
   * From the panel's Filter button. Applied here rather than on the wire: the
   * list endpoint takes no status parameter, and the rows are already loaded.
   */
  status?: string;
}) {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';

  const [dispatches, allocations] = await Promise.all([
    apiFetch<DispatchListItem[]>(`/api/v1/order-to-cash/dispatch${query}`, {
      authenticated: true,
    }),
    apiFetch<AllocationRow[]>('/api/v1/order-to-cash/allocation', { authenticated: true }),
  ]);

  // Allocations with stock still to ship, grouped into the order they belong
  // to - a dispatch covers one order, which the API enforces.
  const readyByOrder = new Map<string, ReadyOrder>();

  if (allocations.ok) {
    for (const row of allocations.data) {
      if (row.status === 'RELEASED_BACK' || row.status === 'CANCELLED') continue;

      const remaining = Number(row.quantityAllocated) - Number(row.quantityDispatched);
      if (!(remaining > 0)) continue;

      const existing = readyByOrder.get(row.salesOrderId) ?? {
        salesOrderId: row.salesOrderId,
        orderNumber: row.orderNumber,
        customerName: row.customerName,
        lines: [],
      };

      existing.lines.push({
        batchAllocationId: row.id,
        itemCode: row.itemCode,
        itemName: row.itemName,
        batchNumber: row.batchNumber,
        expiryDate: row.expiryDate,
        quantityToShip: remaining.toFixed(3),
      });

      readyByOrder.set(row.salesOrderId, existing);
    }
  }

  const readyToDispatch = [...readyByOrder.values()];

  // Filtered after fetching, for the reason in the prop's comment.
  const visible =
    dispatches.ok && status
      ? dispatches.data.filter((row) => row.status === status)
      : dispatches.ok
        ? dispatches.data
        : [];

  return (
    <>
      <Panel
        heading="Dispatches"
        count={dispatches.ok ? visible.length : undefined}
        noun="dispatch"
        action={
          <>
            <PanelSearch stepKey="dispatch" placeholder="Search dispatches…" />
            <FilterToggle fields={DISPATCH_FILTERS} />
            <CreateDialogButton
              label="New dispatch"
              title="New dispatch"
              description="Ships exactly what is still allocated on the order. Stock is reduced when the dispatch is confirmed."
              disabled={readyToDispatch.length === 0}
              disabledHint="No order currently has stock allocated and waiting to ship."
            >
              <NewDispatchForm
                inDialog
                orders={readyToDispatch}
                ordersError={allocations.ok ? null : allocations.error}
              />
            </CreateDialogButton>
          </>
        }
        footer="A dispatch can never exceed what was allocated."
      >
        <FilterPanel fields={DISPATCH_FILTERS} />
        {!dispatches.ok ? (
          <ErrorState what="dispatches" message={dispatches.error} />
        ) : dispatches.data.length === 0 ? (
          <EmptyState
            title={search ? `No dispatch matches “${search}”.` : 'Nothing has been dispatched yet.'}
            hint={
              search
                ? 'Try a different dispatch, order or invoice number.'
                : 'Dispatch an allocated order above. Stock is reduced as it is recorded, and the invoice becomes available afterwards.'
            }
          />
        ) : (
          <Table columns={COLUMNS}>
            {visible.map((dispatch) => (
              <DispatchRow key={dispatch.id} dispatch={dispatch} />
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

function DispatchRow({ dispatch }: { dispatch: DispatchListItem }) {
  return (
    <tr>
      <Cell>
        <p className="font-mono text-xs font-medium text-slate-900">{dispatch.dispatchNumber}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {dispatch.itemCount} line{dispatch.itemCount === 1 ? '' : 's'}
        </p>
      </Cell>

      <Cell>
        <span className="font-mono text-[11px] text-slate-600">{dispatch.orderNumber}</span>
      </Cell>

      <Cell>
        <span className="font-mono text-[11px] text-slate-600">
          {dispatch.invoiceNumber ?? '—'}
        </span>
      </Cell>

      <Cell>
        <p className="text-sm text-slate-800">{dispatch.customerName}</p>
      </Cell>

      <Cell>
        <span className="whitespace-nowrap text-xs text-slate-700">
          {formatDate(dispatch.dispatchDate)}
        </span>
      </Cell>

      <Cell align="right">
        <Quantity value={dispatch.totalQuantity} />
      </Cell>

      <Cell>
        {dispatch.transporterName || dispatch.vehicleNumber || dispatch.lrNumber ? (
          <div className="text-[11px] text-slate-600">
            {dispatch.transporterName && <p>{dispatch.transporterName}</p>}
            {dispatch.vehicleNumber && (
              <p className="font-mono text-slate-500">{dispatch.vehicleNumber}</p>
            )}
            {dispatch.lrNumber && <p className="text-slate-500">LR {dispatch.lrNumber}</p>}
            {dispatch.ewayBillNumber && (
              <p className="text-slate-500">E-way {dispatch.ewayBillNumber}</p>
            )}
          </div>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </Cell>

      <Cell>
        <StatusBadge status={dispatch.status} />
      </Cell>

      <Cell>
        <DispatchRowActions dispatch={dispatch} />
      </Cell>
    </tr>
  );
}
