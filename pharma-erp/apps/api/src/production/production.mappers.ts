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
