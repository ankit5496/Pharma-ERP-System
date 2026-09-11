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
import type { PartyStatus } from './parties';


// ---------------------------------------------------------------------------
// Enumerations — mirrored from the Prisma schema
// ---------------------------------------------------------------------------

export const ITEM_TYPES = ['RAW_MATERIAL', 'PACKING_MATERIAL', 'SEMI_FINISHED', 'FINISHED_GOOD'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/**
 * Unit of measure is FREE TEXT on the shared item master, not an enum.
 *
 * Looser than this module would have chosen — "kg" and "Kg" can both be
 * stored — but the shared schema is authoritative and a column other teams
 * write to is not the place to unilaterally tighten a type. These are the
 * conventional values, offered as suggestions in the UI rather than enforced.
 */
export const COMMON_UNITS = ['kg', 'g', 'mg', 'L', 'mL', 'nos', 'pack'] as const;

/** Drugs and Cosmetics Rules schedule. H1 obliges a separate supply register. */
export const SCHEDULE_CLASSIFICATIONS = ['NONE', 'H', 'H1', 'X', 'G'] as const;
export type ScheduleClassification = (typeof SCHEDULE_CLASSIFICATIONS)[number];

export const SCHEDULE_LABELS: Record<ScheduleClassification, string> = {
  NONE: 'Not scheduled',
  H: 'Schedule H',
  H1: 'Schedule H1',
  X: 'Schedule X',
  G: 'Schedule G',
};

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  RAW_MATERIAL: 'Raw material',
  PACKING_MATERIAL: 'Packing material',
  SEMI_FINISHED: 'Semi-finished',
  FINISHED_GOOD: 'Finished good',
};

export const PARTY_TYPES = ['VENDOR', 'CUSTOMER', 'JOB_WORK_PRINCIPAL'] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const REQUISITION_STATUSES = [
  'OPEN',
  'APPROVED',
  'CONVERTED_TO_PO',
  'CANCELLED',
] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

/** Why a requisition exists: raised by the reorder check, or by a person. */
export const REQUISITION_TRIGGER_TYPES = ['AUTO_REORDER', 'MANUAL'] as const;
export type RequisitionTriggerType = (typeof REQUISITION_TRIGGER_TYPES)[number];

export const REQUISITION_TRIGGER_LABELS: Record<RequisitionTriggerType, string> = {
  AUTO_REORDER: 'Auto-reorder',
  MANUAL: 'Manual',
};

export const PRODUCTION_PLAN_STATUSES = [
  'DRAFT',
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type ProductionPlanStatus = (typeof PRODUCTION_PLAN_STATUSES)[number];


export const PURCHASE_ORDER_STATUSES = ['OPEN', 'PARTIALLY_RECEIVED', 'CLOSED', 'CANCELLED'] as const;
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

export const PURCHASE_INVOICE_STATUSES = ['BOOKED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as const;
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
  OPEN: 'Open',
  APPROVED: 'Approved',
  CONVERTED_TO_PO: 'Converted to PO',
  CANCELLED: 'Cancelled',
};

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  OPEN: 'Open',
  PARTIALLY_RECEIVED: 'Partially received',
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
  BOOKED: 'Booked',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
};

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

/**
 * The item master as every Procure-to-Pay screen sees it.
 *
 * Mirrors the shared `items` table field for field — that table is owned by
 * the master-data work, not by this module, so this contract follows it rather
 * than the other way round. Note what is NOT here: no batch-tracking flag (it
 * is derived from `type`) and no tax-rate reference, because `gstRate` sits on
 * the item itself. The item master IS the tax master.
 */
export interface ItemSummary {
  id: string;
  code: string;
  name: string;
  type: ItemType;
  /** Free text on the shared schema. */
  uom: string;
  shelfLifeMonths: number | null;
  hsnCode: string | null;
  brandName: string | null;
  genericName: string | null;
  scheduleClassification: ScheduleClassification;
  /** GST percentage. Null means no rate is configured and it cannot be invoiced. */
  gstRate: string | null;
  mrp: string | null;
  dpcoCeiling: boolean;
  storageConditions: string | null;
  /** Null means no reorder policy is configured — different from a level of zero. */
  reorderLevel: string | null;
  reorderQuantity: string | null;
  /**
   * Stored on the item, not derived. Defaults true and no form exposes it,
   * so every material entering the plant is traceable to a vendor lot —
   * but a genuine exception now has somewhere to live. See
   * 20260911160000_item_batch_tracking_and_notes.
   */
  requiresBatchTracking: boolean;
  notes: string | null;
}

/** One component a formulation consumes, per unit of output. */
export interface BomLineItem {
  id: string;
  item: ItemSummary;
  quantityPer: string;
  notes: string | null;
}

/**
 * A versioned bill of material from the shared master data.
 *
 * Procure-to-Pay reads it rather than keeping its own component list: a manual
 * requisition cites a production plan, the plan cites a BOM, and "what does
 * this run consume" therefore has exactly one answer.
 */
export interface BomSummary {
  id: string;
  version: number;
  product: ItemSummary;
  outputQuantity: string;
  isActive: boolean;
  effectiveFrom: string | null;
  lines: BomLineItem[];
}

export interface PartySummary {
  id: string;
  code: string;
  name: string;
  partyType: PartyType;
  gstin: string | null;
  drugLicenceNumber: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  paymentTermsDays: number;

  /** US-MD-02: a CUSTOMER may only be ACTIVE with a licence on file. */
  status: PartyStatus;
  drugLicenceValidTo: string | null;
  creditLimit: string | null;
  creditPeriodDays: number | null;
  /** Computed by the API so every screen agrees on today. */
  licenceExpired: boolean;
}

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
  triggerType: RequisitionTriggerType;
  /** Present for MANUAL requisitions; the run the material is for. */
  productionPlan: ProductionPlanSummary | null;
  preferredVendor: { id: string; name: string } | null;
  /** Null when the system raised it — an auto-reorder has no author. */
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
  /** Defaults to the item's reorder quantity when omitted. */
  requiredQuantity?: string;
  /** Required by the API when the trigger is MANUAL. */
  productionPlanId?: string;
  preferredVendorId?: string;
  requiredByDate?: string;
  notes?: string;
}

export interface UpdateRequisitionRequest {
  requiredQuantity?: string;
  preferredVendorId?: string | null;
  requiredByDate?: string | null;
  notes?: string | null;
}

/** Result of running the reorder check. */
export interface ReorderCheckResult {
  /** Requisitions the system raised on this run. */
  created: RequisitionListItem[];
  /** Items below their level that already had one open, so were skipped. */
  skipped: { itemCode: string; itemName: string; reason: string }[];
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Production plan — the reason a MANUAL requisition exists
// ---------------------------------------------------------------------------

/**
 * A planned manufacturing run.
 *
 * The packaging detail the brief asks a requisition to carry — component,
 * level, quantity per unit, mandatory — lives on `components` here rather than
 * being copied onto every requisition raised against the plan. A requisition
 * points at the plan and reads them, so revising the recipe cannot leave stale
 * copies behind on documents that already exist.
 */
export interface ProductionPlanSummary {
  id: string;
  number: string;
  finishedProduct: ItemSummary;
  packVariant: string | null;
  plannedQuantity: string;
  plannedDate: string | null;
  status: ProductionPlanStatus;
  /** The formulation this run follows; its lines are the component list. */
  bom: BomSummary | null;
}

export interface CreateProductionPlanRequest {
  finishedProductId: string;
  packVariant?: string;
  plannedQuantity: string;
  plannedDate?: string;
  notes?: string;
  bomId?: string;
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
  /** Mandatory: an invoice always bills for a specific receipt. */
  goodsReceipt: { id: string; number: string };
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
  /**
   * True when a line's quantity or rate differs from the receipt / order by
   * more than the company's configured tolerance. The invoice is still
   * bookable — a genuine price revision has to be recordable — but it is
   * flagged rather than folded silently into a total.
   */
  toleranceExceeded: boolean;
  /** Which lines differed and by how much. Null when everything matched. */
  matchNotes: string | null;
  /** Payable position, computed from the payments. */
  amountPaid: string;
  outstandingAmount: string;
  paymentStatus: PaymentStatus;
  createdAt: string;
}

/**
 * One invoice line as the client submits it.
 *
 * THERE IS NO TAX FIELD, deliberately. GST is read from the item's tax master
 * entry, never accepted from the caller — a rate typed per document is
 * eventually typed wrong on one of them, and an incorrect input-tax claim is a
 * filing problem rather than a rounding one.
 */
export interface CreatePurchaseInvoiceLineRequest {
  itemId: string;
  quantity: string;
  rate: string;
}

export interface CreatePurchaseInvoiceRequest {
  /** Mandatory. The order is derived from the receipt. */
  goodsReceiptId: string;
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
// Outstanding payables report
// ---------------------------------------------------------------------------

/**
 * Ageing buckets, by days past the due date.
 *
 * Measured from the DUE date, not the invoice date. Ageing a payable from
 * when it was raised would call a 60-day-terms invoice "60 days old" on the
 * day it falls due, which tells the person paying bills nothing about whether
 * they are late.
 */
export const AGEING_BUCKETS = ['NOT_DUE', 'DUE_0_30', 'DUE_31_60', 'DUE_61_90', 'DUE_90_PLUS'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

export const AGEING_BUCKET_LABELS: Record<AgeingBucket, string> = {
  NOT_DUE: 'Not yet due',
  DUE_0_30: 'Overdue 1–30 days',
  DUE_31_60: 'Overdue 31–60 days',
  DUE_61_90: 'Overdue 61–90 days',
  DUE_90_PLUS: 'Overdue 90+ days',
};

/** One vendor's outstanding position, broken into ageing buckets. */
export interface VendorAgeingRow {
  vendor: { id: string; name: string; code: string };
  totalOutstanding: string;
  buckets: Record<AgeingBucket, string>;
  invoiceCount: number;
  /** The single oldest overdue invoice, for a place to start. */
  oldestOverdueDays: number;
}

export interface PayablesReport {
  rows: VendorAgeingRow[];
  totals: {
    totalOutstanding: string;
    buckets: Record<AgeingBucket, string>;
    invoiceCount: number;
  };
  generatedAt: string;
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
  productionPlans: '/workflows/procure-to-pay/requisitions?view=plans',
} as const;
