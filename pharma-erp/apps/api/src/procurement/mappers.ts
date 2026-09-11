import type { QcResultItem, StockLotSummary } from '@pharma-erp/types';

import { toPartySummary } from '../parties/parties.service';
import { toItemSummary } from '../production/production.mappers';

import { qty } from './decimal.util';

/**
 * Items and parties are mapped by the modules that own those registers, not
 * here.
 *
 * This module used to build its own, from its own narrower row type. That was
 * how two shapes for one table stayed hidden — each flow mapped what it
 * happened to select and neither noticed the other. Re-exported so the call
 * sites in this flow are unchanged.
 */
export { toItemSummary, toPartySummary };

/**
 * Row-to-contract mappers.
 *
 * Every list endpoint in this module returns the same shapes for an item, a
 * party and a lot, so they are built in one place. The alternative — each
 * service assembling its own — is how one screen ends up showing a lot's
 * expiry and another silently omitting it.
 */

/**
 * The whole item row, not a hand-picked subset.
 *
 * It used to select eight columns, which was right when procurement owned its
 * own `items` shape. It no longer does: `ItemSummary` is declared once, in
 * @pharma-erp/types production.ts, and describes every column the master-data
 * screens maintain. A narrower select here would mean this flow could not
 * build one — and keeping two lists in step by hand is the thing that went
 * wrong in the first place.
 */
export const ITEM_SELECT = {
  id: true,
  tenantId: true,
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
  requiresBatchTracking: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

export const PARTY_SELECT = {
  id: true,
  tenantId: true,
  code: true,
  name: true,
  partyType: true,
  status: true,
  gstin: true,
  drugLicenceNumber: true,
  drugLicenceValidTo: true,
  email: true,
  phone: true,
  address: true,
  paymentTermsDays: true,
  creditLimit: true,
  creditPeriodDays: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
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
