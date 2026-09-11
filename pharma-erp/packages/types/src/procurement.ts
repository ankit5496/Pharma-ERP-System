/**
 * Procure-to-Pay contracts, shared by the API and the web app.
 *
 * MONEY AND QUANTITIES CROSS THE WIRE AS STRINGS. Prisma returns Decimal, and
 * `JSON.stringify` on a JS number would quietly round 1234567.89 differently
 * than the database stores it. A string survives the trip byte for byte; the
 * UI formats it for display and never does arithmetic on it. Anything named
 * `...Amount`, `quantity...`, `rate`, `stock` or `shortfall` is one of these.
 *
 * Dates cross as ISO 8601 strings, as everywhere else in this codebase.
 */

// ---------------------------------------------------------------------------
// Enumerations — mirrored from the Prisma schema
// ---------------------------------------------------------------------------

// ITEM_TYPES, ItemType, ItemSummary, PARTY_TYPES, PartyType and PartySummary
// used to be declared here as well. They are now owned by ./production and
// ./parties, which is where the master-data screens maintain them and — more
// to the point — which is what the live `items` and `parties` tables actually
// match. Two declarations of each meant two shapes for one table, and the one
// here described columns the database never had: `item_type` rather than
// `type`, PACKAGING rather than PACKING_MATERIAL, and a UnitOfMeasure enum
// that was never created.
//
// Imported for the shapes below, and NOT re-exported: the package index
// already exports ./production and ./parties, so ItemType, ITEM_TYPES,
// PartySummary and the rest reach consumers of `@pharma-erp/types` from
// there. Re-exporting here would give one name two ways out of the package.
import type { PartySummary } from './parties';
import type { ItemSummary } from './production';

/** The item categories a purchase can be raised for. Finished goods are made. */
export const PROCURABLE_ITEM_TYPES = ['RAW_MATERIAL', 'PACKING_MATERIAL'] as const;

export const UNITS_OF_MEASURE = ['KG', 'G', 'MG', 'L', 'ML', 'NOS', 'PACK'] as const;
export type UnitOfMeasure = (typeof UNITS_OF_MEASURE)[number];

export const REQUISITION_STATUSES = [
  'DRAFT',
  'PENDING',
  'APPROVED',
  'CONVERTED_TO_PO',
  'CANCELLED',
] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

export const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_RECEIVED',
  'FULLY_RECEIVED',
  'CLOSED',
  'CANCELLED',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const QC_DECISIONS = ['ACCEPTED', 'REJECTED', 'ON_HOLD'] as const;
export type QcDecision = (typeof QC_DECISIONS)[number];

export const STOCK_LOT_STATUSES = [
  'QUARANTINE',
  'USABLE',
  'REJECTED',
  'ON_HOLD',
  'CONSUMED',
] as const;
export type StockLotStatus = (typeof STOCK_LOT_STATUSES)[number];

export const PURCHASE_INVOICE_STATUSES = ['DRAFT', 'APPROVED', 'CANCELLED'] as const;
export type PurchaseInvoiceStatus = (typeof PURCHASE_INVOICE_STATUSES)[number];

/**
 * Payment standing of an invoice.
 *
 * OVERDUE is DERIVED, never stored: it is "unpaid and past its due date", and
 * a stored flag would be wrong every midnight until something rewrote it. The
 * API computes it per request.
 */
export const PAYMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Display labels
// ---------------------------------------------------------------------------

export const REQUISITION_STATUS_LABELS: Record<RequisitionStatus, string> = {
  DRAFT: 'Draft',
  PENDING: 'Pending approval',
  APPROVED: 'Approved',
  CONVERTED_TO_PO: 'Converted to PO',
  CANCELLED: 'Cancelled',
};

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PARTIALLY_RECEIVED: 'Partially received',
  FULLY_RECEIVED: 'Fully received',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export const STOCK_LOT_STATUS_LABELS: Record<StockLotStatus, string> = {
  QUARANTINE: 'Quarantine — QC pending',
  USABLE: 'Usable',
  REJECTED: 'Rejected',
  ON_HOLD: 'On hold',
  CONSUMED: 'Consumed',
};

export const QC_DECISION_LABELS: Record<QcDecision, string> = {
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  ON_HOLD: 'On hold',
};

export const PURCHASE_INVOICE_STATUS_LABELS: Record<PurchaseInvoiceStatus, string> = {
  DRAFT: 'Draft',
  APPROVED: 'Approved',
  CANCELLED: 'Cancelled',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
};

/**
 * A unit rendered for display.
 *
 * An item's `uom` is free text, not the UnitOfMeasure enum — deliberately, per
 * the Item model: the set of units is long, varies by company, and a wrong
 * guess would block someone from recording work. So a known code gets its
 * label and anything else is shown as entered, which is better than a blank
 * cell where a unit should be.
 */
export function unitLabel(uom: string): string {
  return (UNIT_LABELS as Record<string, string | undefined>)[uom] ?? uom;
}

export const UNIT_LABELS: Record<UnitOfMeasure, string> = {
  KG: 'kg',
  G: 'g',
  MG: 'mg',
  L: 'L',
  ML: 'mL',
  NOS: 'nos',
  PACK: 'pack',
};

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------



/**
 * An item whose usable stock has fallen below its reorder level.
 *
 * `availableStock` counts USABLE lots only. Material sitting in quarantine or
 * rejected is deliberately excluded: it cannot be used in production, so
 * counting it would suppress a requisition that genuinely needs raising.
 */
export interface LowStockItem {
  item: ItemSummary;
  availableStock: string;
  quarantineStock: string;
  shortfall: string;
  /** True when a requisition for this item is already open, to avoid duplicates. */
  hasOpenRequisition: boolean;
}

// ---------------------------------------------------------------------------
// 1. Purchase requisition
// ---------------------------------------------------------------------------

export interface RequisitionListItem {
  id: string;
  number: string;
  item: ItemSummary;
  stockAtRequest: string;
  reorderLevelAtRequest: string;
  /** `reorderLevelAtRequest - stockAtRequest`, floored at zero. */
  shortfallAtRequest: string;
  requiredQuantity: string;
  preferredVendor: { id: string; name: string } | null;
  requestedBy: string | null;
  approvedBy: string | null;
  requestDate: string;
  requiredByDate: string | null;
  status: RequisitionStatus;
  notes: string | null;
  /** Purchase orders raised from this requisition, for navigation. */
  linkedPurchaseOrders: { id: string; number: string; status: PurchaseOrderStatus }[];
  createdAt: string;
}

export interface CreateRequisitionRequest {
  itemId: string;
  requiredQuantity: string;
  preferredVendorId?: string;
  requiredByDate?: string;
  notes?: string;
  /** Save as a draft rather than submitting for approval. */
  asDraft?: boolean;
}

export interface UpdateRequisitionRequest {
  requiredQuantity?: string;
  preferredVendorId?: string | null;
  requiredByDate?: string | null;
  notes?: string | null;
}

// ---------------------------------------------------------------------------
// 2. Purchase order
// ---------------------------------------------------------------------------

export interface PurchaseOrderLineItem {
  id: string;
  item: ItemSummary;
  requisition: { id: string; number: string } | null;
  quantity: string;
  rate: string;
  taxRatePercent: string;
  taxableAmount: string;
  taxAmount: string;
  totalAmount: string;
  quantityReceived: string;
  /** `quantity - quantityReceived`, floored at zero. */
  quantityPending: string;
}

export interface PurchaseOrderListItem {
  id: string;
  number: string;
  vendor: PartySummary;
  poDate: string;
  expectedDeliveryDate: string | null;
  paymentTermsDays: number;
  status: PurchaseOrderStatus;
  taxableAmount: string;
  taxAmount: string;
  totalAmount: string;
  createdBy: string | null;
  issuedAt: string | null;
  notes: string | null;
  lines: PurchaseOrderLineItem[];
  /** Receipts booked against this order. */
  goodsReceipts: { id: string; number: string; receiptDate: string }[];
  invoices: { id: string; number: string; vendorInvoiceNumber: string }[];
  createdAt: string;
}

export interface CreatePurchaseOrderLineRequest {
  itemId: string;
  requisitionId?: string;
  quantity: string;
  rate: string;
  taxRatePercent: string;
}

export interface CreatePurchaseOrderRequest {
  vendorId: string;
  expectedDeliveryDate?: string;
  paymentTermsDays?: number;
  notes?: string;
  lines: CreatePurchaseOrderLineRequest[];
}

/** Body of the convert-requisition-to-PO action. */
export interface ConvertRequisitionRequest {
  vendorId: string;
  rate: string;
  taxRatePercent: string;
  expectedDeliveryDate?: string;
  paymentTermsDays?: number;
}

// ---------------------------------------------------------------------------
// 3. Goods receipt
// ---------------------------------------------------------------------------

export interface GoodsReceiptLineItem {
  id: string;
  item: ItemSummary;
  purchaseOrderLineId: string;
  vendorBatchNumber: string | null;
  manufacturingDate: string | null;
  expiryDate: string | null;
  quantityOrdered: string;
  quantityReceived: string;
  quantityRejected: string;
  /** What went into quarantine: received minus rejected-at-gate. */
  quantityAccepted: string;
  storageLocation: string | null;
  remarks: string | null;
  /** The batch this line created, and where QC has got to with it. */
  lot: StockLotSummary | null;
}

export interface GoodsReceiptListItem {
  id: string;
  number: string;
  purchaseOrder: { id: string; number: string; status: PurchaseOrderStatus };
  vendor: PartySummary;
  receiptDate: string;
  vendorDocumentNumber: string | null;
  receivedBy: string | null;
  remarks: string | null;
  lines: GoodsReceiptLineItem[];
  /** Rolled up from the lots, so a list row can show QC progress. */
  qcPendingCount: number;
  qcAcceptedCount: number;
  qcRejectedCount: number;
  invoices: { id: string; number: string; vendorInvoiceNumber: string }[];
  createdAt: string;
}

export interface CreateGoodsReceiptLineRequest {
  purchaseOrderLineId: string;
  quantityReceived: string;
  quantityRejected?: string;
  vendorBatchNumber?: string;
  manufacturingDate?: string;
  expiryDate?: string;
  storageLocation?: string;
  remarks?: string;
}

export interface CreateGoodsReceiptRequest {
  purchaseOrderId: string;
  receiptDate?: string;
  vendorDocumentNumber?: string;
  remarks?: string;
  lines: CreateGoodsReceiptLineRequest[];
}

// ---------------------------------------------------------------------------
// 4. Stock lots and incoming QC
// ---------------------------------------------------------------------------

export interface StockLotSummary {
  id: string;
  lotNumber: string;
  vendorBatchNumber: string | null;
  manufacturingDate: string | null;
  expiryDate: string | null;
  quantityReceived: string;
  quantityAvailable: string;
  status: StockLotStatus;
  storageLocation: string | null;
}

export interface QcResultItem {
  id: string;
  decision: QcDecision;
  testReference: string | null;
  remarks: string | null;
  inspectedBy: string | null;
  inspectedAt: string;
}

/** A lot as the Incoming QC screen sees it, with its whole provenance. */
export interface QcQueueItem {
  lot: StockLotSummary;
  item: ItemSummary;
  vendor: { id: string; name: string };
  goodsReceipt: { id: string; number: string; receiptDate: string };
  purchaseOrder: { id: string; number: string };
  /** Newest first. Empty until the first decision is recorded. */
  history: QcResultItem[];
  /** Days until expiry, negative when already expired. Null when no expiry. */
  daysToExpiry: number | null;
}

export interface RecordQcDecisionRequest {
  decision: QcDecision;
  testReference?: string;
  remarks?: string;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

/** Usable stock of one item, broken down by lot in FEFO order. */
export interface ItemStockPosition {
  item: ItemSummary;
  availableStock: string;
  quarantineStock: string;
  rejectedStock: string;
  onHoldStock: string;
  belowReorderLevel: boolean;
  /** USABLE lots, earliest expiry first — the order production must pick in. */
  fefoLots: StockLotSummary[];
}

export interface StockLedgerRow {
  id: string;
  itemCode: string;
  itemName: string;
  lotNumber: string | null;
  entryType: string;
  quantityDelta: string;
  affectsUsableStock: boolean;
  reference: string | null;
  notes: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 5. Purchase invoice
// ---------------------------------------------------------------------------

export interface PurchaseInvoiceLineItem {
  id: string;
  item: ItemSummary;
  quantity: string;
  rate: string;
  taxRatePercent: string;
  taxableAmount: string;
  taxAmount: string;
  totalAmount: string;
}

export interface PurchaseInvoiceListItem {
  id: string;
  number: string;
  vendorInvoiceNumber: string;
  vendor: PartySummary;
  purchaseOrder: { id: string; number: string };
  goodsReceipt: { id: string; number: string } | null;
  invoiceDate: string;
  dueDate: string;
  paymentTermsDays: number;
  taxableAmount: string;
  taxAmount: string;
  totalAmount: string;
  status: PurchaseInvoiceStatus;
  notes: string | null;
  recordedBy: string | null;
  lines: PurchaseInvoiceLineItem[];
  /** Payable position, computed from the payments. */
  amountPaid: string;
  outstandingAmount: string;
  paymentStatus: PaymentStatus;
  createdAt: string;
}

export interface CreatePurchaseInvoiceLineRequest {
  itemId: string;
  quantity: string;
  rate: string;
  taxRatePercent: string;
}

export interface CreatePurchaseInvoiceRequest {
  purchaseOrderId: string;
  goodsReceiptId?: string;
  vendorInvoiceNumber: string;
  invoiceDate: string;
  paymentTermsDays?: number;
  notes?: string;
  lines: CreatePurchaseInvoiceLineRequest[];
}

// ---------------------------------------------------------------------------
// 6. Vendor payable and payment
// ---------------------------------------------------------------------------

export interface VendorPaymentItem {
  id: string;
  number: string;
  paymentDate: string;
  amount: string;
  reference: string | null;
  method: string | null;
  notes: string | null;
  recordedBy: string | null;
}

/** One row of the vendor payables ledger: an invoice and its settlement. */
export interface VendorPayableRow {
  invoiceId: string;
  invoiceNumber: string;
  vendorInvoiceNumber: string;
  vendor: { id: string; name: string };
  purchaseOrder: { id: string; number: string };
  invoiceDate: string;
  dueDate: string;
  invoiceAmount: string;
  amountPaid: string;
  outstandingAmount: string;
  paymentStatus: PaymentStatus;
  /** Negative when overdue. */
  daysToDue: number;
  payments: VendorPaymentItem[];
}

export interface RecordPaymentRequest {
  purchaseInvoiceId: string;
  amount: string;
  paymentDate?: string;
  reference?: string;
  method?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * Counts for the cards at the top of Procure-to-Pay.
 *
 * `href` is built by the API so a card and its destination cannot disagree
 * about which filter it means — the alternative is the UI reconstructing a
 * query string that has to match what the count actually measured.
 */
export interface ProcurementSummaryCard {
  key: string;
  label: string;
  count: number;
  /** Secondary figure, e.g. a total amount outstanding. */
  detail: string | null;
  href: string;
  tone: 'neutral' | 'attention' | 'warn';
}

export interface ProcurementSummary {
  cards: ProcurementSummaryCard[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Shared list-query shape
// ---------------------------------------------------------------------------

/**
 * Filters every Procure-to-Pay list accepts.
 *
 * One shape for all six sub-tabs so the table, the filter bar and the query
 * string stay identical between them — a user who learns the Requisitions
 * filters already knows the Invoices filters.
 */
export interface ProcurementListQuery {
  /** Free text over document number, item and party name. */
  search?: string;
  status?: string;
  vendorId?: string;
  itemId?: string;
  /** ISO dates, inclusive, over the document's own primary date. */
  dateFrom?: string;
  dateTo?: string;
}

/** Routes for the Procure-to-Pay sub-tabs, shared so links cannot drift. */
export const PROCUREMENT_ROUTES = {
  requisitions: '/workflows/procure-to-pay/requisitions',
  purchaseOrders: '/workflows/procure-to-pay/purchase-orders',
  goodsReceipts: '/workflows/procure-to-pay/goods-receipts',
  incomingQc: '/workflows/procure-to-pay/incoming-qc',
  invoices: '/workflows/procure-to-pay/invoices',
  payments: '/workflows/procure-to-pay/payments',
} as const;
