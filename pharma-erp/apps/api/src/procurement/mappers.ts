import type {
  ItemSummary,
  PartySummary,
  QcResultItem,
  StockLotSummary,
} from '@pharma-erp/types';

import { qty } from './decimal.util';

/**
 * Row-to-contract mappers.
 *
 * Every list endpoint in this module returns the same shapes for an item, a
 * party and a lot, so they are built in one place. The alternative — each
 * service assembling its own — is how one screen ends up showing a lot's
 * expiry and another silently omitting it.
 */

/** Fields every caller selects for an item. Keep in step with ItemSummary. */
export const ITEM_SELECT = {
  id: true,
  code: true,
  name: true,
  itemType: true,
  uom: true,
  reorderLevel: true,
  requiresBatchTracking: true,
  hsnCode: true,
} as const;

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

type ItemRow = {
  id: string;
  code: string;
  name: string;
  itemType: string;
  uom: string;
  reorderLevel: unknown;
  requiresBatchTracking: boolean;
  hsnCode: string | null;
};

export function toItemSummary(row: ItemRow): ItemSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    itemType: row.itemType as ItemSummary['itemType'],
    uom: row.uom as ItemSummary['uom'],
    reorderLevel: qty(row.reorderLevel as never),
    requiresBatchTracking: row.requiresBatchTracking,
    hsnCode: row.hsnCode,
  };
}

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
