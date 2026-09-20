import {
  RETURN_REASONS,
  SALES_RETURN_STATUSES,
  SALES_RETURN_STATUS_LABELS,
  RETURN_REASON_LABELS,
  type SalesInvoiceDetail,
  type SalesInvoiceListItem,
  type SalesReturnListItem,
} from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

import { choicesFrom, matchesChoice, withinDates, paginate, type Filters } from './filtering';

import {
  CreateDialogButton,
  ListPagerBar,
  FilterPanel,
  FilterToggle,
  PanelSearch,
} from './panel-toolbar';

import { NewReturnForm, SalesReturnRowActions } from './return-actions';
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

const RETURN_FILTERS = [
  {
    param: 'status',
    label: 'Status',
    allLabel: 'Any status',
    choices: choicesFrom(SALES_RETURN_STATUSES, SALES_RETURN_STATUS_LABELS),
  },
  {
    param: 'reason',
    label: 'Reason',
    allLabel: 'Any reason',
    choices: choicesFrom(RETURN_REASONS, RETURN_REASON_LABELS),
  },
  { param: 'dateFrom', label: 'Date from' },
  { param: 'dateTo', label: 'Date to' },
] as const;

const COLUMNS = [
  'Return',
  'Customer',
  'Invoice',
  'Date',
  col.right('Amount'),
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
export async function ReturnsPanel({
  search,
  filters,
}: {
  search?: string;
  /**
   * The Filter panel's selections. Applied here rather than on the wire:
   * the list endpoint takes only a search term, and the rows are already
   * loaded. What search covers is deliberately not repeated here — see
   * filtering.ts.
   */
  filters: Filters;
}) {
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

  // Filtered after fetching, for the reason in the prop's comment.
  const visible = returns.ok
    ? returns.data.filter(
        (row) =>
          matchesChoice(row.status, filters.status) &&
          matchesChoice(row.reason, filters.reason) &&
          withinDates(row.returnDate, filters.dateFrom, filters.dateTo),
      )
    : [];

  // One page of it. The list is already in hand, so paging is a slice.
  const paged = paginate(visible, filters);

  return (
    <>
      <Panel
        heading="Returns"
        count={returns.ok ? visible.length : undefined}
        noun="return"
        action={
          <>
            <PanelSearch stepKey="returns" placeholder="Search returns…" />
            <FilterToggle fields={RETURN_FILTERS} />
            <CreateDialogButton
              label="New return"
              title="New return"
              disabled={returnableInvoices.length === 0}
              disabledHint="No issued invoice currently has anything that could be returned."
            >
              <NewReturnForm
                inDialog
                invoices={returnableInvoices}
                invoicesError={invoices.ok ? null : invoices.error}
              />
            </CreateDialogButton>
          </>
        }
      >
        <FilterPanel fields={RETURN_FILTERS} />
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
            {paged.rows.map((salesReturn) => (
              <ReturnRow key={salesReturn.id} salesReturn={salesReturn} />
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
          noun="returns"
        />
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
