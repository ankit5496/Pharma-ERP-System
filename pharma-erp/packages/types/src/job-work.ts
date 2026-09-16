/**
 * Wire types for the Principal & Job-Work Agreement register — US-MD-05.
 *
 * A principal is a brand owner this company manufactures for: the same physical
 * product leaves the line carrying THEIR brand name and THEIR pack design. The
 * mappings are what keep those two identities attached to one formulation
 * without duplicating it.
 *
 * Money and rates cross the wire as STRINGS, for the same reason quantities do
 * in ./production: the column is `Decimal(12,2)` and JSON has only doubles, so
 * serialising a conversion rate as a number silently rounds it.
 *
 * Dates cross as YYYY-MM-DD, never as a serialised Date: a contract runs for
 * calendar days, and an ISO timestamp would make "in force today" depend on the
 * reader's timezone.
 */

/**
 * How the principal is billed.
 *
 * The most consequential field on an agreement — it decides whose material is
 * consumed and what the invoice is raised on.
 */
export const BILLING_MODELS = ['OWN_PROCUREMENT', 'PURE_CONVERSION'] as const;
export type BillingModel = (typeof BILLING_MODELS)[number];

export const BILLING_MODEL_LABELS: Record<BillingModel, string> = {
  OWN_PROCUREMENT: 'Own-procurement',
  PURE_CONVERSION: 'Pure conversion',
};

/** The long form, for a form field where the distinction has to be explained. */
export const BILLING_MODEL_DESCRIPTIONS: Record<BillingModel, string> = {
  OWN_PROCUREMENT: 'We buy the materials and bill the finished goods',
  PURE_CONVERSION: 'The principal supplies the materials, we bill the conversion',
};

/** What a conversion charge is charged per. */
export const CONVERSION_RATE_BASES = ['PER_BATCH', 'PER_1000_UNITS', 'PER_PACK', 'PER_KG'] as const;
export type ConversionRateBasis = (typeof CONVERSION_RATE_BASES)[number];

export const CONVERSION_RATE_BASIS_LABELS: Record<ConversionRateBasis, string> = {
  PER_BATCH: 'per batch',
  PER_1000_UNITS: 'per 1,000 units',
  PER_PACK: 'per pack',
  PER_KG: 'per kg',
};

/**
 * Whether the agreement is in force, computed against the SERVER's today.
 *
 * Computed by the API rather than by each screen, for the same reason licence
 * status is: two browsers in different timezones must not disagree about
 * whether a contract has lapsed.
 *
 * An agreement with no dates at all is IN_FORCE — an open-ended arrangement is
 * a real thing, and treating "no end date" as expired would be wrong.
 */
export const AGREEMENT_STATUSES = ['IN_FORCE', 'NOT_YET_STARTED', 'EXPIRED'] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  IN_FORCE: 'In force',
  NOT_YET_STARTED: 'Not yet started',
  EXPIRED: 'Expired',
};

/** One of our formulations, as the principal knows it. */
export interface JobWorkMappingView {
  id: string;
  bomId: string;
  /** Our product code and formulation version, e.g. "FG-0142 v2". */
  bomLabel: string;
  /** Our own product name, for contrast with the principal's brand. */
  productName: string;
  /** What the carton says. The principal's property, not ours. */
  principalBrandName: string;
  packDesignRef: string | null;
}

export interface JobWorkAgreementSummary {
  id: string;
  principalId: string;
  principalCode: string;
  principalName: string;
  agreementReference: string | null;
  billingModel: BillingModel;
  /** Decimal as a string, or null. Always paired with the basis; see the API. */
  conversionChargeRate: string | null;
  conversionRateBasis: ConversionRateBasis | null;
  /** YYYY-MM-DD or null. */
  validFrom: string | null;
  validTo: string | null;
  notes: string | null;
  status: AgreementStatus;
  mappings: JobWorkMappingView[];
}

/** One line of the product-to-brand mapping, as sent. */
export interface JobWorkMappingInput {
  bomId: string;
  principalBrandName: string;
  packDesignRef?: string | null;
}

/**
 * What the create endpoint accepts.
 *
 * `billingModel` is required — US-MD-05's "mandatory field on the agreement" —
 * and so is at least one mapping, which is the other criterion. Neither is
 * optional at any layer.
 */
export interface CreateJobWorkAgreementRequest {
  principalId: string;
  billingModel: BillingModel;
  mappings: JobWorkMappingInput[];
  agreementReference?: string;
  conversionChargeRate?: string;
  conversionRateBasis?: ConversionRateBasis;
  validFrom?: string;
  validTo?: string;
  notes?: string;
}

/**
 * A change to an existing agreement. Omitted means unchanged, `null` clears.
 *
 * `mappings`, when given, REPLACES the whole set rather than merging: a
 * contract amendment restates which products are covered, and a merge would
 * make removing a product impossible.
 *
 * `billingModel` is `BillingModel` and never null — it cannot be cleared, only
 * changed to the other value. Note what is NOT yet enforced: US-MD-05 also says
 * it cannot change on an order already in production. Production orders do not
 * carry an agreement yet, so nothing here can check that.
 */
export interface UpdateJobWorkAgreementRequest {
  principalId?: string;
  billingModel?: BillingModel;
  mappings?: JobWorkMappingInput[];
  agreementReference?: string | null;
  conversionChargeRate?: string | null;
  conversionRateBasis?: ConversionRateBasis | null;
  validFrom?: string | null;
  validTo?: string | null;
  notes?: string | null;
}
