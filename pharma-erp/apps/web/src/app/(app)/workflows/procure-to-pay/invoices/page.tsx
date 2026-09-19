import type { Metadata } from 'next';
import {
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  PROCUREMENT_ROUTES,
  PURCHASE_INVOICE_STATUSES,
  PURCHASE_INVOICE_STATUS_LABELS,
} from '@pharma-erp/types';

import { FilterButton, FilterPanel, SearchBox } from '@/components/procurement/filter-bar';
import { Pagination } from '@/components/procurement/pagination';
import { InvoiceActions } from '@/components/procurement/invoice-actions';
import { RecordInvoiceForm } from '@/components/procurement/record-invoice-form';
import {
  Blank,
  DateText,
  EmptyState,
  ErrorState,
  Money,
  Panel,
  Pill,
  RecordLink,
  StatusPill,
  TableWrap,
  Td,
  Th,
  Name,
  Code,
} from '@/components/procurement/ui';
import {
  fetchInvoiceableOrders,
  fetchInvoices,
  fetchVendors,
  toListQuery,
  toOptions,
} from '@/lib/procurement';

export const metadata: Metadata = { title: 'Purchase invoices' };
export const dynamic = 'force-dynamic';

/**
 * Sub-tab 5 — Purchase invoices.
 *
 * An invoice can only be raised against an order that has actually received
 * something, and it carries links to both the order and the receipt. That is
 * the three-way match: what was ordered, what arrived, what is being billed.
 * GST is shown as its own column throughout because input tax is reclaimable
 * and has to be readable without arithmetic.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = toListQuery(await searchParams);

  const [invoices, invoiceable, vendors] = await Promise.all([
    fetchInvoices(query),
    fetchInvoiceableOrders(),
    fetchVendors(),
  ]);

  const isFiltered = Object.values(query).some(Boolean);

  // Both vocabularies in one filter: to the person using this screen "draft"
  // and "overdue" are the same kind of question, even though only one of them
  // is a stored column.
  const statusOptions = [
    ...PURCHASE_INVOICE_STATUSES.map((status) => ({
      value: status,
      label: PURCHASE_INVOICE_STATUS_LABELS[status],
    })),

    // ONLY THE PAYMENT STATUSES THAT ARE NOT ALSO DOCUMENT STATUSES. The two
    // vocabularies overlap on PAID and PARTIALLY_PAID, and offering both
    // spellings produced two options with the SAME value — a duplicate React
    // key, and two menu entries that did exactly the same thing. They could not
    // even differ in behaviour: the API checks the stored column first, so
    // "Payment: Paid" was unreachable.
    //
    // What survives is what the stored column cannot answer: UNPAID, and
    // OVERDUE — which is derived per request, because a stored overdue flag
    // would be wrong every midnight until something rewrote it.
    ...PAYMENT_STATUSES.filter(
      (status) => !(PURCHASE_INVOICE_STATUSES as readonly string[]).includes(status),
    ).map((status) => ({
      value: status,
      label: `Payment: ${PAYMENT_STATUS_LABELS[status]}`,
    })),
  ];

  return (
    <div className="space-y-6">
      <Panel
        title="Purchase invoices"
        subtitle={
          invoices.ok
            ? `${invoices.data.total} invoice${invoices.data.total === 1 ? '' : 's'}`
            : undefined
        }
        action={
          <>
            <SearchBox placeholder="Search invoice no., vendor invoice no., vendor, PO, GRN or item…" />
            <FilterButton />

            {/* Offered only when there is something to bill for. A dialog
                whose only content is "nothing to invoice" wastes the click;
                the sentence says it in place. */}
            {!invoiceable.ok ? (
              <span className="text-xs text-red-700">Orders unavailable: {invoiceable.error}</span>
            ) : invoiceable.data.length === 0 ? (
              <span className="text-xs text-slate-500">Nothing received to invoice yet.</span>
            ) : (
              <RecordInvoiceForm orders={invoiceable.data} />
            )}
          </>
        }
      >
        <FilterPanel
          statuses={statusOptions}
          vendors={vendors.ok ? toOptions(vendors.data) : []}
          searchableLookups
        />

        {!invoices.ok ? (
          <ErrorState message={`Could not load invoices: ${invoices.error}`} />
        ) : invoices.data.rows.length === 0 ? (
          <EmptyState
            title="No invoices recorded yet."
            hint="Record one above once a vendor bills for material you have received."
            filtered={isFiltered}
          />
        ) : (
          <>
            <TableWrap>
              <table className="w-full min-w-[76rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <Th>Invoice</Th>
                    <Th>Vendor</Th>
                    <Th>Matched to</Th>
                    <Th>Dates</Th>
                    <Th align="right">Taxable</Th>
                    <Th align="right">GST</Th>
                    <Th align="right">Total</Th>
                    <Th align="right">Outstanding</Th>
                    <Th>Status</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoices.data.rows.map((invoice) => (
                    <tr key={invoice.id}>
                      <Td>
                        <p className="font-mono text-xs font-semibold text-slate-900">
                          <Code>{invoice.number}</Code>
                        </p>
                        <p className="mt-0.5 text-xs text-slate-600">
                          vendor ref {invoice.vendorInvoiceNumber}
                        </p>
                        {/* The three-way match result. Flagged, not hidden: a
                          genuine price revision is bookable, but it has to be
                          visible as an exception afterwards. */}
                        {invoice.toleranceExceeded && (
                          <p className="mt-1">
                            <Pill tone="warn">Outside tolerance</Pill>
                          </p>
                        )}
                      </Td>

                      <Td>
                        <p className="text-sm text-slate-800"><Name>{invoice.vendor.name}</Name></p>
                        {invoice.vendor.gstin && (
                          <p className="font-mono text-[11px] text-slate-500">
                            {invoice.vendor.gstin}
                          </p>
                        )}
                      </Td>

                      <Td>
                        <div className="flex flex-col gap-0.5 text-xs">
                          <RecordLink
                            href={`${PROCUREMENT_ROUTES.purchaseOrders}?search=${invoice.purchaseOrder.number}`}
                          >
                            <Code>{invoice.purchaseOrder.number}</Code>
                          </RecordLink>
                          {invoice.goodsReceipt ? (
                            <RecordLink
                              href={`${PROCUREMENT_ROUTES.goodsReceipts}?search=${invoice.goodsReceipt.number}`}
                            >
                              <Code>{invoice.goodsReceipt.number}</Code>
                            </RecordLink>
                          ) : (
                            <span className="text-[11px] text-amber-800">No GRN matched</span>
                          )}
                        </div>
                      </Td>

                      <Td>
                        <p className="text-xs tabular-nums text-slate-700">
                          <DateText value={invoice.invoiceDate} />
                        </p>
                        <p className="text-[11px] text-slate-500">
                          due <DateText value={invoice.dueDate} /> · net {invoice.paymentTermsDays}d
                        </p>
                      </Td>

                      <Td align="right">
                        <Money amount={invoice.taxableAmount} />
                      </Td>

                      <Td align="right">
                        <Money amount={invoice.taxAmount} />
                      </Td>

                      <Td align="right">
                        <Money amount={invoice.totalAmount} bold />
                      </Td>

                      <Td align="right">
                        {invoice.outstandingAmount === '0.00' ? (
                          <Blank />
                        ) : (
                          <Money amount={invoice.outstandingAmount} />
                        )}
                        {invoice.amountPaid !== '0.00' && (
                          <p className="text-[11px] text-slate-500">
                            <Money amount={invoice.amountPaid} /> paid
                          </p>
                        )}
                      </Td>

                      <Td>
                        <div className="flex flex-col items-start gap-1">
                          <StatusPill
                            status={invoice.status}
                            label={PURCHASE_INVOICE_STATUS_LABELS[invoice.status]}
                          />
                          {/* The stored status already says Booked / Partially
                            paid / Paid. The derived one adds exactly one thing
                            the column cannot: whether an unpaid invoice is
                            past its due date. So it is shown only then. */}
                          {invoice.paymentStatus === 'OVERDUE' && (
                            <StatusPill
                              status={invoice.paymentStatus}
                              label={PAYMENT_STATUS_LABELS[invoice.paymentStatus]}
                            />
                          )}
                        </div>
                      </Td>

                      <Td>
                        <InvoiceActions invoice={invoice} />
                        {invoice.matchNotes && (
                          <p className="mt-1 max-w-[16rem] text-[11px] leading-snug text-amber-900">
                            {invoice.matchNotes}
                          </p>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>

            <Pagination
              total={invoices.data.total}
              page={invoices.data.page}
              pageSize={invoices.data.pageSize}
              noun="invoices"
            />
          </>
        )}
      </Panel>
    </div>
  );
}
