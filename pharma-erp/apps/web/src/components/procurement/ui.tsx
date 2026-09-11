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
      {label ?? status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** A titled card with an optional action, wrapping a table or a form. */
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
    <section
      aria-labelledby={id}
      className="rounded-lg border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 id={id} className="text-base font-semibold text-slate-900">
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
        </div>
        {action}
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

/** Scroll container for a wide table, so the page body never scrolls sideways. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
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

export function Td({
  children,
  align,
  className = '',
}: {
  children: ReactNode;
  align?: 'right';
  className?: string;
}) {
  return (
    <td className={`px-5 py-3 align-top ${align === 'right' ? 'text-right tabular-nums' : ''} ${className}`}>
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
    <span className={`whitespace-nowrap tabular-nums ${bold ? 'font-semibold text-slate-900' : ''}`}>
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
