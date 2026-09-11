/**
 * Wire types for the Production & Quality Gate workflow.
 *
 * QUANTITIES CROSS THE WIRE AS STRINGS, not numbers. The database stores them
 * as `Decimal(14,3)`; JSON has only IEEE-754 doubles, so serialising a decimal
 * as a number silently rounds it. A dispensed quantity that reads 0.1 in the
 * database and 0.09999999999999999 in the browser is the kind of discrepancy
 * that ends up in a deviation report, so the API sends the decimal's exact
 * string form and the UI formats it for display without ever doing arithmetic
 * on it.
 */

export type ItemType = 'RAW_MATERIAL' | 'PACKING_MATERIAL' | 'SEMI_FINISHED' | 'FINISHED_GOOD';

/** Drugs & Cosmetics Rules schedule. Mirrors the Prisma enum of the same name. */
export type ScheduleClassification = 'NONE' | 'H' | 'H1' | 'X' | 'G';

export type MaterialLotStatus = 'QUARANTINE' | 'USABLE' | 'REJECTED';

export type ProductionOrderStatus =
  'PLANNED' | 'MATERIAL_ISSUED' | 'IN_PROGRESS' | 'PACKED' | 'UNDER_TEST' | 'CLOSED' | 'CANCELLED';

export type BatchReleaseStatus = 'PENDING' | 'RELEASED' | 'BLOCKED';

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  RAW_MATERIAL: 'Raw material',
  PACKING_MATERIAL: 'Packing material',
  SEMI_FINISHED: 'Semi-finished',
  FINISHED_GOOD: 'Finished good',
};

/**
 * Short labels for the tab row and grid; the long form is in
 * SCHEDULE_CLASSIFICATION_HINTS, which says what each one actually requires.
 */
export const SCHEDULE_CLASSIFICATION_LABELS: Record<ScheduleClassification, string> = {
  NONE: 'None',
  H: 'Schedule H',
  H1: 'Schedule H1',
  X: 'Schedule X',
  G: 'Schedule G',
};

export const SCHEDULE_CLASSIFICATION_HINTS: Record<ScheduleClassification, string> = {
  NONE: 'General / OTC',
  H: 'Prescription only',
  H1: 'Prescription, register entry',
  X: 'Prescription retained 2 years',
  G: '"Caution" labelling',
};

/** GST slabs a medicament can fall in. Held here so the form and the API agree. */
export const GST_RATES = ['0', '5', '12', '18', '28'] as const;

export const MATERIAL_LOT_STATUS_LABELS: Record<MaterialLotStatus, string> = {
  QUARANTINE: 'Quarantine',
  USABLE: 'Usable',
  REJECTED: 'Rejected',
};

export const PRODUCTION_ORDER_STATUS_LABELS: Record<ProductionOrderStatus, string> = {
  PLANNED: 'Planned',
  MATERIAL_ISSUED: 'Material issued',
  IN_PROGRESS: 'In progress',
  PACKED: 'Packed',
  UNDER_TEST: 'Under test',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export const BATCH_RELEASE_STATUS_LABELS: Record<BatchReleaseStatus, string> = {
  PENDING: 'Pending',
  RELEASED: 'Released',
  BLOCKED: 'Blocked',
};

// ---------------------------------------------------------------------------
// Items and stock
// ---------------------------------------------------------------------------

export interface ItemSummary {
  id: string;
  code: string;
  name: string;
  type: ItemType;
  uom: string;
  shelfLifeMonths: number | null;
  hsnCode: string | null;
  brandName: string | null;
  genericName: string | null;
  scheduleClassification: ScheduleClassification;
  /** Percentage as a string — see the note at the top of this file. */
  gstRate: string | null;
  mrp: string | null;
  dpcoCeiling: boolean;
  storageConditions: string | null;
  reorderLevel: string | null;
  reorderQuantity: string | null;
}

/**
 * What the create endpoint accepts.
 *
 * `hsnCode` and `gstRate` are required here although both columns are
 * nullable: rows written before the field existed keep their NULL, and
 * everything written from now on has to carry one. Decimals are strings for
 * the reason stated at the top of this file.
 */
/**
 * What the update endpoint accepts.
 *
 * Three-state on purpose: a field left OUT is unchanged, a field sent as
 * `null` is cleared, and a value replaces. Without the distinction there is
 * no way to remove an MRP that was entered by mistake — sending "" would
 * either be rejected or stored as an empty string.
 *
 * `code` is absent deliberately. It is the identifier printed on every
 * document that cites the item, so changing it would rewrite the meaning of
 * paperwork already issued.
 */
export interface UpdateItemRequest {
  name?: string;
  type?: ItemType;
  uom?: string;
  hsnCode?: string;
  gstRate?: string;
  scheduleClassification?: ScheduleClassification;
  brandName?: string | null;
  genericName?: string | null;
  mrp?: string | null;
  dpcoCeiling?: boolean;
  storageConditions?: string | null;
  shelfLifeMonths?: number | null;
  reorderLevel?: string | null;
  reorderQuantity?: string | null;
}

export interface CreateItemRequest {
  code: string;
  name: string;
  type: ItemType;
  uom: string;
  hsnCode: string;
  gstRate: string;
  scheduleClassification?: ScheduleClassification;
  brandName?: string;
  genericName?: string;
  mrp?: string;
  dpcoCeiling?: boolean;
  storageConditions?: string;
  shelfLifeMonths?: number;
  reorderLevel?: string;
  reorderQuantity?: string;
}

export interface MaterialLotSummary {
  id: string;
  lotNumber: string;
  /** ISO date, no time component. */
  expiryDate: string;
  status: MaterialLotStatus;
  quantityAvailable: string;
  quantityReceived: string;
  item: ItemSummary;
}

// ---------------------------------------------------------------------------
// Formulations
// ---------------------------------------------------------------------------

export interface BomLineView {
  id: string;
  item: ItemSummary;
  quantityPer: string;
  notes: string | null;
}

export interface BomView {
  id: string;
  version: number;
  isActive: boolean;
  outputQuantity: string;
  effectiveFrom: string;
  instructions: string | null;
  product: ItemSummary;
  lines: BomLineView[];
}

export interface CreateBomRequest {
  productId: string;
  outputQuantity: string;
  instructions?: string;
  activate?: boolean;
  lines: { itemId: string; quantityPer: string; notes?: string }[];
}

// ---------------------------------------------------------------------------
// Production orders
// ---------------------------------------------------------------------------

export interface ProductionOrderSummary {
  id: string;
  orderNumber: string;
  status: ProductionOrderStatus;
  plannedQuantity: string;
  plannedStartOn: string | null;
  product: ItemSummary;
  bomVersion: number;
  createdAt: string;
  createdBy: string | null;
  /** Batch number once manufacture is recorded; null before that. */
  batchNumber: string | null;
  batchId: string | null;
  releaseStatus: BatchReleaseStatus | null;
}

export interface CreateProductionOrderRequest {
  productId: string;
  plannedQuantity: string;
  plannedStartOn?: string;
}

// ---------------------------------------------------------------------------
// Material issue
// ---------------------------------------------------------------------------

/**
 * What the FEFO planner intends to consume, before anything is written.
 *
 * Returned by a preview endpoint so the shop floor sees which lots will be
 * taken — and, crucially, sees a shortfall — before committing. Dispensing is
 * hard to reverse; showing the plan first is cheap.
 */
export interface MaterialIssuePlanLine {
  item: ItemSummary;
  /** Scaled from the BOM to the order's planned quantity. */
  quantityRequired: string;
  /** Sum of `allocations`; less than required when stock runs out. */
  quantityAllocated: string;
  /** Required minus allocated. "0" when fully covered. */
  quantityShort: string;
  allocations: {
    lotId: string;
    lotNumber: string;
    expiryDate: string;
    quantity: string;
    quantityAvailable: string;
  }[];
}

export interface MaterialIssuePlan {
  productionOrderId: string;
  orderNumber: string;
  /** False when any line is short. The issue endpoint refuses in that case. */
  canIssue: boolean;
  lines: MaterialIssuePlanLine[];
}

export interface MaterialIssueLineView {
  id: string;
  item: ItemSummary;
  lotNumber: string;
  expiryDate: string;
  quantityIssued: string;
}

export interface MaterialIssueView {
  id: string;
  issuedAt: string;
  issuedBy: string | null;
  notes: string | null;
  lines: MaterialIssueLineView[];
}

// ---------------------------------------------------------------------------
// Batch record
// ---------------------------------------------------------------------------

/**
 * Planned versus actual consumption for one material.
 *
 * `variancePercent` is computed by the API rather than the browser so the
 * flagging threshold is one number in one place — a UI that computed its own
 * could disagree with what the audit trail recorded.
 */
export interface BatchMaterialVariance {
  item: ItemSummary;
  quantityPlanned: string;
  quantityIssued: string;
  variancePercent: string;
  /** True when |variancePercent| exceeds the review threshold. */
  flagged: boolean;
}

export interface BatchView {
  id: string;
  batchNumber: string;
  manufacturedOn: string;
  expiryDate: string;
  plannedQuantity: string;
  actualQuantity: string | null;
  releaseStatus: BatchReleaseStatus;
  releaseDecidedAt: string | null;
  releaseDecidedBy: string | null;
  releaseNotes: string | null;
  product: ItemSummary;
  orderNumber: string;
  productionOrderId: string;
  packedQuantity: string | null;
  packedOn: string | null;
  materialVariances: BatchMaterialVariance[];
  /** Above this absolute percentage a variance is flagged for review. */
  varianceThresholdPercent: number;
}

export interface RecordBatchRequest {
  productionOrderId: string;
  /** Defaults to today when omitted. */
  manufacturedOn?: string;
  actualQuantity: string;
}

export interface RecordPackingRequest {
  packedQuantity: string;
  packedOn?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// The quality gate
// ---------------------------------------------------------------------------

/**
 * The release decision.
 *
 * Only two outcomes, and neither is reversible through this API: RELEASED
 * creates the finished-goods lot that makes the batch sellable, BLOCKED
 * permanently withholds it. A third "undo" verb was deliberately not added —
 * reversing a quality decision is a deviation, handled as one, not a button.
 */
export interface ReleaseDecisionRequest {
  decision: Extract<BatchReleaseStatus, 'RELEASED' | 'BLOCKED'>;
  /** Required when blocking. A rejected batch with no recorded reason is what an inspector asks about. */
  notes?: string;
}

export interface FinishedGoodsLotView {
  id: string;
  batchNumber: string;
  expiryDate: string;
  quantityAvailable: string;
  item: ItemSummary;
}
