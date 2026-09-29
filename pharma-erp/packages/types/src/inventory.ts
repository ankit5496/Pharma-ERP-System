/**
 * Wire types for the Stock enquiry screen — US-INV-01.
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
 * order (net of dispatch), or a job-work principal's material received against
 * one job-work order. Company-owned raw and packing material has no such link
 * today, so it is Free here — see US-INV-06 for tagging it at receipt.
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
 * `SALES_ORDER` comes from Order-to-Cash allocation, net of dispatch.
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
