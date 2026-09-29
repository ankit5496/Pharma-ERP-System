'use client';

import { useState } from 'react';

import {
  ITEM_TYPE_LABELS,
  RESERVATION_STATE_LABELS,
  STOCK_BATCH_STATUS_LABELS,
  type ExpiryBucket,
  type ItemType,
  type NearExpiryRow,
} from '@pharma-erp/types';

import { ListPager } from '@/components/list-pager';
import { Code, DateText, Name, Pill, RecordLink, type Tone } from '@/components/procurement/ui';
import { Quantity } from '@/components/production/shared';

import {
  ExpiryNote,
  HEAD,
  RESERVATION_TONE,
  STATUS_TONE,
  TYPE_TONE,
  orderHref,
} from './stock-groups';

const PAGE_SIZES = [10, 25, 50, 100] as const;

const COLUMNS = [
  { label: 'Item' },
  { label: 'Type' },
  { label: 'Batch' },
  { label: 'Expiry' },
  { label: 'Window' },
  { label: 'Available', className: 'cell-align-right' },
  { label: 'Status' },
  { label: 'Reservation' },
] as const;

/** Expired is red; the tightest window amber; the rest neutral. */
export function bucketTone(bucket: string, buckets: readonly Pick<ExpiryBucket, 'key'>[]): Tone {
  if (bucket === 'EXPIRED') return 'danger';
  return buckets[1]?.key === bucket ? 'warn' : 'neutral';
}

/**
 * The flagged batches, soonest expiry first — US-INV-03.
 *
 * Flat, one row per batch, because the question here is "which batches need
 * moving", not "how much of each item is there". Paged in the browser, like the
 * stock enquiry, because the whole list has already arrived.
 */
export function NearExpiryTable({
  rows,
  buckets,
}: {
  rows: readonly NearExpiryRow[];
  buckets: readonly ExpiryBucket[];
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[1]);

  const pageCount = Math.max(Math.ceil(rows.length / pageSize), 1);
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  const visible = rows.slice(start, start + pageSize);
  const labels = new Map(buckets.map((bucket) => [bucket.key, bucket.label]));

  return (
    <>
      <div className="table-scroll overflow-x-auto">
        <table className="w-full min-w-[64rem] text-left text-sm">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.label}
                  scope="col"
                  className={`${HEAD} ${'className' in column ? column.className : ''}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className={row.bucket === 'EXPIRED' ? 'bg-red-50/60' : undefined}>
                <td className="px-4 py-3">
                  <span className="block font-medium text-slate-900">
                    <Name>{row.item.name}</Name>
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">
                    <Code>{row.item.code}</Code>
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset ${
                      TYPE_TONE[row.item.type] ?? 'bg-slate-100 text-slate-700 ring-slate-200'
                    }`}
                  >
                    {ITEM_TYPE_LABELS[row.item.type as ItemType] ?? row.item.type}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-[13px] font-medium text-slate-900">
                    <Code>{row.batchNumber}</Code>
                  </span>
                  {row.vendorBatchNumber && row.vendorBatchNumber !== row.batchNumber && (
                    <span className="block font-mono text-[11px] text-slate-500">
                      Vendor <Code>{row.vendorBatchNumber}</Code>
                    </span>
                  )}
                  {row.principalOwned && (
                    <span className="mt-1 block">
                      <Pill tone="muted">Principal-owned</Pill>
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                  <DateText value={row.expiryDate} />
                  <ExpiryNote days={row.daysToExpiry} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <Pill tone={bucketTone(row.bucket, buckets)}>
                    {labels.get(row.bucket) ?? row.bucket}
                  </Pill>
                </td>
                <td className="cell-align-right px-4 py-3 whitespace-nowrap tabular-nums">
                  <Quantity value={row.quantityAvailable} uom={row.item.uom} />
                </td>
                <td className="px-4 py-3">
                  <Pill tone={STATUS_TONE[row.status]}>
                    {STOCK_BATCH_STATUS_LABELS[row.status]}
                  </Pill>
                </td>
                <td className="px-4 py-3">
                  <Pill tone={RESERVATION_TONE[row.reservationState]}>
                    {RESERVATION_STATE_LABELS[row.reservationState]}
                  </Pill>
                  {row.reservations.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {row.reservations.map((reservation) => (
                        <li key={reservation.orderId} className="whitespace-nowrap">
                          <RecordLink href={orderHref(reservation)}>
                            <span className="font-mono">
                              <Code>{reservation.orderNumber}</Code>
                            </span>
                          </RecordLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ListPager
        page={current}
        pageCount={pageCount}
        pageSize={pageSize}
        first={rows.length === 0 ? 0 : start + 1}
        last={start + visible.length}
        total={rows.length}
        noun="batches"
        pageSizes={PAGE_SIZES}
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </>
  );
}
