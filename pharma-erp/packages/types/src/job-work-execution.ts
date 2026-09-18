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
import type { BatchReleaseStatus } from './production';
import type { ItemSummary } from './procurement';

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

export interface JobWorkMaterialReceiptView {
  id: string;
  receiptNumber: string;

  jobWorkOrderId: string;
  jobWorkOrderNumber: string;
  principalName: string;

  /** The principal's own document. Never a purchase invoice. */
  deliveryChallanNumber: string;

  item: ItemSummary;
  batchNumber: string;
  receivedQuantity: string;

  manufacturingDate: string | null;
  expiryDate: string | null;
  notes: string | null;

  /** SYSTEM-SET. Always PRINCIPAL_OWNED; carried so a screen can show it. */
  stockOwnership: StockOwnership;

  /** The lot this receipt created, and what is left of it. */
  lotNumber: string | null;
  lotQuantityAvailable: string | null;

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
}

export interface JobWorkInvoiceView {
  id: string;
  invoiceNumber: string;

  jobWorkOrderId: string;
  jobWorkOrderNumber: string;
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
export interface JobWorkRegisterRow {
  jobWorkOrderId: string;
  jobWorkOrderNumber: string;

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
  /** SUM of job-work invoice dispatched quantities (US-JW-05). */
  finishedGoodsDispatched: string;
  /** materialReceived − quantityConsumed. */
  closingBalance: string;
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
  totalFinishedGoodsDispatched: string;
  totalClosingBalance: string;
}
