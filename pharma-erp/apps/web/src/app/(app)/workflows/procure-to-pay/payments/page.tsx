import type { Metadata } from 'next';
import { PAYMENT_STATUSES, PAYMENT_STATUS_LABELS, PROCUREMENT_ROUTES } from '@pharma-erp/types';

import { FilterBar } from '@/components/procurement/filter-bar';
import { PayablesReportPanel } from '@/components/procurement/payables-report';
import { RecordPaymentForm } from '@/components/procurement/record-payment-form';
import {
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
} from '@/components/procurement/ui';
import {
  fetchPayables,
  fetchPayablesReport,
  fetchVendors,
  toListQuery,
  toOptions,
} from '@/lib/procurement';

export const metadata: Metadata = { title: 'Vendor payments' };
export const dynamic = 'force-dynamic';

/**
 * Sub-tab 6 — Vendor payments and payables.
 *
 * The ledger is derived, not stored: outstanding is the invoice total minus
 * the payments recorded against it, computed per request. Nothing here can
 * drift out of step with the payments themselves, which is the whole reason
 * there is no balance column in the database.
 *
 * Only approved invoices appear. A draft invoice is a record of what a vendor
 * claims, not a debt.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = toListQuery(await searchParams);

  const [payables, vendors, report] = await Promise.all([
    fetchPayables(query),
    fetchVendors(),
    // The report honours the vendor filter so the summary and the list below
    // always describe the same set of invoices.
    fetchPayablesReport(query.vendorId),
  ]);

  const isFiltered = Object.values(query).some(Boolean);

  return (
    <div className="space-y-6">
      <PayablesReportPanel result={report} />

      <Panel
      title="Vendor payables"
      subtitle={
        payables.ok
          ? `${payables.data.length} approved invoice${payables.data.length === 1 ? '' : 's'}`
          : undefined
      }
    >
      <FilterBar
        statuses={PAYMENT_STATUSES.map((status) => ({
          value: status,
          label: PAYMENT_STATUS_LABELS[status],
        }))}
        vendors={vendors.ok ? toOptions(vendors.data) : []}
        searchPlaceholder="Search by invoice number, vendor or PO…"
      />

      {!payables.ok ? (
        <ErrorState message={`Could not load payables: ${payables.error}`} />
      ) : payables.data.length === 0 ? (
        <EmptyState
          title="Nothing on the payables ledger."
          hint="An invoice appears here once it has been approved on the Purchase invoices tab."
          filtered={isFiltered}
        />
      ) : (
        <TableWrap>
          <table className="w-full min-w-[74rem] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <Th>Invoice</Th>
                <Th>Vendor</Th>
                <Th>Dates</Th>
                <Th align="right">Invoice</Th>
                <Th align="right">Paid</Th>
                <Th align="right">Outstanding</Th>
                <Th>Status</Th>
                <Th>Payments</Th>
                <Th>Record payment</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payables.data.map((row) => (
                <tr
                  key={row.invoiceId}
                  className={row.paymentStatus === 'OVERDUE' ? 'bg-red-50/40' : undefined}
                >
                  <Td>
                    <p className="font-mono text-xs font-semibold text-slate-900">
                      {row.invoiceNumber}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-600">
                      vendor ref {row.vendorInvoiceNumber}
                    </p>
                    <p className="mt-0.5 text-[11px]">
                      <RecordLink
                        href={`${PROCUREMENT_ROUTES.purchaseOrders}?search=${row.purchaseOrder.number}`}
                      >
                        {row.purchaseOrder.number}
                      </RecordLink>
                    </p>
                  </Td>

                  <Td>{row.vendor.name}</Td>

                  <Td>
                    <p className="text-xs tabular-nums text-slate-700">
                      <DateText value={row.invoiceDate} />
                    </p>
                    <p className="text-[11px] tabular-nums text-slate-500">
                      due <DateText value={row.dueDate} />
                    </p>
                    {/* Days to due, phrased as the reader would say it. */}
                    <p className="mt-0.5">
                      {row.paymentStatus === 'PAID' ? null : row.daysToDue < 0 ? (
                        <Pill tone="danger">{Math.abs(row.daysToDue)}d overdue</Pill>
                      ) : row.daysToDue <= 7 ? (
                        <Pill tone="warn">due in {row.daysToDue}d</Pill>
                      ) : (
                        <span className="text-[11px] text-slate-400">
                          due in {row.daysToDue}d
                        </span>
                      )}
                    </p>
                  </Td>

                  <Td align="right">
                    <Money amount={row.invoiceAmount} bold />
                  </Td>

                  <Td align="right">
                    <Money amount={row.amountPaid} />
                  </Td>

                  <Td align="right">
                    <span
                      className={
                        row.outstandingAmount === '0.00'
                          ? 'text-slate-400'
                          : 'font-semibold text-slate-900'
                      }
                    >
                      <Money amount={row.outstandingAmount} />
                    </span>
                  </Td>

                  <Td>
                    <StatusPill
                      status={row.paymentStatus}
                      label={PAYMENT_STATUS_LABELS[row.paymentStatus]}
                    />
                  </Td>

                  <Td>
                    {row.payments.length === 0 ? (
                      <span className="text-xs text-slate-400">None yet</span>
                    ) : (
                      <ul className="space-y-1">
                        {row.payments.map((payment) => (
                          <li key={payment.id} className="text-[11px] leading-snug">
                            <span className="font-medium text-slate-800">
                              <Money amount={payment.amount} />
                            </span>{' '}
                            <span className="text-slate-500">
                              {payment.paymentDate.slice(0, 10)}
                            </span>
                            {payment.reference && (
                              <span className="block text-slate-500">
                                {payment.method ? `${payment.method} · ` : ''}
                                {payment.reference}
                              </span>
                            )}
                            {payment.recordedBy && (
                              <span className="block text-slate-400">by {payment.recordedBy}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Td>

                  <Td>
                    {/* One component either way: it decides internally whether
                        to offer the form or report the invoice as settled. A
                        branch here would unmount it on the payment that
                        cleared the balance, losing the confirmation. */}
                    <RecordPaymentForm payable={row} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
        Outstanding is the invoice total less the payments recorded against it, computed on every
        read rather than stored — so it cannot drift out of step with the payments listed beside
        it. A payment larger than the outstanding balance is refused.
      </p>
    </Panel>
    </div>
  );
}
