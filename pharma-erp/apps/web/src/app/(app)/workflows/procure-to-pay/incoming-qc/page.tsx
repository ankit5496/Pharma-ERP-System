import type { Metadata } from 'next';
import {
  PROCUREMENT_ROUTES,
  QC_DECISION_LABELS,
  STOCK_LOT_STATUSES,
  STOCK_LOT_STATUS_LABELS,
} from '@pharma-erp/types';
import { FilterBar } from '@/components/procurement/filter-bar';
import { QcDecisionForm } from '@/components/procurement/qc-decision-form';
import {
  DateText,
  EmptyState,
  ErrorState,
  Panel,
  Pill,
  Qty,
  RecordLink,
  StatusPill,
  TableWrap,
  Td,
  Th,
} from '@/components/procurement/ui';
import { fetchItems, fetchQcQueue, fetchVendors, toListQuery, toOptions } from '@/lib/procurement';
export const metadata: Metadata = { title: 'Incoming QC' };
export const dynamic = 'force-dynamic';
/**
 * Sub-tab 4 — Incoming quality control.
 *
 * The gate. Every received batch lands here in quarantine, and nothing can be
 * used in production until a Quality Officer decides. The screen makes the
 * consequence of each choice explicit rather than leaving it to be learned:
 * accepting releases the batch into usable stock and the FEFO pool, rejecting
 * or holding leaves it in quarantine where production cannot reach it.
 */
export default async function IncomingQcPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = toListQuery(await searchParams);
  const [queue, vendors, items] = await Promise.all([
    fetchQcQueue(query),
    fetchVendors(),
    fetchItems(),
  ]);
  const isFiltered = Object.values(query).some(Boolean);
  const pending = queue.ok ? queue.data.filter((row) => row.lot.status === 'QUARANTINE') : [];
  return (
    <Panel
      title="Incoming QC"
      subtitle={
        queue.ok
          ? `${pending.length} batch${pending.length === 1 ? '' : 'es'} awaiting a decision, ${queue.data.length} shown`
          : undefined
      }
    >
      <FilterBar
        statuses={STOCK_LOT_STATUSES.filter((status) => status !== 'CONSUMED').map((status) => ({
          value: status,
          label: STOCK_LOT_STATUS_LABELS[status],
        }))}
        vendors={vendors.ok ? toOptions(vendors.data) : []}
        items={items.ok ? toOptions(items.data) : []}
        searchPlaceholder="Search by lot, batch number, item or GRN…"
      />
      {!queue.ok ? (
        <ErrorState message={`Could not load the QC queue: ${queue.error}`} />
      ) : queue.data.length === 0 ? (
        <EmptyState
          title="No batches to inspect."
          hint="Batches appear here as soon as a goods receipt is booked."
          filtered={isFiltered}
        />
      ) : (
        <TableWrap>
          <table className="w-full min-w-[72rem] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <Th>Batch</Th>
                <Th>Item</Th>
                <Th>Source</Th>
                <Th align="right">Quantity</Th>
                <Th>Mfg / expiry</Th>
                <Th>Status</Th>
                <Th>QC history</Th>
                <Th>Decision</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {queue.data.map((row) => (
                <tr
                  key={row.lot.id}
                  className={row.lot.status === 'QUARANTINE' ? 'bg-amber-50/40' : undefined}
                >
                  <Td>
                    <p className="font-mono text-xs font-semibold text-slate-900">
                      {row.lot.lotNumber}
                    </p>
                    {row.lot.vendorBatchNumber && (
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        vendor {row.lot.vendorBatchNumber}
                      </p>
                    )}
                    {row.lot.storageLocation && (
                      <p className="text-[11px] text-slate-400">{row.lot.storageLocation}</p>
                    )}
                  </Td>
                  <Td>
                    <p className="font-medium text-slate-900">{row.item.name}</p>
                    <p className="font-mono text-xs text-slate-500">{row.item.code}</p>
                  </Td>
                  <Td>
                    <p className="text-xs text-slate-700">{row.vendor.name}</p>
                    <p className="mt-0.5 flex flex-wrap gap-2 text-[11px]">
                      <RecordLink
                        href={`${PROCUREMENT_ROUTES.goodsReceipts}?search=${row.goodsReceipt.number}`}
                      >
                        {row.goodsReceipt.number}
                      </RecordLink>
                      <RecordLink
                        href={`${PROCUREMENT_ROUTES.purchaseOrders}?search=${row.purchaseOrder.number}`}
                      >
                        {row.purchaseOrder.number}
                      </RecordLink>
                    </p>
                  </Td>
                  <Td align="right">
                    <Qty value={row.lot.quantityAvailable} uom={row.item.uom} />
                    {row.lot.quantityAvailable !== row.lot.quantityReceived && (
                      <p className="text-[11px] text-slate-400">
                        of {row.lot.quantityReceived} received
                      </p>
                    )}
                  </Td>
                  <Td>
                    <p className="text-xs tabular-nums text-slate-600">
                      <DateText value={row.lot.manufacturingDate} />
                    </p>
                    <p className="text-xs tabular-nums text-slate-800">
                      <DateText value={row.lot.expiryDate} />
                    </p>
                    {row.daysToExpiry !== null && (
                      // Shelf life at the point of receipt is a QC criterion
                      // in its own right: a batch arriving with two months
                      // left may be refused even if it passes every test.
                      <p className="mt-0.5">
                        {row.daysToExpiry < 0 ? (
                          <Pill tone="danger">expired</Pill>
                        ) : row.daysToExpiry < 180 ? (
                          <Pill tone="warn">{row.daysToExpiry}d left</Pill>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            {row.daysToExpiry}d left
                          </span>
                        )}
                      </p>
                    )}
                  </Td>
                  <Td>
                    <StatusPill
                      status={row.lot.status}
                      label={STOCK_LOT_STATUS_LABELS[row.lot.status]}
                    />
                  </Td>
                  <Td>
                    {row.history.length === 0 ? (
                      <span className="text-xs text-slate-400">Not yet inspected</span>
                    ) : (
                      <ul className="space-y-1">
                        {row.history.map((result) => (
                          <li key={result.id} className="text-[11px] leading-snug">
                            <span className="font-semibold text-slate-700">
                              {QC_DECISION_LABELS[result.decision]}
                            </span>{' '}
                            <span className="text-slate-500">
                              {result.inspectedAt.slice(0, 10)}
                              {result.inspectedBy && ` · ${result.inspectedBy}`}
                            </span>
                            {result.testReference && (
                              <span className="block text-slate-500">
                                COA {result.testReference}
                              </span>
                            )}
                            {result.remarks && (
                              <span className="block text-slate-600">{result.remarks}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Td>
                  <Td>
                    <QcDecisionForm lot={row} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
        Only accepted batches count as usable stock and become available for FEFO picking in
        production. Rejected and on-hold batches stay in quarantine and remain traceable for a
        vendor return or debit note — they never increase usable inventory.
      </p>
    </Panel>
  );
}
