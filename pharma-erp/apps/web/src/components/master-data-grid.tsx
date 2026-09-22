'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { ListFilters, type FilterField } from '@/components/list-filters';
import { ListPager } from '@/components/list-pager';
import {
  AGREEMENT_STATUS_LABELS,
  BILLING_MODEL_LABELS,
  CONVERSION_RATE_BASIS_LABELS,
  ITEM_TYPE_LABELS,
  LICENCE_STATUS_LABELS,
  LICENCE_TYPE_LABELS,
  PACKAGING_LEVEL_LABELS,
  PACKAGING_QUANTITY_BASIS_LABELS,
  PARTY_STATUS_LABELS,
  PARTY_TYPE_LABELS,
  SCHEDULE_CLASSIFICATION_LABELS,
  type AgreementStatus,
  type BillingModel,
  type BomView,
  type ItemSummary,
  type JobWorkAgreementSummary,
  type JobWorkMappingView,
  type LicenceRegister,
  type LicenceStatus,
  type LicenceSummary,
  type PackagingLevel,
  type PackagingLineView,
  type PackagingRequirementView,
  type CustomerDocumentSummary,
  type PartySummary,
} from '@pharma-erp/types';

import {
  deleteAgreementAction,
  listCustomerDocumentsAction,
  deleteItemAction,
  deleteLicenceAction,
  deletePackagingAction,
  deletePartyAction,
  setLicenceAlertAction,
} from '@/app/(app)/master-data/actions';
import { DocumentIcon, DocumentPreview } from '@/components/document-preview';
import type { ApiResult } from '@/lib/api';
import { noWheelChange } from '@/lib/number-input';

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

/**
 * Rows per page, and the sizes offered.
 *
 * Ten is the default because that is the brief, and because a register is read
 * by scanning — a page you can take in without scrolling is the point of
 * paging it at all. The larger sizes are there for the times someone is
 * comparing rather than looking something up.
 */
const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * Search, filters and the New button.
 *
 * The controls themselves are the shared `ListFilters`, so this register looks
 * and behaves like the Production and Procurement lists. What stays here is the
 * New button, which is the one part that is this register's own.
 *
 * The row count that used to sit beside the search box is gone: the pager below
 * now says "Showing 1-10 of 34", and two counts in one view only invite a
 * comparison to check they agree.
 */
function Toolbar({
  title,
  total,
  noun,
  singular,
  query,
  onQuery,
  fields,
  values,
  onField,
  onClear,
  onNew,
}: {
  title: string;
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
  fields: readonly FilterField[];
  values: Record<string, string>;
  onField: (name: string, value: string) => void;
  onClear: () => void;
  onNew: () => void;
}) {
  return (
    <ListFilters
      title={title}
      total={total}
      noun={noun}
      singular={singular}
      fields={fields}
      values={values}
      onChange={onField}
      onClear={onClear}
      query={query}
      onQuery={onQuery}
      searchPlaceholder={`Search ${noun}…`}
    >
      <button
        type="button"
        onClick={onNew}
        className="h-9 whitespace-nowrap rounded-md bg-slate-900 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
      >
        New {singular}
      </button>
    </ListFilters>
  );
}

/**
 * Column names, always shown — including when the register is empty.
 *
 * Hiding them on an empty register loses the one thing an empty table is
 * genuinely good for: saying what the register holds. It also made the live
 * registers look broken next to the planned ones, which show their columns.
 */
/** "items" -> "Items", for the heading when a register names no title of its own. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function HeadRow({ labels }: { labels: readonly string[] }) {
  return (
    <thead className="sticky top-0 z-10 bg-slate-50">
      <tr>
        {labels.map((label) => (
          <th
            key={label}
            scope="col"
            className="whitespace-nowrap border-b border-slate-200 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/**
 * The footer: which slice of the register is on screen, and how to move.
 *
 * It sits OUTSIDE the scrolling box rather than under the last row, so it stays
 * reachable without scrolling to the bottom of the page you are on — the
 * controls for changing pages should not themselves need paging to reach.
 *
 * Prev/Next plus a page count, not a numbered strip. A register of two hundred
 * parties is 20 pages, and twenty little numbers is a lot of furniture for a
 * decision that is almost always "the next one" or "search instead".
 */
function Pager({
  page,
  pageCount,
  first,
  last,
  total,
  noun,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  pageCount: number;
  /** 1-based, inclusive — the row numbers actually on screen. */
  first: number;
  last: number;
  total: number;
  noun: string;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  // `flex-none` so the pager keeps its height while the table above it takes
  // the remaining space — this grid is inside a column that scrolls internally.
  return (
    <div className="flex-none bg-white">
      <ListPager
        page={page}
        pageCount={pageCount}
        pageSize={pageSize}
        first={first}
        last={last}
        total={total}
        noun={noun}
        pageSizes={PAGE_SIZES}
        onPage={onPage}
        onPageSize={onPageSize}
      />
    </div>
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
  title,
  onNew,
  empty,
  notice,
  filters,
  matchesField,
}: {
  rows: readonly Row[];
  columns: readonly GridColumn<Row>[];
  searchText: SearchText<Row>;
  rowKey: (row: Row) => string;
  noun: string;
  singular: string;
  /** The heading. Defaults to the plural noun, capitalised. */
  title?: string;
  onNew: () => void;
  empty: ReactNode;
  /** Shown under the toolbar — a refusal from a row action, typically. */
  notice?: ReactNode;
  /** Filters for the panel. Omitted renders the search box with no Filter button. */
  filters?: readonly FilterField[];
  /**
   * Whether a row passes one filter. Called once per field actually set, so
   * several filters narrow rather than widen.
   */
  matchesField?: (row: Row, name: string, value: string) => boolean;
}) {
  const [query, setQuery] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement>(null);

  /**
   * The register's own filters, plus "Created by".
   *
   * BUILT FROM THE ROWS, not from a list of users. The register holds every
   * row it can show, so the distinct creators among them are exactly the
   * answers worth offering — and a filter that listed every user in the
   * company would offer names that match nothing here.
   *
   * Sorted, because the order rows arrive in is creation order and a picklist
   * of names is read alphabetically.
   */
  const allFilters = useMemo(() => {
    const names = [
      ...new Set(
        rows
          .map((row) => (row as { createdBy?: string | null }).createdBy)
          .filter((name): name is string => !!name),
      ),
    ].sort((a, b) => a.localeCompare(b));

    // SHOWN EVEN WHEN NOBODY IS NAMED. It used to be dropped when no row had a
    // creator, which meant a register full of records entered before the column
    // existed simply had no "Created by" — indistinguishable from the feature
    // not being built. An empty picklist that says so is the honest answer.
    return [
      ...(filters ?? []),
      {
        name: 'createdBy',
        label: 'Created by',
        // Searchable, because this list grows with the company: a plain
        // dropdown is fine for three users and a scroll for thirty.
        kind: 'searchable' as const,
        options: names.map((name) => ({ value: name, label: name })),
        allLabel: names.length > 0 ? 'All Users' : 'Not recorded on any row yet',
      },
    ];
  }, [filters, rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    // Only the fields actually set — an unset field was never asked for, and
    // calling the predicate for it would make every register handle an empty
    // value.
    const active = Object.entries(fieldValues).filter(([, value]) => value !== '');

    if (!needle && active.length === 0) return rows;

    return rows.filter((row) => {
      for (const [name, value] of active) {
        // Handled here rather than in six identical per-register predicates:
        // every summary type carries `createdBy` as a plain name, so the test
        // is the same everywhere and nothing is gained by repeating it.
        if (name === 'createdBy') {
          if ((row as { createdBy?: string | null }).createdBy !== value) return false;
          continue;
        }

        if (matchesField && !matchesField(row, name, value)) return false;
      }

      if (!needle) return true;

      return searchText(row).toLowerCase().includes(needle);
    });
  }, [rows, query, fieldValues, searchText, matchesField]);

  // At least 1, so an empty register reads "Page 1 of 1" rather than "of 0".
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));

  // Clamped rather than stored blindly. Searching, changing the page size, and
  // deleting the last row of the last page all shrink the list under whatever
  // page is current — and a page past the end renders an empty table that looks
  // exactly like "nothing matches". Deriving the effective page keeps the two
  // apart without a corrective effect that flashes the empty state first.
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  const visible = filtered.slice(start, start + pageSize);

  function goTo(next: number) {
    setPage(Math.min(Math.max(1, next), pageCount));
    // Back to the top of the new page: paging while scrolled halfway down
    // otherwise lands you in the middle of the next set of rows.
    scrollRef.current?.scrollTo({ top: 0 });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title={title ?? capitalise(noun)}
        total={rows.length}
        noun={noun}
        singular={singular}
        query={query}
        onQuery={(value) => {
          setQuery(value);
          // A new search is a new list; keeping the old page number would show
          // page 4 of a result that has one page.
          setPage(1);
        }}
        fields={allFilters}
        values={fieldValues}
        onField={(name, value) => {
          setFieldValues((current) => ({ ...current, [name]: value }));
          setPage(1);
        }}
        onClear={() => {
          setFieldValues({});
          setPage(1);
        }}
        onNew={onNew}
      />

      {notice}

      {/* `table-scroll` is what draws the rules BETWEEN cells — a slate-200 line
          under every row, a fainter slate-100 line down each column, and a
          firmer edge under the header. It is a stylesheet rule rather than
          classes here (see globals.css) so that every table in the application
          is ruled identically; this grid used to draw its own borders per cell
          and so quietly looked different from the Procure-to-Pay lists.

          `border-separate` is gone with them: those column rules land on
          adjacent cell edges, and only `border-collapse` merges the two into
          one line instead of two abutting ones. */}
      <div ref={scrollRef} className="table-scroll min-h-0 flex-1 overflow-auto overscroll-contain">
        <table className="w-full text-left text-sm">
          {/* Sticky so the column names stay readable once the register is
              longer than the box — which is the entire point of a grid. The
              pinning itself comes from `.table-scroll thead th`. */}
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  // A pinned header cell sits at the crossing of two sticky
                  // axes, so it needs to outrank both the row it is in and
                  // the pinned body cells scrolling beneath it.
                  className={`whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 ${
                    column.align === 'right' ? 'text-right' : ''
                  } ${column.pinned ? 'sticky right-0 z-20 bg-white' : ''}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
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
              visible.map((row) => (
                // No hover class: `.table-scroll` hovers the whole row for
                // every table in the application. `group` stays, because the
                // pinned cell still has to follow it.
                <tr key={rowKey(row)} className="group">
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

      {/* ALWAYS SHOWN, like every Procure-to-Pay list. It used to hide itself
          whenever everything fit on one page, which took the row count and the
          page-size control away exactly when somebody wanted to raise the size
          to see more — and it made these registers look unlike the rest of the
          application for no reason a reader could work out. */}
      <Pager
        page={current}
        pageCount={pageCount}
        first={filtered.length === 0 ? 0 : start + 1}
        last={start + visible.length}
        total={filtered.length}
        noun={noun}
        pageSize={pageSize}
        onPage={goTo}
        onPageSize={(size) => {
          setPageSize(size);
          // Row 1 again rather than trying to keep the current rows in view:
          // the arithmetic for "which page holds the row I was looking at"
          // is guesswork once the size changes, and landing at the top is
          // the one outcome nobody has to work out.
          setPage(1);
          scrollRef.current?.scrollTo({ top: 0 });
        }}
      />
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

/**
 * "Created" — the same two columns on every register.
 *
 * Generic over the row, because all six summary types carry `createdAt` and
 * `createdBy`; one definition means the date format and the em-dash for an
 * unattributed row cannot drift between six copies.
 *
 * `createdBy` is null for a record entered before the column existed, and for
 * one whose creating user has been hard-deleted — which the schema prevents,
 * so in practice it means "before this was recorded". A dash says that without
 * inventing a name.
 */
function createdColumns<
  Row extends { createdAt: string; createdBy: string | null },
>(): readonly GridColumn<Row>[] {
  return [
    {
      key: 'createdAt',
      label: 'Created',
      // Sliced to the calendar day. `createdAt` is a full ISO timestamp and
      // the time of entry is not what anybody reads a register for.
      render: (row) => row.createdAt.slice(0, 10),
    },
    {
      key: 'createdBy',
      label: 'Created by',
      render: (row) =>
        row.createdBy ? <span className="text-slate-700">{row.createdBy}</span> : <Blank />,
    },
  ];
}

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
  ...createdColumns<ItemSummary>(),
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
  extra,
}: {
  /** Names the row in the confirmation and the button's accessible name. */
  label: string;
  onEdit: () => void;
  /** The register's own delete action. Returns the API's refusal, if any. */
  onDelete: () => Promise<{ ok: boolean; message?: string }>;
  onError: (message: string | null) => void;
  /**
   * A register-specific entry, above Edit. Only the Item register uses one
   * today (Inventory), and it sits first because looking at stock is a read
   * and the two below it are writes.
   */
  extra?: { label: string; onClick: () => void };
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
          {extra && (
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                extra.onClick();
              }}
              className="block w-full rounded px-3 py-1.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              {extra.label}
            </button>
          )}
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

/**
 * "Created date" — the same filter on every register.
 *
 * Defined once and spread into each register's filters, so the wording cannot
 * drift between six copies. It writes two values, `createdFrom` and
 * `createdTo`; see `dateRangeKeys` in list-filters.
 */
const CREATED_FILTER: FilterField = {
  name: 'created',
  label: 'Created date',
  kind: 'dateRange',
};

/**
 * Whether a record was created inside the range.
 *
 * COMPARED AS CALENDAR DAYS, not instants. `createdAt` is an ISO timestamp and
 * the inputs give YYYY-MM-DD, so comparing them directly would put a record
 * created at 14:30 outside a To of its own date — the whole day is meant, not
 * the midnight at the start of it. Slicing the timestamp to its date makes
 * both ends inclusive, which is what "from the 1st to the 5th" means to
 * everyone who is not a computer.
 *
 * The slice takes the date in UTC, which is how the API sends it. A user east
 * of UTC filtering the last few hours of their day may see a record fall on
 * the previous date; that is the same convention the rest of the registers
 * already display, so the filter and the column agree.
 */
function matchesCreated(createdAt: string, name: string, value: string): boolean {
  const day = createdAt.slice(0, 10);

  if (name === 'createdFrom') return day >= value;
  if (name === 'createdTo') return day <= value;

  return true;
}

/**
 * Turns one of the shared label maps into filter options.
 *
 * The maps are the single source for what each code is CALLED, so building the
 * options from them means a filter can never offer a value the register cannot
 * display, or miss one that was added to the enum.
 */
function optionsFrom(labels: Record<string, string>) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

const ITEM_FILTERS: readonly FilterField[] = [
  {
    name: 'type',
    // "Category" is what the Item form calls this field, and a filter that
    // names it differently from the control that sets it reads as a second,
    // unrelated thing to choose.
    label: 'Category',
    options: optionsFrom(ITEM_TYPE_LABELS),
    allLabel: 'Any category',
  },
  {
    name: 'schedule',
    label: 'Schedule',
    options: optionsFrom(SCHEDULE_CLASSIFICATION_LABELS),
    allLabel: 'Any schedule',
  },
  CREATED_FILTER,
];

function matchesItemField(item: ItemSummary, name: string, value: string): boolean {
  if (name === 'type') return item.type === value;
  if (name === 'schedule') return item.scheduleClassification === value;
  if (name.startsWith('created')) return matchesCreated(item.createdAt, name, value);

  return true;
}

export function ItemGrid({
  result,
  onNew,
  onEdit,
  onInventory,
}: {
  result: ApiResult<ItemSummary[]>;
  onNew: () => void;
  onEdit: (item: ItemSummary) => void;
  onInventory: (item: ItemSummary) => void;
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
          extra={{ label: 'Inventory', onClick: () => onInventory(item) }}
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
      filters={ITEM_FILTERS}
      matchesField={matchesItemField}
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
  ...createdColumns<BomView>(),
];

/**
 * Active versus superseded, which is the question actually asked of this
 * register: a formulation is never edited, so a product with four revisions has
 * four rows here and only one of them is the one being manufactured to.
 */
const BOM_FILTERS: readonly FilterField[] = [
  {
    name: 'version',
    label: 'Status',
    options: [
      { value: 'ACTIVE', label: 'Active only' },
      { value: 'SUPERSEDED', label: 'Superseded only' },
    ],
    allLabel: 'Any status',
  },
  CREATED_FILTER,
];

function matchesBomField(bom: BomView, name: string, value: string): boolean {
  if (name === 'version') return value === 'ACTIVE' ? bom.isActive : !bom.isActive;
  if (name.startsWith('created')) return matchesCreated(bom.createdAt, name, value);

  return true;
}

export function BomGrid({
  result,
  onNew,
  onEdit,
}: {
  result: ApiResult<BomView[]>;
  onNew: () => void;
  onEdit: (bom: BomView) => void;
}) {
  if (!result.ok) return <LoadFailed error={result.error} />;

  // A plain button rather than the RowActions menu the other registers use:
  // that menu pairs Edit with Delete, and a formulation has no delete endpoint.
  // A menu offering one action is a menu nobody wants to open.
  const columns: GridColumn<BomView>[] = [
    ...BOM_COLUMNS,
    {
      key: 'actions',
      label: '',
      align: 'right',
      pinned: true,
      render: (bom) => (
        <button
          type="button"
          onClick={() => onEdit(bom)}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Edit
          <span className="sr-only">
            {' '}
            {bom.product.code} v{bom.version}
          </span>
        </button>
      ),
    },
  ];

  return (
    <Grid
      rows={result.data}
      columns={columns}
      rowKey={(bom) => bom.id}
      searchText={(bom) => `${bom.product.code} ${bom.product.name} v${bom.version}`}
      noun="formulations"
      singular="formulation"
      filters={BOM_FILTERS}
      matchesField={matchesBomField}
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
    key: 'documents',
    label: 'Documents',
    // The count, not a link, in the SHARED column definition: opening one needs
    // its id, and the register holds only a count — the bytes stay in the
    // database until somebody asks for a specific file. PartyGrid replaces this
    // with a clickable version; see there.
    render: (party) =>
      party.documentCount > 0 ? (
        <span className="text-slate-700">{party.documentCount}</span>
      ) : (
        <Blank />
      ),
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
  ...createdColumns<PartySummary>(),
];

/**
 * The Documents cell: the paperwork on file, as icons.
 *
 * An icon per document rather than a count in words, because the useful fact at
 * a glance is WHAT is on file — a PDF licence reads differently from a
 * photographed one — and "1 document" says neither.
 *
 * Clicking opens a preview rather than downloading. Checking a licence number
 * is the common reason to open one, and a download makes that a detour through
 * the file manager; the preview carries its own Download button for when the
 * file really is wanted.
 *
 * The ids are fetched on first click, not with the register: the listing
 * carries a count precisely so drawing it does not touch the documents table
 * for every row. Until then the count is all there is to draw, so the icons
 * start as neutral placeholders and take their real type once loaded.
 */
function PartyDocumentsCell({ party }: { party: PartySummary }) {
  const [documents, setDocuments] = useState<CustomerDocumentSummary[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const [previewing, setPreviewing] = useState<CustomerDocumentSummary | null>(null);

  const load = async (): Promise<CustomerDocumentSummary[] | null> => {
    if (documents) return documents;

    setIsLoading(true);
    setError(false);

    const result = await listCustomerDocumentsAction(party.id);

    setIsLoading(false);

    if (!result.ok) {
      setError(true);
      return null;
    }

    setDocuments(result.data);
    return result.data;
  };

  const open = async (index: number) => {
    const loaded = await load();
    const chosen = loaded?.[index];

    if (chosen) setPreviewing(chosen);
  };

  // Before the first click the types are unknown, so one neutral button per
  // document stands in — the count is known, which is what the register was
  // given.
  const entries: (CustomerDocumentSummary | null)[] =
    documents ?? Array.from({ length: party.documentCount }, () => null);

  return (
    <>
      <div className="flex items-center gap-1.5">
        {entries.map((document, index) => (
          <button
            key={document?.id ?? index}
            type="button"
            disabled={isLoading}
            onClick={() => void open(index)}
            title={document?.fileName ?? 'Open document'}
            aria-label={document ? `Open ${document.fileName}` : `Open document ${index + 1}`}
            className="rounded p-0.5 text-slate-400 transition hover:bg-slate-100 disabled:opacity-50"
          >
            {document ? (
              <DocumentIcon contentType={document.contentType} />
            ) : (
              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
                className="h-5 w-5 shrink-0"
                fill="none"
                stroke="currentColor"
              >
                <path
                  d="M5 2.5h6.5L16 7v10.5H5z"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                  className="stroke-slate-400"
                />
                <path
                  d="M11.5 2.5V7H16"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                  className="stroke-slate-400"
                />
              </svg>
            )}
          </button>
        ))}

        {error && <span className="text-xs text-red-700">could not load</span>}
      </div>

      {previewing && (
        <DocumentPreview
          partyId={party.id}
          document={previewing}
          onClose={() => setPreviewing(null)}
        />
      )}
    </>
  );
}

const PARTY_FILTERS: readonly FilterField[] = [
  {
    name: 'partyType',
    label: 'Type',
    options: optionsFrom(PARTY_TYPE_LABELS),
    allLabel: 'Any type',
  },
  {
    name: 'status',
    label: 'Status',
    options: optionsFrom(PARTY_STATUS_LABELS),
    allLabel: 'Any status',
  },
  CREATED_FILTER,
];

function matchesPartyField(party: PartySummary, name: string, value: string): boolean {
  if (name === 'partyType') return party.partyType === value;
  if (name === 'status') return party.status === value;
  if (name.startsWith('created')) return matchesCreated(party.createdAt, name, value);

  return true;
}

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
    // The shared definition renders a bare count; here it becomes a control
    // that opens the paperwork. Replaced rather than appended so the column
    // keeps its position between GSTIN and the licence.
    ...PARTY_COLUMNS.map((column) =>
      column.key === 'documents'
        ? {
            ...column,
            render: (party: PartySummary) =>
              party.documentCount > 0 ? <PartyDocumentsCell party={party} /> : <Blank />,
          }
        : column,
    ),
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
      filters={PARTY_FILTERS}
      matchesField={matchesPartyField}
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
// Licence & Compliance — US-MD-04
// ---------------------------------------------------------------------------

const LICENCE_STATUS_TONE: Record<LicenceStatus, string> = {
  VALID: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  EXPIRING: 'bg-amber-50 text-amber-900 ring-amber-200',
  EXPIRED: 'bg-red-50 text-red-800 ring-red-200',
};

/**
 * Days remaining, phrased the way someone would say it.
 *
 * "-5d" is arithmetic; "5 days ago" is the thing that has happened. A lapsed
 * manufacturing licence is a stop-work condition and the column should read
 * like one.
 */
function daysLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ago`;
  if (days === 0) return 'today';
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

const LICENCE_COLUMNS: readonly GridColumn<LicenceSummary>[] = [
  {
    key: 'type',
    label: 'Type',
    render: (licence) => (
      <span className="font-medium text-slate-900">{LICENCE_TYPE_LABELS[licence.licenceType]}</span>
    ),
  },
  { key: 'number', label: 'Number', render: (licence) => <Code>{licence.licenceNumber}</Code> },
  {
    key: 'authority',
    label: 'Issuing authority',
    render: (licence) => <Truncated text={licence.issuingAuthority} />,
  },
  {
    key: 'issuedOn',
    label: 'Issued',
    align: 'right',
    render: (licence) => licence.issuedOn ?? <Blank />,
  },
  { key: 'expiry', label: 'Expires', align: 'right', render: (licence) => licence.expiryDate },
  {
    key: 'status',
    label: 'Status',
    render: (licence) => (
      <Pill tone={LICENCE_STATUS_TONE[licence.status]}>
        {LICENCE_STATUS_LABELS[licence.status]}
      </Pill>
    ),
  },
  {
    key: 'daysLeft',
    label: 'Days left',
    align: 'right',
    // The only column that changes meaning by sign, so it is the only one that
    // gets emphasis rather than colour on every row.
    render: (licence) => (
      <span
        className={
          licence.status === 'EXPIRED'
            ? 'font-semibold text-red-800'
            : licence.status === 'EXPIRING'
              ? 'font-semibold text-amber-900'
              : 'text-slate-700'
        }
      >
        {daysLabel(licence.daysUntilExpiry)}
      </span>
    ),
  },
  {
    key: 'notes',
    label: 'Notes',
    render: (licence) => (licence.notes ? <Truncated text={licence.notes} /> : <Blank />),
  },
  ...createdColumns<LicenceSummary>(),
];

/**
 * The alert threshold, set from the register itself — US-MD-04's "configurable
 * number of days".
 *
 * It lives here rather than on a settings screen because this is where someone
 * thinking about licence renewals already is, and because the number only
 * means anything next to the rows it reclassifies: change it and the Status
 * column moves under your hand.
 */
function AlertLeadDays({
  value,
  onError,
}: {
  value: number;
  onError: (message: string | null) => void;
}) {
  const [days, setDays] = useState(String(value));
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // The saved value is the source of truth. Re-syncing on change keeps the box
  // honest when a save is refused, or when another tab moves it.
  useEffect(() => setDays(String(value)), [value]);

  function commit() {
    const parsed = Number(days);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
      onError('The renewal warning must be a whole number of days between 1 and 365.');
      setDays(String(value));
      return;
    }

    if (parsed === value) return;

    onError(null);
    startTransition(async () => {
      const result = await setLicenceAlertAction(parsed);

      if (!result.ok) {
        onError(result.message ?? 'That change could not be saved.');
        setDays(String(value));
        return;
      }

      router.refresh();
    });
  }

  return (
    <label className="flex items-center gap-2 whitespace-nowrap text-xs text-slate-600">
      Warn
      <input
        type="number"
        min={1}
        max={365}
        value={days}
        disabled={isPending}
        onChange={(event) => setDays(event.target.value)}
        onBlur={commit}
        {...noWheelChange}
        // Enter commits without submitting anything — this control is not in a
        // form, and leaving Enter to bubble would do nothing at all.
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') setDays(String(value));
        }}
        aria-label="Days before expiry to warn"
        className="w-16 rounded-md border border-slate-300 px-2 py-1 text-right text-xs tabular-nums text-slate-900 disabled:bg-slate-100"
      />
      days before expiry
      {isPending && <span className="text-slate-400">saving…</span>}
    </label>
  );
}

const LICENCE_FILTERS: readonly FilterField[] = [
  {
    name: 'licenceType',
    label: 'Licence type',
    options: optionsFrom(LICENCE_TYPE_LABELS),
    allLabel: 'Any type',
  },
  {
    name: 'status',
    label: 'Status',
    options: optionsFrom(LICENCE_STATUS_LABELS),
    allLabel: 'Any status',
  },
  CREATED_FILTER,
];

function matchesLicenceField(licence: LicenceSummary, name: string, value: string): boolean {
  if (name === 'licenceType') return licence.licenceType === value;
  if (name === 'status') return licence.status === value;
  if (name.startsWith('created')) return matchesCreated(licence.createdAt, name, value);

  return true;
}

export function LicenceGrid({
  result,
  onNew,
  onEdit,
}: {
  result: ApiResult<LicenceRegister>;
  onNew: () => void;
  onEdit: (licence: LicenceSummary) => void;
}) {
  const [actionError, setActionError] = useState<string | null>(null);

  if (!result.ok) return <LoadFailed error={result.error} />;

  const { licences, alertLeadDays } = result.data;

  const columns: GridColumn<LicenceSummary>[] = [
    ...LICENCE_COLUMNS,
    {
      key: 'actions',
      label: '',
      align: 'right',
      pinned: true,
      render: (licence) => (
        <RowActions
          label={`${LICENCE_TYPE_LABELS[licence.licenceType]} — ${licence.licenceNumber}`}
          onEdit={() => onEdit(licence)}
          onDelete={() => deleteLicenceAction(licence.id)}
          onError={setActionError}
        />
      ),
    },
  ];

  const overdue = licences.filter((licence) => licence.status !== 'VALID').length;

  return (
    <Grid
      rows={licences}
      columns={columns}
      rowKey={(licence) => licence.id}
      searchText={(licence) =>
        [
          licence.licenceNumber,
          licence.issuingAuthority,
          LICENCE_TYPE_LABELS[licence.licenceType],
          licence.notes,
        ]
          .filter(Boolean)
          .join(' ')
      }
      noun="licences"
      singular="licence"
      onNew={onNew}
      filters={LICENCE_FILTERS}
      matchesField={matchesLicenceField}
      notice={
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-2">
            <AlertLeadDays value={alertLeadDays} onError={setActionError} />
            {overdue > 0 && (
              <span className="text-xs font-medium text-amber-900">
                {overdue} {overdue === 1 ? 'licence needs' : 'licences need'} attention — also shown
                on the dashboard.
              </span>
            )}
          </div>
          {actionError && (
            <p
              role="alert"
              className="border-b border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800"
            >
              {actionError}
            </p>
          )}
        </>
      }
      empty={
        <>
          No licences on file yet. Add the manufacturing licence first — it is the one that stops
          production when it lapses.
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Principal & Job-Work agreements — US-MD-05
// ---------------------------------------------------------------------------

const AGREEMENT_STATUS_TONE: Record<AgreementStatus, string> = {
  IN_FORCE: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  NOT_YET_STARTED: 'bg-sky-50 text-sky-800 ring-sky-200',
  EXPIRED: 'bg-red-50 text-red-800 ring-red-200',
};

const BILLING_MODEL_TONE: Record<BillingModel, string> = {
  OWN_PROCUREMENT: 'bg-violet-50 text-violet-800 ring-violet-200',
  PURE_CONVERSION: 'bg-amber-50 text-amber-900 ring-amber-200',
};

/**
 * The product-to-brand mapping, in the cell where it belongs — US-MD-05.
 *
 * Shown inline rather than behind an expander: the mapping IS the agreement.
 * An agreement row without it says who you have a contract with but not what
 * it covers, which is the question the register exists to answer.
 *
 * Our formulation on the left, their brand on the right, an arrow between. The
 * direction matters — it is our recipe sold under their name, not the reverse.
 */
function MappingCell({ mappings }: { mappings: readonly JobWorkMappingView[] }) {
  if (mappings.length === 0) return <Blank />;

  return (
    <ul className="flex flex-col gap-1">
      {mappings.map((mapping) => (
        <li key={mapping.id} className="flex flex-wrap items-baseline gap-1.5 whitespace-nowrap">
          <Code>{mapping.bomLabel}</Code>
          <span aria-hidden className="text-slate-400">
            →
          </span>
          <span className="font-medium text-slate-900">{mapping.principalBrandName}</span>
          {mapping.packDesignRef && (
            <span className="font-mono text-[11px] text-slate-500">{mapping.packDesignRef}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

const AGREEMENT_COLUMNS: readonly GridColumn<JobWorkAgreementSummary>[] = [
  {
    key: 'principal',
    label: 'Principal',
    render: (agreement) => (
      <span className="whitespace-nowrap">
        <span className="font-medium text-slate-900">{agreement.principalName}</span>{' '}
        <Code>{agreement.principalCode}</Code>
      </span>
    ),
  },
  {
    key: 'reference',
    label: 'Reference',
    render: (agreement) =>
      agreement.agreementReference ? <Code>{agreement.agreementReference}</Code> : <Blank />,
  },
  {
    key: 'billingModel',
    label: 'Billing model',
    // The mandatory field of US-MD-05, and the one that decides what gets
    // invoiced — so it reads as a state, not as text in a row of text.
    render: (agreement) => (
      <Pill tone={BILLING_MODEL_TONE[agreement.billingModel]}>
        {BILLING_MODEL_LABELS[agreement.billingModel]}
      </Pill>
    ),
  },
  {
    key: 'rate',
    label: 'Conversion charge',
    align: 'right',
    render: (agreement) =>
      agreement.conversionChargeRate === null ? (
        <Blank />
      ) : (
        <span className="whitespace-nowrap tabular-nums">
          ₹{agreement.conversionChargeRate}
          {agreement.conversionRateBasis && (
            <span className="ml-1 text-xs text-slate-500">
              {CONVERSION_RATE_BASIS_LABELS[agreement.conversionRateBasis]}
            </span>
          )}
        </span>
      ),
  },
  {
    key: 'products',
    label: 'Products — our formulation → their brand',
    render: (agreement) => <MappingCell mappings={agreement.mappings} />,
  },
  {
    key: 'status',
    label: 'Status',
    render: (agreement) => (
      <Pill tone={AGREEMENT_STATUS_TONE[agreement.status]}>
        {AGREEMENT_STATUS_LABELS[agreement.status]}
      </Pill>
    ),
  },
  {
    key: 'validFrom',
    label: 'From',
    align: 'right',
    render: (agreement) => agreement.validFrom ?? <Blank />,
  },
  {
    key: 'validTo',
    label: 'Until',
    align: 'right',
    // An open-ended agreement is a real arrangement, not a missing value, so it
    // says so rather than showing the dash that means "not recorded".
    render: (agreement) =>
      agreement.validTo ?? <span className="text-xs text-slate-500">open-ended</span>,
  },
  {
    key: 'notes',
    label: 'Notes',
    render: (agreement) => (agreement.notes ? <Truncated text={agreement.notes} /> : <Blank />),
  },
  ...createdColumns<JobWorkAgreementSummary>(),
];

const AGREEMENT_FILTERS: readonly FilterField[] = [
  {
    name: 'billingModel',
    label: 'Billing model',
    options: optionsFrom(BILLING_MODEL_LABELS),
    allLabel: 'Any model',
  },
  {
    name: 'status',
    label: 'Status',
    options: optionsFrom(AGREEMENT_STATUS_LABELS),
    allLabel: 'Any status',
  },
  CREATED_FILTER,
];

function matchesAgreementField(
  agreement: JobWorkAgreementSummary,
  name: string,
  value: string,
): boolean {
  if (name === 'billingModel') return agreement.billingModel === value;
  if (name === 'status') return agreement.status === value;
  if (name.startsWith('created')) return matchesCreated(agreement.createdAt, name, value);

  return true;
}

export function AgreementGrid({
  result,
  onNew,
  onEdit,
}: {
  result: ApiResult<JobWorkAgreementSummary[]>;
  onNew: () => void;
  onEdit: (agreement: JobWorkAgreementSummary) => void;
}) {
  const [actionError, setActionError] = useState<string | null>(null);

  if (!result.ok) return <LoadFailed error={result.error} />;

  const columns: GridColumn<JobWorkAgreementSummary>[] = [
    ...AGREEMENT_COLUMNS,
    {
      key: 'actions',
      label: '',
      align: 'right',
      pinned: true,
      render: (agreement) => (
        <RowActions
          label={`${agreement.principalName}${
            agreement.agreementReference ? ` — ${agreement.agreementReference}` : ''
          }`}
          onEdit={() => onEdit(agreement)}
          onDelete={() => deleteAgreementAction(agreement.id)}
          onError={setActionError}
        />
      ),
    },
  ];

  return (
    <Grid
      rows={result.data}
      columns={columns}
      rowKey={(agreement) => agreement.id}
      // Searchable by the principal's brand too: "which agreement covers
      // Dolotab?" is the question somebody on the packing line actually asks.
      searchText={(agreement) =>
        [
          agreement.principalName,
          agreement.principalCode,
          agreement.agreementReference,
          BILLING_MODEL_LABELS[agreement.billingModel],
          agreement.notes,
          ...agreement.mappings.flatMap((mapping) => [
            mapping.bomLabel,
            mapping.productName,
            mapping.principalBrandName,
            mapping.packDesignRef,
          ]),
        ]
          .filter(Boolean)
          .join(' ')
      }
      noun="agreements"
      singular="agreement"
      onNew={onNew}
      filters={AGREEMENT_FILTERS}
      matchesField={matchesAgreementField}
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
      empty={
        <>
          No job-work agreements yet. Add one to record what a principal is billed and which of our
          formulations carry their brand.
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Packaging requirements — US-MD-06
// ---------------------------------------------------------------------------

const PACKAGING_LEVEL_TONE: Record<PackagingLevel, string> = {
  PRIMARY: 'bg-sky-50 text-sky-800 ring-sky-200',
  SECONDARY: 'bg-violet-50 text-violet-800 ring-violet-200',
  TERTIARY: 'bg-slate-100 text-slate-700 ring-slate-200',
};

/**
 * The component list, inline — the specification IS the component list.
 *
 * A mandatory component is marked, an optional one is not: that flag decides
 * whether a shortage stops the line, and it is the one thing on the row that
 * changes what happens rather than merely describing it.
 */
function ComponentCell({ lines }: { lines: readonly PackagingLineView[] }) {
  if (lines.length === 0) return <Blank />;

  return (
    <ul className="flex flex-col gap-1">
      {lines.map((line) => (
        <li key={line.id} className="flex flex-wrap items-baseline gap-1.5 whitespace-nowrap">
          <Code>{line.item.code}</Code>
          <span className="tabular-nums text-slate-900">
            {trimQuantity(line.quantityPer)}
            <span className="ml-1 text-xs text-slate-500">
              {line.item.uom} {PACKAGING_QUANTITY_BASIS_LABELS[line.quantityBasis]}
            </span>
          </span>
          <Pill tone={PACKAGING_LEVEL_TONE[line.level]}>{PACKAGING_LEVEL_LABELS[line.level]}</Pill>
          {line.requirement === 'MANDATORY' && (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-red-700">
              blocks
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

const PACKAGING_COLUMNS: readonly GridColumn<PackagingRequirementView>[] = [
  {
    key: 'product',
    label: 'Product',
    render: (row) => (
      <span className="whitespace-nowrap">
        <Code>{row.product.code}</Code>{' '}
        <span className="font-medium text-slate-900">{row.product.name}</span>
      </span>
    ),
  },
  {
    key: 'variant',
    label: 'Pack variant',
    render: (row) => <span className="font-medium text-slate-900">{row.packVariant}</span>,
  },
  {
    key: 'unitsPerPack',
    label: 'Units / pack',
    align: 'right',
    // The number that makes every per-pack quantity scalable, so it earns a
    // column rather than hiding in the drawer.
    render: (row) => (
      <span className="tabular-nums">
        {trimQuantity(row.unitsPerPack)}
        <span className="ml-1 text-xs text-slate-500">{row.product.uom}</span>
      </span>
    ),
  },
  {
    key: 'components',
    label: 'Components',
    render: (row) => <ComponentCell lines={row.lines} />,
  },
  {
    key: 'status',
    label: 'Status',
    // Not a soft-delete flag: an inactive specification still exists, and its
    // being inactive is what stops a work order being raised for the product.
    render: (row) =>
      row.isActive ? (
        <Pill tone="bg-emerald-50 text-emerald-800 ring-emerald-200">Active</Pill>
      ) : (
        <Pill tone="bg-slate-100 text-slate-600 ring-slate-200">Inactive</Pill>
      ),
  },
  {
    key: 'notes',
    label: 'Notes',
    render: (row) => (row.notes ? <Truncated text={row.notes} /> : <Blank />),
  },
  ...createdColumns<PackagingRequirementView>(),
];

const PACKAGING_FILTERS: readonly FilterField[] = [
  {
    name: 'active',
    label: 'Status',
    options: [
      { value: 'ACTIVE', label: 'Active only' },
      { value: 'INACTIVE', label: 'Inactive only' },
    ],
    allLabel: 'Any status',
  },
  CREATED_FILTER,
];

function matchesPackagingField(
  row: PackagingRequirementView,
  name: string,
  value: string,
): boolean {
  if (name === 'active') return value === 'ACTIVE' ? row.isActive : !row.isActive;
  if (name.startsWith('created')) return matchesCreated(row.createdAt, name, value);

  return true;
}

export function PackagingGrid({
  result,
  onNew,
  onEdit,
}: {
  result: ApiResult<PackagingRequirementView[]>;
  onNew: () => void;
  onEdit: (requirement: PackagingRequirementView) => void;
}) {
  const [actionError, setActionError] = useState<string | null>(null);

  if (!result.ok) return <LoadFailed error={result.error} />;

  const columns: GridColumn<PackagingRequirementView>[] = [
    ...PACKAGING_COLUMNS,
    {
      key: 'actions',
      label: '',
      align: 'right',
      pinned: true,
      render: (row) => (
        <RowActions
          label={`${row.product.code} — ${row.packVariant}`}
          onEdit={() => onEdit(row)}
          onDelete={() => deletePackagingAction(row.id)}
          onError={setActionError}
        />
      ),
    },
  ];

  const inactive = result.data.filter((row) => !row.isActive).length;

  return (
    <Grid
      rows={result.data}
      columns={columns}
      rowKey={(row) => row.id}
      searchText={(row) =>
        [
          row.product.code,
          row.product.name,
          row.packVariant,
          row.notes,
          ...row.lines.flatMap((line) => [line.item.code, line.item.name]),
        ]
          .filter(Boolean)
          .join(' ')
      }
      noun="pack specifications"
      singular="pack specification"
      onNew={onNew}
      filters={PACKAGING_FILTERS}
      matchesField={matchesPackagingField}
      notice={
        <>
          {inactive > 0 && (
            <p className="border-b border-slate-200 bg-slate-50/60 px-4 py-2 text-xs text-slate-600">
              {inactive} inactive {inactive === 1 ? 'specification' : 'specifications'}. A product
              with no active specification cannot have a work order raised for it.
            </p>
          )}
          {actionError && (
            <p
              role="alert"
              className="border-b border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800"
            >
              {actionError}
            </p>
          )}
        </>
      }
      empty={
        <>
          No pack specifications yet. Add one before raising a work order — a product cannot go into
          production without a pack to put it in.
        </>
      }
    />
  );
}

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
        <table className="w-full border-separate border-spacing-0 text-left text-sm">
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
