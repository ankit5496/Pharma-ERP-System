/**
 * Wire types for the Stock enquiry screen — US-INV-01 — and the near-expiry
 * report built on it — US-INV-03.
 *
 * One screen for everything physically held: raw and packing material
 * (`StockLot`) and released finished goods (`FinishedGoodsLot`), grouped by
 * item and drillable to batch.
 *
 * NOTHING HERE IS STORED. Every figure is read live from the rows goods
 * receipt, QC, material issue, batch release and dispatch already maintain.
 *
 * RESERVATION IS READ, NOT DECIDED. A batch counts as reserved only where the
 * data already ties it to an order: Order-to-Cash allocation against a sales
 * order (net of dispatch), raw or packing material held at incoming QC for the
 * sales order it was bought for (`stock_reservations`), or a job-work
 * principal's material received against one job-work order. Anything else is
 * Free.
 *
 * Quantities are decimal strings, as everywhere else in the API.
 */

export const STOCK_BATCH_STATUSES = ['USABLE', 'QUARANTINE', 'ON_HOLD', 'RELEASED'] as const;
export type StockBatchStatus = (typeof STOCK_BATCH_STATUSES)[number];

export const STOCK_BATCH_STATUS_LABELS: Record<StockBatchStatus, string> = {
  USABLE: 'Usable',
  QUARANTINE: 'Quarantine',
  ON_HOLD: 'On Hold',
  RELEASED: 'Released',
};

export const RESERVATION_STATES = ['RESERVED', 'PARTIALLY_RESERVED', 'FREE'] as const;
export type ReservationState = (typeof RESERVATION_STATES)[number];

export const RESERVATION_STATE_LABELS: Record<ReservationState, string> = {
  RESERVED: 'Reserved',
  PARTIALLY_RESERVED: 'Partially Reserved',
  FREE: 'Free',
};

/** The choices the "Expiring within" filter offers, in days. */
export const EXPIRING_WITHIN_OPTIONS = [30, 60, 90, 180] as const;

/**
 * What a batch is held for.
 *
 * `SALES_ORDER` comes from Order-to-Cash allocation, net of dispatch, or —
 * for raw and packing material — from a live hold set at incoming QC.
 * `JOB_WORK_ORDER` is a principal's own material, received against one
 * job-work order and usable only for it.
 */
export type StockReservationKind = 'SALES_ORDER' | 'JOB_WORK_ORDER';

/** One order holding part or all of a batch. */
export interface StockReservation {
  kind: StockReservationKind;
  orderId: string;
  orderNumber: string;
  quantity: string;
}

export interface StockBatchRow {
  id: string;
  /** `MATERIAL` is a raw/packing lot; `FINISHED_GOOD` is a released batch. */
  source: 'MATERIAL' | 'FINISHED_GOOD';
  batchNumber: string;
  /** The supplier's own batch number, for received material. */
  vendorBatchNumber: string | null;
  /** YYYY-MM-DD. Optional on received material, always set on a made batch. */
  manufacturingDate: string | null;
  /** YYYY-MM-DD, or null where the supplier gave none. */
  expiryDate: string | null;
  /** Negative once expired; null with no expiry date. */
  daysToExpiry: number | null;
  status: StockBatchStatus;
  /** A job-work principal's material held here is not the company's own stock. */
  principalOwned: boolean;
  quantityAvailable: string;
  reservedQuantity: string;
  freeQuantity: string;
  reservationState: ReservationState;
  reservations: StockReservation[];
}

export interface StockItemGroup {
  item: { id: string; code: string; name: string; type: string; uom: string };
  quantityAvailable: string;
  reservedQuantity: string;
  freeQuantity: string;
  /** Soonest expiry first; batches without an expiry date last. */
  batches: StockBatchRow[];
}

export interface StockEnquiry {
  groups: StockItemGroup[];
}

/** Which balance a movement changed. */
export type StockMovementBucket = 'QUARANTINE' | 'USABLE' | 'FINISHED';

export const STOCK_MOVEMENT_BUCKET_LABELS: Record<StockMovementBucket, string> = {
  QUARANTINE: 'Quarantine',
  USABLE: 'Usable',
  FINISHED: 'Finished stock',
};

/**
 * One movement behind a batch's quantity — the batch's ledger.
 *
 * Assembled from the records each transaction already writes: the stock ledger
 * for receipts, QC and adjustments; material issue lines; and, for finished
 * goods, the release, dispatches, sales returns and job-work dispatches.
 */
export interface StockMovement {
  id: string;
  /** ISO timestamp, or YYYY-MM-DD where the source records only a date. */
  date: string;
  label: string;
  /** The document behind it, e.g. "GRN-2026-0004" or "DSP-0012 · SO-2026-0001". */
  reference: string | null;
  /** Signed: positive into stock, negative out. */
  quantity: string;
  bucket: StockMovementBucket;
  notes: string | null;
}

// -----------------------------------------------------------------------------
// Near-expiry report — US-INV-03
// -----------------------------------------------------------------------------

/** The windows a company starts with, in days. Configurable per company. */
export const DEFAULT_EXPIRY_ALERT_DAYS = [90, 60, 30] as const;

/** Mirrors `tenants_expiry_alert_days_sane`, so the API refuses in words first. */
export const MAX_EXPIRY_ALERT_WINDOWS = 5;
export const MIN_EXPIRY_ALERT_DAYS = 1;
export const MAX_EXPIRY_ALERT_DAYS = 730;

/** `EXPIRED`, or `WITHIN_<n>` for the window ending at n days. */
export type ExpiryBucketKey = 'EXPIRED' | `WITHIN_${number}`;

export interface ExpiryBucket {
  key: ExpiryBucketKey;
  /** e.g. "Expired", "0–30 days", "31–60 days". */
  label: string;
  /** Inclusive day range; both null for EXPIRED (below zero). */
  fromDays: number | null;
  toDays: number | null;
  /** Batches in this bucket after the item and batch filters, before the bucket filter. */
  batchCount: number;
}

/** A batch the report flags: a stock row plus the item and the bucket it falls in. */
export interface NearExpiryRow extends StockBatchRow {
  item: StockItemGroup['item'];
  bucket: ExpiryBucketKey;
}

export interface NearExpiryReport {
  /** The company's windows, smallest first. */
  alertDays: number[];
  /** Expired first, then each window in order. */
  buckets: ExpiryBucket[];
  /** Soonest expiry first. */
  rows: NearExpiryRow[];
}

/** Filters the API accepts on `GET /inventory/near-expiry`. All optional. */
export interface NearExpiryQuery {
  itemId?: string;
  /** A batch number (own or supplier's), or an item name or code. */
  search?: string;
  bucket?: string;
}

/**
 * The buckets a set of windows makes, expired first.
 *
 * [90, 60, 30] gives Expired, 0–30, 31–60, 61–90. Shared so the API, the
 * dashboard and the page all cut the same lines.
 */
export function expiryBuckets(alertDays: readonly number[]): Omit<ExpiryBucket, 'batchCount'>[] {
  const windows = [...new Set(alertDays)].sort((a, b) => a - b);
  const buckets: Omit<ExpiryBucket, 'batchCount'>[] = [
    { key: 'EXPIRED', label: 'Expired', fromDays: null, toDays: null },
  ];

  windows.forEach((days, index) => {
    const from = index === 0 ? 0 : windows[index - 1]! + 1;
    buckets.push({
      key: `WITHIN_${days}`,
      label: `${from}–${days} days`,
      fromDays: from,
      toDays: days,
    });
  });

  return buckets;
}

/** The bucket a batch with this many days left falls in, or null beyond the widest window. */
export function expiryBucketFor(
  daysToExpiry: number,
  alertDays: readonly number[],
): ExpiryBucketKey | null {
  if (daysToExpiry < 0) return 'EXPIRED';

  const window = [...alertDays].sort((a, b) => a - b).find((days) => daysToExpiry <= days);

  return window === undefined ? null : `WITHIN_${window}`;
}

/** Filters the API accepts on `GET /inventory/stock`. All optional. */
export interface StockEnquiryQuery {
  /** Item name or code, or a batch number. */
  search?: string;
  itemId?: string;
  itemType?: string;
  status?: StockBatchStatus;
  reservation?: ReservationState;
  /** Batches expiring within this many days, including already-expired ones. */
  expiringWithin?: number;
}
