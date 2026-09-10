import type { Metadata } from 'next';
import { PROCUREMENT_ROUTES, STOCK_LOT_STATUS_LABELS, UNIT_LABELS } from '@pharma-erp/types';

import { BookReceiptForm } from '@/components/procurement/book-receipt-form';
import { FilterBar } from '@/components/procurement/filter-bar';
import {
  Blank,
  DateText,
  EmptyState,
  ErrorState,
  Panel,
  Pill,
  Qty,
  RecordLink,
  StatusPill,
  TableWrap,
} from '@/components/procurement/ui';
import {
  fetchGoodsReceipts,
  fetchItems,
  fetchReceivableOrders,
  fetchVendors,
  toListQuery,
  toOptions,
} from '@/lib/procurement';

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
  const query = toListQuery(await searchParams);

  const [receipts, receivable, vendors, items] = await Promise.all([
    fetchGoodsReceipts(query),
    fetchReceivableOrders(),
    fetchVendors(),
    fetchItems(),
  ]);

  const isFiltered = Object.values(query).some(Boolean);

  return (
    <div className="space-y-6">
      <Panel
        title="Book a receipt"
        subtitle="Record material arriving against an issued purchase order. Each line creates a batch, in quarantine until incoming QC clears it."
      >
        <div className="p-5">
          {!receivable.ok ? (
            <ErrorState message={`Could not load open orders: ${receivable.error}`} />
          ) : receivable.data.length === 0 ? (
            <p className="text-sm text-slate-600">
              No purchase orders are open for receiving. Issue an order first — a draft order
              cannot receive material.
            </p>
          ) : (
            <BookReceiptForm orders={receivable.data} />
          )}
        </div>
      </Panel>

      <Panel
        title="Goods receipts"
        subtitle={
          receipts.ok
            ? `${receipts.data.length} receipt${receipts.data.length === 1 ? '' : 's'}`
            : undefined
        }
      >
        <FilterBar
          statuses={QC_FILTERS}
          vendors={vendors.ok ? toOptions(vendors.data) : []}
          items={items.ok ? toOptions(items.data) : []}
          searchPlaceholder="Search by GRN, PO, vendor or batch number…"
        />

        {!receipts.ok ? (
          <ErrorState message={`Could not load goods receipts: ${receipts.error}`} />
        ) : receipts.data.length === 0 ? (
          <EmptyState
            title="No goods receipts yet."
            hint="Book one above when material arrives against an issued purchase order."
            filtered={isFiltered}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {receipts.data.map((receipt) => (
              <li key={receipt.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-900">
                        {receipt.number}
                      </span>
                      {receipt.qcPendingCount > 0 && (
                        <Pill tone="warn">{receipt.qcPendingCount} awaiting QC</Pill>
                      )}
                      {receipt.qcAcceptedCount > 0 && (
                        <Pill tone="ok">{receipt.qcAcceptedCount} accepted</Pill>
                      )}
                      {receipt.qcRejectedCount > 0 && (
                        <Pill tone="danger">{receipt.qcRejectedCount} rejected / held</Pill>
                      )}
                    </div>

                    <p className="mt-1 text-sm text-slate-700">{receipt.vendor.name}</p>

                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                      <span>
                        Received <DateText value={receipt.receiptDate} />
                      </span>
                      <RecordLink
                        href={`${PROCUREMENT_ROUTES.purchaseOrders}?search=${receipt.purchaseOrder.number}`}
                      >
                        {receipt.purchaseOrder.number}
                      </RecordLink>
                      {receipt.vendorDocumentNumber && (
                        <span>Vendor doc {receipt.vendorDocumentNumber}</span>
                      )}
                      {receipt.receivedBy && <span>by {receipt.receivedBy}</span>}
                      {receipt.invoices.map((invoice) => (
                        <RecordLink
                          key={invoice.id}
                          href={`${PROCUREMENT_ROUTES.invoices}?search=${invoice.number}`}
                        >
                          {invoice.number}
                        </RecordLink>
                      ))}
                    </p>
                  </div>

                  {receipt.qcPendingCount > 0 && (
                    <RecordLink href={`${PROCUREMENT_ROUTES.incomingQc}?status=QUARANTINE`}>
                      Go to incoming QC →
                    </RecordLink>
                  )}
                </div>

                <TableWrap>
                  <table className="mt-3 w-full min-w-[62rem] text-left text-xs">
                    <thead>
                      <tr className="border-y border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
                        <th scope="col" className="py-2 pr-4 font-medium">
                          Item
                        </th>
                        <th scope="col" className="py-2 pr-4 font-medium">
                          Batch
                        </th>
                        <th scope="col" className="py-2 pr-4 font-medium">
                          Mfg
                        </th>
                        <th scope="col" className="py-2 pr-4 font-medium">
                          Expiry
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">
                          Ordered
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">
                          Received
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">
                          Rejected
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">
                          To quarantine
                        </th>
                        <th scope="col" className="py-2 pr-4 font-medium">
                          Location
                        </th>
                        <th scope="col" className="py-2 font-medium">
                          Inventory status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {receipt.lines.map((line) => (
                        <tr key={line.id}>
                          <td className="py-2 pr-4">
                            <span className="font-medium text-slate-800">{line.item.name}</span>
                            <span className="ml-2 font-mono text-[11px] text-slate-500">
                              {line.item.code}
                            </span>
                          </td>
                          <td className="py-2 pr-4">
                            {line.lot ? (
                              <>
                                <span className="font-mono text-[11px] font-medium text-slate-900">
                                  {line.lot.lotNumber}
                                </span>
                                {line.vendorBatchNumber && (
                                  <span className="ml-2 text-[11px] text-slate-500">
                                    vendor {line.vendorBatchNumber}
                                  </span>
                                )}
                              </>
                            ) : (
                              <Blank />
                            )}
                          </td>
                          <td className="py-2 pr-4 tabular-nums">
                            <DateText value={line.manufacturingDate} />
                          </td>
                          <td className="py-2 pr-4 tabular-nums">
                            <DateText value={line.expiryDate} />
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            <Qty value={line.quantityOrdered} uom={UNIT_LABELS[line.item.uom]} />
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {line.quantityReceived}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {line.quantityRejected === '0' ? (
                              <Blank />
                            ) : (
                              <span className="text-red-800">{line.quantityRejected}</span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-right font-medium tabular-nums">
                            {line.quantityAccepted}
                          </td>
                          <td className="py-2 pr-4">{line.storageLocation ?? <Blank />}</td>
                          <td className="py-2">
                            {line.lot ? (
                              <StatusPill
                                status={line.lot.status}
                                label={STOCK_LOT_STATUS_LABELS[line.lot.status]}
                              />
                            ) : (
                              <Blank />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>

                {receipt.remarks && (
                  <p className="mt-2 text-xs text-slate-500">{receipt.remarks}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

