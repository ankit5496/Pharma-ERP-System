import { BadRequestException, Injectable } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  RegisterQuery,
  RegisterReport,
  RegisterRow,
  RegisterSummary,
  RegisterTrendPoint,
} from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';

/**
 * US-ACC-03 — the purchase and sales registers.
 *
 * READ-ONLY. Every method here is a query; nothing writes, and nothing here
 * decides tax. The figures are the ones the invoices were raised with, read
 * back — a register that recomputed GST could disagree with the document an
 * auditor is holding.
 *
 * THE DATE RANGE IS APPLIED IN THE DATABASE, not after loading. A register is
 * run over a period on purpose: a year of invoices is not something to pull
 * into a browser and filter there, and paging the query would leave the
 * summary totals disagreeing with the table under them.
 *
 * ONE ROUND TRIP FOR THE WHOLE REGISTER, which is why these are joins written
 * out rather than `include`. Every `prisma.scoped` operation opens its own
 * transaction and spends its first round trip on `set_config` — the price of
 * tenant scoping — and a nested include then fetches each relation with a
 * further query: header, party, lines, items. Against a managed database
 * ~600ms away that measured 2.9s for seven invoices, nearly all of it waiting.
 * Run inside one tenant transaction, as one join, it is two round trips
 * whatever the size of the period.
 *
 * ROW-LEVEL SECURITY STILL APPLIES. `set_config` runs first in the same
 * transaction, and the policies are enforced by Postgres against raw SQL
 * exactly as against a generated query. The dates are bound parameters, never
 * interpolated.
 *
 * DECIMALS THROUGHOUT. Money is summed with Prisma.Decimal and rendered only
 * at the end, so a register of two thousand lines does not drift by a paisa
 * the way accumulated floats would.
 */
@Injectable()
export class AccountingReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The purchase register.
   *
   * CANCELLED INVOICES ARE OUT. A cancelled purchase invoice is not a purchase,
   * and including it would overstate input tax. Everything else booked in the
   * period is in, paid or not: a register reports what was invoiced, and
   * whether it has been paid is the payables report's question.
   */
  async purchaseRegister(query: RegisterQuery): Promise<RegisterReport> {
    const { from, to } = this.range(query);

    const records = await this.prisma.transaction((tx) =>
      tx.$queryRaw<PurchaseRecord[]>`
        SELECT i.id               AS invoice_id,
               i.number           AS invoice_number,
               i.invoice_date     AS invoice_date,
               i.taxable_amount   AS invoice_taxable,
               i.tax_amount       AS invoice_tax,
               i.total_amount     AS invoice_total,
               v.name             AS party_name,
               v.gstin            AS party_gstin,
               it.code            AS item_code,
               it.name            AS item_name,
               it.hsn_code        AS hsn_code,
               it.uom             AS uom,
               l.quantity         AS quantity,
               l.tax_rate_percent AS gst_rate_percent,
               l.taxable_amount   AS line_taxable,
               l.tax_amount       AS line_tax,
               l.total_amount     AS line_total
          FROM purchase_invoices i
          JOIN parties v ON v.id = i.vendor_id
          JOIN purchase_invoice_lines l ON l.purchase_invoice_id = i.id
          JOIN items it ON it.id = l.item_id
         WHERE i.deleted_at IS NULL
           AND i.status <> 'CANCELLED'
           AND i.invoice_date >= ${from}
           AND i.invoice_date <= ${to}
         ORDER BY i.invoice_date, i.number, l.created_at`,
    );

    const rows: RegisterRow[] = records.map((record) => ({
      invoiceId: record.invoice_id,
      invoiceNumber: record.invoice_number,
      invoiceDate: toIsoDate(record.invoice_date),
      partyName: record.party_name,
      partyGstin: record.party_gstin,
      itemCode: record.item_code,
      itemName: record.item_name,
      // The purchase line carries no HSN of its own, so it comes from the item
      // master — the same place the purchase order read it from.
      hsnCode: record.hsn_code,
      quantity: record.quantity.toFixed(3),
      uom: record.uom,
      taxableValue: record.line_taxable.toFixed(2),
      gstRatePercent: record.gst_rate_percent.toFixed(2),
      // Not recorded against a purchase invoice — see `gstSplitRecorded`.
      cgst: null,
      sgst: null,
      igst: null,
      totalTax: record.line_tax.toFixed(2),
      lineTotal: record.line_total.toFixed(2),
      invoiceTotal: record.invoice_total.toFixed(2),
    }));

    // Summed from the INVOICE headers, which is why they are deduplicated: a
    // join repeats the header once per line, and adding it up as it stands
    // would multiply a three-line invoice by three.
    const invoices = byInvoice(records, (record) => ({
      date: record.invoice_date,
      taxable: record.invoice_taxable,
      cgst: null,
      sgst: null,
      igst: null,
      tax: record.invoice_tax,
      total: record.invoice_total,
    }));

    return {
      register: 'purchase',
      from: toIsoDate(from),
      to: toIsoDate(to),
      summary: summarise(invoices),
      trend: trend(invoices),
      rows,
      gstSplitRecorded: false,
    };
  }

  /**
   * The sales register.
   *
   * ISSUED ONLY. A draft invoice has no number anybody has been given and no
   * receivable behind it; a cancelled one has been reversed. Neither is a sale,
   * and this is the rule the receivables figures elsewhere already apply.
   */
  async salesRegister(query: RegisterQuery): Promise<RegisterReport> {
    const { from, to } = this.range(query);

    const records = await this.prisma.transaction((tx) =>
      tx.$queryRaw<SalesRecord[]>`
        SELECT i.id             AS invoice_id,
               i.invoice_number AS invoice_number,
               i.invoice_date   AS invoice_date,
               i.subtotal       AS invoice_taxable,
               i.cgst_amount    AS invoice_cgst,
               i.sgst_amount    AS invoice_sgst,
               i.igst_amount    AS invoice_igst,
               i.tax_amount     AS invoice_tax,
               i.grand_total    AS invoice_total,
               i.customer_gstin AS party_gstin,
               c.name           AS party_name,
               it.code          AS item_code,
               it.uom           AS uom,
               s.description    AS item_name,
               s.hsn_code       AS hsn_code,
               s.quantity       AS quantity,
               s.gst_rate_percent AS gst_rate_percent,
               s.taxable_value  AS line_taxable,
               s.cgst_amount    AS line_cgst,
               s.sgst_amount    AS line_sgst,
               s.igst_amount    AS line_igst,
               s.tax_amount     AS line_tax,
               s.line_total     AS line_total
          FROM sales_invoices i
          JOIN parties c ON c.id = i.customer_id
          JOIN sales_invoice_items s ON s.sales_invoice_id = i.id
          JOIN items it ON it.id = s.item_id
         WHERE i.deleted_at IS NULL
           AND i.status = 'ISSUED'
           AND i.invoice_date >= ${from}
           AND i.invoice_date <= ${to}
         ORDER BY i.invoice_date, i.invoice_number, s.line_number`,
    );

    const rows: RegisterRow[] = records.map((record) => ({
      invoiceId: record.invoice_id,
      invoiceNumber: record.invoice_number,
      invoiceDate: toIsoDate(record.invoice_date),
      partyName: record.party_name,
      // The GSTIN AS INVOICED, not as the customer record reads today: the
      // invoice snapshotted it, and a later correction to the party must not
      // rewrite a document already issued.
      partyGstin: record.party_gstin,
      itemCode: record.item_code,
      itemName: record.item_name,
      hsnCode: record.hsn_code,
      quantity: record.quantity.toFixed(3),
      uom: record.uom,
      taxableValue: record.line_taxable.toFixed(2),
      gstRatePercent: record.gst_rate_percent.toFixed(2),
      cgst: record.line_cgst.toFixed(2),
      sgst: record.line_sgst.toFixed(2),
      igst: record.line_igst.toFixed(2),
      totalTax: record.line_tax.toFixed(2),
      lineTotal: record.line_total.toFixed(2),
      invoiceTotal: record.invoice_total.toFixed(2),
    }));

    const invoices = byInvoice(records, (record) => ({
      date: record.invoice_date,
      // `subtotal` IS the taxable base: it already sums the lines' own taxable
      // values, which are net of their discounts. Subtracting discountAmount
      // again would double-count it — checked against the data, where subtotal
      // equals the sum of the line taxable values and subtotal + tax equals
      // grandTotal exactly.
      taxable: record.invoice_taxable,
      cgst: record.invoice_cgst,
      sgst: record.invoice_sgst,
      igst: record.invoice_igst,
      tax: record.invoice_tax,
      total: record.invoice_total,
    }));

    return {
      register: 'sales',
      from: toIsoDate(from),
      to: toIsoDate(to),
      summary: summarise(invoices),
      trend: trend(invoices),
      rows,
      gstSplitRecorded: true,
    };
  }

  /**
   * The range, as whole UTC days inclusive of both ends.
   *
   * `to` is pushed to the end of its day. Invoice dates are stored as
   * timestamps, so a plain `<= 2026-09-30` would silently drop everything
   * raised on the last day of the month — the single likeliest day for a
   * register to be run over.
   */
  private range(query: RegisterQuery): { from: Date; to: Date } {
    const from = new Date(`${query.from}T00:00:00.000Z`);
    const to = new Date(`${query.to}T23:59:59.999Z`);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Both dates must be given as YYYY-MM-DD.');
    }

    if (from > to) {
      throw new BadRequestException('The From date cannot be after the To date.');
    }

    return { from, to };
  }
}

// ---------------------------------------------------------------------------
// Query rows
// ---------------------------------------------------------------------------
//
// `numeric` comes back from Postgres as Prisma.Decimal, `timestamp` as Date.
// Typed here rather than inferred so a renamed column fails the build instead
// of rendering "undefined" into a tax register.

interface InvoiceHeaderRecord {
  invoice_id: string;
  invoice_date: Date;
  invoice_taxable: Prisma.Decimal;
  invoice_tax: Prisma.Decimal;
  invoice_total: Prisma.Decimal;
}

interface LineRecord {
  invoice_number: string;
  party_name: string;
  party_gstin: string | null;
  item_code: string;
  item_name: string;
  hsn_code: string | null;
  uom: string;
  quantity: Prisma.Decimal;
  gst_rate_percent: Prisma.Decimal;
  line_taxable: Prisma.Decimal;
  line_tax: Prisma.Decimal;
  line_total: Prisma.Decimal;
}

type PurchaseRecord = InvoiceHeaderRecord & LineRecord;

type SalesRecord = InvoiceHeaderRecord &
  LineRecord & {
    invoice_cgst: Prisma.Decimal;
    invoice_sgst: Prisma.Decimal;
    invoice_igst: Prisma.Decimal;
    line_cgst: Prisma.Decimal;
    line_sgst: Prisma.Decimal;
    line_igst: Prisma.Decimal;
  };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface InvoiceTotals {
  date: Date;
  taxable: Prisma.Decimal;
  /** Null where the source does not record the split. */
  cgst: Prisma.Decimal | null;
  sgst: Prisma.Decimal | null;
  igst: Prisma.Decimal | null;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
}

/**
 * One entry per invoice, from rows that repeat the header once per line.
 *
 * The first row wins because every row for an invoice carries the same header
 * figures; taking them once is what keeps the totals honest.
 */
function byInvoice<T extends { invoice_id: string }>(
  records: readonly T[],
  totals: (record: T) => InvoiceTotals,
): InvoiceTotals[] {
  const seen = new Map<string, InvoiceTotals>();

  for (const record of records) {
    if (!seen.has(record.invoice_id)) seen.set(record.invoice_id, totals(record));
  }

  return [...seen.values()];
}

function zero(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

function summarise(invoices: readonly InvoiceTotals[]): RegisterSummary {
  let taxable = zero();
  let cgst = zero();
  let sgst = zero();
  let igst = zero();
  let tax = zero();
  let total = zero();

  for (const invoice of invoices) {
    taxable = taxable.add(invoice.taxable);
    cgst = cgst.add(invoice.cgst ?? 0);
    sgst = sgst.add(invoice.sgst ?? 0);
    igst = igst.add(invoice.igst ?? 0);
    tax = tax.add(invoice.tax);
    total = total.add(invoice.total);
  }

  return {
    invoiceCount: invoices.length,
    taxableValue: taxable.toFixed(2),
    cgst: cgst.toFixed(2),
    sgst: sgst.toFixed(2),
    igst: igst.toFixed(2),
    totalTax: tax.toFixed(2),
    invoiceValue: total.toFixed(2),
  };
}

/**
 * Day-by-day totals.
 *
 * Only days that HAVE invoices appear. Filling the gaps with zeroes would say
 * trading collapsed every Sunday rather than that nobody invoiced.
 */
function trend(invoices: readonly InvoiceTotals[]): RegisterTrendPoint[] {
  const byDay = new Map<string, { taxable: Prisma.Decimal; total: Prisma.Decimal; count: number }>();

  for (const invoice of invoices) {
    const day = toIsoDate(invoice.date);
    const entry = byDay.get(day) ?? { taxable: zero(), total: zero(), count: 0 };

    byDay.set(day, {
      taxable: entry.taxable.add(invoice.taxable),
      total: entry.total.add(invoice.total),
      count: entry.count + 1,
    });
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entry]) => ({
      date,
      taxableValue: entry.taxable.toFixed(2),
      invoiceValue: entry.total.toFixed(2),
      invoiceCount: entry.count,
    }));
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
