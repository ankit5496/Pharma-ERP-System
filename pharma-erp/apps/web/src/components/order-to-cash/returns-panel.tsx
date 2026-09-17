import {
  RETURN_REASON_LABELS,
  type SalesInvoiceDetail,
  type SalesInvoiceListItem,
  type SalesReturnListItem,
} from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

import { NewReturnForm, SalesReturnRowActions } from './return-actions';
import {
  Cell,
  EmptyState,
  ErrorState,
  formatDate,
  Money,
  Note,
  Panel,
  StatusBadge,
  StepHeader,
  Table,
} from './ui';

const COLUMNS = [
  'Return #',
  'Customer',
  'Invoice #',
  'Date',
  'Amount',
  'Reason',
  'Status',
  'Actions',
] as const;

/**
 * Subtab 7 — Returns.
 *
 * The note at the top is not decoration. The single most surprising thing about
 * this screen, for anyone used to a general-purpose ERP, is that a return does
 * NOT put stock back on sale — it goes to quarantine and someone decides
 * afterwards. Saying so where the action is taken beats leaving it to be
 * discovered from the stock figures.
 */
export async function ReturnsPanel({ search }: { search?: string }) {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';

  const [returns, invoices] = await Promise.all([
    apiFetch<SalesReturnListItem[]>(`/api/v1/order-to-cash/sales-returns${query}`, {
      authenticated: true,
    }),
    apiFetch<SalesInvoiceListItem[]>('/api/v1/order-to-cash/sales-invoices', {
      authenticated: true,
    }),
  ]);

  // Only issued invoices can be returned against. Their LINES are needed to
  // offer a choice, and the list endpoint does not carry them — so the detail is
  // fetched for the returnable ones. Capped, because this is one request each
  // and an unbounded fan-out would make the page slower the longer the company
  // has been trading.
  const returnable = invoices.ok
    ? invoices.data.filter((invoice) => invoice.status === 'ISSUED').slice(0, 25)
    : [];

  const details = await Promise.all(
    returnable.map((invoice) =>
      apiFetch<SalesInvoiceDetail>(`/api/v1/order-to-cash/sales-invoices/${invoice.id}`, {
        authenticated: true,
      }),
    ),
  );

  const returnableInvoices = details
    .filter((result): result is { ok: true; data: SalesInvoiceDetail } => result.ok)
    .map((result) => result.data)
    // An invoice whose every line has been fully returned has nothing left to
    // offer, so it is filtered out rather than shown with an empty line list.
    .filter((invoice) =>
      invoice.items.some((line) => Number(line.quantity) > Number(line.quantityReturned)),
    );

  return (
    <>
      <StepHeader
        title="Returns"
        description="Goods coming back from a distributor, traced to the batch that shipped, with a credit note against the original invoice."
      />

      <div className="mb-6">
        <Note tone="amber">
          <p className="font-semibold">Returned stock does not go back on sale.</p>
          <p className="mt-1">
            It is received into <strong className="font-semibold">quarantine</strong> and is
            invisible to allocation until someone decides otherwise. Goods that have left the
            company&rsquo;s custody cannot be assumed to have been stored correctly. The credit to
            the customer is issued in full either way — whether the stock can be resold is the
            company&rsquo;s problem, not theirs.
          </p>
        </Note>
      </div>

      <div className="mb-6">
        <NewReturnForm
          invoices={returnableInvoices}
          invoicesError={invoices.ok ? null : invoices.error}
        />
      </div>

      <Panel
        heading="Returns"
        count={returns.ok ? returns.data.length : undefined}
        noun="return"
        footer="A return can never exceed what the invoice line actually shipped, less anything already returned. Stock comes back through the same inventory ledger that sent it out, as an IN entry against the quarantined quantity."
      >
        {!returns.ok ? (
          <ErrorState what="returns" message={returns.error} />
        ) : returns.data.length === 0 ? (
          <EmptyState
            title={search ? `No return matches “${search}”.` : 'No returns recorded.'}
            hint={
              search
                ? 'Try a different return number, invoice or customer.'
                : 'Record one above against the invoice the goods went out on.'
            }
          />
        ) : (
          <Table columns={COLUMNS}>
            {returns.data.map((salesReturn) => (
              <ReturnRow key={salesReturn.id} salesReturn={salesReturn} />
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

function ReturnRow({ salesReturn }: { salesReturn: SalesReturnListItem }) {
  return (
    <tr>
      <Cell>
        <p className="font-mono text-xs font-medium text-slate-900">{salesReturn.returnNumber}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {salesReturn.itemCount} line{salesReturn.itemCount === 1 ? '' : 's'}
        </p>
      </Cell>

      <Cell>
        <p className="text-sm text-slate-800">{salesReturn.customerName}</p>
      </Cell>

      <Cell>
        <span className="font-mono text-[11px] text-slate-600">{salesReturn.invoiceNumber}</span>
        {salesReturn.orderNumber && (
          <p className="mt-0.5 font-mono text-[11px] text-slate-400">{salesReturn.orderNumber}</p>
        )}
      </Cell>

      <Cell>
        <span className="whitespace-nowrap text-xs text-slate-700">
          {formatDate(salesReturn.returnDate)}
        </span>
      </Cell>

      <Cell align="right">
        <Money value={salesReturn.totalAmount} bold />
        <p className="mt-0.5 text-[11px] text-slate-500">
          incl. <Money value={salesReturn.taxAmount} /> GST
        </p>
      </Cell>

      <Cell>
        <p className="text-xs text-slate-700">{RETURN_REASON_LABELS[salesReturn.reason]}</p>
      </Cell>

      <Cell>
        <StatusBadge status={salesReturn.status} />
      </Cell>

      <Cell>
        <SalesReturnRowActions salesReturn={salesReturn} />
      </Cell>
    </tr>
  );
}
