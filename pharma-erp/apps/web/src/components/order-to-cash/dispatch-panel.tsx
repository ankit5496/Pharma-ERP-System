import type { DispatchListItem, SalesInvoiceListItem } from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

import { DispatchRowActions, NewDispatchForm } from './dispatch-actions';
import {
  Cell,
  EmptyState,
  ErrorState,
  formatDate,
  Panel,
  Quantity,
  StatusBadge,
  StepHeader,
  Table,
} from './ui';

const COLUMNS = [
  'Dispatch #',
  'Order #',
  'Invoice #',
  'Customer',
  'Dispatch date',
  'Qty',
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
 * Quantities are never typed here for the common case: dispatching an invoice
 * ships exactly what was reserved for it. That is both less work and one fewer
 * place for a number to be wrong.
 */
export async function DispatchPanel({ search }: { search?: string }) {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';

  const [dispatches, invoices] = await Promise.all([
    apiFetch<DispatchListItem[]>(`/api/v1/order-to-cash/dispatch${query}`, {
      authenticated: true,
    }),
    apiFetch<SalesInvoiceListItem[]>('/api/v1/order-to-cash/sales-invoices', {
      authenticated: true,
    }),
  ]);

  // Issued invoices that have not yet been fully shipped. Cancelled ones are
  // excluded — there is nothing to send.
  const dispatchedInvoiceIds = new Set(
    dispatches.ok
      ? dispatches.data
          .filter((dispatch) => dispatch.status !== 'CANCELLED')
          .map((dispatch) => dispatch.salesInvoiceId)
          .filter((id): id is string => id !== null)
      : [],
  );

  const awaiting = invoices.ok
    ? invoices.data.filter(
        (invoice) => invoice.status === 'ISSUED' && !dispatchedInvoiceIds.has(invoice.id),
      )
    : [];

  return (
    <>
      <StepHeader
        title="Dispatch"
        description="Goods leaving the warehouse, recorded down to the batch. Confirming a dispatch reduces finished-goods stock and writes the inventory ledger in the same transaction."
      />

      <div className="mb-6">
        <NewDispatchForm
          invoices={awaiting}
          invoicesError={invoices.ok ? null : invoices.error}
        />
      </div>

      <Panel
        heading="Dispatches"
        count={dispatches.ok ? dispatches.data.length : undefined}
        noun="dispatch"
        footer="A dispatch can never exceed what was allocated, and is refused outright while a Schedule H1, H1X or X compliance re-check is outstanding on any line being shipped."
      >
        {!dispatches.ok ? (
          <ErrorState what="dispatches" message={dispatches.error} />
        ) : dispatches.data.length === 0 ? (
          <EmptyState
            title={search ? `No dispatch matches “${search}”.` : 'Nothing has been dispatched yet.'}
            hint={
              search
                ? 'Try a different dispatch, order or invoice number.'
                : 'Dispatch an invoiced order above. Stock is reduced as the dispatch is recorded.'
            }
          />
        ) : (
          <Table columns={COLUMNS}>
            {dispatches.data.map((dispatch) => (
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
