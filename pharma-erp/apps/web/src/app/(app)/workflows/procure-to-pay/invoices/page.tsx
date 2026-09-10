import type { Metadata } from 'next';
import {
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  PROCUREMENT_ROUTES,
  PURCHASE_INVOICE_STATUSES,
  PURCHASE_INVOICE_STATUS_LABELS,
} from '@pharma-erp/types';

import { FilterBar } from '@/components/procurement/filter-bar';
import { InvoiceActions } from '@/components/procurement/invoice-actions';
import { RecordInvoiceForm } from '@/components/procurement/record-invoice-form';
import {
  Blank,
  DateText,
  EmptyState,
  ErrorState,
  Money,
  Panel,
  RecordLink,
  StatusPill,
  TableWrap,
  Td,
  Th,
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
    ...PAYMENT_STATUSES.map((status) => ({
      value: status,
      label: `Payment: ${PAYMENT_STATUS_LABELS[status]}`,
    })),
  ];

  return (
    <div className="space-y-6">
      <Panel
        title="Record a vendor invoice"
        subtitle="Match the invoice against the purchase order and the goods receipt it bills for."
      >
        <div className="p-5">
          {!invoiceable.ok ? (
            <ErrorState message={`Could not load orders: ${invoiceable.error}`} />
          ) : invoiceable.data.length === 0 ? (
            <p className="text-sm text-slate-600">
              No purchase order has received material yet, so there is nothing to invoice. Book a
              goods receipt first.
            </p>
          ) : (
            <RecordInvoiceForm orders={invoiceable.data} />
          )}
        </div>
      </Panel>

      <Panel
        title="Purchase invoices"
        subtitle={
          invoices.ok
            ? `${invoices.data.length} invoice${invoices.data.length === 1 ? '' : 's'}`
            : undefined
        }
      >
        <FilterBar
          statuses={statusOptions}
          vendors={vendors.ok ? toOptions(vendors.data) : []}
          searchPlaceholder="Search by invoice number, vendor, PO or GRN…"
        />

        {!invoices.ok ? (
          <ErrorState message={`Could not load invoices: ${invoices.error}`} />
        ) : invoices.data.length === 0 ? (
          <EmptyState
            title="No invoices recorded yet."
            hint="Record one above once a vendor bills for material you have received."
            filtered={isFiltered}
          />
        ) : (
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
                {invoices.data.map((invoice) => (
                  <tr key={invoice.id}>
                    <Td>
                      <p className="font-mono text-xs font-semibold text-slate-900">
                        {invoice.number}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-600">
                        vendor ref {invoice.vendorInvoiceNumber}
                      </p>
                    </Td>

                    <Td>
                      <p className="text-sm text-slate-800">{invoice.vendor.name}</p>
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
                          {invoice.purchaseOrder.number}
                        </RecordLink>
                        {invoice.goodsReceipt ? (
                          <RecordLink
                            href={`${PROCUREMENT_ROUTES.goodsReceipts}?search=${invoice.goodsReceipt.number}`}
                          >
                            {invoice.goodsReceipt.number}
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
                        due <DateText value={invoice.dueDate} /> · net{' '}
                        {invoice.paymentTermsDays}d
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
                        {invoice.status === 'APPROVED' && (
                          <StatusPill
                            status={invoice.paymentStatus}
                            label={PAYMENT_STATUS_LABELS[invoice.paymentStatus]}
                          />
                        )}
                      </div>
                    </Td>

                    <Td>
                      <InvoiceActions invoice={invoice} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}
