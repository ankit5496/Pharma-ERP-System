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
 * Where a principal's delivery stands.
 *
 * PENDING_QC while any material on it is still quarantined, ON_HOLD or
 * REJECTED if a decision went that way, RELEASED when everything on the
 * challan is usable. Derived from the lines by the API, never set by hand.
 */
export const JOB_WORK_RECEIPT_STATUSES = ['PENDING_QC', 'RELEASED', 'ON_HOLD', 'REJECTED'] as const;
export type JobWorkReceiptStatus = (typeof JOB_WORK_RECEIPT_STATUSES)[number];

export const JOB_WORK_RECEIPT_STATUS_LABELS: Record<JobWorkReceiptStatus, string> = {
  PENDING_QC: 'QC pending',
  RELEASED: 'Released',
  ON_HOLD: 'On hold',
  REJECTED: 'Rejected',
};

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

  deliveryChallanNumber: string;
  /** YYYY-MM-DD, off the challan. */
  receiptDate: string;

  /**
   * Whether this consignment has to clear incoming QC before it may be
   * issued. Decided when the receipt is booked and then fixed, so a later
   * change of policy cannot put released material back into quarantine.
   */
  qcRequired: boolean;
  status: JobWorkReceiptStatus;

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
