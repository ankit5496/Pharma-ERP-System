import { BadRequestException } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';

/**
 * Decimal handling for the procurement module.
 *
 * Everything here exists to keep quantities and money away from JS numbers.
 * `0.1 + 0.2 !== 0.3` is a curiosity in most software and a defect in this
 * one: a dispensing quantity or an invoice total that is wrong in the fourth
 * decimal place is a regulatory problem. So values arrive as strings, are
 * parsed straight into Prisma.Decimal, are computed on as Decimal, and are
 * serialised back to strings. No arithmetic ever touches a `number`.
 */

export type Decimal = Prisma.Decimal;

export const ZERO = new Prisma.Decimal(0);

/** Money is always two decimal places, including trailing zeros. */
export function money(value: Prisma.Decimal | string | number): string {
  return new Prisma.Decimal(value).toFixed(2);
}

/**
 * Quantities render at up to four places with trailing zeros trimmed, so a
 * whole-number kilogram reads "50" rather than "50.0000" while 0.125 keeps its
 * precision. Display only — the stored value is unaffected.
 */
export function qty(value: Prisma.Decimal | string | number): string {
  const fixed = new Prisma.Decimal(value).toFixed(4);

  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** Percentages, e.g. a 12% GST rate, as "12.00". */
export function percent(value: Prisma.Decimal | string | number): string {
  return new Prisma.Decimal(value).toFixed(2);
}

/**
 * Parses a client-supplied decimal, rejecting anything that is not a finite
 * number.
 *
 * A 400 rather than a coerced NaN: `new Decimal('abc')` throws, and letting
 * that surface as a 500 would blame the server for a malformed request body.
 */
export function parseDecimal(value: string | number, field: string): Prisma.Decimal {
  try {
    const parsed = new Prisma.Decimal(value);

    if (!parsed.isFinite()) throw new Error('not finite');

    return parsed;
  } catch {
    throw new BadRequestException(`${field} must be a number.`);
  }
}

/** Parses and requires a strictly positive value — a quantity or an amount. */
export function parsePositive(value: string | number, field: string): Prisma.Decimal {
  const parsed = parseDecimal(value, field);

  if (parsed.lessThanOrEqualTo(0)) {
    throw new BadRequestException(`${field} must be greater than zero.`);
  }

  return parsed;
}

/** Parses and requires a non-negative value — a rejected quantity may be zero. */
export function parseNonNegative(value: string | number, field: string): Prisma.Decimal {
  const parsed = parseDecimal(value, field);

  if (parsed.isNegative()) {
    throw new BadRequestException(`${field} cannot be negative.`);
  }

  return parsed;
}

/**
 * Line arithmetic: taxable, tax and total from quantity, rate and tax rate.
 *
 * Rounded to two places at the LINE, not at the document. Summing unrounded
 * lines and rounding once at the end gives a total that does not equal the sum
 * of the printed lines, and a vendor reconciling an invoice by hand will
 * notice. ROUND_HALF_UP matches Indian GST invoicing convention.
 */
export function computeLineAmounts(
  quantity: Prisma.Decimal,
  rate: Prisma.Decimal,
  taxRatePercent: Prisma.Decimal,
): { taxableAmount: Prisma.Decimal; taxAmount: Prisma.Decimal; totalAmount: Prisma.Decimal } {
  const taxableAmount = quantity.times(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  const taxAmount = taxableAmount
    .times(taxRatePercent)
    .dividedBy(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  return { taxableAmount, taxAmount, totalAmount: taxableAmount.plus(taxAmount) };
}

/** Document totals: the sum of already-rounded line amounts. */
export function sumLineAmounts(
  lines: readonly {
    taxableAmount: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
  }[],
): { taxableAmount: Prisma.Decimal; taxAmount: Prisma.Decimal; totalAmount: Prisma.Decimal } {
  return lines.reduce(
    (acc, line) => ({
      taxableAmount: acc.taxableAmount.plus(line.taxableAmount),
      taxAmount: acc.taxAmount.plus(line.taxAmount),
      totalAmount: acc.totalAmount.plus(line.totalAmount),
    }),
    { taxableAmount: ZERO, taxAmount: ZERO, totalAmount: ZERO },
  );
}

/**
 * How far `actual` departs from `expected`, as an absolute percentage.
 *
 * Used by the three-way match. Absolute because a tolerance is symmetric: an
 * invoice 5% under what was received is as much an exception as one 5% over,
 * and only one of those is in the buyer's favour.
 *
 * An expected value of zero returns 100 rather than dividing: anything billed
 * against nothing received is a total mismatch, not an infinite one.
 */
export function percentageDrift(
  actual: Prisma.Decimal,
  expected: Prisma.Decimal,
): Prisma.Decimal {
  if (expected.isZero()) {
    return actual.isZero() ? ZERO : new Prisma.Decimal(100);
  }

  return actual
    .minus(expected)
    .dividedBy(expected)
    .times(100)
    .abs()
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** `a - b`, never below zero. Used for shortfalls and pending quantities. */
export function positiveDifference(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  const difference = a.minus(b);

  return difference.isNegative() ? ZERO : difference;
}

/**
 * Whole days from now until `date`, negative once it has passed.
 *
 * Both sides are truncated to UTC midnight first, so "due today" is 0 rather
 * than a fraction that rounds unpredictably depending on the time of day the
 * page happens to be loaded.
 */
export function daysUntil(date: Date, now: Date = new Date()): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return Math.round((target - today) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Purchase order fulfilment
// ---------------------------------------------------------------------------

/** The three quantities a purchase order line carries. */
export interface FulfilmentQuantities {
  quantity: Prisma.Decimal | string | number;
  quantityReceived: Prisma.Decimal | string | number;
  quantityCancelled: Prisma.Decimal | string | number;
}

/**
 * What may still be received on a line: ordered, less what arrived, less what
 * was short-closed. Floored at zero.
 *
 * ONE DEFINITION, used by the order service to report it, the receipt service
 * to cap what may be booked, and both to decide an order's status. Three
 * copies of this arithmetic is how a form offers to receive a quantity the
 * API then refuses.
 */
export function pendingOn(line: FulfilmentQuantities): Prisma.Decimal {
  return positiveDifference(
    new Prisma.Decimal(line.quantity),
    new Prisma.Decimal(line.quantityReceived).plus(new Prisma.Decimal(line.quantityCancelled)),
  );
}

/**
 * A purchase order's status, derived from its lines rather than from whichever
 * receipt happened last.
 *
 *   nothing outstanding             -> CLOSED
 *   something received, more due    -> PARTIALLY_RECEIVED
 *   nothing received yet            -> unchanged (OPEN or APPROVED)
 *
 * CLOSED MEANS FINISHED, whether every unit arrived or the balance was short
 * closed. The two are still distinguishable where it matters — a short-closed
 * order carries a cancelled quantity on its lines and a fully received one
 * does not — but the order itself gets one word for "done".
 *
 * `current` is returned untouched when nothing has been received, which is what
 * protects APPROVED. Approval is the one status a person sets, and a receipt
 * that brings in nothing (every line rejected at the gate) must not silently
 * un-approve the order.
 *
 * CANCELLED is never produced here: abandoning an order is a decision, not a
 * consequence of receiving.
 */
export function fulfilmentStatus(
  lines: readonly FulfilmentQuantities[],
  current: 'OPEN' | 'APPROVED' | 'PARTIALLY_RECEIVED' | 'CLOSED' | 'CANCELLED',
): 'OPEN' | 'APPROVED' | 'PARTIALLY_RECEIVED' | 'CLOSED' {
  if (current === 'CANCELLED') return 'CLOSED';

  const anythingPending = lines.some((line) => pendingOn(line).greaterThan(0));

  if (!anythingPending) return 'CLOSED';

  const anythingReceived = lines.some((line) =>
    new Prisma.Decimal(line.quantityReceived).greaterThan(0),
  );

  if (anythingReceived) return 'PARTIALLY_RECEIVED';

  // Nothing in yet: whatever the order was before — Open, or Approved and
  // waiting for the vendor — is still true.
  return current === 'PARTIALLY_RECEIVED' || current === 'CLOSED' ? 'OPEN' : current;
}
