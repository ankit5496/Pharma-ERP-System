import { formatCode, formatStatus, titleCaseName } from '@pharma-erp/types';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The shared vocabulary of the Procure-to-Pay screens.
 *
 * Six sub-tabs render the same handful of things — a status pill, a money
 * figure, an empty state, a panel round a table. Defining them once is what
 * makes the six feel like one workflow rather than six screens built in the
 * same week; it is also the only way the statuses stay the same colour
 * everywhere, which is what people actually navigate by.
 */

// ---------------------------------------------------------------------------
// Status pills
// ---------------------------------------------------------------------------

export type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger' | 'muted';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-sky-50 text-sky-800 ring-sky-200',
  ok: 'bg-green-50 text-green-800 ring-green-200',
  warn: 'bg-amber-50 text-amber-900 ring-amber-200',
  danger: 'bg-red-50 text-red-800 ring-red-200',
  muted: 'bg-slate-50 text-slate-500 ring-slate-200',
};

/**
 * One tone table for every status in the workflow.
 *
 * Grouped by what the status MEANS to the person reading it, not by which
 * table it came from: anything needing action is amber, anything settled is
 * green, anything that stops material being used is red. A Store Officer and
 * an Accountant then read the same colours the same way.
 */
const STATUS_TONE: Record<string, Tone> = {
  // Requisition
  DRAFT: 'muted',
  PENDING: 'warn',
  APPROVED: 'ok',
  CONVERTED_TO_PO: 'info',
  CANCELLED: 'muted',
  // Purchase order
  ISSUED: 'info',
  PARTIALLY_RECEIVED: 'warn',
  FULLY_RECEIVED: 'ok',
  CLOSED: 'muted',
  // Stock lot / QC
  QUARANTINE: 'warn',
  USABLE: 'ok',
  REJECTED: 'danger',
  ON_HOLD: 'danger',
  CONSUMED: 'muted',
  ACCEPTED: 'ok',
  // Payment
  UNPAID: 'warn',
  PARTIALLY_PAID: 'warn',
  PAID: 'ok',
  OVERDUE: 'danger',
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const tone = STATUS_TONE[status] ?? 'neutral';

  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONE_CLASS[tone]}`}
    >
      {/* formatStatus, not toLowerCase(). The fallback used to render
          "partially received" — all lower case is one of the two casings the
          table convention rules out, and this component draws every status
          badge in the application, so it was doing it everywhere at once. */}
      {formatStatus(label ?? status)}
    </span>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONE_CLASS[tone]}`}
    >
      {/* A plain string gets the status casing; anything richer is passed
          through untouched, because a caller that built its own markup has
          already decided how it reads. */}
      {typeof children === 'string' ? formatStatus(children) : children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Names and codes
// ---------------------------------------------------------------------------

/**
 * A human-readable name — a vendor, a customer, a product, a person.
 *
 * TITLE CASE, BUT ONLY WHERE THE CASING CARRIES NOTHING. `titleCaseName`
 * reshapes a value only when it is entirely upper or entirely lower case, which
 * are the two the convention rules out; anything mixed was chosen deliberately
 * and is passed through. That distinction is not fussiness — "Lactose IP" is a
 * pharmacopoeial name, and a title-caser that rewrote it to "Lactose Ip" would
 * have corrupted a drug name on a pharmaceutical document.
 *
 * Display only. The stored value is never touched, which is what keeps the edit
 * forms honest: they still show, and save, exactly what was typed.
 */
export function Name({ children }: { children: string | null | undefined }) {
  return <>{titleCaseName(children)}</>;
}

/**
 * A document number or item code — PR-1204, PO-4482, GRN-8841, RM-PARA-001.
 *
 * Upper case, and monospaced by the caller where it is the row's identity.
 * These are read letter by letter and quoted back in emails; a lower-case
 * prefix makes two references to one document look like two documents.
 */
export function Code({ children }: { children: string | null | undefined }) {
  return <>{formatCode(children)}</>;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * A titled card with optional actions, wrapping a table or a form.
 *
 * THE ACTIONS SHARE THE TITLE'S LINE, right-aligned and vertically centred
 * against it. That is what keeps the Filter button, the create button and the
 * title on one baseline on every screen, whether or not that screen has a
 * subtitle under the heading.
 */
export function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return (
    <section aria-labelledby={id} className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold text-slate-900">
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * What a list shows when it has no rows.
 *
 * Distinguishes "nothing here yet" from "nothing matched your filters", because
 * the two need different reactions and a single "No results" leaves the reader
 * to guess which one they are looking at.
 */
export function EmptyState({
  title,
  hint,
  filtered,
}: {
  title: string;
  hint?: string;
  filtered?: boolean;
}) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-medium text-slate-700">
        {filtered ? 'No records match these filters.' : title}
      </p>
      {(filtered || hint) && (
        <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-500">
          {filtered ? 'Clear the search or filters to see everything.' : hint}
        </p>
      )}
    </div>
  );
}

/** A failed fetch, rendered as data rather than thrown. */
export function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="m-5 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      {message}
    </div>
  );
}

/**
 * Scroll container for a table, so the page body never scrolls in either axis.
 *
 * BOTH AXES, AND A CEILING ON THE HEIGHT. Sideways scrolling was already here
 * for wide tables; the vertical bound is what stops a long page of rows pushing
 * the pager and everything else several screens down. The header row is pinned
 * inside the box by `.table-scroll` in globals.css, so scrolling the rows
 * never scrolls away the column names.
 */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="table-scroll max-h-[34rem] overflow-auto">{children}</div>;
}

/**
 * Horizontal scrolling only, for a table nested inside a record.
 *
 * The line tables inside a goods receipt or a purchase order are NOT the
 * screen's list — the record is. Giving each of them {@link TableWrap}'s height
 * ceiling would put a scroll box inside every row, so a page of ten receipts
 * would offer eleven independent scrollbars. The record list is bounded once,
 * by {@link RecordList}; a nested table only needs somewhere to put its width.
 */
export function SubTable({ children }: { children: ReactNode }) {
  // NOT `table-scroll`, which is what bounds and rules a screen's own list: a
  // nested table given that class inherited the pinned header and the heavy
  // row rule meant for records, so an order's five lines looked like five
  // records.
  //
  // `overflow-y-hidden` is not redundant. Setting one axis to `auto` while the
  // other is `visible` is not a state CSS allows, so the browser promotes the
  // other to `auto` too — and the nested table then drew a second, pointless
  // vertical scrollbar inside every record.
  return <div className="overflow-x-auto overflow-y-hidden">{children}</div>;
}

/**
 * The bounded, scrolling container for a list of records.
 *
 * Screens whose rows are too tall for a table row — a goods receipt carries its
 * batch lines, a purchase order its order lines — render a list instead. They
 * still need what a table gets from {@link TableWrap}: a ceiling, so a hundred
 * records do not make the page a hundred records long and strand the pager at
 * the bottom of it.
 *
 * Each record is separated by a full-width rule rather than the hairline the
 * lists used before. With a nested table inside every record, a 1px slate-100
 * line was not enough to say where one receipt ended and the next began.
 */
export function RecordList({ children }: { children: ReactNode }) {
  return (
    <div data-record-list className="max-h-[34rem] overflow-y-auto overflow-x-hidden">
      <ul className="divide-y-2 divide-slate-200">{children}</ul>
    </div>
  );
}

export function Th({ children, align }: { children: ReactNode; align?: 'right' }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-5 py-3 font-medium ${align === 'right' ? 'text-right' : ''}`}
    >
      {children}
    </th>
  );
}

/**
 * A table cell.
 *
 * VERTICALLY CENTRED BY DEFAULT. Cells used to be top-aligned, so on any row
 * where one cell was taller than the rest — a two-line item name, a stack of
 * linked orders, a column of action buttons — everything else floated to the
 * top and the row read as ragged. Centring lines the text and the controls up
 * across the row.
 *
 * `top` stays available for cells that genuinely hold a list, where centring a
 * long list against a short neighbour looks worse than aligning it. It is a
 * prop rather than something passed in `className` because two Tailwind
 * alignment utilities on one element are resolved by stylesheet order, not by
 * the order they were written in — so an override there would win only by luck.
 */
export function Td({
  children,
  align,
  valign = 'middle',
  className = '',
}: {
  children: ReactNode;
  align?: 'right';
  valign?: 'middle' | 'top';
  className?: string;
}) {
  return (
    <td
      className={`px-5 py-3 ${valign === 'top' ? 'align-top' : 'align-middle'} ${
        align === 'right' ? 'text-right tabular-nums' : ''
      } ${className}`}
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/**
 * A rupee amount.
 *
 * The value arrives as a string and is printed as one — grouping is applied by
 * splitting the digits, never by `Number(...)`, so a large total cannot lose
 * precision on its way to the screen.
 */
export function Money({ amount, bold }: { amount: string; bold?: boolean }) {
  return (
    <span
      className={`whitespace-nowrap tabular-nums ${bold ? 'font-semibold text-slate-900' : ''}`}
    >
      ₹{groupIndian(amount)}
    </span>
  );
}

/**
 * Indian digit grouping: 12,34,567.89 rather than 1,234,567.89.
 *
 * Done by hand on the string. `toLocaleString('en-IN')` would require a Number
 * first, which is the one thing these values must never become.
 */
export function groupIndian(value: string): string {
  const negative = value.startsWith('-');
  const [whole = '0', fraction] = value.replace('-', '').split('.');

  // Last three digits, then pairs.
  const head = whole.slice(0, -3);
  const tail = whole.slice(-3);
  const grouped = head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}` : tail;

  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

/** A quantity with its unit. */
export function Qty({ value, uom }: { value: string; uom?: string }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {value}
      {uom && <span className="ml-1 text-xs text-slate-500">{uom}</span>}
    </span>
  );
}

/**
 * A date, as YYYY-MM-DD in UTC.
 *
 * The same convention the rest of the application uses. Consistency matters
 * more than locale friendliness here: an expiry date shifted by a timezone is
 * a batch released a day late or a day early.
 */
export function DateText({ value, fallback = '—' }: { value: string | null; fallback?: string }) {
  if (!value) return <span className="text-slate-300">{fallback}</span>;

  return <span className="whitespace-nowrap tabular-nums">{value.slice(0, 10)}</span>;
}

/**
 * A date AND the time of day, for events where the hour is part of the record.
 *
 * Most dates in this module are dates: a receipt date, an expiry, a due date.
 * A QC decision is not — it is the moment a named person released or rejected
 * material, and an inspection log that says only "19 Sep" cannot distinguish
 * two decisions on the same batch on the same day, which is exactly the
 * sequence an auditor asks about.
 *
 * Rendered in the VIEWER'S timezone from the stored UTC instant, because the
 * question being asked is "when did this happen here".
 */
export function DateTimeText({
  value,
  fallback = '—',
}: {
  value: string | null;
  fallback?: string;
}) {
  if (!value) return <span className="text-slate-300">{fallback}</span>;

  const at = new Date(value);

  if (Number.isNaN(at.getTime())) {
    return <span className="whitespace-nowrap tabular-nums">{value.slice(0, 10)}</span>;
  }

  const date = at.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = at.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return (
    <span className="whitespace-nowrap tabular-nums">
      {date} {time}
    </span>
  );
}

/** Muted em dash for an absent value, matching the record browser. */
export function Blank() {
  return <span className="text-slate-300">—</span>;
}

/** A link between two related documents. */
export function RecordLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="font-medium text-sky-800 underline decoration-sky-300 underline-offset-2 hover:decoration-sky-700"
    >
      {children}
    </Link>
  );
}

/** Label/value pair for a detail panel. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{children}</dd>
    </div>
  );
}
