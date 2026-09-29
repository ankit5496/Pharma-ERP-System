'use client';

import { Fragment, useEffect, useState } from 'react';

import {
  ITEM_TYPE_LABELS,
  RESERVATION_STATE_LABELS,
  STOCK_BATCH_STATUS_LABELS,
  STOCK_MOVEMENT_BUCKET_LABELS,
  type ItemType,
  type ReservationState,
  type StockBatchRow,
  type StockBatchStatus,
  type StockItemGroup,
  type StockMovement,
  type StockReservation,
} from '@pharma-erp/types';

import { ListPager } from '@/components/list-pager';
import { Code, DateText, Name, Pill, RecordLink, type Tone } from '@/components/procurement/ui';
// Production's, not procurement's: it groups digits (1,90,000), which is how
// quantities read on the Material Issue and Batch Record screens.
import { Quantity } from '@/components/production/shared';

import { fetchBatchMovementsAction } from './actions';

const PAGE_SIZES = [10, 25, 50, 100] as const;

const STATUS_TONE: Record<StockBatchStatus, Tone> = {
  USABLE: 'ok',
  RELEASED: 'ok',
  QUARANTINE: 'warn',
  ON_HOLD: 'warn',
};

const RESERVATION_TONE: Record<ReservationState, Tone> = {
  RESERVED: 'info',
  PARTIALLY_RESERVED: 'warn',
  FREE: 'neutral',
};

/** The same category colours as the Master Data item register. */
const TYPE_TONE: Record<string, string> = {
  RAW_MATERIAL: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  PACKING_MATERIAL: 'bg-violet-50 text-violet-800 ring-violet-200',
  SEMI_FINISHED: 'bg-amber-50 text-amber-800 ring-amber-200',
  FINISHED_GOOD: 'bg-blue-50 text-blue-800 ring-blue-200',
};

const COLUMNS = [
  { label: '', className: 'w-10' },
  { label: 'Code' },
  { label: 'Item' },
  { label: 'Type' },
  { label: 'Batches' },
  { label: 'On Hand', className: 'cell-align-right' },
  { label: 'Reserved', className: 'cell-align-right' },
  { label: 'Free', className: 'cell-align-right' },
  { label: 'Next Expiry' },
] as const;

const HEAD = 'whitespace-nowrap px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-500';

/** Where a reservation links: the order's own list, searched for it. */
const orderHref = (reservation: StockReservation) =>
  `${
    reservation.kind === 'SALES_ORDER'
      ? '/workflows/order-to-cash/sales-orders'
      : '/workflows/job-work/job-work-orders'
  }?search=${encodeURIComponent(reservation.orderNumber)}`;

/**
 * Stock by item, each row opening onto its batches — US-INV-01.
 *
 * Laid out like the other registers (Master Data, the Procure-to-Pay lists):
 * one table under `.table-scroll`, title-case headers, the shared row rules,
 * and the always-visible pager. Paged here, in the browser, because the whole
 * list has already arrived.
 *
 * Items start open after a search, or when only one item is listed — either
 * way the person is looking for batches, not totals.
 */
export function StockGroups({
  groups,
  expandAll = false,
}: {
  groups: readonly StockItemGroup[];
  expandAll?: boolean;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);

  const pageCount = Math.max(Math.ceil(groups.length / pageSize), 1);
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  const visible = groups.slice(start, start + pageSize);
  const openAll = expandAll || groups.length === 1;

  return (
    <>
      <div className="table-scroll overflow-x-auto">
        <table className="w-full min-w-[64rem] text-left text-sm">
          <thead>
            <tr>
              {COLUMNS.map((column, index) => (
                <th
                  key={index}
                  scope="col"
                  className={`${HEAD} ${'className' in column ? column.className : ''}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((group) => (
              <StockGroupRows key={group.item.id} group={group} defaultOpen={openAll} />
            ))}
          </tbody>
        </table>
      </div>

      <ListPager
        page={current}
        pageCount={pageCount}
        pageSize={pageSize}
        first={groups.length === 0 ? 0 : start + 1}
        last={start + visible.length}
        total={groups.length}
        noun="items"
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

function StockGroupRows({ group, defaultOpen }: { group: StockItemGroup; defaultOpen: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const { item } = group;
  const soonest = group.batches.find((batch) => batch.expiryDate);
  const toggle = () => setIsOpen(!isOpen);

  return (
    <>
      <tr onClick={toggle} className="cursor-pointer">
        <td className="px-2 py-3">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              toggle();
            }}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Hide' : 'Show'} batches of ${item.name}`}
            className="rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`}
            >
              <path d="M7.5 5 12.5 10 7.5 15" />
            </svg>
          </button>
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="font-mono text-[13px] text-slate-900">
            <Code>{item.code}</Code>
          </span>
        </td>
        <td className="px-4 py-3 font-medium text-slate-900">
          <Name>{item.name}</Name>
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset ${
              TYPE_TONE[item.type] ?? 'bg-slate-100 text-slate-700 ring-slate-200'
            }`}
          >
            {ITEM_TYPE_LABELS[item.type as ItemType] ?? item.type}
          </span>
        </td>
        <td className="px-4 py-3 text-slate-700 tabular-nums">{group.batches.length}</td>
        <td className="cell-align-right px-4 py-3 whitespace-nowrap tabular-nums">
          <Quantity value={group.quantityAvailable} uom={item.uom} />
        </td>
        <td className="cell-align-right px-4 py-3 whitespace-nowrap tabular-nums">
          <Quantity value={group.reservedQuantity} uom={item.uom} />
        </td>
        <td className="cell-align-right px-4 py-3 whitespace-nowrap tabular-nums">
          <Quantity value={group.freeQuantity} uom={item.uom} />
        </td>
        <td className="px-4 py-3 whitespace-nowrap text-slate-700">
          <DateText value={soonest?.expiryDate ?? null} />
        </td>
      </tr>

      {isOpen && (
        <tr>
          <td colSpan={COLUMNS.length} className="bg-slate-50/60 px-5 py-4">
            <BatchTable batches={group.batches} uom={item.uom} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * One item's batches.
 *
 * `position: static` on its header cells: `.table-scroll thead th` pins every
 * header inside a scrolling table, this nested one included, and a pinned
 * header inside a row would float over the rows above it.
 */
function BatchTable({ batches, uom }: { batches: readonly StockBatchRow[]; uom: string }) {
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const nested = `${HEAD} border-b border-slate-200 bg-transparent`;

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            {['Batch', 'Mfg Date', 'Expiry', 'Available', 'Status', 'Reservation', 'History'].map(
              (label) => (
                <th
                  key={label}
                  scope="col"
                  style={{ position: 'static' }}
                  className={`${nested} ${label === 'Available' ? 'cell-align-right' : ''}`}
                >
                  {label === 'History' ? <span className="sr-only">History</span> : label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {batches.map((batch) => (
            <Fragment key={batch.id}>
              <BatchRow
                batch={batch}
                uom={uom}
                showingHistory={historyOf === batch.id}
                onHistory={() => setHistoryOf(historyOf === batch.id ? null : batch.id)}
              />
              {historyOf === batch.id && (
                <tr>
                  <td colSpan={7} className="bg-slate-50 px-4 pt-2 pb-3">
                    <BatchHistory batch={batch} uom={uom} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BatchRow({
  batch,
  uom,
  showingHistory,
  onHistory,
}: {
  batch: StockBatchRow;
  uom: string;
  showingHistory: boolean;
  onHistory: () => void;
}) {
  const expired = batch.daysToExpiry !== null && batch.daysToExpiry < 0;

  return (
    <tr className={expired ? 'bg-red-50/60' : undefined}>
      <td className="px-4 py-2.5 align-top">
        <span className="font-mono text-[13px] font-medium text-slate-900">
          <Code>{batch.batchNumber}</Code>
        </span>
        {batch.vendorBatchNumber && batch.vendorBatchNumber !== batch.batchNumber && (
          <span className="block font-mono text-[11px] text-slate-500">
            Vendor <Code>{batch.vendorBatchNumber}</Code>
          </span>
        )}
        {batch.principalOwned && (
          <span className="mt-1 block">
            <Pill tone="muted">Principal-owned</Pill>
          </span>
        )}
      </td>

      <td className="px-4 py-2.5 align-top whitespace-nowrap text-slate-700">
        <DateText value={batch.manufacturingDate} />
      </td>

      <td className="px-4 py-2.5 align-top whitespace-nowrap text-slate-700">
        <DateText value={batch.expiryDate} />
        <ExpiryNote days={batch.daysToExpiry} />
      </td>

      <td className="cell-align-right px-4 py-2.5 align-top whitespace-nowrap tabular-nums">
        <Quantity value={batch.quantityAvailable} uom={uom} />
      </td>

      <td className="px-4 py-2.5 align-top">
        <Pill tone={STATUS_TONE[batch.status]}>{STOCK_BATCH_STATUS_LABELS[batch.status]}</Pill>
      </td>

      <td className="px-4 py-2.5 align-top">
        <Pill tone={RESERVATION_TONE[batch.reservationState]}>
          {RESERVATION_STATE_LABELS[batch.reservationState]}
        </Pill>

        {batch.reservations.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs">
            {batch.reservations.map((reservation) => (
              <li key={reservation.orderId} className="whitespace-nowrap">
                <RecordLink href={orderHref(reservation)}>
                  <span className="font-mono">
                    <Code>{reservation.orderNumber}</Code>
                  </span>
                </RecordLink>{' '}
                <span className="text-slate-600">
                  <Quantity value={reservation.quantity} uom={uom} />
                </span>
              </li>
            ))}
            {batch.reservationState === 'PARTIALLY_RESERVED' && (
              <li className="text-slate-500">
                Free <Quantity value={batch.freeQuantity} uom={uom} />
              </li>
            )}
          </ul>
        )}
      </td>

      <td className="px-4 py-2.5 align-top">
        <button
          type="button"
          onClick={onHistory}
          aria-expanded={showingHistory}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-slate-700 transition hover:bg-slate-50"
        >
          {showingHistory ? 'Hide history' : 'History'}
        </button>
      </td>
    </tr>
  );
}

/**
 * Every movement behind this batch's quantity, oldest first.
 *
 * Loaded on demand rather than with the list: it reads several tables per
 * batch, and most batches on a screen are never opened.
 */
function BatchHistory({ batch, uom }: { batch: StockBatchRow; uom: string }) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ok'; rows: StockMovement[] }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void fetchBatchMovementsAction(batch.source, batch.id).then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { status: 'ok', rows: result.data }
          : { status: 'error', message: result.error },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [batch.source, batch.id]);

  if (state.status === 'loading') {
    return <p className="py-2 text-xs text-slate-500">Loading history…</p>;
  }

  if (state.status === 'error') {
    return (
      <p role="alert" className="py-2 text-xs text-red-700">
        Could not load history: {state.message}
      </p>
    );
  }

  if (state.rows.length === 0) {
    return <p className="py-2 text-xs text-slate-500">No recorded movements for this batch.</p>;
  }

  const head = 'px-3 py-1.5 text-[11px] font-semibold tracking-wide text-slate-500';

  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="border-b border-slate-200">
          {['Date', 'Movement', 'Reference', 'Stock', 'Quantity'].map((label) => (
            <th
              key={label}
              scope="col"
              style={{ position: 'static' }}
              className={`${head} bg-transparent ${label === 'Quantity' ? 'cell-align-right' : ''}`}
            >
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {state.rows.map((row) => {
          const out = row.quantity.startsWith('-');

          return (
            <tr key={row.id}>
              <td className="px-3 py-1.5 whitespace-nowrap text-slate-600 tabular-nums">
                {row.date.slice(0, 10)}
              </td>
              <td className="px-3 py-1.5 text-slate-800">
                {row.label}
                {row.notes && <span className="block text-[11px] text-slate-500">{row.notes}</span>}
              </td>
              <td className="px-3 py-1.5 font-mono whitespace-nowrap text-slate-700">
                {row.reference ? (
                  <Code>{row.reference}</Code>
                ) : (
                  <span className="text-slate-300">—</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-slate-600">
                {STOCK_MOVEMENT_BUCKET_LABELS[row.bucket]}
              </td>
              <td
                className={`cell-align-right px-3 py-1.5 whitespace-nowrap tabular-nums ${
                  out ? 'text-red-700' : 'text-green-800'
                }`}
              >
                {out ? '' : '+'}
                <Quantity value={row.quantity} uom={uom} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ExpiryNote({ days }: { days: number | null }) {
  if (days === null) return null;

  const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

  if (days < 0) {
    return (
      <span className="block text-[11px] font-medium text-red-700">
        Expired {plural(-days)} ago
      </span>
    );
  }

  return (
    <span
      className={`block text-[11px] ${days <= 30 ? 'font-medium text-amber-800' : 'text-slate-500'}`}
    >
      {days === 0 ? 'Expires today' : `in ${plural(days)}`}
    </span>
  );
}
