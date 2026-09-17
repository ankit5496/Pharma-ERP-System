import type { SalesInvoiceListItem, SalesOrderListItem } from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

import { IssueInvoiceButton, InvoiceRowActions } from './invoice-actions';
import {
  Badge,
  Cell,
  EmptyState,
  ErrorState,
  formatDate,
  Money,
  Panel,
  StatusBadge,
  StepHeader,
  Table,
} from './ui';

const COLUMNS = [
  'Invoice #',
  'Customer',
  'Date',
  'Subtotal',
  'GST',
  'Total',
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

  const [invoices, orders] = await Promise.all([
    apiFetch<SalesInvoiceListItem[]>(`/api/v1/order-to-cash/sales-invoices${query}`, {
      authenticated: true,
    }),
    apiFetch<SalesOrderListItem[]>('/api/v1/order-to-cash/sales-orders', { authenticated: true }),
  ]);

  const readyToInvoice = orders.ok
    ? orders.data.filter((order) =>
        ['ALLOCATED', 'PARTIALLY_ALLOCATED', 'DISPATCHED'].includes(order.status),
      )
    : [];

  return (
    <>
      <StepHeader
        title="Invoices"
        description="Tax invoices raised from an order's reserved batches. GST is split from the place of supply, and any DPCO or NLEM ceiling price is checked before the invoice is issued."
      />

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
            <ul className="divide-y divide-slate-100">
              {readyToInvoice.map((order) => (
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
                      Order value <Money value={order.grandTotal} /> ·{' '}
                      <span className="align-middle">
                        <StatusBadge status={order.status} />
                      </span>
                    </p>
                  </div>
                  <IssueInvoiceButton
                    salesOrderId={order.id}
                    orderNumber={order.orderNumber}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        heading="Invoices"
        count={invoices.ok ? invoices.data.length : undefined}
        noun="invoice"
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
