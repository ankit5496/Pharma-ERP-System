import type {
  DispatchListItem,
  SalesInvoiceListItem,
  SalesOrderListItem,
} from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

import { PanelSearch } from './panel-toolbar';

import { IssueInvoiceButton, InvoiceRowActions } from './invoice-actions';
import {
  Badge,
  Cell,
  col,
  EmptyState,
  ErrorState,
  formatDate,
  Money,
  Panel,
  StatusBadge,
  Table,
} from './ui';

const READY_COLUMNS = [
  'Order #',
  'Customer',
  'Order date',
  col.right('Order value'),
  'Status',
  'Dispatch',
  'Actions',
] as const;

const COLUMNS = [
  'Invoice #',
  'Customer',
  'Date',
  col.right('Subtotal'),
  col.right('GST'),
  col.right('Total'),
  col.right('Paid'),
  'Payment status',
  'Status',
  'Actions',
] as const;

/**
 * Subtab 5 — Invoices.
 *
 * The "ready to invoice" list is orders with stock reserved. An invoice cannot
 * be composed line by line from this screen, which is why there is no
 * line-picker anywhere on it: the batches billed are the batches FEFO reserved,
 * and the only input is which order to bill.
 */
export async function InvoicesPanel({ search }: { search?: string }) {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';

  const [invoices, orders, dispatches] = await Promise.all([
    apiFetch<SalesInvoiceListItem[]>(`/api/v1/order-to-cash/sales-invoices${query}`, {
      authenticated: true,
    }),
    apiFetch<SalesOrderListItem[]>('/api/v1/order-to-cash/sales-orders', { authenticated: true }),
    apiFetch<DispatchListItem[]>('/api/v1/order-to-cash/dispatch', { authenticated: true }),
  ]);

  const readyToInvoice = orders.ok
    ? orders.data.filter((order) =>
        ['ALLOCATED', 'PARTIALLY_ALLOCATED', 'DISPATCHED'].includes(order.status),
      )
    : [];

  // The API bills a DISPATCH, so each order is matched to the consignment that
  // can still be invoiced: one that has actually left (not a draft) and has no
  // invoice against it yet. An order with none is shown, but its button says
  // what is missing rather than posting a request the API would refuse.
  const billableByOrder = new Map<string, { id: string; number: string; status: string }>();

  if (dispatches.ok) {
    for (const dispatch of dispatches.data) {
      const shipped = dispatch.status === 'DISPATCHED' || dispatch.status === 'DELIVERED';

      if (shipped && !dispatch.salesInvoiceId && !billableByOrder.has(dispatch.salesOrderId)) {
        billableByOrder.set(dispatch.salesOrderId, {
          id: dispatch.id,
          number: dispatch.dispatchNumber,
          status: dispatch.status,
        });
      }
    }
  }

  return (
    <>
      <div className="mb-6">
        <Panel heading="Ready to invoice" count={readyToInvoice.length} noun="order">
          {!orders.ok ? (
            <ErrorState what="orders ready to invoice" message={orders.error} />
          ) : readyToInvoice.length === 0 ? (
            <EmptyState
              title="Nothing is ready to invoice."
              hint="An order appears here once batches have been reserved against it on the Allocation tab."
            />
          ) : (
            <Table columns={READY_COLUMNS}>
              {readyToInvoice.map((order) => {
                const billable = billableByOrder.get(order.id) ?? null;

                return (
                  <tr key={order.id}>
                    <Cell>
                      <span className="font-mono text-xs font-medium text-slate-900">
                        {order.orderNumber}
                      </span>
                    </Cell>

                    <Cell>
                      <p className="text-sm text-slate-800">{order.customerName}</p>
                    </Cell>

                    <Cell>
                      <span className="whitespace-nowrap text-xs text-slate-700">
                        {formatDate(order.orderDate)}
                      </span>
                    </Cell>

                    <Cell align="right">
                      <Money value={order.grandTotal} />
                    </Cell>

                    <Cell>
                      <StatusBadge status={order.status} />
                    </Cell>

                    <Cell>
                      {/* The invoice bills a DISPATCH, so this column is the
                          precondition: what it names is what would be billed. */}
                      {billable ? (
                        <>
                          <p className="font-mono text-[11px] text-slate-700">{billable.number}</p>
                          <p className="mt-0.5 text-[11px] text-slate-500">{billable.status}</p>
                        </>
                      ) : (
                        <span
                          className="text-[11px] text-slate-500"
                          title="An invoice bills what shipped, not what is reserved"
                        >
                          Not dispatched yet
                        </span>
                      )}
                    </Cell>

                    <Cell>
                      <IssueInvoiceButton
                        dispatchId={billable?.id ?? null}
                        orderNumber={order.orderNumber}
                      />
                    </Cell>
                  </tr>
                );
              })}
            </Table>
          )}
        </Panel>
      </div>

      <Panel
        heading="Invoices"
        count={invoices.ok ? invoices.data.length : undefined}
        noun="invoice"
        action={<PanelSearch stepKey="invoices" placeholder="Search invoices…" />}
        footer="Addresses, GSTIN, HSN codes, rates, batch numbers and expiry dates are snapshotted onto each invoice when it is issued, so a later correction to master data never rewrites a filed document."
      >
        {!invoices.ok ? (
          <ErrorState what="invoices" message={invoices.error} />
        ) : invoices.data.length === 0 ? (
          <EmptyState
            title={search ? `No invoice matches “${search}”.` : 'No invoices yet.'}
            hint={
              search
                ? 'Try a different invoice number, order or customer.'
                : 'Invoice an order above. Issuing one also creates the receivable.'
            }
          />
        ) : (
          <Table columns={COLUMNS}>
            {invoices.data.map((invoice) => (
              <InvoiceRow key={invoice.id} invoice={invoice} />
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

function InvoiceRow({ invoice }: { invoice: SalesInvoiceListItem }) {
  const cancelled = invoice.status === 'CANCELLED';

  return (
    <tr className={cancelled ? 'bg-slate-50 text-slate-400' : undefined}>
      <Cell>
        <p className="font-mono text-xs font-medium text-slate-900">{invoice.invoiceNumber}</p>
        {invoice.orderNumber && (
          <p className="mt-0.5 font-mono text-[11px] text-slate-500">{invoice.orderNumber}</p>
        )}
        <span className="mt-1 inline-block">
          {/* Which tax applied. Worth showing: it is the one thing on an invoice
              that cannot be corrected later without cancelling it. */}
          <Badge tone="slate">{invoice.isInterState ? 'IGST' : 'CGST + SGST'}</Badge>
        </span>
      </Cell>

      <Cell>
        <p className="text-sm text-slate-800">{invoice.customerName}</p>
      </Cell>

      <Cell>
        <p className="whitespace-nowrap text-xs text-slate-700">
          {formatDate(invoice.invoiceDate)}
        </p>
        {invoice.dueDate && (
          <p className="mt-0.5 whitespace-nowrap text-[11px] text-slate-500">
            due {formatDate(invoice.dueDate)}
          </p>
        )}
      </Cell>

      <Cell align="right">
        <Money value={invoice.subtotal} />
      </Cell>

      <Cell align="right">
        <Money value={invoice.taxAmount} />
      </Cell>

      <Cell align="right">
        <Money value={invoice.grandTotal} bold />
      </Cell>

      <Cell align="right">
        {/* Receipts only. What a credit note wrote off is shown beside the
            payment status instead — money received and money forgiven settle
            the same balance but are not the same fact. */}
        <Money value={invoice.amountPaid} bold={invoice.amountPaid !== '0.00'} />
      </Cell>

      <Cell>
        <StatusBadge status={invoice.paymentStatus} />
        {invoice.amountOutstanding !== '0.00' && invoice.paymentStatus !== 'UNPAID' && (
          <p className="mt-1 text-[11px] text-slate-500">
            <Money value={invoice.amountOutstanding} /> left
          </p>
        )}
        {invoice.amountCredited !== '0.00' && (
          <p className="mt-0.5 text-[11px] text-slate-500">
            <Money value={invoice.amountCredited} /> credited
          </p>
        )}
      </Cell>

      <Cell>
        <StatusBadge status={invoice.status} />
      </Cell>

      <Cell>
        <InvoiceRowActions invoice={invoice} />
      </Cell>
    </tr>
  );
}
