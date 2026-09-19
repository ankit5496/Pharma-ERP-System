import {
  PAYMENT_METHOD_LABELS,
  type ReceiptListItem,
  type SalesInvoiceListItem,
} from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

import {
  CreateDialogButton,
  FilterPanel,
  FilterToggle,
  PanelSearch,
} from './panel-toolbar';

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
  Table,
} from './ui';

const RECEIPT_FILTERS = [
  {
    param: 'status',
    label: 'Status',
    allLabel: 'Any status',
    choices: [
      { value: 'RECORDED', label: 'Recorded' },
      { value: 'CLEARED', label: 'Cleared' },
      { value: 'BOUNCED', label: 'Bounced' },
      { value: 'CANCELLED', label: 'Cancelled' },
    ],
  },
  { param: 'dateFrom', label: 'Date from' },
  { param: 'dateTo', label: 'Date to' },
] as const;

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
export async function ReceiptsPanel({
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

  const [receipts, invoices] = await Promise.all([
    apiFetch<ReceiptListItem[]>(`/api/v1/order-to-cash/receipts${query}`, {
      authenticated: true,
    }),
    apiFetch<SalesInvoiceListItem[]>('/api/v1/order-to-cash/sales-invoices?paymentStatus=UNPAID', {
      authenticated: true,
    }),
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

  // Filtered after fetching, for the reason in the prop's comment.
  const visible =
    receipts.ok && status
      ? receipts.data.filter((row) => row.status === status)
      : receipts.ok
        ? receipts.data
        : [];

  return (
    <>
      <Panel
        heading="Receipts"
        count={receipts.ok ? visible.length : undefined}
        noun="receipt"
        action={
          <>
            <PanelSearch stepKey="receipts" placeholder="Search receipts…" />
            <FilterToggle fields={RECEIPT_FILTERS} />
            <CreateDialogButton
              label="New receipt"
              title="New receipt"
              description="Applied to one invoice. The amount cannot exceed its outstanding balance."
              disabled={collectable.length === 0}
              disabledHint="Nothing is currently outstanding."
            >
              <NewReceiptForm
                inDialog
                invoices={collectable}
                invoicesError={invoices.ok ? null : invoices.error}
                totalOutstanding={totalOutstanding.toFixed(2)}
              />
            </CreateDialogButton>
          </>
        }
        footer="A receipt can never exceed the invoice's outstanding balance — this system holds no payments on account. A bounced cheque is reversed with a visible adjustment, never by deleting the receipt."
      >
        <FilterPanel fields={RECEIPT_FILTERS} />
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
            {visible.map((receipt) => (
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
