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

export const ITEM_TYPES = [
  'RAW_MATERIAL',
  'PACKING_MATERIAL',
  'SEMI_FINISHED',
  'FINISHED_GOOD',
] as const;
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

export const REQUISITION_STATUSES = ['OPEN', 'APPROVED', 'CONVERTED_TO_PO', 'CANCELLED'] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

/** Why a requisition exists: raised by the reorder check, or by a person. */
export const REQUISITION_TRIGGER_TYPES = ['AUTO_REORDER', 'MANUAL'] as const;
export type RequisitionTriggerType = (typeof REQUISITION_TRIGGER_TYPES)[number];

export const REQUISITION_TRIGGER_LABELS: Record<RequisitionTriggerType, string> = {
  AUTO_REORDER: 'Auto Create',
  MANUAL: 'Manual',
};

/**
 * What each trigger means, shown on hover.
 *
 * The stored value stays `AUTO_REORDER`: renaming a database enum to change a
 * word on screen would rewrite history on every requisition ever raised, and
 * the label is a presentation concern.
 */
export const REQUISITION_TRIGGER_HINTS: Record<RequisitionTriggerType, string> = {
  AUTO_REORDER: 'Low stock is reported but raises nothing. Create requisitions on the form.',
  MANUAL: 'Raised by a person on the requisition form.',
};

/** Where a packaging component sits: blister, carton, shipper. */
export const PACKAGING_LEVELS = ['PRIMARY', 'SECONDARY', 'TERTIARY'] as const;
export type PackagingLevel = (typeof PACKAGING_LEVELS)[number];

export const PACKAGING_LEVEL_LABELS: Record<PackagingLevel, string> = {
  PRIMARY: 'Primary',
  SECONDARY: 'Secondary',
  TERTIARY: 'Tertiary',
};

export const PRODUCTION_PLAN_STATUSES = [
  'DRAFT',
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type ProductionPlanStatus = (typeof PRODUCTION_PLAN_STATUSES)[number];

export const PURCHASE_ORDER_STATUSES = [
  /** Being prepared: inert until submitted. */
  'DRAFT',
  'OPEN',
  /** Authorised to send to the vendor. The one status a person sets. */
  'APPROVED',
  'PARTIALLY_RECEIVED',
  /** Finished: fully received, or closed with a balance outstanding. */
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
  DRAFT: 'Draft',
  OPEN: 'Open',
  APPROVED: 'Approved',
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
  /**
   * How many documents are on file. A count, not the documents themselves —
   * the register renders one line per party and the bytes live in the database,
   * so listing them here would pull every customer's paperwork to draw a link.
   */
  documentCount: number;
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
  /**
   * True when material is already on order and has not arrived.
   *
   * Separate from the flag above because a requisition STOPS being open the
   * moment it becomes a purchase order, while the shortage carries on until the
   * goods land and QC clears them. Without this the screen would report an item
   * as unattended for the whole of the vendor's lead time.
   */
  hasOpenPurchaseOrder: boolean;
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
  /** The run the material is for, when one was cited. */
  productionPlan: ProductionPlanSummary | null;
  preferredVendor: { id: string; name: string } | null;

  /**
   * What the material is for, and where it sits in the pack.
   *
   * All optional. A requisition for a bulk raw material answers none of these;
   * one for a carton answers all of them. The two item references are the
   * item master itself, not copies of it.
   */
  finishedProduct: ItemSummary | null;
  packVariant: string | null;
  packagingComponent: ItemSummary | null;
  packagingLevel: PackagingLevel | null;
  /** Per unit or batch of the finished product — the rate, not the buy figure. */
  quantityPerUnit: string | null;
  isMandatory: boolean;
  /** Null when the system raised it — an auto-reorder has no author. */
  requestedBy: string | null;
  /** The same person as `requestedBy`, by id, so a filter can name them. */
  requestedById: string | null;
  approvedBy: string | null;
  requestDate: string;
  requiredByDate: string | null;
  status: RequisitionStatus;
  notes: string | null;
  /** Purchase orders raised from this requisition, for navigation. */
  linkedPurchaseOrders: { id: string; number: string; status: PurchaseOrderStatus }[];
  createdAt: string;
}

/**
 * The manual requisition form's payload.
 *
 * `itemId` is the only required field. Everything else is either defaulted
 * from the item master or genuinely optional — and every id here is resolved
 * against existing master data by the API, which creates none of it.
 *
 * Note what is ABSENT: no `number`, no `status`, no `triggerType`, no
 * `requestedById`, no stock figures. Those are the system's to set, and
 * accepting them from a client would let a requisition claim a shortage that
 * never existed or claim the system raised it.
 */
export interface CreateRequisitionRequest {
  itemId: string;
  /** Defaults to the item's reorder quantity when omitted. */
  requiredQuantity?: string;
  productionPlanId?: string;
  preferredVendorId?: string;
  requiredByDate?: string;
  notes?: string;

  finishedProductId?: string;
  packVariant?: string;
  packagingComponentId?: string;
  packagingLevel?: PackagingLevel;
  quantityPerUnit?: string;
  isMandatory?: boolean;
}

/**
 * Company-level Procure-to-Pay settings.
 *
 * One flag today. Returned as an object rather than a bare boolean so adding
 * the second one does not break the endpoint's shape.
 */
export interface ProcurementSettings {
  /**
   * Whether the reorder check may raise requisitions by itself.
   *
   * Off, low stock is still detected and reported — it just does not create
   * anything, and requisitions are raised by hand instead.
   */
  autoRequisitionEnabled: boolean;
}

export interface UpdateProcurementSettingsRequest {
  autoRequisitionEnabled: boolean;
}

export interface UpdateRequisitionRequest {
  requiredQuantity?: string;
  preferredVendorId?: string | null;
  requiredByDate?: string | null;
  notes?: string | null;
}

/** Result of running the reorder check. */
export interface ReorderCheckResult {
  /** Requisitions the system raised on this run. Empty when auto creation is off. */
  created: RequisitionListItem[];
  /**
   * Items below their level that were not acted on, and why — already had one
   * open, no reorder quantity configured, or auto creation switched off.
   */
  skipped: { itemCode: string; itemName: string; reason: string }[];
  /**
   * Whether the company allows automatic creation. Reported back so the caller
   * can say "nothing was raised because the switch is off" rather than leaving
   * an empty result looking like a failure.
   */
  autoCreationEnabled: boolean;
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
  /** Short-closed: given up on, neither received nor still expected. */
  quantityCancelled: string;
  /**
   * What may still be received: `quantity - quantityReceived -
   * quantityCancelled`, floored at zero. This is the figure the goods-receipt
   * form caps entry at, and the one that decides whether the order is still
   * receivable at all — a short-closed line reaches zero without anyone
   * pretending the shortfall arrived.
   */
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
  /**
   * Optional ONLY on a draft. The service demands all three for a placed
   * order, and again when a draft is submitted — a type cannot express
   * "required unless saveAsDraft", so the rule lives where the flag is
   * visible rather than being weakened into a comment here.
   */
  quantity?: string;
  rate?: string;
  taxRatePercent?: string;
}

export interface CreatePurchaseOrderRequest {
  vendorId: string;
  expectedDeliveryDate?: string;
  paymentTermsDays?: number;
  notes?: string;
  /** Save without placing the order. Absent means a real, placed order. */
  saveAsDraft?: boolean;
  /** May be omitted or empty on a draft; a placed order needs at least one. */
  lines?: CreatePurchaseOrderLineRequest[];
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

/**
 * Whether a lot may still be used, as the inventory view reports it.
 *
 * DERIVED, never stored — the same reasoning as PAYMENT_STATUSES' OVERDUE. A
 * lot that expires tonight is usable now and expired tomorrow, and nothing
 * happens in between: a stored flag would be wrong from midnight until
 * something rewrote it, and "something rewrote it" is a job nobody runs at
 * midnight. The API computes it per request from the expiry date.
 */
export const INVENTORY_STATUSES = ['USABLE', 'EXPIRED'] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const INVENTORY_STATUS_LABELS: Record<InventoryStatus, string> = {
  USABLE: 'Usable',
  EXPIRED: 'Expired',
};

/**
 * One lot of an item, as the Item register's Inventory view shows it.
 *
 * ONLY LOTS INCOMING QC ACCEPTED. A goods receipt creates a lot in QUARANTINE
 * and QC is what releases it, so quarantined and rejected stock is deliberately
 * absent — this view answers "what do we hold", and material nobody has passed
 * is not held in any sense that matters.
 */
export interface InventoryLot {
  id: string;
  lotNumber: string;
  vendorBatchNumber: string | null;
  /** ISO date. Null when the material does not expire — cartons, leaflets. */
  expiryDate: string | null;
  quantityReceived: string;
  quantityAvailable: string;
  storageLocation: string | null;
  /** Derived from `expiryDate` against today; see INVENTORY_STATUSES. */
  status: InventoryStatus;
  /** Whole days until expiry. Negative once past it, null when there is none. */
  daysToExpiry: number | null;
  /** Where it came from, so a lot can be traced without leaving the dialog. */
  goodsReceiptNumber: string | null;
  receivedOn: string | null;
  vendorName: string | null;
}

export interface ItemInventory {
  item: ItemSummary;
  /** Sum of `quantityAvailable` across lots that are not expired. */
  usableQuantity: string;
  /** Sum across lots that are. */
  expiredQuantity: string;
  /** Soonest expiry first, undated lots last — the order FEFO consumes them. */
  lots: InventoryLot[];
}

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
  /** The item's unit, so a quantity on this row reads without a lookup. */
  itemUom: string;
  /** Our own lot number, allocated at goods receipt. */
  lotNumber: string | null;
  /**
   * THE VENDOR'S BATCH NUMBER, carried from the goods receipt unchanged.
   *
   * This is the number on the drum and on the vendor's certificate of
   * analysis, and it is what a recall or an inspection is conducted by. It
   * travels with the batch through QC into stock and is never re-keyed.
   */
  vendorBatchNumber: string | null;
  expiryDate: string | null;
  entryType: string;
  /** Signed: positive adds, negative removes. */
  quantityDelta: string;
  /**
   * Whether this movement changed USABLE stock.
   *
   * False on everything a quarantined or rejected batch does, which is how a
   * rejection is recorded in full without ever becoming available to
   * production.
   */
  affectsUsableStock: boolean;
  reference: string | null;
  notes: string | null;
  createdBy: string | null;
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
export const AGEING_BUCKETS = [
  'NOT_DUE',
  'DUE_0_30',
  'DUE_31_60',
  'DUE_61_90',
  'DUE_90_PLUS',
] as const;
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
  /**
   * Requisitions only. Ignored by the other lists rather than given its own
   * query shape: one interface across the six tabs is what keeps the filter
   * bar and the query string identical between them.
   */
  triggerType?: string;
  /** Requisitions only — the user who raised it. */
  raisedById?: string;
  /** Purchase orders only — orders with a line sourced from this requisition. */
  requisitionId?: string;
  /** ISO dates, inclusive, over the document's own primary date. */
  dateFrom?: string;
  dateTo?: string;
  /** 1-based. Out of range is clamped rather than refused. */
  page?: number;
  pageSize?: number;
}

/** The page sizes the controls offer. */
export const PAGE_SIZES = [10, 25, 50, 100] as const;

export type PageSize = (typeof PAGE_SIZES)[number];

export const DEFAULT_PAGE_SIZE: PageSize = 25;

/**
 * One page of a list, with the size of the whole.
 *
 * `total` is the count AFTER filtering, which is the number the pager and the
 * "showing 1-10 of 125" line both need. A total taken before the filters would
 * promise pages that do not exist.
 */
export interface Paginated<T> {
  rows: T[];
  total: number;
  /** Echoed back so the caller can render the pager from the response alone. */
  page: number;
  pageSize: number;
}

/** Routes for the Procure-to-Pay sub-tabs, shared so links cannot drift. */
export const PROCUREMENT_ROUTES = {
  lowStock: '/workflows/procure-to-pay/low-stock',
  requisitions: '/workflows/procure-to-pay/requisitions',
  purchaseOrders: '/workflows/procure-to-pay/purchase-orders',
  goodsReceipts: '/workflows/procure-to-pay/goods-receipts',
  incomingQc: '/workflows/procure-to-pay/incoming-qc',
  stockLedger: '/workflows/procure-to-pay/stock-ledger',
  invoices: '/workflows/procure-to-pay/invoices',
  payments: '/workflows/procure-to-pay/payments',
  productionPlans: '/workflows/procure-to-pay/requisitions?view=plans',
} as const;

// ---------------------------------------------------------------------------
// Units of measure — stored code vs displayed unit
// ---------------------------------------------------------------------------

/**
 * How each stored UOM code is written when a person reads it.
 *
 * THE STORED VALUE IS A CODE, NOT A UNIT. Items hold "KG"; a kilogram is
 * written "kg". Printing the code raw put "Enter quantity in KG" on the
 * purchase-order form, which is not how the unit is spelled — and the same
 * would be true of "ML" for a millilitre.
 *
 * Note that this is NOT a lowercasing rule, which is why it is a table rather
 * than a call to toLowerCase(): a litre is "L", a millilitre is "mL", and
 * lowercasing either would be as wrong as leaving "KG" alone.
 *
 * Lives here rather than beside the master-data form because that module is
 * 'use client' — every export of one becomes a client reference, so a server
 * component importing this map would get a proxy instead of the object.
 */
export const UOM_LABELS: Record<string, string> = {
  KG: 'kg',
  G: 'g',
  MG: 'mg',
  L: 'L',
  ML: 'mL',
  NOS: 'nos',
  TABLET: 'tablets',
  CAPSULE: 'capsules',
  VIAL: 'vials',
  STRIP: 'strips',
  BOTTLE: 'bottles',
};

/**
 * The unit as it should be read, for any stored code.
 *
 * Falls back to the stored value untouched. Free-text units exist in the item
 * master — the column is a VARCHAR, not an enum — and a unit somebody typed as
 * "sachet" is already how they want to read it. Guessing at it would be worse
 * than leaving it.
 */
export function formatUom(stored: string | null | undefined): string {
  if (!stored) return '';

  return UOM_LABELS[stored.trim().toUpperCase()] ?? stored;
}
