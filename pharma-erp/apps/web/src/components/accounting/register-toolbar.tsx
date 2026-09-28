'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import type { RegisterReport } from '@pharma-erp/types';

/**
 * The date range, what the register covers, and the export.
 *
 * THE RANGE LIVES IN THE URL, so a register is a link: "the September purchase
 * register" can be sent to somebody and opens as the same report. It is also
 * what lets the page be a server component — the dates arrive as search params
 * and the report is fetched on the server, already filtered.
 *
 * CHANGING A DATE RUNS THE REPORT. There is no Generate button: a date input
 * reports nothing until the whole date is valid — it holds an empty string
 * while you are part-way through — so a half-typed year cannot reach the
 * server the way it could from a text box. The short debounce is for the
 * picker, where clicking through months would otherwise fire a query per
 * click.
 */
export function RegisterToolbar({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A timer outliving the toolbar would navigate after the user had left.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const invalid = Boolean(draftFrom && draftTo && draftFrom > draftTo);

  /** Applies a range. Nothing is asked of the server until both ends are set. */
  const apply = (nextFrom: string, nextTo: string) => {
    if (!nextFrom || !nextTo || nextFrom > nextTo) return;

    const next = new URLSearchParams(params.toString());
    next.set('from', nextFrom);
    next.set('to', nextTo);
    // Back to page one: the line that was on page four of September is not the
    // same line on page four of October.
    next.delete('page');

    startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  };

  const change = (nextFrom: string, nextTo: string) => {
    setDraftFrom(nextFrom);
    setDraftTo(nextTo);

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(nextFrom, nextTo), 400);
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="register-from" className="field-label">
            From date
          </label>
          <input
            id="register-from"
            type="date"
            value={draftFrom}
            onChange={(event) => change(event.target.value, draftTo)}
            className="field mt-1.5 h-10 w-44"
          />
        </div>

        <div>
          <label htmlFor="register-to" className="field-label">
            To date
          </label>
          <input
            id="register-to"
            type="date"
            value={draftTo}
            onChange={(event) => change(draftFrom, event.target.value)}
            className="field mt-1.5 h-10 w-44"
          />
        </div>

        {/* The only feedback the Generate button used to give. Without it a
            slow report would look like a range that did nothing. */}
        <p aria-live="polite" className="pb-2.5 text-xs text-slate-500">
          {isPending ? 'Running the register…' : ''}
        </p>
      </div>

      {invalid && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-700">
          The From date is after the To date, so the register has not been re-run.
        </p>
      )}
    </section>
  );
}

/**
 * Writes the register as CSV.
 *
 * CSV, NOT XLSX: the project has no spreadsheet library, and adding one to
 * write a flat table would be a dependency for its own sake. Excel opens this.
 *
 * THE SAME ROWS THE TABLE RENDERS, taken from the report the page was given
 * rather than fetched again. A second request could return a different answer
 * — an invoice raised in between — and an export that disagrees with the
 * screen it came from is worse than no export.
 */
export function ExportButton({ report, filename }: { report: RegisterReport | null; filename: string }) {
  const rows = report?.rows ?? [];

  const download = () => {
    if (!report || rows.length === 0) return;

    const header = [
      'Invoice number',
      'Invoice date',
      report.register === 'purchase' ? 'Supplier' : 'Customer',
      'GSTIN',
      'Item code',
      'Item',
      'HSN',
      'Quantity',
      'UoM',
      'Taxable value',
      'GST rate %',
      'CGST',
      'SGST',
      'IGST',
      'Total tax',
      'Line total',
      'Invoice total',
    ];

    const body = rows.map((row) => [
      row.invoiceNumber,
      row.invoiceDate,
      row.partyName,
      row.partyGstin ?? '',
      row.itemCode,
      row.itemName,
      row.hsnCode ?? '',
      row.quantity,
      row.uom,
      row.taxableValue,
      row.gstRatePercent,
      // Empty rather than 0.00 where the split is not recorded: a zero in a tax
      // column is a statement that no such tax was charged.
      row.cgst ?? '',
      row.sgst ?? '',
      row.igst ?? '',
      row.totalTax,
      row.lineTotal,
      row.invoiceTotal,
    ]);

    const csv = [header, ...body].map((line) => line.map(escapeCsv).join(',')).join('\r\n');

    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${filename}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={download}
      disabled={rows.length === 0}
      title={rows.length === 0 ? 'Nothing to export for this period.' : undefined}
      // The same solid button the Order-to-Cash panels use for their primary
      // action, and h-9 because it shares a row with Search and Filter.
      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
    >
      Export CSV
    </button>
  );
}

/**
 * Quotes a field for CSV.
 *
 * The leading-character guard is not decoration: a value starting with =, +, -
 * or @ is executed as a formula when the file is opened in Excel, so a party
 * named "=cmd|..." would run on somebody's machine. Prefixing a quote keeps
 * the text intact and inert.
 */
/**
 * Excel reads a CSV as the local code page unless it starts with a byte-order
 * mark, which is the difference between a rupee sign and mojibake. Built from its
 * code point rather than typed: an invisible U+FEFF sitting in the source is
 * the kind of character that survives a copy-paste and breaks something else.
 */
const BOM = String.fromCharCode(0xfeff);

function escapeCsv(value: string): string {
  const risky = /^[=+\-@]/.test(value);
  const text = risky ? `'${value}` : value;

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
