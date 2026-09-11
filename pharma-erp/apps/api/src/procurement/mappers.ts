import type {
  ItemSummary,
  PartySummary,
  BomSummary,
  ProductionPlanSummary,
  QcResultItem,
  StockLotSummary,
} from '@pharma-erp/types';

import { money, percent, qty } from './decimal.util';

/**
 * Row-to-contract mappers.
 *
 * Every list endpoint in this module returns the same shapes for an item, a
 * party and a lot, so they are built in one place. The alternative — each
 * service assembling its own — is how one screen ends up showing a lot's
 * expiry and another silently omitting it.
 */

/** Fields every caller selects for an item. Mirrors the shared items table. */
export const ITEM_SELECT = {
  id: true,
  code: true,
  name: true,
  type: true,
  uom: true,
  shelfLifeMonths: true,
  hsnCode: true,
  brandName: true,
  genericName: true,
  scheduleClassification: true,
  gstRate: true,
  mrp: true,
  dpcoCeiling: true,
  storageConditions: true,
  reorderLevel: true,
  reorderQuantity: true,
} as const;

/**
 * Whether a receipt of this item must carry a batch number and expiry.
 *
 * DERIVED, because the shared item master has no such column — and derived as
 * "always", because this is a pharmaceutical ERP. Every material that enters a
 * plant, from an API to a carton, has to be traceable to a vendor lot for
 * recall and for inspection. If an exception ever turns out to be real it
 * belongs as a column on the shared table, decided with the master-data work,
 * not as a quiet special case here.
 */
export function requiresBatchTracking(_type: string): boolean {
  return true;
}

type ItemRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  uom: string;
  shelfLifeMonths: number | null;
  hsnCode: string | null;
  brandName: string | null;
  genericName: string | null;
  scheduleClassification: string;
  gstRate: unknown;
  mrp: unknown;
  dpcoCeiling: boolean;
  storageConditions: string | null;
  reorderLevel: unknown;
  reorderQuantity: unknown;
};

export function toItemSummary(row: ItemRow): ItemSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type as ItemSummary['type'],
    uom: row.uom,
    shelfLifeMonths: row.shelfLifeMonths,
    hsnCode: row.hsnCode,
    brandName: row.brandName,
    genericName: row.genericName,
    scheduleClassification: row.scheduleClassification as ItemSummary['scheduleClassification'],
    // Nullable throughout: on the shared schema these are genuinely optional,
    // and null means "not configured" rather than zero. Coercing a missing
    // reorder level to 0 would quietly exempt the item from the low-stock
    // check instead of flagging that nobody has set a policy for it.
    gstRate: row.gstRate === null ? null : percent(row.gstRate as never),
    mrp: row.mrp === null ? null : money(row.mrp as never),
    dpcoCeiling: row.dpcoCeiling,
    storageConditions: row.storageConditions,
    reorderLevel: row.reorderLevel === null ? null : qty(row.reorderLevel as never),
    reorderQuantity: row.reorderQuantity === null ? null : qty(row.reorderQuantity as never),
    requiresBatchTracking: requiresBatchTracking(row.type),
  };
}

/** Shape a BOM must be loaded with for the mapper below. */
export const BOM_INCLUDE = {
  product: { select: ITEM_SELECT },
  lines: { include: { item: { select: ITEM_SELECT } }, orderBy: { id: 'asc' } },
} as const;

export function toBomSummary(row: {
  id: string;
  version: number;
  outputQuantity: unknown;
  isActive: boolean;
  effectiveFrom: Date | null;
  product: ItemRow;
  lines: { id: string; quantityPer: unknown; notes: string | null; item: ItemRow }[];
}): BomSummary {
  return {
    id: row.id,
    version: row.version,
    product: toItemSummary(row.product),
    outputQuantity: qty(row.outputQuantity as never),
    isActive: row.isActive,
    effectiveFrom: toDateOnly(row.effectiveFrom),
    lines: row.lines.map((line) => ({
      id: line.id,
      item: toItemSummary(line.item),
      quantityPer: qty(line.quantityPer as never),
      notes: line.notes,
    })),
  };
}

export const PARTY_SELECT = {
  id: true,
  code: true,
  name: true,
  partyType: true,
  gstin: true,
  drugLicenceNumber: true,
  email: true,
  phone: true,
  paymentTermsDays: true,
} as const;

export const LOT_SELECT = {
  id: true,
  lotNumber: true,
  vendorBatchNumber: true,
  manufacturingDate: true,
  expiryDate: true,
  quantityReceived: true,
  quantityAvailable: true,
  status: true,
  storageLocation: true,
} as const;

type PartyRow = {
  id: string;
  code: string;
  name: string;
  partyType: string;
  gstin: string | null;
  drugLicenceNumber: string | null;
  email: string | null;
  phone: string | null;
  paymentTermsDays: number;
};

export function toPartySummary(row: PartyRow): PartySummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    partyType: row.partyType as PartySummary['partyType'],
    gstin: row.gstin,
    drugLicenceNumber: row.drugLicenceNumber,
    email: row.email,
    phone: row.phone,
    paymentTermsDays: row.paymentTermsDays,
  };
}

type LotRow = {
  id: string;
  lotNumber: string;
  vendorBatchNumber: string | null;
  manufacturingDate: Date | null;
  expiryDate: Date | null;
  quantityReceived: unknown;
  quantityAvailable: unknown;
  status: string;
  storageLocation: string | null;
};

export function toStockLotSummary(row: LotRow): StockLotSummary {
  return {
    id: row.id,
    lotNumber: row.lotNumber,
    vendorBatchNumber: row.vendorBatchNumber,
    // Date columns, not timestamps: sliced to YYYY-MM-DD so no timezone shift
    // can move a manufacturing date across a day boundary in the browser.
    manufacturingDate: toDateOnly(row.manufacturingDate),
    expiryDate: toDateOnly(row.expiryDate),
    quantityReceived: qty(row.quantityReceived as never),
    quantityAvailable: qty(row.quantityAvailable as never),
    status: row.status as StockLotSummary['status'],
    storageLocation: row.storageLocation,
  };
}

export function toQcResultItem(
  row: {
    id: string;
    decision: string;
    testReference: string | null;
    remarks: string | null;
    inspectedById: string;
    inspectedAt: Date;
  },
  people: PeopleMap,
): QcResultItem {
  return {
    id: row.id,
    decision: row.decision as QcResultItem['decision'],
    testReference: row.testReference,
    remarks: row.remarks,
    inspectedBy: people.get(row.inspectedById) ?? null,
    inspectedAt: row.inspectedAt.toISOString(),
  };
}

/** `YYYY-MM-DD` for a Postgres `date`, or null. */
export function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Shape a production plan must be loaded with for the mapper below. */
export const PRODUCTION_PLAN_INCLUDE = {
  finishedProduct: { select: ITEM_SELECT },
  bom: { include: BOM_INCLUDE },
} as const;

export function toProductionPlanSummary(row: {
  id: string;
  number: string;
  packVariant: string | null;
  plannedQuantity: unknown;
  plannedDate: Date | null;
  status: string;
  finishedProduct: Parameters<typeof toItemSummary>[0];
  bom: Parameters<typeof toBomSummary>[0] | null;
}): ProductionPlanSummary {
  return {
    id: row.id,
    number: row.number,
    finishedProduct: toItemSummary(row.finishedProduct),
    packVariant: row.packVariant,
    plannedQuantity: qty(row.plannedQuantity as never),
    plannedDate: toDateOnly(row.plannedDate),
    status: row.status as ProductionPlanSummary['status'],
    // The component list comes from the BOM, not from a parallel table.
    bom: row.bom ? toBomSummary(row.bom) : null,
  };
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * User id to display name.
 *
 * The document tables store acting-user ids without a Prisma relation (see the
 * schema's note on why), so names are resolved in one batched query per list
 * rather than a join per row. A missing id maps to null rather than throwing:
 * an id can outlive nothing here, but a soft-deleted user still resolves and
 * that is the point.
 */
export type PeopleMap = Map<string, string>;

export const EMPTY_PEOPLE: PeopleMap = new Map();

/** Collects the non-null ids from a set of rows, ready for `loadPeople`. */
export function collectIds(...ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
}
