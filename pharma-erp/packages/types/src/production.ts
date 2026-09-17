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

// ItemType, ItemSummary and ScheduleClassification are declared in
// ./procurement, which is where the shared item master lives. Imported here
// rather than redeclared: two definitions of one table is what produced the
// merge this comment is being written during.
import type { ItemSummary, ItemType, ScheduleClassification, StockLotStatus } from './procurement';

/**
 * Ordered as the process runs, so a status filter reads down the workflow
 * rather than alphabetically.
 *
 * The array is the source and the union is derived from it: a filter needs the
 * values at runtime, and a hand-written union beside a hand-written list is two
 * places to forget a status.
 */
export const PRODUCTION_ORDER_STATUSES = [
  'PLANNED',
  'MATERIAL_ISSUED',
  'IN_PROGRESS',
  'PACKED',
  'UNDER_TEST',
  'CLOSED',
  'CANCELLED',
] as const;

export type ProductionOrderStatus = (typeof PRODUCTION_ORDER_STATUSES)[number];

export const BATCH_RELEASE_STATUSES = ['PENDING', 'RELEASED', 'BLOCKED'] as const;

export type BatchReleaseStatus = (typeof BATCH_RELEASE_STATUSES)[number];

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

/**
 * A lot of raw or packaging material as production sees it.
 *
 * This is a `stock_lots` row — the same lot Procure-to-Pay received and
 * incoming QC released — not a production-private copy. There is one stock
 * table, and both modules read it; see the note on MaterialIssueLine.lot.
 *
 * `expiryDate` is nullable because cartons, leaflets and most packaging carry
 * no expiry at all. Null is a fact about the material, not a missing value:
 * FEFO deliberately orders such lots last. See STOCK_LOT_STATUS_LABELS for the
 * statuses; only USABLE is ever issued.
 */
export interface ProductionStockLot {
  id: string;
  lotNumber: string;
  /** ISO date, no time component. Null when the material does not expire. */
  expiryDate: string | null;
  status: StockLotStatus;
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

/**
 * Changes a formulation in place, instead of superseding it with a new version.
 *
 * No `productId` and no `activate`: a formulation that changes which product it
 * makes is a different formulation, and which version is current is a decision
 * about the whole set rather than about one row. The API refuses the edit once
 * a work order, brand mapping or production plan references the formulation —
 * at that point something downstream was decided on these numbers.
 */
export interface UpdateBomRequest {
  outputQuantity: string;
  instructions?: string;
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
 * Whether a batch of a given size could be made, and what it would consume —
 * US-PROD-01.
 *
 * Returned before the work order is raised, so the requirement grid and the
 * Pass/Fail on the form are the SAME numbers the save will check. A screen that
 * computed its own answer would eventually disagree with the server, and the
 * disagreement would show up as a save refused for reasons the page said were
 * fine.
 */
export interface WorkOrderFeasibilityLine {
  itemId: string;
  code: string;
  name: string;
  uom: string;
  /** Scaled from the formulation to the batch size. */
  required: string;
  /** Usable stock on hand — quarantined and rejected lots excluded. */
  available: string;
  /** `required - available`, floored at zero. */
  short: string;
  isShort: boolean;
}

export interface WorkOrderFeasibility {
  productId: string;
  productCode: string;
  productName: string;
  /** The formulation the batch would follow. */
  bomVersion: number;
  batchQuantity: string;
  /** False when any material is short. The create endpoint refuses then too. */
  canRaise: boolean;
  /** Absent only when the product has no active formulation to scale. */
  lines: WorkOrderFeasibilityLine[];
  /**
   * Why it cannot be raised, when the reason is not a shortage — no active
   * formulation, or no active pack specification. Null when the only thing
   * stopping it is stock, which `lines` already explains.
   */
  blockedReason: string | null;
}

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
    /**
     * YYYY-MM-DD, or null.
     *
     * Nullable because stock lots carry an optional expiry: a carton or a
     * leaflet usually has none. FEFO sorts those LAST rather than excluding
     * them — a component with no expiry cannot expire, so it is the safest
     * thing to leave on the shelf, not a reason to make it unissuable.
     */
    expiryDate: string | null;
    quantity: string;
    quantityAvailable: string;
    /** True when this lot is not the one FEFO would have chosen. */
    isFefoOverride?: boolean;
    /** Why, when it is. Required by the column's CHECK constraint. */
    overrideReason?: string | null;
  }[];
}

export interface MaterialIssuePlan {
  productionOrderId: string;
  orderNumber: string;
  /** False when any line is short. The issue endpoint refuses in that case. */
  canIssue: boolean;
  lines: MaterialIssuePlanLine[];
}

/**
 * Naming the lot to draw from, rather than taking the one FEFO proposed —
 * US-PROD-02.
 *
 * The criterion is that the screen always PROPOSES the nearest-expiry lot. It
 * does not forbid choosing another: a container damaged in the store, or one
 * held back for a retained sample, is a real reason. What it cannot be is
 * silent, so the reason travels with the choice and is stored on the line.
 *
 * `reason` is optional because naming a lot is not always a departure —
 * confirming the one already suggested is the case the story calls "Actual
 * Batch, manually confirmed, defaults to the suggestion". The API requires it
 * when, and only when, the lot differs from the plan's proposal.
 */
export interface MaterialIssueOverride {
  itemId: string;
  lotId: string;
  quantity: string;
  /** Required when the lot differs from the FEFO suggestion; the API enforces that. */
  reason?: string;
}

/** What the issue endpoint accepts. Omit `overrides` for a plain FEFO issue. */
export interface IssueMaterialRequest {
  overrides?: MaterialIssueOverride[];
}

export interface MaterialIssueLineView {
  id: string;
  item: ItemSummary;
  lotNumber: string;
  /** YYYY-MM-DD, or null for a lot with no expiry. */
  expiryDate: string | null;
  quantityIssued: string;
  /** US-PROD-02: departing from the FEFO suggestion, and why. */
  isFefoOverride: boolean;
  overrideReason: string | null;
}

export interface MaterialIssueView {
  id: string;
  /** US-PROD-02's "Issue No.", as MI-YYYY-NNNN. Allocated when the issue saves. */
  issueNumber: string;
  /**
   * The work order this dispensing was against.
   *
   * Denormalised onto the view because the register lists every issue across
   * every order, and without it each row would say what was dispensed but not
   * what for.
   */
  orderNumber: string;
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
