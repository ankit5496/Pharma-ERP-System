import type { ReactNode } from 'react';

import {
  CHECK_RESULT_LABELS,
  type CheckResult,
} from '@pharma-erp/types';

/**
 * Shared presentation for the Order-to-Cash screens.
 *
 * Everything here is a plain server component with no state, so a panel can use
 * it without becoming a client component. Only the pieces that genuinely need
 * interactivity (forms, confirmations) carry 'use client'.
 *
 * The visual vocabulary is taken from /admin/users rather than invented: the
 * same card (`rounded-lg border border-slate-200 bg-white shadow-sm`), the same
 * table head (`text-xs uppercase tracking-wide text-slate-500`), the same
 * ring-inset pill badges. Seven new screens are exactly the situation where a
 * slightly different table in each one would become the house style by
 * accident.
 */

// ---------------------------------------------------------------------------
// Page section
// ---------------------------------------------------------------------------


/** The card every list sits in, with a count in its header. */
export function Panel({
  heading,
  count,
  noun,
  action,
  children,
  footer,
}: {
  heading: string;
  count?: number;
  noun?: string;
  /**
   * The toolbar: search, filter, and whatever creates a record. It sits on the
   * header row beside the count rather than in a band above the table, so the
   * list stays the tallest thing on the screen — the same arrangement
   * Procure-to-Pay uses.
   */
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-slate-200 px-5 py-3.5">
        <h3 className="text-base font-semibold text-slate-900">
          {count === undefined
            ? heading
            : `${count} ${noun ?? heading.toLowerCase()}${count === 1 ? '' : 's'}`}
        </h3>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      {children}
      {footer && (
        <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">{footer}</div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

/**
 * A column: either a plain label, or a label with its alignment.
 *
 * Alignment belongs on the COLUMN, not only on the cell. A header that says
 * "Credit limit" flush left above figures flush right is the misalignment this
 * type exists to make impossible — the heading and the numbers under it are one
 * column and have to be declared once.
 */
export type TableColumn = string | { label: string; align: 'left' | 'right' };

/** Right-aligns a column. `col.right('Amount')` reads better at the call site. */
export const col = {
  right: (label: string): TableColumn => ({ label, align: 'right' }),
};

export function Table({
  columns,
  children,
  minWidth = 'min-w-[64rem]',
}: {
  columns: readonly TableColumn[];
  children: ReactNode;
  /**
   * Floor for the table's width, so a wide table scrolls sideways instead of
   * crushing its columns. Overridable: a six-column table does not need the
   * same floor as a ten-column one.
   */
  minWidth?: string;
}) {
  return (
    // `table-scroll` is the application-wide grid treatment defined in
    // globals.css — column separators, a firmer header rule, row borders, a
    // hover highlight and a sticky header. Procure-to-Pay already uses it, and
    // opting in here rather than restyling means the two workflows cannot drift
    // apart. Its selectors are direct-child (`> table > tbody > tr`), so this
    // div must remain the table's immediate parent.
    <div className="table-scroll max-h-[34rem] overflow-auto">
      <table className={`w-full text-left text-sm ${minWidth}`}>
        <thead>
          <tr className="text-xs uppercase tracking-wide text-slate-500">
            {columns.map((column) => {
              const label = typeof column === 'string' ? column : column.label;
              const align = typeof column === 'string' ? 'left' : column.align;

              return (
                <th
                  key={label}
                  scope="col"
                  className={`whitespace-nowrap px-5 py-3 font-medium ${
                    align === 'right' ? 'text-right' : ''
                  }`}
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Cell({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td
      className={`px-5 py-3.5 align-top ${
        align === 'right' ? 'text-right tabular-nums' : ''
      } ${className}`}
    >
      {children}
    </td>
  );
}

/**
 * A monetary figure. Right-aligned and tabular-nums so a column of amounts
 * lines up on the decimal point — the whole reason the API sends fixed-scale
 * strings.
 */
export function Money({ value, bold = false }: { value: string; bold?: boolean }) {
  return (
    <span className={`tabular-nums ${bold ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
      {formatMoney(value)}
    </span>
  );
}

export function Quantity({ value }: { value: string }) {
  return <span className="tabular-nums text-slate-700">{formatQuantity(value)}</span>;
}

/**
 * Groups the integer part with thousands separators, in the Indian convention
 * (1,23,456.78) that every other figure in an Indian pharma office uses.
 *
 * Done by hand rather than with `Intl.NumberFormat` because the value is a
 * decimal STRING and must not pass through a float on the way to the screen —
 * `Number('12345678.91')` is exact today and a rounding surprise at a larger
 * magnitude. The digits shown are always the digits the API sent.
 */
export function formatMoney(value: string): string {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = '00'] = (negative ? value.slice(1) : value).split('.');

  // Last three digits, then groups of two — "12,34,567".
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;

  return `${negative ? '-' : ''}${grouped}.${fraction}`;
}

/** Trims trailing zeros from a quantity: "10.000" reads better as "10". */
export function formatQuantity(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/\.?0+$/, '') || '0';
}

/** ISO date to "12 Aug 2026" — unambiguous, unlike any all-numeric format. */
export function formatDate(value: string | null): string {
  if (!value) return '—';

  const [year, month, day] = value.slice(0, 10).split('-');
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const index = Number(month) - 1;

  if (!year || !day || index < 0 || index > 11) return value.slice(0, 10);

  return `${Number(day)} ${months[index]} ${year}`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return `${formatDate(value.slice(0, 10))}, ${value.slice(11, 16)}`;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

type Tone = 'green' | 'amber' | 'red' | 'slate' | 'blue';

const TONES: Record<Tone, string> = {
  green: 'bg-green-50 text-green-800 ring-green-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-800 ring-red-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  blue: 'bg-blue-50 text-blue-800 ring-blue-200',
};

export function Badge({
  children,
  tone = 'slate',
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Status tones, held as one table for every status enum in the flow.
 *
 * One map rather than a function per screen, because the same status has to look
 * the same wherever it appears — an order that is amber on one tab and blue on
 * the next teaches the reader that the colour means nothing.
 *
 * The tones encode ATTENTION, not sentiment: red is "this is stopping work",
 * amber is "someone has to do something", green is "done", slate is "no longer
 * active", blue is "in progress".
 */
const STATUS_TONES: Record<string, Tone> = {
  // Sales order
  DRAFT: 'slate',
  PENDING_CHECK: 'amber',
  APPROVED: 'green',
  BLOCKED: 'red',
  PARTIALLY_ALLOCATED: 'amber',
  ALLOCATED: 'blue',
  DISPATCHED: 'blue',
  COMPLETED: 'green',
  CANCELLED: 'slate',
  // Allocation
  PARTIALLY_DISPATCHED: 'amber',
  RELEASED_BACK: 'slate',
  // Invoice / payment
  ISSUED: 'blue',
  UNPAID: 'amber',
  PARTIALLY_PAID: 'amber',
  PAID: 'green',
  // Dispatch
  DELIVERED: 'green',
  // Receipt
  RECORDED: 'blue',
  CLEARED: 'green',
  BOUNCED: 'red',
  // Return
  RECEIVED: 'blue',
  QUARANTINED: 'amber',
  CREDITED: 'green',
  // Customer / licence
  ACTIVE: 'green',
  INACTIVE: 'slate',
  SUSPENDED: 'red',
  // Batch
  QUARANTINE: 'amber',
  UNDER_TEST: 'amber',
  RELEASED: 'green',
  REJECTED: 'red',
  ON_HOLD: 'amber',
  RECALLED: 'red',
};

/** Turns SCREAMING_SNAKE into "Screaming snake" for a label. */
export function humanise(value: string): string {
  const lower = value.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONES[status] ?? 'slate'}>{label ?? humanise(status)}</Badge>;
}

/**
 * A licence or credit gate result.
 *
 * NOT_RUN is rendered as a distinct grey "Not run" rather than as a blank or as
 * a failure. The difference between "nobody has checked" and "checked and
 * refused" is the difference between an order waiting for someone and an order
 * that needs a credit decision, and a blank cell would conflate them.
 */
export function CheckBadge({ result }: { result: CheckResult }) {
  const tone: Tone = result === 'PASS' ? 'green' : result === 'FAIL' ? 'red' : 'slate';
  return <Badge tone={tone}>{CHECK_RESULT_LABELS[result]}</Badge>;
}

// ---------------------------------------------------------------------------
// Empty / error states
// ---------------------------------------------------------------------------

/**
 * What a list shows when it is genuinely empty.
 *
 * Distinct from the error state below, and the distinction matters in a pharma
 * system for the reason the codebase already states about placeholder panels: an
 * empty table is a CLAIM ("there are no orders"), and if the real situation is
 * that the API is unreachable, that claim is false and misleading.
 */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

/** A failed load, said plainly, with the API's own message. */
export function ErrorState({ message, what }: { message: string; what: string }) {
  return (
    <div role="alert" className="px-5 py-8">
      <p className="text-sm font-medium text-red-800">Could not load {what}.</p>
      <p className="mt-1.5 text-sm text-red-700">{message}</p>
      <p className="mt-3 text-xs text-slate-500">
        Nothing is shown rather than an empty table, because an empty table would read as
        &ldquo;there are none&rdquo;.
      </p>
    </div>
  );
}

/** An inline warning or note inside a panel. */
export function Note({
  tone = 'amber',
  children,
}: {
  tone?: 'amber' | 'red' | 'blue' | 'slate';
  children: ReactNode;
}) {
  const classes = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-900',
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  }[tone];

  return <div className={`rounded-md border px-4 py-3 text-sm ${classes}`}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export const PRIMARY_BUTTON =
  'inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400';

export const SECONDARY_BUTTON =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400';

export const DANGER_BUTTON =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:text-red-300';
