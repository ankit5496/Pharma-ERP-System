import type { Item } from '@pharma-erp/database';
import type { ItemSummary } from '@pharma-erp/types';

/**
 * The Item row as Prisma returns it.
 *
 * An alias, not a hand-written shape. It used to list the six columns the
 * mappers happened to need, which meant every column added to the model had
 * to be copied here as well — and the first time that was missed, `type`
 * stayed narrowed to the three ItemType values that existed when it was
 * written, and call sites nowhere near this file stopped compiling.
 *
 * Derived from the generated model, the two cannot disagree.
 */
export type ItemRow = Item;

export function toItemSummary(item: ItemRow): ItemSummary {
  return {
    id: item.id,
    // Resolved by the register that lists these; a bare mapper has no name
    // lookup, and threading one through sixteen call sites for a field only
    // Master Data shows would be a poor trade.
    createdBy: null,
    createdAt: item.createdAt.toISOString(),
    code: item.code,
    name: item.name,
    type: item.type,
    uom: item.uom,
    shelfLifeMonths: item.shelfLifeMonths,
    hsnCode: item.hsnCode,
    brandName: item.brandName,
    genericName: item.genericName,
    scheduleClassification: item.scheduleClassification,
    // `toString()` on a Prisma Decimal, never Number(): the column is exact
    // and a double is not. See the note at the top of @pharma-erp/types
    // production.ts — the UI formats these, it never does arithmetic on them.
    gstRate: item.gstRate?.toString() ?? null,
    mrp: item.mrp?.toString() ?? null,
    dpcoCeiling: item.dpcoCeiling,
    storageConditions: item.storageConditions,
    reorderLevel: item.reorderLevel?.toString() ?? null,
    reorderQuantity: item.reorderQuantity?.toString() ?? null,
    requiresBatchTracking: item.requiresBatchTracking,
    notes: item.notes,
  };
}

/**
 * Formats a `@db.Date` column as YYYY-MM-DD.
 *
 * `toISOString().slice(0, 10)` and not `toLocaleDateString`: a date column
 * comes back from the driver as midnight UTC, and converting it through a
 * local timezone west of Greenwich moves it to the previous day. An expiry
 * date that shifts by a day depending on where the server runs is a labelling
 * error, so the UTC calendar day is taken verbatim.
 */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Midnight UTC for a YYYY-MM-DD string, matching how `@db.Date` round-trips.
 *
 * `new Date('2026-09-10')` already parses as UTC midnight; this exists so the
 * intent is stated at the call sites rather than resting on that detail.
 */
export function fromIsoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

/** Today as a `@db.Date`-compatible value, in UTC calendar terms. */
export function todayUtc(): Date {
  return fromIsoDate(new Date().toISOString());
}

/**
 * Adds whole months, clamping to the end of the target month.
 *
 * Used to date an expiry from a product's shelf life. Without the clamp,
 * 31 August + 6 months would roll into 3 March — JavaScript's Date silently
 * overflows — and an expiry date that is wrong by two days on some batches and
 * not others is exactly the sort of thing found during an inspection rather
 * than in testing.
 */
export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();

  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return new Date(Date.UTC(year, month, Math.min(day, lastDayOfTargetMonth)));
}

/**
 * Beyond this the earliest-expiring lot is skipped rather than issued.
 *
 * Zero: any unexpired usable lot may be consumed. Kept as a named constant
 * because a real plant usually wants a margin here — material that expires
 * mid-campaign is no use — and the place to put it should be obvious.
 */
export const MINIMUM_SHELF_LIFE_DAYS = 0;

/**
 * WHAT COUNTS AS ISSUABLE STOCK. One definition, used by everything that asks.
 *
 * This exists because there used to be two. The work-order gate summed every
 * lot marked USABLE; the FEFO allocator additionally required the lot to be
 * unexpired and to have something left in it. So a work order could pass the
 * "blocks confirmation if any required material is insufficient" check against
 * stock that was entirely expired, and then fail at dispensing time with a
 * shortage the person raising it had already been told they did not have — the
 * precise "promise the store cannot keep" that gate exists to prevent.
 *
 * The three conditions, and why each is here:
 *
 *   status USABLE       quarantined material has not passed incoming QC and
 *                       rejected material never will.
 *   quantityAvailable   a fully-drawn lot is a row, not stock.
 *   not expired         with no-expiry lots INCLUDED: cartons, leaflets and
 *                       shippers carry none, and testing `expiryDate >= cutoff`
 *                       alone would silently make every one of them unissuable.
 *
 * The cutoff is a DATE, from `todayUtc()`, not an instant. `expiryDate` is a
 * `@db.Date` stored at midnight UTC, so comparing it against `new Date()` —
 * which carries a time of day — excluded lots expiring today for all but the
 * first instant of it. That made MINIMUM_SHELF_LIFE_DAYS = 0 behave as "expires
 * strictly after today", which is not what it says.
 */
export function issuableStockWhere(days: number = MINIMUM_SHELF_LIFE_DAYS) {
  const cutoff = todayUtc();
  cutoff.setUTCDate(cutoff.getUTCDate() + days);

  // Not `as const`: Prisma's generated `where` types take mutable arrays, and a
  // readonly `OR` is rejected outright.
  return {
    status: 'USABLE' as const,
    quantityAvailable: { gt: 0 },
    OR: [{ expiryDate: { gte: cutoff } }, { expiryDate: null }],
  };
}
