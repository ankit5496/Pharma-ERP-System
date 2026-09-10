import { USER_ROLE_LABELS, isUserRole, type DatasetColumn } from '@pharma-erp/types';

/**
 * Generic renderer for a list of records.
 *
 * The whole reason the record browser needs no page per table: a dataset's
 * `columns` describe what to show and this decides how to show it, so date
 * formatting, null handling and overflow behave identically everywhere instead
 * of being re-decided in each new table.
 *
 * Styled to match the hand-written table on the Users admin page, which stays
 * as it is — that page has row actions and a create form, and is a different
 * thing from a read-only inspector.
 */
export function RecordTable({
  columns,
  rows,
  rowKey,
}: {
  columns: readonly DatasetColumn[];
  rows: readonly Record<string, unknown>[];
  /** Property to key rows by. Falls back to the index when absent or empty. */
  rowKey?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            {columns.map((column) => (
              <th key={column.key} scope="col" className="whitespace-nowrap px-6 py-3 font-medium">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => {
            const key = rowKey ? String(row[rowKey] ?? index) : String(index);

            return (
              <tr key={key} className="align-top">
                {columns.map((column) => (
                  <td key={column.key} className="px-6 py-3">
                    <Cell value={row[column.key]} type={column.type} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One cell.
 *
 * Null and empty string both render as a muted em dash rather than as blank
 * space, so "no value recorded" is visibly distinct from a rendering bug.
 */
function Cell({ value, type }: { value: unknown; type?: DatasetColumn['type'] }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-slate-300">—</span>;
  }

  switch (type) {
    case 'datetime':
      return <span className="whitespace-nowrap tabular-nums text-slate-600">{formatWhen(value)}</span>;

    case 'boolean':
      return value ? (
        <span className="whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
          Yes
        </span>
      ) : (
        <span className="text-slate-400">No</span>
      );

    case 'role':
      return <span className="text-slate-700">{isUserRole(value) ? USER_ROLE_LABELS[value] : String(value)}</span>;

    case 'code':
      return <span className="font-mono text-xs text-slate-700">{String(value)}</span>;

    default:
      return <span className="text-slate-800">{String(value)}</span>;
  }
}

/**
 * Timestamps as `YYYY-MM-DD HH:MM` in UTC, matching how the dashboard and the
 * users table already render them.
 *
 * UTC rather than the browser's zone, deliberately and consistently across the
 * app: a record inspector is used to reconcile against the audit trail, and a
 * time silently shifted into the reader's local zone is exactly the sort of
 * discrepancy that wastes an afternoon. Tenant-local rendering is a real
 * requirement for batch and expiry dates — `Tenant.timezone` exists for it —
 * and belongs with those fields, not applied by halves here.
 */
function formatWhen(value: unknown): string {
  const date = new Date(String(value));

  if (Number.isNaN(date.getTime())) return String(value);

  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
