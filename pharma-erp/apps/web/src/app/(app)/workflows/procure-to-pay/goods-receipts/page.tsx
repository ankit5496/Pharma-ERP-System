import type { Metadata } from 'next';
import { PROCUREMENT_ROUTES } from '@pharma-erp/types';

import { BookReceiptForm } from '@/components/procurement/book-receipt-form';
import { EditGoodsReceiptButton } from '@/components/procurement/edit-dialogs';
import { FilterButton, FilterPanel } from '@/components/procurement/filter-bar';
import { Pagination } from '@/components/procurement/pagination';
import {
  Blank,
  DateText,
  EmptyState,
  ErrorState,
  Panel,
  Pill,
  Qty,
  RecordLink,
  TableWrap,
  Td,
  Th,
} from '@/components/procurement/ui';
import {
  fetchGoodsReceipts,
  fetchItems,
  fetchReceivableOrders,
  fetchVendors,
  toListQuery,
  toOptions,
} from '@/lib/procurement';
import { requireSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Goods receipts' };
export const dynamic = 'force-dynamic';

const QC_FILTERS = [
  { value: 'QC_PENDING', label: 'Has batches awaiting QC' },
  { value: 'QC_COMPLETE', label: 'QC complete' },
];

/**
 * Sub-tab 3 — GRN.
 *
 * Every receipt shows its batches, because that is the whole point: raw
 * material is never received as an anonymous quantity. Each line displays the
 * lot the receipt created, its vendor batch number, its expiry, and where QC
 * has got to with it — which is also the answer to "can production use this
 * yet", and the answer is no until the Incoming QC tab says otherwise.
 */
export default async function GoodsReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = toListQuery(params);

  // Set when the user pressed "Create GRN" on a purchase order, so the form
  // opens on that order instead of making them find it again in the list.
  const preselectedOrderId =
    typeof params.purchaseOrderId === 'string' ? params.purchaseOrderId : undefined;

  const [user, receipts, receivable, vendors, items] = await Promise.all([
    requireSession(),
    fetchGoodsReceipts(query),
    fetchReceivableOrders(),
    fetchVendors(),
    fetchItems(),
  ]);

  const isFiltered = Object.values(query).some(Boolean);

  return (
    <div className="space-y-6">
      <Panel
        title="Goods receipts"
        subtitle={
          receipts.ok
            ? `${receipts.data.total} receipt${receipts.data.total === 1 ? '' : 's'}`
            : undefined
        }
        action={
          <>
            <FilterButton />

            {/* The button is only offered when there is something to receive
                against. Opening a dialog whose only content is "nothing is
                open" wastes the click; the sentence says it in place. */}
            {!receivable.ok ? (
              <span className="text-xs text-red-700">
                Open orders unavailable: {receivable.error}
              </span>
            ) : receivable.data.length === 0 ? (
              <span className="text-xs text-slate-500">No order is open for receiving.</span>
            ) : (
              <BookReceiptForm
                orders={receivable.data}
                preselectedOrderId={preselectedOrderId}
                receivedBy={user.fullName}
              />
            )}
          </>
        }
      >
        <FilterPanel
          statuses={QC_FILTERS}
          vendors={vendors.ok ? toOptions(vendors.data) : []}
          items={items.ok ? toOptions(items.data) : []}
          searchPlaceholder="Search by GRN, PO, vendor or batch number…"
        />

        {!receipts.ok ? (
          <ErrorState message={`Could not load goods receipts: ${receipts.error}`} />
        ) : receipts.data.rows.length === 0 ? (
          <EmptyState
            title="No goods receipts yet."
            hint="Book one above when material arrives against an issued purchase order."
            filtered={isFiltered}
          />
        ) : (
          <>
            <TableWrap>
              <table className="w-full min-w-[78rem] text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500">
                    <Th>GRN no.</Th>
                    <Th>Received</Th>
                    <Th>PO no.</Th>
                    <Th>Vendor</Th>
                    <Th>Item / batch</Th>
                    <Th align="right">Received</Th>
                    <Th>QC</Th>
                    <Th>Received by</Th>
                    <Th>Invoice</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.data.rows.map((receipt) => (
                    <tr key={receipt.id}>
                      <Td>
                        <span className="font-mono text-xs font-semibold text-slate-900">
                          {receipt.number}
                        </span>
                        {receipt.vendorDocumentNumber && (
                          <span
                            className="mt-0.5 block max-w-[10rem] truncate text-[11px] text-slate-500"
                            title={`Vendor document ${receipt.vendorDocumentNumber}`}
                          >
                            doc {receipt.vendorDocumentNumber}
                          </span>
                        )}
                      </Td>

                      <Td>
                        <DateText value={receipt.receiptDate} />
                      </Td>

                      <Td>
                        <RecordLink
                          href={`${PROCUREMENT_ROUTES.purchaseOrders}?search=${receipt.purchaseOrder.number}`}
                        >
                          <span className="font-mono text-xs">{receipt.purchaseOrder.number}</span>
                        </RecordLink>
                      </Td>

                      <Td>
                        {/* Truncated with the full name on hover: a vendor
                            called "Shree Krishna Pharmaceuticals Pvt Ltd"
                            would otherwise set the width of the whole
                            column. */}
                        <span className="block max-w-[12rem] truncate" title={receipt.vendor.name}>
                          {receipt.vendor.name}
                        </span>
                      </Td>

                      {/* THE LINES, STACKED INSIDE THE ROW rather than in a
                          table of their own. A nested table per record was
                          what made consecutive receipts run together — each
                          one had its own header row, so the screen showed a
                          dozen sets of column names and no clear edge between
                          records. */}
                      <Td valign="top">
                        <ul className="space-y-1">
                          {receipt.lines.map((line) => (
                            <li key={line.id} className="leading-snug">
                              <span
                                className="block max-w-[16rem] truncate text-xs font-medium text-slate-800"
                                title={`${line.item.name} (${line.item.code})`}
                              >
                                {line.item.name}
                              </span>
                              <span className="block text-[11px] text-slate-500">
                                {line.lot?.lotNumber ? (
                                  <span className="font-mono">{line.lot.lotNumber}</span>
                                ) : (
                                  <Blank />
                                )}
                                {line.expiryDate && (
                                  <span className="ml-1.5 tabular-nums">
                                    exp {line.expiryDate.slice(0, 10)}
                                  </span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </Td>

                      <Td align="right" valign="top">
                        <ul className="space-y-1">
                          {receipt.lines.map((line) => (
                            <li key={line.id} className="leading-snug">
                              <Qty value={line.quantityReceived} uom={line.item.uom} />
                              {line.quantityRejected !== '0' && (
                                <span className="block text-[11px] text-red-700">
                                  {line.quantityRejected} rejected
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </Td>

                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {receipt.qcPendingCount > 0 && (
                            <Pill tone="warn">{receipt.qcPendingCount} pending</Pill>
                          )}
                          {receipt.qcAcceptedCount > 0 && (
                            <Pill tone="ok">{receipt.qcAcceptedCount} accepted</Pill>
                          )}
                          {receipt.qcRejectedCount > 0 && (
                            <Pill tone="danger">{receipt.qcRejectedCount} rejected</Pill>
                          )}
                        </div>
                        {receipt.qcPendingCount > 0 && (
                          <p className="mt-1 text-[11px]">
                            <RecordLink href={`${PROCUREMENT_ROUTES.incomingQc}?status=QUARANTINE`}>
                              Go to QC →
                            </RecordLink>
                          </p>
                        )}
                      </Td>

                      <Td>
                        {receipt.receivedBy ? (
                          <span className="text-xs text-slate-600">{receipt.receivedBy}</span>
                        ) : (
                          <Blank />
                        )}
                      </Td>

                      <Td>
                        {receipt.invoices.length === 0 ? (
                          <Blank />
                        ) : (
                          <ul className="space-y-0.5">
                            {receipt.invoices.map((invoice) => (
                              <li key={invoice.id}>
                                <RecordLink
                                  href={`${PROCUREMENT_ROUTES.invoices}?search=${invoice.number}`}
                                >
                                  <span className="font-mono text-xs">{invoice.number}</span>
                                </RecordLink>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Td>

                      <Td>
                        <EditGoodsReceiptButton receipt={receipt} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>

            <Pagination
              total={receipts.data.total}
              page={receipts.data.page}
              pageSize={receipts.data.pageSize}
              noun="receipts"
            />
          </>
        )}
      </Panel>
    </div>
  );
}
