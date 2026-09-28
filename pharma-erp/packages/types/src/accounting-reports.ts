/**
 * US-ACC-03 — the purchase and sales registers.
 *
 * READ-ONLY, AND DELIBERATELY SO. Nothing in this contract creates, amends or
 * cancels an invoice; the registers report what the two invoice tables already
 * hold. That is also why there is no register-specific persistence: a register
 * that stored its own copy of an invoice could disagree with the invoice.
 *
 * ONE SHAPE FOR BOTH REGISTERS, because they answer the same question of two
 * different ledgers and the screen that renders them should not fork. Where
 * the two genuinely differ, the difference is in the DATA and is named here
 * rather than smoothed over — see `gstSplitRecorded`.
 */

/** Both registers are asked for a closed date range, inclusive at both ends. */
export interface RegisterQuery {
  /** ISO date, no time. */
  from: string;
  to: string;
}

export interface RegisterSummary {
  invoiceCount: number;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  totalTax: string;
  invoiceValue: string;
}

/** One day's totals, for the value trend. Days with no invoices are absent. */
export interface RegisterTrendPoint {
  /** ISO date, no time. */
  date: string;
  taxableValue: string;
  invoiceValue: string;
  invoiceCount: number;
}

/**
 * One line of one invoice — the register's unit, not the invoice.
 *
 * A tax register is read line by line: HSN and rate belong to the line, and an
 * invoice with three HSN codes is three rows. The invoice-level figures repeat
 * across its lines, which is what lets the table be read or exported flat.
 */
export interface RegisterRow {
  invoiceId: string;
  invoiceNumber: string;
  /** ISO date, no time. */
  invoiceDate: string;
  /** Vendor on the purchase register, customer on the sales register. */
  partyName: string;
  partyGstin: string | null;
  itemCode: string;
  itemName: string;
  hsnCode: string | null;
  quantity: string;
  uom: string;
  taxableValue: string;
  gstRatePercent: string;
  /**
   * Null where the source does not record it — see `gstSplitRecorded`. Null is
   * NOT zero: zero would assert a split that nobody wrote down.
   */
  cgst: string | null;
  sgst: string | null;
  igst: string | null;
  totalTax: string;
  lineTotal: string;
  /** The whole invoice's total, repeated on each of its lines. */
  invoiceTotal: string;
}

export interface RegisterReport {
  register: 'purchase' | 'sales';
  from: string;
  to: string;
  summary: RegisterSummary;
  trend: readonly RegisterTrendPoint[];
  rows: readonly RegisterRow[];
  /**
   * Whether the source records CGST/SGST/IGST separately.
   *
   * False for purchases: `purchase_invoices` holds one combined tax amount and
   * `purchase_invoice_lines` a single `taxAmount`, with no split and no
   * inter-state marker. The register says so rather than showing three zeroes
   * or inferring a classification the invoice never carried.
   */
  gstSplitRecorded: boolean;
}
