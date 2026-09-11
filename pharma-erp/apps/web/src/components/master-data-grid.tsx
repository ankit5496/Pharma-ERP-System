'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  ITEM_TYPE_LABELS,
  PARTY_TYPE_LABELS,
  SCHEDULE_CLASSIFICATION_LABELS,
  type BomView,
  type ItemSummary,
  type PartySummary,
} from '@pharma-erp/types';

import { deleteItemAction, deletePartyAction } from '@/app/(app)/master-data/actions';
import type { ApiResult } from '@/lib/api';

/**
 * The register as a table — direction H.
 *
 * The reasoning behind the shape: an item master is corrected far more often
 * than it is created. Someone is looking for the one row with the wrong HSN
 * code among two hundred, and a form shows you one record at a time. So the
 * grid is the register and the form is what opens when you add to it.
 *
 * Editing is per row rather than per cell. Items can be edited and retired
 * from here — the form opens in the drawer with the row loaded — but a cell
 * is not typed into directly. Inline editing needs per-field saves,
 * optimistic state and a way to show a rejection against one cell, and none
 * of that is worth building before the other five registers even have
 * tables.
 */

export interface GridColumn<Row> {
  key: string;
  label: string;
  /** Numbers and dates read better right-aligned in a column. */
  align?: 'right';
  /**
   * Pins the column to the right edge while the rest scrolls under it. For
   * the row's own controls: a register wide enough to scroll sideways would
   * otherwise hide them, and hunting for the actions column by scrolling is
   * not a thing anyone should have to do.
   */
  pinned?: boolean;
  render: (row: Row) => ReactNode;
}

/** Everything on a row that the search box should match against. */
type SearchText<Row> = (row: Row) => string;

function Toolbar({
  count,
  total,
  noun,
  singular,
  query,
  onQuery,
  onNew,
  disabled,
}: {
  count: number;
  total: number;
  noun: string;
  /**
   * Stated, not derived. Stripping a trailing "s" turns "parties" into
   * "partie" — which is exactly what the button read before. English plurals
   * are not mechanical, so each register says its own singular.
   */
  singular: string;
  query: string;
  onQuery: (value: string) => void;
  onNew: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={`Search ${noun}…`}
          aria-label={`Search ${noun}`}
          disabled={disabled}
          className="field-sm w-full max-w-xs"
        />
        {total > 0 && (
          <span className="whitespace-nowrap text-xs tabular-nums text-slate-500">
            {count === total ? `${total} ${noun}` : `${count} of ${total}`}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onNew}
        className="whitespace-nowrap rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
      >
        New {singular}
      </button>
    </div>
  );
}

/**
 * Column names, always shown — including when the register is empty.
 *
 * Hiding them on an empty register loses the one thing an empty table is
 * genuinely good for: saying what the register holds. It also made the live
 * registers look broken next to the planned ones, which show their columns.
 */
function HeadRow({ labels }: { labels: readonly string[] }) {
  return (
    <thead className="sticky top-0 z-10 bg-slate-50">
      <tr className="border-b border-slate-200">
        {labels.map((label) => (
          <th
            key={label}
            scope="col"
            className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/**
 * The table itself. Generic over the row so each register keeps its own
 * types — the alternative, a shared `Record<string, unknown>` row, throws away
 * exactly the checking that stops a column reading a field that no longer
 * exists.
 */
export function Grid<Row>({
  rows,
  columns,
  searchText,
  rowKey,
  noun,
  singular,
  onNew,
  empty,
  notice,
}: {
  rows: readonly Row[];
  columns: readonly GridColumn<Row>[];
  searchText: SearchText<Row>;
  rowKey: (row: Row) => string;
  noun: string;
  singular: string;
  onNew: () => void;
  empty: ReactNode;
  /** Shown under the toolbar — a refusal from a row action, typically. */
  notice?: ReactNode;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => searchText(row).toLowerCase().includes(needle));
  }, [rows, query, searchText]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        count={filtered.length}
        total={rows.length}
        noun={noun}
        singular={singular}
        query={query}
        onQuery={setQuery}
        onNew={onNew}
        disabled={rows.length === 0}
      />

      {notice}

      {/* The grid scrolls in both directions inside its own box, so a wide
          register never makes the page itself scroll sideways. */}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <table className="w-full border-collapse text-left text-sm">
          {/* Sticky so the column names stay readable once the register is
              longer than the box — which is the entire point of a grid. */}
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="border-b border-slate-200">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  // A pinned header cell sits at the crossing of two sticky
                  // axes, so it needs to outrank both the row it is in and
                  // the pinned body cells scrolling beneath it.
                  className={`whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 ${
                    column.align === 'right' ? 'text-right' : ''
                  } ${column.pinned ? 'sticky right-0 z-20 bg-slate-50' : ''}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              // Inside the table, spanning every column, so the header stays
              // put and the message sits under the columns it is about.
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-6 py-10 text-center text-sm text-slate-600"
                >
                  {rows.length === 0 ? (
                    empty
                  ) : (
                    <>
                      Nothing matches{' '}
                      <strong className="font-semibold text-slate-900">{query}</strong>.
                    </>
                  )}
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={rowKey(row)} className="group transition hover:bg-slate-50">
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      // A pinned cell needs its own background — it floats
                      // over the scrolling ones — and has to repeat the row's
                      // hover, or it stays white while the rest of the row
                      // highlights.
                      className={`whitespace-nowrap px-4 py-2.5 text-slate-700 ${
                        column.align === 'right' ? 'text-right tabular-nums' : ''
                      } ${
                        column.pinned
                          ? 'sticky right-0 bg-white shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)] group-hover:bg-slate-50'
                          : ''
                      }`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Codes are compared character by character, so they get a monospaced face. */
function Code({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px] text-slate-900">{children}</span>;
}

const TYPE_TONE: Record<string, string> = {
  RAW_MATERIAL: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  PACKING_MATERIAL: 'bg-violet-50 text-violet-800 ring-violet-200',
  SEMI_FINISHED: 'bg-amber-50 text-amber-800 ring-amber-200',
  FINISHED_GOOD: 'bg-blue-50 text-blue-800 ring-blue-200',
};

/**
 * Only a real schedule gets a badge.
 *
 * NONE renders as a dash, because a badge reading "None" draws the eye to the
 * rows that need no attention — the opposite of what colour is for here. A
 * schedule is a legal restriction on sale, so the ones that carry it should be
 * the ones that stand out.
 */
const SCHEDULE_TONE: Record<string, string> = {
  H: 'bg-amber-50 text-amber-900 ring-amber-200',
  H1: 'bg-orange-50 text-orange-900 ring-orange-200',
  X: 'bg-red-50 text-red-900 ring-red-200',
  G: 'bg-slate-100 text-slate-700 ring-slate-200',
};

function Blank() {
  return <span className="text-slate-300">—</span>;
}

/**
 * Free text that can run long — a composition, a storage instruction.
 *
 * Capped and clipped rather than allowed to set the column's width: one item
 * stored "below 25 °C, protect from light and moisture, do not refrigerate"
 * would otherwise push every other column off the screen. The full value is
 * on the title attribute and in the edit form.
 */
function Truncated({ text }: { text: string }) {
  return (
    <span title={text} className="block max-w-[15rem] truncate">
      {text}
    </span>
  );
}

function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tone}`}
    >
      {children}
    </span>
  );
}

/** Trailing zeros hide the meaningful digits: the API sends Decimal(14,3). */
function trimQuantity(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

// ---------------------------------------------------------------------------
// Item / Product — real rows, from GET /production/items
// ---------------------------------------------------------------------------

const ITEM_COLUMNS: readonly GridColumn<ItemSummary>[] = [
  { key: 'code', label: 'Code', render: (item) => <Code>{item.code}</Code> },
  {
    key: 'name',
    label: 'Name',
    render: (item) => <span className="font-medium text-slate-900">{item.name}</span>,
  },
  {
    key: 'type',
    label: 'Category',
    render: (item) => (
      <Pill tone={TYPE_TONE[item.type] ?? 'bg-slate-100 text-slate-700 ring-slate-200'}>
        {ITEM_TYPE_LABELS[item.type]}
      </Pill>
    ),
  },
  {
    key: 'brand',
    label: 'Brand',
    render: (item) => item.brandName ?? <Blank />,
  },
  {
    key: 'generic',
    label: 'Generic / composition',
    render: (item) => (item.genericName ? <Truncated text={item.genericName} /> : <Blank />),
  },
  {
    key: 'schedule',
    label: 'Schedule',
    render: (item) =>
      item.scheduleClassification === 'NONE' ? (
        <Blank />
      ) : (
        <Pill tone={SCHEDULE_TONE[item.scheduleClassification] ?? SCHEDULE_TONE.G!}>
          {SCHEDULE_CLASSIFICATION_LABELS[item.scheduleClassification]}
        </Pill>
      ),
  },
  { key: 'uom', label: 'UOM', render: (item) => item.uom },
  {
    key: 'hsn',
    label: 'HSN',
    render: (item) => (item.hsnCode ? <Code>{item.hsnCode}</Code> : <Blank />),
  },
  {
    key: 'gst',
    label: 'GST',
    align: 'right',
    // Trimmed because the column is DECIMAL(5,2) and "12.00%" reads as more
    // precision than a tax slab has.
    render: (item) => (item.gstRate === null ? <Blank /> : `${trimQuantity(item.gstRate)}%`),
  },
  {
    key: 'mrp',
    label: 'MRP',
    align: 'right',
    render: (item) =>
      item.mrp === null ? (
        <Blank />
      ) : (
        <>
          {item.mrp}
          {item.dpcoCeiling && (
            <span
              title="Falls under a DPCO ceiling price"
              className="ml-1.5 rounded bg-red-50 px-1 text-[10px] font-semibold text-red-800 ring-1 ring-inset ring-red-200"
            >
              DPCO
            </span>
          )}
        </>
      ),
  },
  {
    key: 'shelfLife',
    label: 'Shelf-life',
    align: 'right',
    render: (item) =>
      item.shelfLifeMonths === null ? (
        <Blank />
      ) : (
        <>
          {item.shelfLifeMonths}
          <span className="ml-1 text-xs text-slate-500">mo</span>
        </>
      ),
  },
  {
    key: 'storage',
    label: 'Storage',
    render: (item) =>
      item.storageConditions ? <Truncated text={item.storageConditions} /> : <Blank />,
  },
  {
    key: 'reorderLevel',
    label: 'Reorder at',
    align: 'right',
    render: (item) =>
      item.reorderLevel === null ? (
        <Blank />
      ) : (
        <>
          {trimQuantity(item.reorderLevel)}
          <span className="ml-1 text-xs text-slate-500">{item.uom}</span>
        </>
      ),
  },
  {
    key: 'reorderQuantity',
    label: 'Reorder qty',
    align: 'right',
    render: (item) =>
      item.reorderQuantity === null ? (
        <Blank />
      ) : (
        <>
          {trimQuantity(item.reorderQuantity)}
          <span className="ml-1 text-xs text-slate-500">{item.uom}</span>
        </>
      ),
  },
];

/**
 * Edit and retire, on the row rather than behind a menu.
 *
 * Two actions is not enough to hide, and a row's own controls being visible
 * is what makes a grid feel like the thing you work in rather than a report.
 *
 * Retiring asks first. It is reversible in the database — the row is only
 * stamped `deletedAt` — but not from this screen, so from here it is a
 * one-way door and should be treated as one.
 */
/**
 * The menu's own size, needed before it is rendered so it can be placed.
 * Kept in step with the `w-40` and the two rows below by hand — measuring
 * would mean rendering it offscreen first, which is a lot of machinery for a
 * box whose contents are two fixed words.
 */
const MENU_WIDTH = 160;
const MENU_HEIGHT = 84;

function RowActions({
  label,
  onEdit,
  onDelete,
  onError,
}: {
  /** Names the row in the confirmation and the button's accessible name. */
  label: string;
  onEdit: () => void;
  /** The register's own delete action. Returns the API's refusal, if any. */
  onDelete: () => Promise<{ ok: boolean; message?: string }>;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * Positioned `fixed` against the button's measured rectangle, not
   * `absolute` inside the cell. The grid is a scroll container with
   * `overflow: auto`, which clips an absolutely-positioned child — so on the
   * lower rows the menu would simply be cut off.
   *
   * It opens to the LEFT of the button rather than below it. The actions
   * column is pinned, so every row's button sits at the same x: a downward
   * menu lands squarely on the next row's control and hides the very thing
   * someone reaches for next. Flying left puts it over the data columns,
   * which are being read rather than clicked.
   */
  function toggle() {
    if (isOpen) {
      setIsOpen(false);
      return;
    }

    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;

    // On a narrow screen there may be nothing to the left to open into, so
    // fall back to below-right and accept the overlap.
    const opensLeft = rect.left >= MENU_WIDTH + 16;

    setAnchor({
      // Clamped so the last row's menu is not half off the bottom.
      top: Math.max(
        8,
        Math.min(opensLeft ? rect.top : rect.bottom + 4, window.innerHeight - MENU_HEIGHT - 8),
      ),
      right: opensLeft
        ? window.innerWidth - rect.left + 6
        : Math.max(8, window.innerWidth - rect.right),
    });
    setIsOpen(true);
  }

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setIsOpen(false);
      buttonRef.current?.focus();
    }

    // The menu is fixed to the viewport, so it does not travel with its row.
    // Closing on scroll beats leaving it hovering over a different item —
    // and `true` catches the grid's own scrolling, which does not bubble.
    function dismiss() {
      setIsOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [isOpen]);

  function remove() {
    setIsOpen(false);

    // Says what actually happens. "Delete" is the word on the button because
    // it is the word people look for, but the row is not destroyed — it is
    // stamped deleted and stays readable on every document that cites it,
    // which is the only behaviour a batch record can be reconciled against.
    const confirmed = window.confirm(
      `Delete ${label}?\n\n` +
        'It stays on documents that already cite it, but it can no longer be chosen. ' +
        'Its code stays taken and cannot be reused.',
    );

    if (!confirmed) return;

    onError(null);
    startTransition(async () => {
      const result = await onDelete();

      if (!result.ok) {
        onError(result.message ?? 'Could not delete this record.');
        return;
      }

      router.refresh();
    });
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        disabled={isPending}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={`Actions for ${label}`}
        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
      >
        {isPending ? 'Working…' : 'Actions'}
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          <path d="M5 7.5 10 12.5 15 7.5" />
        </svg>
      </button>

      {isOpen && anchor && (
        <div
          ref={menuRef}
          style={{ top: anchor.top, right: anchor.right }}
          className="fixed z-50 w-40 rounded-md border border-slate-200 bg-white p-1 text-left shadow-lg"
        >
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              onEdit();
            }}
            className="block w-full rounded px-3 py-1.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={remove}
            className="block w-full rounded px-3 py-1.5 text-left text-sm font-medium text-red-700 transition hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      )}
    </>
  );
}

export function ItemGrid({
  result,
  onNew,
  onEdit,
}: {
  result: ApiResult<ItemSummary[]>;
  onNew: () => void;
  onEdit: (item: ItemSummary) => void;
}) {
  // Declared before the early return: hooks cannot sit behind a condition.
  const [actionError, setActionError] = useState<string | null>(null);

  if (!result.ok) return <LoadFailed error={result.error} />;

  const columns: GridColumn<ItemSummary>[] = [
    ...ITEM_COLUMNS,
    {
      key: 'actions',
      label: '',
      align: 'right',
      pinned: true,
      render: (item) => (
        <RowActions
          label={`${item.code} — ${item.name}`}
          onEdit={() => onEdit(item)}
          onDelete={() => deleteItemAction(item.id)}
          onError={setActionError}
        />
      ),
    },
  ];

  return (
    <Grid
      rows={result.data}
      columns={columns}
      // A refusal goes above the table, not in the row: the actions column is
      // narrow and pinned, and "used by a formulation and cannot be deleted"
      // does not fit in it legibly.
      notice={
        actionError && (
          <p
            role="alert"
            className="border-b border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800"
          >
            {actionError}
          </p>
        )
      }
      rowKey={(item) => item.id}
      // Everything visible on the row is searchable, plus the generic name,
      // which is not a column but is what someone looking for "paracetamol"
      // will actually type.
      searchText={(item) =>
        [
          item.code,
          item.name,
          item.brandName,
          item.genericName,
          ITEM_TYPE_LABELS[item.type],
          item.hsnCode,
          item.uom,
        ]
          .filter(Boolean)
          .join(' ')
      }
      noun="items"
      singular="item"
      onNew={onNew}
      empty={
        <>
          No items yet. Seed the demo data with <code>pnpm seed:production</code>.
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// BOM / Formulation — real rows, from GET /production/boms
// ---------------------------------------------------------------------------

const BOM_COLUMNS: readonly GridColumn<BomView>[] = [
  { key: 'product', label: 'Product', render: (bom) => <Code>{bom.product.code}</Code> },
  {
    key: 'name',
    label: 'Name',
    render: (bom) => <span className="font-medium text-slate-900">{bom.product.name}</span>,
  },
  { key: 'version', label: 'Version', render: (bom) => `v${bom.version}` },
  {
    key: 'output',
    label: 'Batch size',
    align: 'right',
    render: (bom) => (
      <>
        {trimQuantity(bom.outputQuantity)}
        <span className="ml-1 text-xs text-slate-500">{bom.product.uom}</span>
      </>
    ),
  },
  { key: 'lines', label: 'Lines', align: 'right', render: (bom) => bom.lines.length },
  {
    key: 'active',
    label: 'Status',
    render: (bom) =>
      bom.isActive ? (
        <Pill tone="bg-emerald-50 text-emerald-800 ring-emerald-200">Active</Pill>
      ) : (
        <Pill tone="bg-slate-100 text-slate-600 ring-slate-200">Superseded</Pill>
      ),
  },
  { key: 'from', label: 'Effective', align: 'right', render: (bom) => bom.effectiveFrom },
];

export function BomGrid({ result, onNew }: { result: ApiResult<BomView[]>; onNew: () => void }) {
  if (!result.ok) return <LoadFailed error={result.error} />;

  return (
    <Grid
      rows={result.data}
      columns={BOM_COLUMNS}
      rowKey={(bom) => bom.id}
      searchText={(bom) => `${bom.product.code} ${bom.product.name} v${bom.version}`}
      noun="formulations"
      singular="formulation"
      onNew={onNew}
      empty={
        <>
          No formulations yet. Seed the demo data with <code>pnpm seed:production</code>.
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Party — real rows, from GET /parties
// ---------------------------------------------------------------------------

const PARTY_TYPE_TONE: Record<string, string> = {
  VENDOR: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  CUSTOMER: 'bg-blue-50 text-blue-800 ring-blue-200',
  JOB_WORK_PRINCIPAL: 'bg-violet-50 text-violet-800 ring-violet-200',
};

const PARTY_COLUMNS: readonly GridColumn<PartySummary>[] = [
  { key: 'code', label: 'Code', render: (party) => <Code>{party.code}</Code> },
  {
    key: 'name',
    label: 'Name',
    render: (party) => <span className="font-medium text-slate-900">{party.name}</span>,
  },
  {
    key: 'type',
    label: 'Type',
    render: (party) => (
      <Pill tone={PARTY_TYPE_TONE[party.partyType] ?? 'bg-slate-100 text-slate-700 ring-slate-200'}>
        {PARTY_TYPE_LABELS[party.partyType]}
      </Pill>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    render: (party) =>
      party.status === 'ACTIVE' ? (
        <Pill tone="bg-emerald-50 text-emerald-800 ring-emerald-200">Active</Pill>
      ) : (
        <Pill tone="bg-slate-100 text-slate-600 ring-slate-200">Inactive</Pill>
      ),
  },
  {
    key: 'gstin',
    label: 'GSTIN',
    render: (party) => (party.gstin ? <Code>{party.gstin}</Code> : <Blank />),
  },
  {
    key: 'licence',
    label: 'Drug licence',
    render: (party) =>
      party.drugLicenceNumber ? <Code>{party.drugLicenceNumber}</Code> : <Blank />,
  },
  {
    key: 'licenceValidTo',
    label: 'Valid until',
    align: 'right',
    // An expired licence is the one thing on this row that stops a dispatch,
    // so it is the one thing that gets colour.
    render: (party) =>
      party.drugLicenceValidTo === null ? (
        <Blank />
      ) : party.licenceExpired ? (
        <span className="whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 font-semibold text-red-800 ring-1 ring-inset ring-red-200">
          {party.drugLicenceValidTo} · expired
        </span>
      ) : (
        party.drugLicenceValidTo
      ),
  },
  {
    key: 'creditLimit',
    label: 'Credit limit',
    align: 'right',
    render: (party) => party.creditLimit ?? <Blank />,
  },
  {
    key: 'creditPeriod',
    label: 'Credit period',
    align: 'right',
    render: (party) =>
      party.creditPeriodDays === null ? (
        <Blank />
      ) : (
        <>
          {party.creditPeriodDays}
          <span className="ml-1 text-xs text-slate-500">d</span>
        </>
      ),
  },
  {
    key: 'paymentTerms',
    label: 'Payment terms',
    align: 'right',
    render: (party) => (
      <>
        {party.paymentTermsDays}
        <span className="ml-1 text-xs text-slate-500">d</span>
      </>
    ),
  },
  { key: 'phone', label: 'Phone', render: (party) => party.phone ?? <Blank /> },
  { key: 'email', label: 'Email', render: (party) => party.email ?? <Blank /> },
  {
    key: 'address',
    label: 'Address',
    render: (party) => (party.address ? <Truncated text={party.address} /> : <Blank />),
  },
];

export function PartyGrid({
  result,
  onNew,
  onEdit,
}: {
  result: ApiResult<PartySummary[]>;
  onNew: () => void;
  onEdit: (party: PartySummary) => void;
}) {
  const [actionError, setActionError] = useState<string | null>(null);

  if (!result.ok) return <LoadFailed error={result.error} />;

  const columns: GridColumn<PartySummary>[] = [
    ...PARTY_COLUMNS,
    {
      key: 'actions',
      label: '',
      align: 'right',
      pinned: true,
      render: (party) => (
        <RowActions
          label={`${party.code} — ${party.name}`}
          onEdit={() => onEdit(party)}
          onDelete={() => deletePartyAction(party.id)}
          onError={setActionError}
        />
      ),
    },
  ];

  return (
    <Grid
      rows={result.data}
      columns={columns}
      rowKey={(party) => party.id}
      searchText={(party) =>
        [party.code, party.name, party.gstin, party.drugLicenceNumber, party.phone, party.email]
          .filter(Boolean)
          .join(' ')
      }
      noun="parties"
      singular="party"
      onNew={onNew}
      notice={
        actionError && (
          <p
            role="alert"
            className="border-b border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800"
          >
            {actionError}
          </p>
        )
      }
      empty={<>No parties yet. Add a supplier or a customer to get started.</>}
    />
  );
}

// ---------------------------------------------------------------------------
// The four registers with no table behind them
// ---------------------------------------------------------------------------

/**
 * Column names for a register that does not exist yet.
 *
 * Shown greyed, with the reason underneath. Naming the columns makes the shape
 * of the register readable now, without the empty body claiming there are no
 * records — there is no table to have records in, which is a different thing.
 */
export function PlannedGrid({
  columns,
  noun,
  singular,
  reason,
  onNew,
}: {
  columns: readonly string[];
  noun: string;
  singular: string;
  reason: string;
  onNew: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <input
          type="search"
          disabled
          placeholder={`Search ${noun}…`}
          aria-label={`Search ${noun}`}
          className="field-sm w-full max-w-xs"
        />
        <button
          type="button"
          onClick={onNew}
          className="whitespace-nowrap rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
        >
          New {singular}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {/* Same table shape as a live register, so a planned one differs only
            in what it says — not in how it is built. */}
        <table className="w-full border-collapse text-left text-sm">
          <HeadRow labels={columns} />
          <tbody>
            <tr>
              <td colSpan={columns.length} className="px-6 py-10 text-center">
                <p className="text-sm font-medium text-slate-700">
                  This register has no table yet.
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{reason}</p>
                <p className="mx-auto mt-3 max-w-md text-xs text-slate-500">
                  The columns above are what it will hold.{' '}
                  <strong className="font-semibold">New {singular}</strong> opens the form, so the
                  fields can be reviewed before the schema is written.
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LoadFailed({ error }: { error: string }) {
  return <p className="px-6 py-8 text-sm text-red-800">Could not load this register: {error}</p>;
}
