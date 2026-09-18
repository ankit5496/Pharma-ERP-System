/**
 * Line and document arithmetic, for showing a total while somebody is typing.
 *
 * THIS IS A PREVIEW, NOT THE ANSWER. The figures written to the database are
 * computed by the API in `computeLineAmounts` / `sumLineAmounts`, on
 * Prisma.Decimal, and that is what a purchase order is billed on. This exists
 * because a form that shows a stale total while its inputs change reads as
 * broken — the user changes a quantity, the total sits there, and the natural
 * conclusion is that the edit did not take.
 *
 * SO IT MIRRORS THE SERVER'S RULES EXACTLY, and the details matter:
 *
 *   ROUNDED AT THE LINE, NOT AT THE DOCUMENT. Summing unrounded lines and
 *   rounding once at the end gives a total that does not equal the sum of the
 *   printed lines, and a vendor reconciling an invoice by hand will notice.
 *
 *   HALF UP, matching Indian GST invoicing convention and the server's
 *   ROUND_HALF_UP.
 *
 * It runs on doubles, which Decimal exists precisely to avoid — so a paisa of
 * disagreement in a pathological case is possible, and is why this number is
 * never submitted. Only the quantity, rate and tax rate are sent; the server
 * recomputes from those and its answer is the one that is stored.
 */

/**
 * Two decimal places, half up.
 *
 * The nudge counters binary representation error: 1.005 is stored as
 * 1.00499999999999989, so `Math.round(100.499…)` gives 100 where the
 * arithmetic says 101. Quantities and rates here are non-negative — the inputs
 * set `min="0"` — so `Math.round`'s half-up-on-positives is the right rule.
 */
function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;

  return Math.round(value * 100 + 1e-9) / 100;
}

/** A number from a form field, where empty and rubbish both mean zero. */
function read(value: string): number {
  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

export interface LineAmounts {
  taxableAmount: number;
  taxAmount: number;
  totalAmount: number;
}

/** Taxable, tax and total for one line, from what is currently in the fields. */
export function lineAmounts(quantity: string, rate: string, taxRatePercent: string): LineAmounts {
  const taxableAmount = round2(read(quantity) * read(rate));
  const taxAmount = round2((taxableAmount * read(taxRatePercent)) / 100);

  return { taxableAmount, taxAmount, totalAmount: taxableAmount + taxAmount };
}

/** The document total: the sum of ALREADY ROUNDED line totals. */
export function sumLineAmounts(lines: readonly LineAmounts[]): LineAmounts {
  return lines.reduce<LineAmounts>(
    (total, line) => ({
      taxableAmount: total.taxableAmount + line.taxableAmount,
      taxAmount: total.taxAmount + line.taxAmount,
      totalAmount: total.totalAmount + line.totalAmount,
    }),
    { taxableAmount: 0, taxAmount: 0, totalAmount: 0 },
  );
}

/**
 * An amount as the rest of the application prints one: two places, always.
 *
 * `toFixed(2)` rather than a locale format, because these sit beside values
 * that came from the API as decimal strings and the two must not look
 * different from one another.
 */
export function formatAmount(value: number): string {
  return value.toFixed(2);
}
