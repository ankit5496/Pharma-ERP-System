import type { RegisterReport, RegisterRow } from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

import {
  RegisterFilterPanel,
  RegisterFilterToggle,
  RegisterPager,
  RegisterSearch,
  type RegisterFilterField,
  type RegisterSuggestion,
} from './register-table-controls';
import { ExportButton } from './register-toolbar';

/**
 * US-ACC-03 — one register, whichever it is.
 *
 * ONE COMPONENT FOR BOTH, because the purchase and sales registers answer the
 * same question of two ledgers: how much was invoiced in a period, how much of
 * it was tax, and on what. Two copies would drift — the columns would be
 * renamed on one and not the other — and the only real difference between them
 * lives in the data, not the layout.
 *
 * A SERVER COMPONENT. The report is fetched already filtered, so the browser
 * is never sent invoices outside the period, and the summary, the charts and
 * the table are three views of exactly one response rather than three
 * calculations that could disagree.
 */
export async function RegisterView({
  register,
  from,
  to,
  table = {},
}: {
  register: 'purchase' | 'sales';
  from: string;
  to: string;
  /**
   * The table's own search, filter and page, from the URL.
   *
   * Separate from the date range on purpose: these narrow what the TABLE
   * shows, while the range is what the whole report is about. The summary
   * cards and the charts stay period-wide, so they cannot quietly disagree
   * with the heading above them.
   */
  table?: Record<string, string>;
}) {
  const purchase = register === 'purchase';
  const title = purchase ? 'Purchase Register' : 'Sales Register';

  const result = await apiFetch<RegisterReport>(
    `/api/v1/accounting/reports/${register}-register?from=${encodeURIComponent(
      from,
    )}&to=${encodeURIComponent(to)}`,
    { authenticated: true },
  );

  const report = result.ok ? result.data : null;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>

      {!result.ok ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          The register could not be loaded. {result.error}
        </p>
      ) : (
        <>
          <SummaryCards report={report!} purchase={purchase} />

          <RegisterTable report={report!} purchase={purchase} table={table} />
        </>
      )}
    </div>
  );
}

const PAGE_SIZES = [25, 50, 100, 250] as const;
const DEFAULT_PAGE_SIZE = 50;

/**
 * The table's rows after its own search and filter.
 *
 * SEARCH AND FILTER COVER DISJOINT GROUND. Typing matches the DOCUMENT
 * identifiers — the invoice number, the GSTIN, the HSN code — the strings
 * somebody arrives holding. The filter takes the closed sets a register is
 * read by: the period, the rate, the party, the product, the tax treatment.
 * Neither offers what the other does, so a filter never restates the search
 * box and the two compose instead of competing.
 *
 * The party and the product are therefore NOT searchable: they are filters,
 * where the list of what exists in the period is offered rather than typed
 * from memory and mis-spelled.
 */
function narrow(
  rows: readonly RegisterRow[],
  table: Record<string, string>,
): readonly RegisterRow[] {
  const needle = (table.q ?? '').trim().toLowerCase();

  return rows.filter((row) => {
    if (table.rate && row.gstRatePercent !== table.rate) return false;
    if (table.party && row.partyName !== table.party) return false;
    if (table.item && row.itemCode !== table.item) return false;

    if (table.tax) {
      const interState = Number(row.igst ?? 0) > 0;
      if (table.tax === 'INTER' && !interState) return false;
      if (table.tax === 'INTRA' && interState) return false;
    }

    if (!needle) return true;

    return [row.invoiceNumber, row.partyGstin ?? '', row.hsnCode ?? '']
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });
}

/**
 * One page of the narrowed rows.
 *
 * The page is CLAMPED rather than trusted: searching shortens the list under
 * whatever page is in the URL, and page 9 of a now 2-page table has to show
 * something.
 */
function paginate(rows: readonly RegisterRow[], table: Record<string, string>) {
  const asked = Number(table.rows);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(asked) ? asked : DEFAULT_PAGE_SIZE;

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const wanted = Number(table.page);
  const page = Math.min(Math.max(Number.isFinite(wanted) && wanted > 0 ? wanted : 1, 1), pageCount);

  const start = (page - 1) * pageSize;

  return {
    rows: rows.slice(start, start + pageSize),
    page,
    pageCount,
    pageSize,
    first: total === 0 ? 0 : start + 1,
    last: Math.min(start + pageSize, total),
    total,
  };
}

/**
 * What the search box offers, built from the period on screen.
 *
 * ONE ENTRY PER THING THAT CAN BE TYPED, in the order somebody is likely to
 * reach for it: the invoice number, then the HSN code, then the GSTIN. Each
 * carries what it belongs to, because "30049099" alone does not tell you
 * whether it is the code you meant.
 */
function suggestionsFor(rows: readonly RegisterRow[]): RegisterSuggestion[] {
  const invoices = new Map<string, string>();
  const hsn = new Map<string, number>();
  const gstins = new Map<string, string>();

  for (const row of rows) {
    if (!invoices.has(row.invoiceNumber)) {
      invoices.set(row.invoiceNumber, `${row.partyName} · ${row.invoiceDate}`);
    }

    if (row.hsnCode) hsn.set(row.hsnCode, (hsn.get(row.hsnCode) ?? 0) + 1);
    if (row.partyGstin) gstins.set(row.partyGstin, row.partyName);
  }

  return [
    ...[...invoices].map(([value, hint]) => ({ value, hint })),
    ...[...hsn].map(([value, lines]) => ({
      value,
      hint: `HSN · ${lines} line${lines === 1 ? '' : 's'}`,
    })),
    ...[...gstins].map(([value, party]) => ({ value, hint: `GSTIN · ${party}` })),
  ];
}

/**
 * The filters a register is read by, built from the rows actually present.
 *
 * Every choice comes from the period on screen, so the list never offers a
 * supplier who did not invoice in September and then shows an empty table.
 */
function filterFields(rows: readonly RegisterRow[], purchase: boolean): RegisterFilterField[] {
  const rates = [...new Set(rows.map((row) => row.gstRatePercent))].sort(
    (a, b) => Number(a) - Number(b),
  );
  const parties = [...new Set(rows.map((row) => row.partyName))].sort((a, b) => a.localeCompare(b));

  const items = [...new Map(rows.map((row) => [row.itemCode, row.itemName])).entries()].sort(
    ([, a], [, b]) => a.localeCompare(b),
  );

  const fields: RegisterFilterField[] = [
    {
      param: 'rate',
      label: 'GST rate',
      allLabel: 'Any rate',
      choices: rates.map((rate) => ({ value: rate, label: `${rate}%` })),
    },
    {
      param: 'party',
      label: purchase ? 'Supplier' : 'Customer',
      allLabel: purchase ? 'Any supplier' : 'Any customer',
      choices: parties.map((name) => ({ value: name, label: name })),
    },
    {
      param: 'item',
      label: 'Product',
      allLabel: 'Any product',
      choices: items.map(([code, name]) => ({ value: code, label: `${name} (${code})` })),
    },
  ];

  // Intra- versus inter-state is a real division of a SALES register and the
  // reason the split exists. Purchases do not record it, so the control is
  // absent there rather than present and always empty.
  if (!purchase) {
    fields.push({
      param: 'tax',
      label: 'Tax treatment',
      allLabel: 'Any treatment',
      choices: [
        { value: 'INTRA', label: 'Intra-state (CGST + SGST)' },
        { value: 'INTER', label: 'Inter-state (IGST)' },
      ],
    });
  }

  return fields;
}

function money(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;

  return parsed.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function SummaryCards({ report, purchase }: { report: RegisterReport; purchase: boolean }) {
  const { summary } = report;

  const cards: { label: string; value: string; note?: string }[] = [
    {
      label: purchase ? 'Total Purchase Invoices' : 'Total Sales Invoices',
      value: String(summary.invoiceCount),
    },
    { label: 'Total Taxable Value', value: money(summary.taxableValue) },
    {
      label: 'Total Tax',
      value: money(summary.totalTax),
      // Sales record the split; purchases do not. Said once, on the figure it
      // qualifies, rather than as three cards each reading "Not recorded".
      note: report.gstSplitRecorded
        ? `CGST ${money(summary.cgst)} · SGST ${money(summary.sgst)} · IGST ${money(summary.igst)}`
        : 'CGST/SGST/IGST split not recorded on purchase invoices',
    },
    {
      label: purchase ? 'Total Purchase Value' : 'Total Sales Value',
      value: money(summary.invoiceValue),
    },
  ];

  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">{card.label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{card.value}</dd>
            {card.note && <p className="mt-0.5 text-[11px] text-slate-400">{card.note}</p>}
          </div>
      ))}
    </dl>
  );
}

function RegisterTable({
  report,
  purchase,
  table,
}: {
  report: RegisterReport;
  purchase: boolean;
  table: Record<string, string>;
}) {
  const matching = narrow(report.rows, table);
  const paged = paginate(matching, table);
  const fields = filterFields(report.rows, purchase);
  const narrowed = matching.length !== report.rows.length;

  // Nothing in the PERIOD is a different answer from nothing matching the
  // search, and the two need different next steps: widen the range, or clear
  // the search. The period-empty case keeps its own message.
  if (report.rows.length === 0) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white px-5 py-12 text-center shadow-sm">
        <p className="text-sm font-medium text-slate-900">
          {purchase
            ? 'No purchase invoices found for the selected period.'
            : 'No sales invoices found for the selected period.'}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {report.from} to {report.to}. Try a wider range.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-slate-200 px-5 py-3.5">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            {purchase ? 'Purchase Register' : 'Sales Register'}
          </h3>
          <p className="mt-0.5 text-sm text-slate-500">
            {narrowed
              ? `${matching.length} of ${report.rows.length} lines`
              : `${report.rows.length} line${report.rows.length === 1 ? '' : 's'}`}{' '}
            · {report.summary.invoiceCount} invoice
            {report.summary.invoiceCount === 1 ? '' : 's'} · {report.from} to {report.to}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <RegisterSearch
            placeholder="Search invoice number, GSTIN or HSN…"
            suggestions={suggestionsFor(report.rows)}
          />
          <RegisterFilterToggle fields={fields} />
          <ExportButton
            report={{ ...report, rows: matching }}
            filename={`${purchase ? 'Purchase' : 'Sales'}_Register_${report.from}_to_${report.to}`}
          />
        </div>
      </div>

      <RegisterFilterPanel fields={fields} from={report.from} to={report.to} />

      <div className="table-scroll max-h-[34rem] overflow-auto">
        <table className="w-full min-w-[72rem] text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-slate-500">
              <th scope="col" className="whitespace-nowrap px-5 py-3 font-medium">
                Invoice
              </th>
              <th scope="col" className="whitespace-nowrap px-5 py-3 font-medium">
                Date
              </th>
              <th scope="col" className="whitespace-nowrap px-5 py-3 font-medium">
                {purchase ? 'Supplier' : 'Customer'}
              </th>
              <th scope="col" className="whitespace-nowrap px-5 py-3 font-medium">
                Item
              </th>
              <th scope="col" className="whitespace-nowrap px-5 py-3 font-medium">
                HSN
              </th>
              <th scope="col" className="whitespace-nowrap px-5 py-3 text-right font-medium">
                Quantity
              </th>
              <th scope="col" className="whitespace-nowrap px-5 py-3 text-right font-medium">
                Taxable
              </th>
              <th scope="col" className="whitespace-nowrap px-5 py-3 text-right font-medium">
                CGST
              </th>
              <th scope="col" className="whitespace-nowrap px-5 py-3 text-right font-medium">
                SGST
              </th>
              <th scope="col" className="whitespace-nowrap px-5 py-3 text-right font-medium">
                IGST
              </th>
              <th scope="col" className="whitespace-nowrap px-5 py-3 text-right font-medium">
                Total tax
              </th>
              <th scope="col" className="whitespace-nowrap px-5 py-3 text-right font-medium">
                Invoice total
              </th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((row, index) => (
              <tr key={`${row.invoiceId}-${row.itemCode}-${index}`}>
                <td className="px-5 py-3 align-top">
                  <span className="font-mono text-xs font-medium text-slate-900">
                    {row.invoiceNumber}
                  </span>
                </td>
                <td className="whitespace-nowrap px-5 py-3 align-top text-xs text-slate-700">
                  {row.invoiceDate}
                </td>
                <td className="px-5 py-3 align-top">
                  <p className="text-sm text-slate-800">{row.partyName}</p>
                  {row.partyGstin && (
                    <p className="mt-0.5 font-mono text-[11px] text-slate-500">{row.partyGstin}</p>
                  )}
                </td>
                <td className="px-5 py-3 align-top">
                  <p className="text-sm text-slate-800">{row.itemName}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-500">{row.itemCode}</p>
                </td>
                <td className="px-5 py-3 align-top font-mono text-xs text-slate-700">
                  {row.hsnCode ?? '—'}
                </td>
                <td className="px-5 py-3 text-right align-top text-sm tabular-nums text-slate-800">
                  {row.quantity}
                  <span className="ml-1 text-[11px] text-slate-500">{row.uom}</span>
                </td>
                <td className="px-5 py-3 text-right align-top text-sm tabular-nums text-slate-800">
                  {money(row.taxableValue)}
                  <p className="mt-0.5 text-[11px] text-slate-500">{row.gstRatePercent}% GST</p>
                </td>
                <td className="px-5 py-3 text-right align-top text-sm tabular-nums text-slate-800">
                  {row.cgst === null ? '—' : money(row.cgst)}
                </td>
                <td className="px-5 py-3 text-right align-top text-sm tabular-nums text-slate-800">
                  {row.sgst === null ? '—' : money(row.sgst)}
                </td>
                <td className="px-5 py-3 text-right align-top text-sm tabular-nums text-slate-800">
                  {row.igst === null ? '—' : money(row.igst)}
                </td>
                <td className="px-5 py-3 text-right align-top text-sm tabular-nums text-slate-800">
                  {money(row.totalTax)}
                </td>
                <td className="px-5 py-3 text-right align-top text-sm font-medium tabular-nums text-slate-900">
                  {money(row.invoiceTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {matching.length === 0 && (
        <p className="px-5 py-10 text-center text-sm text-slate-600">
          No lines match this search or filter. The period still holds{' '}
          {report.rows.length} line{report.rows.length === 1 ? '' : 's'}.
        </p>
      )}

      <RegisterPager
        page={paged.page}
        pageCount={paged.pageCount}
        pageSize={paged.pageSize}
        pageSizes={PAGE_SIZES}
        first={paged.first}
        last={paged.last}
        total={paged.total}
      />
    </section>
  );
}
