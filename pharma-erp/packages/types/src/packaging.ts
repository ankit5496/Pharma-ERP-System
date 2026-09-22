/**
 * Wire types for the Packaging Requirement Master — US-MD-06.
 *
 * What a product's pack consumes, per pack presentation, and whether the stock
 * to pack it actually exists.
 *
 * Quantities cross the wire as STRINGS, for the same reason they do in
 * ./production: the columns are `Decimal(14,3)` and JSON has only doubles, so
 * serialising a component quantity as a number silently rounds it — and these
 * are the numbers a shortage is computed from.
 */

/**
 * PACKAGING_LEVELS, PackagingLevel and PACKAGING_LEVEL_LABELS are declared in
 * ./procurement and imported here rather than restated.
 *
 * They arrived twice, independently: Procure-to-Pay needed a packaging level on
 * a purchase requisition, and US-MD-06 needed one on a pack specification. Same
 * three values, same meaning, one Postgres enum — so one declaration, owned by
 * the module that had it first. Re-exporting them here would make
 * `export *` from the index ambiguous, which is exactly the build error the
 * duplicate produced.
 */
import type { ItemSummary, PackagingLevel } from './procurement';

/** The long form, where the distinction has to be explained rather than named. */
export const PACKAGING_LEVEL_DESCRIPTIONS: Record<PackagingLevel, string> = {
  PRIMARY: 'Touches the product',
  SECONDARY: 'Carton, insert',
  TERTIARY: 'Shipper, pallet',
};

/**
 * What a stated quantity is counted against — US-MD-06's scaling rule.
 *
 * PER_PACK scales with the number of packs a batch yields. PER_BATCH does NOT
 * scale: one batch record insert is one whether the batch is ten thousand
 * tablets or a million.
 */
export const PACKAGING_QUANTITY_BASES = ['PER_PACK', 'PER_BATCH'] as const;
export type PackagingQuantityBasis = (typeof PACKAGING_QUANTITY_BASES)[number];

export const PACKAGING_QUANTITY_BASIS_LABELS: Record<PackagingQuantityBasis, string> = {
  PER_PACK: 'per pack',
  PER_BATCH: 'per batch',
};

/** Whether a shortage stops the line or merely warns. */
export const PACKAGING_COMPONENT_REQUIREMENTS = ['MANDATORY', 'OPTIONAL'] as const;
export type PackagingComponentRequirement = (typeof PACKAGING_COMPONENT_REQUIREMENTS)[number];

export const PACKAGING_COMPONENT_REQUIREMENT_LABELS: Record<PackagingComponentRequirement, string> =
  {
    MANDATORY: 'Mandatory',
    OPTIONAL: 'Optional',
  };

export const PACKAGING_COMPONENT_REQUIREMENT_DESCRIPTIONS: Record<
  PackagingComponentRequirement,
  string
> = {
  MANDATORY: 'Block if short',
  OPTIONAL: 'Warn if short',
};

export interface PackagingLineView {
  id: string;
  item: ItemSummary;
  level: PackagingLevel;
  /** Decimal as a string. */
  quantityPer: string;
  quantityBasis: PackagingQuantityBasis;
  requirement: PackagingComponentRequirement;
  notes: string | null;
}

export interface PackagingRequirementView {
  id: string;
  /** When the record was created — the register sorts on it and filters by it. */
  createdAt: string;
  /** Who entered it, by name. Null for a record created before this was kept. */
  createdBy: string | null;
  product: ItemSummary;
  packVariant: string;
  /** How many units of the product one pack holds. Decimal as a string. */
  unitsPerPack: string;
  isActive: boolean;
  notes: string | null;
  lines: PackagingLineView[];
}

// ---------------------------------------------------------------------------
// Availability — US-MD-06 criteria 2 and 3
// ---------------------------------------------------------------------------

/**
 * Whether a pack can actually be run.
 *
 * BLOCKED means a MANDATORY component is short — short of a carton, the line
 * stops. SHORT_OPTIONAL means only OPTIONAL components are short, which is a
 * problem worth knowing about but not one that halts packing.
 */
export const PACKAGING_READINESS = ['READY', 'SHORT_OPTIONAL', 'BLOCKED'] as const;
export type PackagingReadiness = (typeof PACKAGING_READINESS)[number];

export const PACKAGING_READINESS_LABELS: Record<PackagingReadiness, string> = {
  READY: 'Ready to pack',
  SHORT_OPTIONAL: 'Short — non-blocking',
  BLOCKED: 'Short — blocks packing',
};

/**
 * One component, scaled to a batch and checked against stock.
 *
 * `quantityRequired` is what US-MD-06's second criterion produces; the
 * remaining three fields are what its third criterion produces. Both are
 * computed on the server, on read — there is nothing stored to go stale, and
 * nobody cross-checks a paper list.
 */
export interface PackagingAvailabilityLine {
  item: ItemSummary;
  level: PackagingLevel;
  quantityBasis: PackagingQuantityBasis;
  requirement: PackagingComponentRequirement;
  /** As stated on the specification, before scaling. */
  quantityPer: string;
  /** After scaling to the batch. This is the criterion-2 number. */
  quantityRequired: string;
  /** Usable stock on hand for this component, across all lots. */
  quantityAvailable: string;
  /** `required - available`, floored at zero. */
  quantityShort: string;
  isShort: boolean;
}

export interface PackagingAvailability {
  requirementId: string;
  product: ItemSummary;
  packVariant: string;
  unitsPerPack: string;
  /** The batch this was scaled to, in the product's own unit. */
  batchQuantity: string;
  /** `batchQuantity / unitsPerPack` — how many packs the batch yields. */
  packs: string;
  readiness: PackagingReadiness;
  lines: PackagingAvailabilityLine[];
}

// ---------------------------------------------------------------------------
// The dashboard sweep — US-MD-06 criterion 4
// ---------------------------------------------------------------------------

/**
 * Why a planned batch is at risk.
 *
 * NO_SPECIFICATION is listed alongside the shortages deliberately: a plan for a
 * product with no active pack specification cannot become a work order at all
 * (criterion 1), and discovering that when the batch is due is the same failure
 * the whole story exists to prevent.
 */
export const PACKAGING_RISKS = ['NO_SPECIFICATION', 'BLOCKED', 'SHORT_OPTIONAL'] as const;
export type PackagingRisk = (typeof PACKAGING_RISKS)[number];

export const PACKAGING_RISK_LABELS: Record<PackagingRisk, string> = {
  NO_SPECIFICATION: 'No pack specification',
  BLOCKED: 'Packaging short',
  SHORT_OPTIONAL: 'Partly short',
};

/** One short component, trimmed to what an alert needs to say. */
export interface PackagingShortageComponent {
  itemCode: string;
  itemName: string;
  uom: string;
  quantityRequired: string;
  quantityAvailable: string;
  quantityShort: string;
  requirement: PackagingComponentRequirement;
}

/** One planned batch that will not pack cleanly. */
export interface PackagingShortagePlan {
  planId: string;
  planNumber: string;
  productCode: string;
  productName: string;
  /** Null when the plan did not name one; see the note on matching. */
  packVariant: string | null;
  plannedQuantity: string;
  /** YYYY-MM-DD, or null when the plan carries no date. */
  plannedDate: string | null;
  /**
   * Whole days until the batch is due. Negative when the date has passed,
   * null when the plan has no date — which is itself worth showing, because an
   * undated plan is one nobody can schedule packaging material against.
   */
  daysUntilPacking: number | null;
  risk: PackagingRisk;
  shortComponents: PackagingShortageComponent[];
}

/**
 * The dashboard alert — US-MD-06's fourth criterion.
 *
 * Present only for roles whose dashboard carries the production or purchase
 * sections. Purchase because a packaging shortage is a purchase action: the
 * person who can fix it is the buyer, not the packing line.
 */
export interface PackagingShortageAlert {
  /** Soonest due first; undated plans last. */
  plans: PackagingShortagePlan[];
  /** How many of `plans` would stop the line rather than merely warn. */
  blockedCount: number;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface PackagingLineInput {
  itemId: string;
  level: PackagingLevel;
  quantityPer: string;
  quantityBasis: PackagingQuantityBasis;
  requirement: PackagingComponentRequirement;
  notes?: string | null;
}

export interface CreatePackagingRequirementRequest {
  productId: string;
  packVariant: string;
  unitsPerPack: string;
  lines: PackagingLineInput[];
  isActive?: boolean;
  notes?: string;
}

/**
 * A change to an existing specification. Omitted means unchanged.
 *
 * `lines`, when given, REPLACES the set: an amended pack specification restates
 * what the pack contains, and merging would make removing a component
 * impossible.
 */
export interface UpdatePackagingRequirementRequest {
  packVariant?: string;
  unitsPerPack?: string;
  lines?: PackagingLineInput[];
  isActive?: boolean;
  notes?: string | null;
}
