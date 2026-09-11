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
