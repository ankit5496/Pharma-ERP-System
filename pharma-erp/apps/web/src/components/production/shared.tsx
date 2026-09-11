import type { BatchReleaseStatus, ProductionOrderStatus } from '@pharma-erp/types';
import { BATCH_RELEASE_STATUS_LABELS, PRODUCTION_ORDER_STATUS_LABELS } from '@pharma-erp/types';

/** A titled card. Every step panel is built from these, so they line up. */
export function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          {description && <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="px-6 py-8 text-sm text-slate-600">{children}</p>;
}

export function LoadError({ error }: { error: string }) {
  return <p className="px-6 py-6 text-sm text-red-800">Could not load this step: {error}</p>;
}

/**
 * Quantities, right-aligned and tabular so columns of figures line up and a
 * transposed digit is visible.
 *
 * Trailing zeros are trimmed — the API sends `Decimal(14,3)`, so a whole
 * number arrives as "100000.000" and printing that everywhere buries the
 * meaningful digits.
 */
export function Quantity({ value, uom }: { value: string | null; uom?: string }) {
  if (value === null) return <span className="text-slate-300">—</span>;

  const trimmed = value.includes('.') ? value.replace(/\.?0+$/, '') : value;
  const grouped = Number(trimmed).toLocaleString('en-IN', { maximumFractionDigits: 3 });

  return (
    <span className="whitespace-nowrap tabular-nums text-slate-800">
      {Number.isNaN(Number(trimmed)) ? trimmed : grouped}
      {uom && <span className="ml-1 text-xs text-slate-500">{uom}</span>}
    </span>
  );
}

/**
 * A date that is legally meaningful, so it is never reformatted into the
 * reader's locale — the API sends the calendar day and that is what shows.
 */
export function DateCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-300">—</span>;

  return <span className="whitespace-nowrap tabular-nums text-slate-700">{value}</span>;
}

/**
 * How soon a lot expires, as a coloured hint.
 *
 * Present because FEFO is the whole point of the material-issue step, and a
 * column of dates does not make "this one goes first" obvious at a glance.
 */
export function ExpiryHint({ date }: { date: string }) {
  const days = Math.round((new Date(`${date}T00:00:00Z`).getTime() - Date.now()) / 86_400_000);

  const tone =
    days < 0
      ? 'bg-red-50 text-red-800 ring-red-200'
      : days < 90
        ? 'bg-amber-50 text-amber-800 ring-amber-200'
        : 'bg-slate-50 text-slate-600 ring-slate-200';

  const label = days < 0 ? 'expired' : days < 30 ? `${days}d` : `${Math.round(days / 30)}mo`;

  return (
    <span
      className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${tone}`}
    >
      {label}
    </span>
  );
}

const ORDER_STATUS_TONE: Record<ProductionOrderStatus, string> = {
  PLANNED: 'bg-slate-100 text-slate-700 ring-slate-200',
  MATERIAL_ISSUED: 'bg-blue-50 text-blue-800 ring-blue-200',
  IN_PROGRESS: 'bg-blue-50 text-blue-800 ring-blue-200',
  PACKED: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  UNDER_TEST: 'bg-amber-50 text-amber-800 ring-amber-200',
  CLOSED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  CANCELLED: 'bg-slate-100 text-slate-500 ring-slate-200',
};

export function OrderStatusBadge({ status }: { status: ProductionOrderStatus }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${ORDER_STATUS_TONE[status]}`}
    >
      {PRODUCTION_ORDER_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Released is green, blocked is red, pending is neutral.
 *
 * The one badge in the app where the colour carries real weight: it is the
 * answer to "may this be sold", so it should be readable across a room.
 */
export function ReleaseBadge({ status }: { status: BatchReleaseStatus }) {
  const tone =
    status === 'RELEASED'
      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
      : status === 'BLOCKED'
        ? 'bg-red-50 text-red-800 ring-red-200'
        : 'bg-slate-100 text-slate-700 ring-slate-200';

  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tone}`}
    >
      {BATCH_RELEASE_STATUS_LABELS[status]}
    </span>
  );
}

/** Table header cell, shared so every table in the workflow matches. */
export function Th({
  children,
  align = 'left',
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-6 py-3 font-medium ${align === 'right' ? 'text-right' : ''}`}
    >
      {children}
    </th>
  );
}

export function TableFrame({
  head,
  children,
  minWidth = '52rem',
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  minWidth?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            {head}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}
