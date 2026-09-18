import {
  PAYMENT_METHOD_LABELS,
  type ReceiptListItem,
  type SalesInvoiceListItem,
} from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

import { NewReceiptForm, ReceiptRowActions } from './receipt-actions';
import {
  Cell,
  col,
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
  'Receipt #',
  'Customer',
  'Invoice #',
  'Date',
  col.right('Amount'),
  'Payment method',
  'Status',
  'Actions',
] as const;

/**
 * Subtab 6 — Receipts.
 *
 * The unpaid-invoice list doubles as the collection worklist, which is why it
 * carries the outstanding figure and the due date rather than just an id.
 *
 * A receipt always names an invoice. There is no on-account option, because this
 * system holds no design for advance payments and offering a field that the API
 * would refuse would be worse than not offering it.
 */
export async function ReceiptsPanel({ search }: { search?: string }) {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';

  const [receipts, invoices] = await Promise.all([
    apiFetch<ReceiptListItem[]>(`/api/v1/order-to-cash/receipts${query}`, {
      authenticated: true,
    }),
    apiFetch<SalesInvoiceListItem[]>(
      '/api/v1/order-to-cash/sales-invoices?paymentStatus=UNPAID',
      { authenticated: true },
    ),
  ]);

  // Part-paid invoices are also collectable, so they are fetched separately and
  // merged: the API filter takes one payment status at a time.
  const partPaid = await apiFetch<SalesInvoiceListItem[]>(
    '/api/v1/order-to-cash/sales-invoices?paymentStatus=PARTIALLY_PAID',
    { authenticated: true },
  );

  const collectable = [
    ...(invoices.ok ? invoices.data : []),
    ...(partPaid.ok ? partPaid.data : []),
  ].filter((invoice) => invoice.status === 'ISSUED' && invoice.amountOutstanding !== '0.00');

  const totalOutstanding = collectable.reduce(
    (total, invoice) => total + Number(invoice.amountOutstanding),
    0,
  );

  return (
    <>
      <StepHeader
        title="Receipts"
        description="Payments collected and applied to an invoice. Recording one reduces the customer's outstanding balance and updates the invoice's payment status."
      />

      <div className="mb-6">
        <NewReceiptForm
          invoices={collectable}
          invoicesError={invoices.ok ? null : invoices.error}
          totalOutstanding={totalOutstanding.toFixed(2)}
        />
      </div>

      <Panel
        heading="Receipts"
        count={receipts.ok ? receipts.data.length : undefined}
        noun="receipt"
        footer="A receipt can never exceed the invoice's outstanding balance — this system holds no payments on account. A bounced cheque is reversed with a visible adjustment, never by deleting the receipt."
      >
        {!receipts.ok ? (
          <ErrorState what="receipts" message={receipts.error} />
        ) : receipts.data.length === 0 ? (
          <EmptyState
            title={search ? `No receipt matches “${search}”.` : 'No payments recorded yet.'}
            hint={
              search
                ? 'Try a different receipt number, reference or customer.'
                : 'Record a payment above against an unpaid invoice.'
            }
          />
        ) : (
          <Table columns={COLUMNS}>
            {receipts.data.map((receipt) => (
              <ReceiptRow key={receipt.id} receipt={receipt} />
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

function ReceiptRow({ receipt }: { receipt: ReceiptListItem }) {
  const reversed = receipt.status === 'BOUNCED' || receipt.status === 'CANCELLED';

  return (
    <tr className={reversed ? 'bg-red-50/30' : undefined}>
      <Cell>
        <p className="font-mono text-xs font-medium text-slate-900">{receipt.receiptNumber}</p>
      </Cell>

      <Cell>
        <p className="text-sm text-slate-800">{receipt.customerName}</p>
      </Cell>

      <Cell>
        <span className="font-mono text-[11px] text-slate-600">{receipt.invoiceNumber}</span>
      </Cell>

      <Cell>
        <span className="whitespace-nowrap text-xs text-slate-700">
          {formatDate(receipt.receiptDate)}
        </span>
      </Cell>

      <Cell align="right">
        <Money value={receipt.amount} bold />
      </Cell>

      <Cell>
        <p className="text-xs text-slate-700">{PAYMENT_METHOD_LABELS[receipt.paymentMethod]}</p>
        {receipt.referenceNumber && (
          <p className="mt-0.5 font-mono text-[11px] text-slate-500">{receipt.referenceNumber}</p>
        )}
      </Cell>

      <Cell>
        <StatusBadge status={receipt.status} />
      </Cell>

      <Cell>
        <ReceiptRowActions receipt={receipt} />
      </Cell>
    </tr>
  );
}
