import type { Metadata } from 'next';
import {
  DEFAULT_PAGE_SIZE,
  PROCUREMENT_ROUTES,
  type ItemStockPosition,
  type StockLedgerRow,
} from '@pharma-erp/types';

import { FilterButton, FilterPanel } from '@/components/procurement/filter-bar';
import {
  Blank,
  DateText,
  DateTimeText,
  EmptyState,
  ErrorState,
  Panel,
  Pill,
  Qty,
  RecordLink,
  RecordList,
  SubTable,
  TableWrap,
  Td,
  Th,
} from '@/components/procurement/ui';
import { Pagination } from '@/components/procurement/pagination';
import {
  fetchItems,
  fetchStockLedger,
  fetchStockPositions,
  toListQuery,
  toOptions,
} from '@/lib/procurement';

export const metadata: Metadata = { title: 'Raw material stock' };
export const dynamic = 'force-dynamic';

/**
 * Sub-tab 5 — Raw material stock.
 *
 * What QC released, batch by batch, and every movement behind it.
 *
 * TWO PANELS, because they answer two different questions. The first is "what
 * can production use right now, and in what order" — one row per BATCH, never
 * summed into a per-item total, because two batches of the same material are
 * not interchangeable: they have different expiries and a recall names one and
 * not the other. The second is the ledger: every movement that produced those
 * balances, including the ones that deliberately produced none.
 *
 * NOTHING ON THIS SCREEN IS TYPED BY ANYONE. Every row here was written by a
 * goods receipt or a QC decision, carrying the vendor's batch number, quantity
 * and expiry forward untouched. There is no create form, and that is the
 * point — a stock figure somebody can type is a stock figure nobody can trust.
 */
export default async function StockLedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = toListQuery(await searchParams);

  // Sliced on the server, like low stock. The ledger endpoint returns the
  // movements for the chosen item; paging it in the database would need a
  // second endpoint for a list that is already bounded by one item's history.
  const ledgerPage = Math.max(query.page ?? 1, 1);
  const ledgerPageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

  const [positions, ledger, items] = await Promise.all([
    fetchStockPositions(),
    fetchStockLedger(query.itemId),
    fetchItems(),
  ]);

  const ledgerRows = ledger.ok ? ledger.data : [];
  const visibleLedger = ledgerRows.slice(
    (ledgerPage - 1) * ledgerPageSize,
    ledgerPage * ledgerPageSize,
  );

  // Items with something to show. An item nobody has ever received would
  // otherwise contribute an empty row to every company's screen.
  const stocked = positions.ok
    ? positions.data.filter(
        (p) =>
          (query.itemId ? p.item.id === query.itemId : true) &&
          (p.fefoLots.length > 0 ||
            p.quarantineStock !== '0' ||
            p.rejectedStock !== '0' ||
            p.onHoldStock !== '0'),
      )
    : [];

  return (
    <div className="space-y-6">
      <Panel
        title="Stock by batch"
        subtitle="Usable batches in first-expiry-first-out order — the order production must pick in."
        action={<FilterButton />}
      >
        <FilterPanel
          items={items.ok ? toOptions(items.data) : []}
          showDates={false}
          searchPlaceholder="Search the ledger by item or batch…"
        />

        {!positions.ok ? (
          <ErrorState message={`Could not load stock: ${positions.error}`} />
        ) : stocked.length === 0 ? (
          <EmptyState
            title="No raw material stock yet."
            hint="Batches appear here once incoming QC accepts a goods receipt."
            filtered={Boolean(query.itemId)}
          />
        ) : (
          <RecordList>
            {stocked.map((position) => (
              <StockByItem key={position.item.id} position={position} />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel
        title="Stock ledger"
        subtitle={
          ledger.ok
            ? `${ledger.data.length} movement${ledger.data.length === 1 ? '' : 's'}, newest first`
            : undefined
        }
      >
        {!ledger.ok ? (
          <ErrorState message={`Could not load the ledger: ${ledger.error}`} />
        ) : ledger.data.length === 0 ? (
          <EmptyState
            title="No stock movements yet."
            hint="Every receipt and QC decision writes an entry here automatically."
            filtered={Boolean(query.itemId)}
          />
        ) : (
          <>
            <TableWrap>
              <table className="w-full min-w-[74rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <Th>When</Th>
                    <Th>Item</Th>
                    <Th>Batch</Th>
                    <Th>Expiry</Th>
                    <Th>Movement</Th>
                    <Th align="right">Quantity</Th>
                    <Th>Usable stock</Th>
                    <Th>Source</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleLedger.map((entry) => (
                    <LedgerRow key={entry.id} entry={entry} />
                  ))}
                </tbody>
              </table>
            </TableWrap>

            <Pagination
              total={ledgerRows.length}
              page={ledgerPage}
              pageSize={ledgerPageSize}
              noun="movements"
            />
          </>
        )}
      </Panel>
    </div>
  );
}

/**
 * One item's batches, each kept as its own record.
 *
 * The per-item figure at the top is a SUM FOR READING, not a stock record —
 * the records are the rows beneath it, and consumption draws on them in the
 * order shown.
 */
function StockByItem({ position }: { position: ItemStockPosition }) {
  const { item } = position;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{item.name}</p>
          <p className="font-mono text-xs text-slate-500">{item.code}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-slate-900">
            <Qty value={position.availableStock} uom={item.uom} /> usable
          </span>
          {position.quarantineStock !== '0' && (
            <Pill tone="warn">
              {position.quarantineStock} {item.uom} awaiting QC
            </Pill>
          )}
          {position.onHoldStock !== '0' && (
            <Pill tone="danger">
              {position.onHoldStock} {item.uom} on hold
            </Pill>
          )}
          {position.rejectedStock !== '0' && (
            <Pill tone="danger">
              {position.rejectedStock} {item.uom} rejected
            </Pill>
          )}
          {position.belowReorderLevel && <Pill tone="warn">Below reorder level</Pill>}
        </div>
      </div>

      {position.fefoLots.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          Nothing usable. Quarantined, held and rejected material is not available to production.
        </p>
      ) : (
        <SubTable>
          <table className="mt-3 w-full min-w-[44rem] text-left text-xs">
            <thead>
              <tr className="border-y border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Pick order
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Batch
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Expiry
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Available
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Received
                </th>
                <th scope="col" className="py-2 font-medium">
                  Location
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {position.fefoLots.map((lot, index) => (
                <tr key={lot.id}>
                  {/* The FEFO position, stated rather than implied by row
                      order: the first batch here is the one that must be
                      consumed first, and saying so is the whole point. */}
                  <td className="py-2 pr-4">
                    {index === 0 ? (
                      <Pill tone="ok">next</Pill>
                    ) : (
                      <span className="text-slate-400">{index + 1}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <span className="font-medium text-slate-800">
                      {lot.vendorBatchNumber ?? lot.lotNumber}
                    </span>
                    {lot.vendorBatchNumber && (
                      <span className="ml-2 font-mono text-[11px] text-slate-400">
                        {lot.lotNumber}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 tabular-nums text-slate-700">
                    <DateText value={lot.expiryDate} />
                  </td>
                  <td className="py-2 pr-4 text-right font-semibold tabular-nums text-slate-900">
                    {lot.quantityAvailable} {item.uom}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-slate-500">
                    {lot.quantityReceived} {item.uom}
                  </td>
                  <td className="py-2 text-slate-600">{lot.storageLocation ?? <Blank />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SubTable>
      )}
    </li>
  );
}

/** How each movement type reads to someone scanning the ledger. */
const MOVEMENT_LABELS: Record<string, string> = {
  GRN_QUARANTINE: 'Received into quarantine',
  QC_ACCEPTED: 'QC accepted',
  QC_REJECTED: 'QC rejected',
  QC_HOLD: 'QC hold',
  CONSUMPTION: 'Issued / consumed',
  ADJUSTMENT: 'Adjustment',
};

function LedgerRow({ entry }: { entry: StockLedgerRow }) {
  const delta = Number(entry.quantityDelta);
  const adds = delta > 0;

  return (
    <tr>
      <Td>
        <span className="text-xs text-slate-600">
          <DateTimeText value={entry.createdAt} />
        </span>
        {entry.createdBy && <p className="text-[11px] text-slate-400">{entry.createdBy}</p>}
      </Td>

      <Td>
        <p className="text-sm text-slate-800">{entry.itemName}</p>
        <p className="font-mono text-[11px] text-slate-500">{entry.itemCode}</p>
      </Td>

      <Td>
        {/* The vendor's batch number leads, because that is the number on the
            drum and in a recall notice. Our own lot number sits behind it. */}
        <p className="font-medium text-slate-800">{entry.vendorBatchNumber ?? <Blank />}</p>
        {entry.lotNumber && (
          <p className="font-mono text-[11px] text-slate-400">{entry.lotNumber}</p>
        )}
      </Td>

      <Td>
        <span className="text-xs tabular-nums text-slate-700">
          <DateText value={entry.expiryDate} />
        </span>
      </Td>

      <Td>
        <span className="text-xs text-slate-700">
          {MOVEMENT_LABELS[entry.entryType] ?? entry.entryType.replace(/_/g, ' ').toLowerCase()}
        </span>
        {entry.notes && (
          <p className="max-w-[20rem] text-[11px] leading-snug text-slate-500">{entry.notes}</p>
        )}
      </Td>

      <Td align="right">
        <span
          className={`whitespace-nowrap font-semibold tabular-nums ${
            adds ? 'text-green-800' : 'text-red-800'
          }`}
        >
          {adds ? '+' : ''}
          {entry.quantityDelta} {entry.itemUom}
        </span>
      </Td>

      <Td>
        {/* The distinction the whole quality gate rests on. A rejection is
            recorded in full and still never touches usable stock. */}
        {entry.affectsUsableStock ? (
          <Pill tone={adds ? 'ok' : 'neutral'}>
            {adds ? 'Added to usable' : 'Removed from usable'}
          </Pill>
        ) : (
          <Pill tone="muted">Not usable stock</Pill>
        )}
      </Td>

      <Td>
        {entry.reference ? (
          <RecordLink href={`${PROCUREMENT_ROUTES.goodsReceipts}?search=${entry.reference}`}>
            <span className="font-mono text-[11px]">{entry.reference}</span>
          </RecordLink>
        ) : (
          <Blank />
        )}
      </Td>
    </tr>
  );
}
