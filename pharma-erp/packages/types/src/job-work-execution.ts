/**
 * Wire types for job-work EXECUTION — US-JW-01 … US-JW-06.
 *
 * ./job-work holds the agreement register (US-MD-05): the commercial terms.
 * This file holds what those terms govern — orders, the principal's material,
 * the production tag, dispatch/invoice, and the derived register. Split because
 * the register is master data edited once a year and this is transactional
 * traffic, and because keeping them apart makes it obvious which of the two a
 * screen is touching.
 *
 * Quantities and money cross the wire as STRINGS throughout, matching the rest
 * of the API: the columns are Decimal and JSON has only doubles, so serialising
 * a conversion rate as a number silently rounds it.
 *
 * Dates cross as YYYY-MM-DD.
 */

import type { BillingModel, ConversionRateBasis } from './job-work';
import type { ItemSummary, StockLotStatus } from './procurement';
import type { BatchReleaseStatus } from './production';

/** Whose material a stock lot is. Mirrors the `StockOwnership` DB enum. */
export const STOCK_OWNERSHIPS = ['COMPANY_OWNED', 'PRINCIPAL_OWNED'] as const;
export type StockOwnership = (typeof STOCK_OWNERSHIPS)[number];

export const STOCK_OWNERSHIP_LABELS: Record<StockOwnership, string> = {
  COMPANY_OWNED: 'Own-procured',
  PRINCIPAL_OWNED: 'Principal-owned',
};

/**
 * Which bucket a billing model obliges production to consume from.
 *
 * Exported so a screen can SHOW the derivation rather than restate it, and so
 * the API and the screen cannot drift apart on it. A lookup, never an input:
 * US-JW-03 rule 1 is "Stock Bucket Used is system-derived from the Billing
 * Model", and rule 2 is that the user cannot select an incorrect one.
 */
export const STOCK_BUCKET_FOR_BILLING_MODEL: Record<BillingModel, StockOwnership> = {
  PURE_CONVERSION: 'PRINCIPAL_OWNED',
  OWN_PROCUREMENT: 'COMPANY_OWNED',
};

/** What a job-work invoice is raised on. Mirrors the `JobWorkInvoiceBasis` enum. */
export const JOB_WORK_INVOICE_BASES = [
  'CONVERSION_CHARGE_ONLY',
  'FULL_FINISHED_GOODS_VALUE',
] as const;
export type JobWorkInvoiceBasis = (typeof JOB_WORK_INVOICE_BASES)[number];

export const JOB_WORK_INVOICE_BASIS_LABELS: Record<JobWorkInvoiceBasis, string> = {
  CONVERSION_CHARGE_ONLY: 'Conversion charge only',
  FULL_FINISHED_GOODS_VALUE: 'Full finished-goods value',
};

/**
 * The other half of the same derivation — US-JW-05, control 7.
 *
 * A screen uses this to DISPLAY the basis beside an AUTO-DERIVED badge. It
 * never sends it: CreateJobWorkDispatchRequest has no `invoiceBasis` field, so
 * there is nothing for a user to change and nothing for the API to have to
 * ignore.
 */
export const INVOICE_BASIS_FOR_BILLING_MODEL: Record<BillingModel, JobWorkInvoiceBasis> = {
  PURE_CONVERSION: 'CONVERSION_CHARGE_ONLY',
  OWN_PROCUREMENT: 'FULL_FINISHED_GOODS_VALUE',
};

// -----------------------------------------------------------------------------
// US-JW-01 — the job-work order
// -----------------------------------------------------------------------------

/**
 * One product+brand a principal may order, resolved from their agreement.
 *
 * What the order form's Product and Brand fields are built from. The two are
 * ONE mapping row, so choosing a brand fixes the product and vice versa, and a
 * combination outside the agreement is not offerable at all — which is US-JW-01
 * validations 2 and 3 applied at the point of choosing rather than at the point
 * of saving.
 */
export interface JobWorkOrderableProduct {
  mappingId: string;
  bomId: string;
  bomVersion: number;
  productId: string;
  productCode: string;
  productName: string;
  /** What the carton says — the principal's brand, not ours. */
  principalBrandName: string;
  packDesignRef: string | null;
  uom: string;
}

/**
 * A principal that can be ordered against today, with their agreement's terms.
 *
 * Only principals holding an IN_FORCE agreement appear: control 1 at the point
 * of choosing, so the form cannot offer something the API will refuse.
 */
export interface JobWorkOrderablePrincipal {
  principalId: string;
  principalCode: string;
  principalName: string;
  agreementId: string;
  agreementReference: string | null;
  /** AUTO-INHERITED onto any order placed against this agreement. */
  billingModel: BillingModel;
  conversionChargeRate: string | null;
  conversionRateBasis: ConversionRateBasis | null;
  validFrom: string | null;
  validTo: string | null;
  products: JobWorkOrderableProduct[];
}

export interface JobWorkOrderSummary {
  id: string;
  orderNumber: string;

  principalId: string;
  principalCode: string;
  principalName: string;

  agreementId: string;
  agreementReference: string | null;

  /** AUTO-INHERITED from the agreement and frozen here. Read-only everywhere. */
  billingModel: BillingModel;
  /** The bucket production is held to. Derived, shown, never chosen. */
  stockBucket: StockOwnership;
  /** The basis any invoice against this order will carry. Derived. */
  invoiceBasis: JobWorkInvoiceBasis;

  product: JobWorkOrderableProduct;

  quantity: string;
  /** YYYY-MM-DD. */
  deliveryDate: string;
  notes: string | null;

  createdAt: string;
  createdBy: string | null;

  // Derived progress, from actual transactions — never a stored status. See
  // the note on the JobWorkOrder model about why there is no status column.
  materialReceivedQuantity: string;
  materialConsumedQuantity: string;
  dispatchedQuantity: string;
  productionOrderCount: number;
}

/**
 * What the create endpoint accepts.
 *
 * NOTE WHAT IS ABSENT: no `billingModel`, no `agreementId`, no `productId`, no
 * `brand`. The mapping carries product and brand; the agreement and the billing
 * model are read off that mapping's agreement by the server. Control 3 is
 * therefore structural — there is no field to send, and the DTO rejects unknown
 * properties rather than ignoring them.
 */
export interface CreateJobWorkOrderRequest {
  principalId: string;
  /** One row of the agreement's product-brand mapping. */
  mappingId: string;
  quantity: string;
  /** YYYY-MM-DD. */
  deliveryDate: string;
  notes?: string;
}

/** Quantity, delivery date and notes only. The terms are not editable. */
export interface UpdateJobWorkOrderRequest {
  quantity?: string;
  deliveryDate?: string;
  notes?: string | null;
}

// -----------------------------------------------------------------------------
// US-JW-02 — the principal's material
// -----------------------------------------------------------------------------

/**
 * One material the order's formulation calls for.
 *
 * WHAT THE PRINCIPAL IS EXPECTED TO SUPPLY, read from the BOM the order is
 * pinned to. The receipt form lists these rather than asking someone to
 * remember them, and the quantity typed against each one is what actually
 * arrived — which is not the same number, and is why the BOM figure is shown
 * beside it rather than used as the value.
 */
/**
 * Which list a material came off, and therefore which section it belongs in.
 *
 * RAW is everything the formulation calls for; PACKING is everything the pack
 * specification calls for. They are separate masters with separate scaling
 * rules, and a store officer checking a challan reads them as separate
 * sections — but they arrive on one document and are received as one receipt.
 */
export const JOB_WORK_MATERIAL_KINDS = ['RAW', 'PACKING'] as const;
export type JobWorkMaterialKind = (typeof JOB_WORK_MATERIAL_KINDS)[number];

export const JOB_WORK_MATERIAL_KIND_LABELS: Record<JobWorkMaterialKind, string> = {
  RAW: 'Raw materials',
  PACKING: 'Packing materials',
};

export interface JobWorkOrderMaterial {
  item: ItemSummary;
  kind: JobWorkMaterialKind;

  /**
   * What the source master calls for, per its own batch or pack.
   *
   * Reference, not a default — the whole point of recording a receipt is that
   * what arrived and what was asked for differ.
   */
  quantityPerBatch: string;

  /**
   * What that quantity is expressed against, in words.
   *
   * The two masters state themselves differently — a BOM per its output
   * quantity, a pack specification per pack or per batch — so this is a phrase
   * rather than a number the screen would have to interpret.
   */
  quantityBasis: string;

  /** Kept for the formulation lines, whose basis is a plain quantity. */
  bomOutputQuantity: string;
}

/**
 * Where a receipt stands.
 *
 * DRAFT while the store is still adding what arrived, PENDING_APPROVAL once
 * somebody says the delivery is completely recorded, and then whatever the
 * quality user decided. Advanced by the API, never set from a request.
 */
export const JOB_WORK_RECEIPT_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'ON_HOLD',
  'REJECTED',
] as const;
export type JobWorkReceiptStatus = (typeof JOB_WORK_RECEIPT_STATUSES)[number];

export const JOB_WORK_RECEIPT_STATUS_LABELS: Record<JobWorkReceiptStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  ON_HOLD: 'On hold',
  REJECTED: 'Rejected',
};

/** The decisions a quality user may record against a consignment. */
export const JOB_WORK_RECEIPT_DECISIONS = ['APPROVED', 'ON_HOLD', 'REJECTED'] as const;
export type JobWorkReceiptDecision = (typeof JOB_WORK_RECEIPT_DECISIONS)[number];

/**
 * One material on a delivery challan, and the lot it became.
 *
 * The QC status is the LOT's status, not a second field kept in step with it:
 * quarantined material is what "pending" means, and reading it off the lot is
 * what makes the answer here and the answer production gets the same answer.
 */
export interface JobWorkMaterialReceiptLineView {
  id: string;
  item: ItemSummary;
  /** Which of the two sections this belongs in, off the item master. */
  kind: JobWorkMaterialKind;
  /** The principal's document for the consignment THIS material arrived on. */
  deliveryChallanNumber: string;
  batchNumber: string;
  receivedQuantity: string;
  manufacturingDate: string | null;
  expiryDate: string | null;
  notes: string | null;

  /** Constant by construction — see the service. */
  stockOwnership: StockOwnership;

  lotId: string | null;
  lotNumber: string | null;
  lotStatus: StockLotStatus | null;
  lotQuantityAvailable: string | null;
}

/**
 * A principal's delivery: the document, and the materials on it.
 *
 * US-JW-02. The header names the consignment — whose it is, which order it is
 * against, their challan number, the date, and whether it has to clear
 * incoming QC. The lines are what physically arrived.
 */
export interface JobWorkMaterialReceiptView {
  id: string;
  receiptNumber: string;

  jobWorkOrderId: string;
  jobWorkOrderNumber: string;
  principalId: string;
  principalName: string;

  /** The product this receipt is against. One order, one product. */
  productName: string;
  productCode: string;
  principalBrandName: string;

  /** YYYY-MM-DD: when the receipt was opened. Challan dates sit on the lines. */
  receiptDate: string;

  status: JobWorkReceiptStatus;

  /** Who said the delivery was completely recorded, and when. */
  submittedBy: string | null;
  submittedAt: string | null;

  /** The quality decision: who, when and why. */
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;

  /**
   * The challans this receipt gathered, for a list that has no room for the
   * lines. One draft collects whatever arrives against the order, so there may
   * be several.
   */
  deliveryChallanNumbers: string[];

  /** Counted for the register, which shows how many of each rather than all. */
  rawMaterialCount: number;
  packingMaterialCount: number;

  notes: string | null;

  lines: JobWorkMaterialReceiptLineView[];

  /** Sum of the lines, so a list can show it without loading them. */
  totalReceivedQuantity: string;

  receivedAt: string;
  receivedBy: string | null;
}

/**
 * What the receipt endpoint accepts.
 *
 * No ownership field: US-JW-02 says the tag is system-set, so sending one is
 * unsupported rather than overridden. No rate, no tax, no vendor — this is not
 * a purchase, and there is nowhere to record one.
 */
export interface CreateJobWorkMaterialReceiptRequest {
  jobWorkOrderId: string;
  deliveryChallanNumber: string;
  itemId: string;
  batchNumber: string;
  receivedQuantity: string;
  manufacturingDate?: string;
  expiryDate?: string;
  notes?: string;
}

// -----------------------------------------------------------------------------
// US-JW-05 — dispatch and invoice
// -----------------------------------------------------------------------------

/**
 * A finished batch that may be sent back to the principal.
 *
 * Only RELEASED batches with finished-goods stock remaining appear. A batch on
 * hold or rejected is neither offered here NOR accepted by the API — the list
 * is a convenience, and the refusal is the control.
 */
export interface JobWorkDispatchableBatch {
  batchId: string;
  batchNumber: string;
  productionOrderNumber: string;
  /** YYYY-MM-DD. */
  expiryDate: string;
  releaseStatus: BatchReleaseStatus;
  /** Releasable finished goods left on this batch. */
  quantityAvailable: string;
  item: ItemSummary;

  /**
   * Who owns the goods — off the production order, not the agreement.
   *
   * The billing model was copied onto the production order when the batch was
   * raised, and is the value the stock-bucket rule read to decide where the
   * batch's materials and output belong. An agreement renegotiated afterwards
   * does not change who owns a batch already made, so this reports the decision
   * that was taken rather than one derived from today's terms.
   */
  stockOwnership: StockOwnership;
}

export interface JobWorkInvoiceView {
  id: string;
  invoiceNumber: string;

  jobWorkOrderId: string;
  jobWorkOrderNumber: string;
  /** Who is being billed. The id, so a list can filter on it. */
  principalId: string;
  principalName: string;

  batchId: string;
  batchNumber: string;

  /** AUTO-DERIVED from the billing model. Read-only. */
  invoiceBasis: JobWorkInvoiceBasis;
  billingModel: BillingModel;

  dispatchDate: string;
  dispatchedQuantity: string;

  rateApplied: string;
  rateBasis: ConversionRateBasis | null;

  taxableValue: string;
  gstRatePercent: string;
  gstAmount: string;
  totalValue: string;

  notes: string | null;
  createdAt: string;
  createdBy: string | null;
}

/**
 * What the dispatch endpoint accepts.
 *
 * NO `invoiceBasis`. And `unitValue` is accepted ONLY under OWN_PROCUREMENT,
 * where the finished-goods value is a commercial figure the agreement does not
 * carry. Sending it under PURE_CONVERSION is REJECTED rather than ignored, so a
 * caller cannot smuggle material value into a conversion invoice — US-JW-05's
 * "raw material value is NOT invoiced" holds against the API, not only against
 * the screen.
 */
export interface CreateJobWorkDispatchRequest {
  jobWorkOrderId: string;
  batchId: string;
  dispatchedQuantity: string;
  /** YYYY-MM-DD. Defaults to today when omitted. */
  dispatchDate?: string;
  /** OWN_PROCUREMENT only: the finished-goods value per unit. */
  unitValue?: string;
  notes?: string;
}

// -----------------------------------------------------------------------------
// US-JW-06 — the derived register
// -----------------------------------------------------------------------------

/**
 * One job-work order's movements, aggregated from real transactions.
 *
 * READ-ONLY and derived: there is no create, update or delete endpoint for a
 * register row and no table behind it. Every figure is a SUM over job-work
 * material receipts, material-issue lines and job-work invoices — which is
 * US-JW-06 rules 1 to 5 expressed as an absence of machinery rather than as a
 * permission check.
 */
/**
 * One material of a formulation, and whether there is enough of it.
 *
 * THE SAME ARITHMETIC THE REFUSAL USES. This is what the Production screen
 * shows before anyone presses the button, computed by the same service that
 * decides whether to accept the work order — so the table and the answer
 * cannot disagree.
 *
 * Which pool "eligible" counts depends on the billing model, and that is the
 * whole difference between the two: principal-owned material received against
 * THIS order under pure conversion, company-owned released stock under own
 * procurement.
 */
export interface JobWorkMaterialReadinessLine {
  item: ItemSummary;

  /** What the formulation calls for at this batch size. */
  requiredQuantity: string;

  /**
   * What was received against this order — pure conversion only.
   *
   * The gross figure off the challans, before QC, expiry or consumption are
   * taken into account. Shown beside `eligibleQuantity` because the gap
   * between the two is the thing a store officer needs explaining.
   */
  receivedQuantity: string | null;

  /**
   * What could actually be issued right now.
   *
   * Correct ownership, in date, QC released, not consumed, and — under own
   * procurement — not already spoken for by another open work order.
   */
  eligibleQuantity: string;

  /** Released stock in the company bucket — own procurement only. */
  availableStock: string | null;
  /** Committed to work orders already raised — own procurement only. */
  reservedQuantity: string | null;

  /** requiredQuantity − eligibleQuantity, floored at zero. */
  shortageQuantity: string;

  /** Quantity sitting in quarantine, on hold or rejected, if any. */
  quantityAwaitingQc: string;
  quantityRejectedOrHeld: string;
  /** Quantity excluded because it is expired or too near expiry. */
  quantityExpired: string;

  ready: boolean;
}

/** What the Production screen needs to explain itself. */
export interface JobWorkMaterialReadiness {
  jobWorkOrderId: string;
  jobWorkOrderNumber: string;
  principalId: string;
  principalName: string;
  agreementId: string;
  agreementReference: string | null;
  billingModel: BillingModel;

  product: ItemSummary;
  principalBrandName: string;
  stockBucket: StockOwnership;

  /** The batch size the figures below were worked out for. */
  batchSize: string;
  bomId: string;
  bomVersion: number;
  bomOutputQuantity: string;

  lines: JobWorkMaterialReadinessLine[];

  /** True only when every line is ready. The button follows this. */
  ready: boolean;

  /**
   * Why not, if not — in the same words the API refuses with.
   *
   * Null when ready. A non-material blocker (no BOM, lapsed agreement) puts
   * its reason here with an empty line list.
   */
  blockedReason: string | null;
}

/**
 * Where a job-work production order stands.
 *
 * Its own list rather than the internal one: the two workflows are separate,
 * and READY_FOR_BATCH_RELEASE has no counterpart in internal production while
 * PACKED has none here.
 */
export const JOB_WORK_PRODUCTION_STATUSES = [
  'DRAFT',
  'READY_FOR_PRODUCTION',
  'IN_PRODUCTION',
  'PRODUCTION_COMPLETED',
  'READY_FOR_BATCH_RELEASE',
  'BATCH_RELEASED',
  'CANCELLED',
] as const;
export type JobWorkProductionStatus = (typeof JOB_WORK_PRODUCTION_STATUSES)[number];

export const JOB_WORK_PRODUCTION_STATUS_LABELS: Record<JobWorkProductionStatus, string> = {
  DRAFT: 'Draft',
  READY_FOR_PRODUCTION: 'Ready for production',
  IN_PRODUCTION: 'In production',
  PRODUCTION_COMPLETED: 'Production completed',
  READY_FOR_BATCH_RELEASE: 'Ready for batch release',
  BATCH_RELEASED: 'Batch released',
  CANCELLED: 'Cancelled',
};

/**
 * Manufacturing a principal's batch.
 *
 * SEPARATE FROM THE INTERNAL PRODUCTION ORDER, and holding no material of its
 * own: what will be consumed is on the receipt it points at, whose lines carry
 * every drum, batch marking, quantity and expiry date. The product, principal,
 * agreement and billing model come the same way, through the job-work order.
 */
export interface JobWorkProductionOrderView {
  id: string;
  orderNumber: string;
  status: JobWorkProductionStatus;

  jobWorkOrderId: string;
  jobWorkOrderNumber: string;

  principalId: string;
  principalName: string;

  agreementId: string;
  agreementReference: string | null;
  billingModel: BillingModel;

  product: ItemSummary;
  principalBrandName: string;

  /** What is to be made, in the product's own unit. */
  plannedQuantity: string;

  plannedStartOn: string | null;
  plannedCompletionOn: string | null;

  notes: string | null;

  /**
   * The approved consignment this will consume, with its lines.
   *
   * The whole receipt rather than a summary of it: the screens that open a
   * production order ask what material is behind it, and answering from a
   * second copy is how two records of one delivery come to disagree.
   */
  /**
   * The consignment behind the order, under pure conversion.
   *
   * NULL UNDER OWN PROCUREMENT, where the material was bought through
   * Procure-to-Pay and there is no consignment from the principal.
   */
  materialReceipt: JobWorkMaterialReceiptView | null;

  /** Which pool this order's material is drawn from. Follows the model. */
  materialSource: JobWorkMaterialSource;

  /**
   * The batch made against this order, once there is one.
   *
   * On the ORDER because the register's Batch column is read beside the status
   * — "in production, no batch yet" and "in production, batch on hold" are
   * different situations, and a column that needs a second screen to fill in
   * does not say which is which.
   */
  batchNumber: string | null;
  releaseStatus: BatchReleaseStatus | null;

  /** How many issues have been recorded against it. */
  issueCount: number;

  createdAt: string;
  createdBy: string | null;
}

/**
 * A drum the issue form may draw on, with what is left of it.
 *
 * STRAIGHT FROM THE INWARD RECEIPT LINE. Nothing here is stored a second time —
 * `quantityAvailable` is the lot's own balance and `alreadyIssued` is the sum
 * of what earlier issues took, so a drum half-consumed offers its remainder.
 */
export interface JobWorkIssuableMaterial {
  /**
   * The inward line this drum arrived on, under pure conversion.
   *
   * NULL UNDER OWN PROCUREMENT, where the lot came from a purchase rather than
   * from the principal and has a goods receipt behind it instead.
   */
  receiptLineId: string | null;
  lotId: string;
  lotNumber: string;

  item: ItemSummary;
  kind: JobWorkMaterialKind;

  /** The principal's own marking on the drum. */
  batchNumber: string;
  deliveryChallanNumber: string | null;
  manufacturingDate: string | null;
  expiryDate: string | null;

  receivedQuantity: string;
  quantityAvailable: string;
  alreadyIssued: string;

  /** QUARANTINE until Quality check clears it; only USABLE may be issued. */
  lotStatus: string;
}

/**
 * A consignment as the production-order lookup needs it.
 *
 * THREE FIELDS, NOT THE WHOLE RECEIPT. The lookup shows a number and a count of
 * each kind; sending every line with its item and its lot made that one call
 * 443 KB and eight seconds, to render one dropdown. What a batch will actually
 * consume is answered by the material check, which reads the lines server-side.
 */
export interface JobWorkEligibleReceipt {
  id: string;
  receiptNumber: string;
  rawMaterialCount: number;
  packingMaterialCount: number;
  deliveryChallanNumbers: string[];
}

/**
 * One material the formulation calls for, against what the principal sent.
 *
 * REQUIRED COMES FROM THE MASTERS — the active formulation for raw materials,
 * the active pack specification for packing — scaled to the quantity the
 * job-work order asked for. RECEIVED is the consignment's own lines. Neither is
 * stored anywhere; a stored copy is a third figure that can disagree.
 */
export interface JobWorkMaterialSufficiencyLine {
  item: ItemSummary;
  kind: JobWorkMaterialKind;

  /** The formulation or pack specification, scaled to the order's quantity. */
  requiredQuantity: string;

  /**
   * What is on hand from whichever source this order draws on.
   *
   * ONE FIELD FOR BOTH MODELS, named for what it means rather than for where it
   * came from: under pure conversion it is what the principal sent on the
   * consignment, under own procurement it is usable company stock less what
   * other open orders have already claimed. `materialSource` on the parent says
   * which, and is what the screen heads the column with.
   */
  suppliedQuantity: string;

  /** `required - supplied`, floored at zero. "0" when covered. */
  shortQuantity: string;

  sufficient: boolean;
}

/**
 * Where a job-work batch's material comes from.
 *
 * Follows the billing model and nothing else: pure conversion consumes what the
 * principal sent, own procurement consumes stock we bought ourselves through
 * Procure-to-Pay. It decides which validation the production-order form runs
 * and which steps of the workflow apply at all.
 */
export const JOB_WORK_MATERIAL_SOURCES = ['PRINCIPAL_CONSIGNMENT', 'OWN_INVENTORY'] as const;
export type JobWorkMaterialSource = (typeof JOB_WORK_MATERIAL_SOURCES)[number];

export const JOB_WORK_MATERIAL_SOURCE_LABELS: Record<JobWorkMaterialSource, string> = {
  PRINCIPAL_CONSIGNMENT: 'Received from the principal',
  OWN_INVENTORY: 'Our own inventory',
};

/**
 * Whether the principal has sent enough to make the batch.
 *
 * THE GATE ON RAISING A PRODUCTION ORDER. Raw and packing are reported
 * separately because they come from different masters and are chased from
 * different people — a batch short of cartons is a different phone call from
 * one short of API.
 *
 * ADVISORY ON THE SCREEN, ENFORCED IN THE SERVICE: the create endpoint
 * re-computes all of this and refuses on its own account, so a request made by
 * hand meets the same rule as the form.
 */
export interface JobWorkMaterialSufficiency {
  jobWorkOrderId: string;
  jobWorkOrderNumber: string;

  /** The order's own model. Never chosen here — it comes off the agreement. */
  billingModel: BillingModel;

  /** Which pool `suppliedQuantity` was measured against. Follows the model. */
  materialSource: JobWorkMaterialSource;

  /** Null under own procurement: there is no consignment to point at. */
  materialReceiptId: string | null;
  receiptNumber: string | null;

  product: ItemSummary;
  /** What the job-work order asked for. The production order inherits it. */
  plannedQuantity: string;

  raw: JobWorkMaterialSufficiencyLine[];
  packing: JobWorkMaterialSufficiencyLine[];

  /** True only when every required material is covered. */
  sufficient: boolean;

  /**
   * Why it cannot be judged at all — no active formulation, say. Null when the
   * only thing wrong is a shortage, which the lines already explain.
   */
  blockedReason: string | null;

  /** One sentence per short material, ready to show or to refuse with. */
  shortages: string[];
}

/**
 * What issuing a job-work order would consume, and out of which drums.
 *
 * THE SAME SHAPE AS MaterialIssuePlan, with one difference that matters: the
 * allocations come from the drums the principal actually sent, not from company
 * stock. The requirement is still the formulation scaled to the order, so a
 * consignment that is short of what the batch needs says so here rather than at
 * the moment somebody presses Dispense.
 */
export interface JobWorkIssuePlanLine {
  item: ItemSummary;
  kind: JobWorkMaterialKind;

  /** Scaled from the BOM (or the pack specification) to the planned quantity. */
  quantityRequired: string;
  /** Sum of `allocations`; less than required when the consignment runs out. */
  quantityAllocated: string;
  /** Required minus allocated. "0" when fully covered. */
  quantityShort: string;

  allocations: {
    lotId: string;
    lotNumber: string;
    /** Null under own procurement — the lot came from a purchase. */
    receiptLineId: string | null;

    /** The principal's own marking on the drum, and the challan it came on. */
    batchNumber: string;
    deliveryChallanNumber: string | null;

    expiryDate: string | null;

    /** What this plan would take from it. */
    quantity: string;
    /** What is left on it, after earlier issues. */
    quantityAvailable: string;
  }[];
}

export interface JobWorkIssuePlan {
  productionOrderId: string;
  orderNumber: string;
  jobWorkOrderNumber: string;
  principalName: string;
  product: ItemSummary;

  /** The consignment being drawn on. */
  receiptNumber: string;

  /** False when any line is short. The issue endpoint refuses in that case. */
  canIssue: boolean;

  /**
   * Why it cannot be issued, when the reason is not a shortage — no active
   * formulation, or a consignment that has not passed Quality check. Null when
   * the only thing stopping it is quantity, which `lines` already explains.
   */
  blockedReason: string | null;

  lines: JobWorkIssuePlanLine[];
}

/** Planned against actual consumption of one material on a job-work batch. */
export interface JobWorkBatchMaterialVariance {
  item: ItemSummary;
  kind: JobWorkMaterialKind;
  quantityPlanned: string;
  quantityIssued: string;
  variancePercent: string;
  /** True when |variancePercent| exceeds the review threshold. */
  flagged: boolean;
}

/** One drum drawn against a job-work batch. */
export interface JobWorkMaterialIssueLineView {
  id: string;
  item: ItemSummary;
  kind: JobWorkMaterialKind;

  lotId: string;
  lotNumber: string;
  /** The principal's own marking on the drum. */
  batchNumber: string;
  expiryDate: string | null;

  quantityIssued: string;

  /** The challan it arrived on, straight through from the receipt line. */
  deliveryChallanNumber: string | null;
}

/**
 * Material issued from the principal's stock to a job-work batch.
 *
 * Its own record, not the internal material issue. The lines reference the
 * lots the inward receipt created rather than restating them.
 */
export interface JobWorkMaterialIssueView {
  id: string;
  issueNumber: string;

  productionOrderId: string;
  productionOrderNumber: string;
  jobWorkOrderNumber: string;
  principalId: string;
  principalName: string;
  product: ItemSummary;

  issuedAt: string;
  issuedBy: string | null;
  notes: string | null;

  lines: JobWorkMaterialIssueLineView[];
  totalQuantityIssued: string;
}

/**
 * A batch manufactured for a principal, with its packing and release.
 *
 * One record for all three, matching what the internal flow splits across a
 * batch and a packing record — job work has no second consumer of the packing
 * figures, and a one-to-one join is a join that can disagree.
 */
export interface JobWorkBatchView {
  id: string;
  batchNumber: string;

  productionOrderId: string;
  productionOrderNumber: string;
  jobWorkOrderNumber: string;
  principalId: string;
  principalName: string;
  product: ItemSummary;
  principalBrandName: string;

  manufacturedOn: string;
  expiryDate: string;

  plannedQuantity: string;
  actualQuantity: string | null;

  packedQuantity: string | null;
  rejectedQuantity: string;
  packVariant: string | null;
  packedOn: string | null;

  releaseStatus: BatchReleaseStatus;
  releaseDecidedAt: string | null;
  releaseDecidedBy: string | null;
  releaseNotes: string | null;

  notes: string | null;

  /**
   * Which packing components the batch used, and how much of each.
   *
   * Returned WITH the batch so the packing form can seed its component boxes
   * on a correction rather than asking for them again — the same reason the
   * internal batch record returns its own.
   */
  packagingConsumed: { itemId: string; quantityConsumed: string }[];

  /**
   * What the formulation called for against what was actually drawn.
   *
   * Computed, never stored: it is the BOM scaled to the order's planned
   * quantity against the sum of the issue lines, and storing either side would
   * be a second copy of a figure that can then disagree with its source.
   */
  materialVariances: JobWorkBatchMaterialVariance[];
  /** Above this absolute percentage a variance is flagged for review. */
  varianceThresholdPercent: number;

  recordedBy: string | null;
  createdAt: string;
}

/**
 * The four stages of the job-work production workflow.
 *
 * One tab with four sub-tabs, mirroring Production & Quality Gate — which is
 * the screen this was copied from, so the vocabulary is deliberately the same.
 */
export const JOB_WORK_PRODUCTION_STAGES = [
  'production-orders',
  'material-issue',
  'batch-record',
  'batch-release',
] as const;
export type JobWorkProductionStage = (typeof JOB_WORK_PRODUCTION_STAGES)[number];

export const JOB_WORK_PRODUCTION_STAGE_LABELS: Record<JobWorkProductionStage, string> = {
  'production-orders': 'Production orders',
  'material-issue': 'Material issue',
  'batch-record': 'Batch record',
  'batch-release': 'Batch release',
};

export interface JobWorkRegisterRow {
  jobWorkOrderId: string;
  jobWorkOrderNumber: string;

  /** When the job-work order was raised. ISO 8601. Orders the picklists. */
  createdAt: string;

  principalId: string;
  principalName: string;

  agreementId: string;
  agreementReference: string | null;
  billingModel: BillingModel;

  productName: string;
  principalBrandName: string;

  orderedQuantity: string;
  /** SUM of job-work material receipts (US-JW-02). */
  materialReceived: string;
  /** SUM of material-issue lines drawn from this order's principal-owned lots. */
  quantityConsumed: string;
  /** SUM of released batch quantities made against this order (US-JW-03/04). */
  finishedGoodsProduced: string;
  /** SUM of job-work invoice dispatched quantities (US-JW-05). */
  finishedGoodsDispatched: string;
  /** materialReceived − quantityConsumed. */
  closingBalance: string;

  /**
   * What this order has been billed, if anything.
   *
   * An order may be invoiced more than once — a part dispatch is a part
   * invoice — so this is a list rather than a field, and the amount is the sum.
   */
  invoiceNumbers: string[];
  invoicedAmount: string;
}

/** The register, grouped by principal and agreement as US-JW-06 asks. */
export interface JobWorkRegisterGroup {
  principalId: string;
  principalName: string;
  agreementId: string;
  agreementReference: string | null;
  billingModel: BillingModel;

  rows: JobWorkRegisterRow[];

  totalMaterialReceived: string;
  totalQuantityConsumed: string;
  totalFinishedGoodsProduced: string;
  totalFinishedGoodsDispatched: string;
  totalClosingBalance: string;
  totalInvoicedAmount: string;
}
