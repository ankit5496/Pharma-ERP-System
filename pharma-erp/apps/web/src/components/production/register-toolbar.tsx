'use client';

import { useMemo, useState } from 'react';

/**
 * Search, filter and paging for the Production registers.
 *
 * ONE implementation, used by all five steps, because five hand-rolled
 * toolbars drift: the counts start meaning slightly different things, one
 * forgets to reset the page when the search changes, and the register that
 * needed the care most is the one that got the least.
 *
 * Client-side throughout. Every step already fetches its rows in full to render
 * the list, so filtering is a substring test rather than a request. When one of
 * these outgrows that, the fix is a server query and a cursor — NOT a filter
 * that quietly drops rows the count still claims.
 */

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZES = [10, 25, 50, 100] as const;

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * The state a register needs, with the paging arithmetic done.
 *
 * A hook rather than a wrapper component: each register lays its rows out
 * differently — a table, a card list, a master/detail split — and only the
 * slicing is common.
 */
export function useRegisterView<Row>({
  rows,
  searchText,
  matchesFilter,
}: {
  rows: readonly Row[];
  /** Everything on a row the search box should match against. */
  searchText: (row: Row) => string;
  /** Applied when a filter other than "all" is chosen. */
  matchesFilter?: (row: Row, value: string) => boolean;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return rows.filter((row) => {
      if (filter !== 'ALL' && matchesFilter && !matchesFilter(row, filter)) return false;
      if (!needle) return true;

      return searchText(row).toLowerCase().includes(needle);
    });
  }, [rows, query, filter, searchText, matchesFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));

  // Derived, not stored. Searching, changing the page size and a row being
  // removed all shrink the list under whatever page is current, and a page past
  // the end renders empty — which looks exactly like "nothing matches".
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  const visible = filtered.slice(start, start + pageSize);

  return {
    query,
    setQuery: (value: string) => {
      setQuery(value);
      // A new search is a new list; keeping the page number would show page 4
      // of a result that has one page.
      setPage(1);
    },
    filter,
    setFilter: (value: string) => {
      setFilter(value);
      setPage(1);
    },
    filtered,
    visible,
    total: rows.length,
    page: current,
    pageCount,
    pageSize,
    setPageSize: (size: number) => {
      setPageSize(size);
      setPage(1);
    },
    goTo: (next: number) => setPage(Math.min(Math.max(1, next), pageCount)),
    first: start + 1,
    last: start + visible.length,
  };
}

/** The search box, the optional status filter, and the count. */
export function RegisterToolbar({
  query,
  onQuery,
  placeholder,
  noun,
  filter,
  onFilter,
  filterLabel = 'Status',
  filterOptions,
  shown,
  total,
  children,
}: {
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  noun: string;
  filter?: string;
  onFilter?: (value: string) => void;
  filterLabel?: string;
  filterOptions?: readonly FilterOption[];
  shown: number;
  total: number;
  /** Anything the register wants beside the count — a New button, usually. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
      {/* Capped at roughly the width of its own placeholder. It was `flex-1`,
          which stretched it across the whole toolbar on a wide screen — a box
          the width of the page for a value that is rarely more than a document
          number, and it pushed the filter and the count out to the far edge
          where they read as unrelated controls. `flex-1` is kept below the cap
          so it still shrinks on a narrow screen. */}
      <input
        type="search"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder={placeholder}
        aria-label={`Search ${noun}`}
        className="w-full min-w-0 max-w-sm flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
      />

      {filterOptions && onFilter && (
        <label className="flex items-center gap-2 whitespace-nowrap text-xs text-slate-600">
          {filterLabel}
          <select
            value={filter}
            onChange={(event) => onFilter(event.target.value)}
            aria-label={`Filter ${noun} by ${filterLabel.toLowerCase()}`}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            <option value="ALL">All</option>
            {filterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* `mr-auto` rather than letting the input stretch: the count takes the
          slack, which keeps the search and the filter together as one group
          instead of pinning them to opposite edges of a wide screen. */}
      <span className="mr-auto whitespace-nowrap text-xs tabular-nums text-slate-500">
        {shown === total ? `${total} ${noun}` : `${shown} of ${total}`}
      </span>

      {children}
    </div>
  );
}

/**
 * Which slice is on screen, and how to move.
 *
 * Prev/Next and a page count rather than a numbered strip: a register of two
 * hundred is twenty pages, and twenty little numbers is a lot of furniture for
 * a decision that is almost always "the next one" or "search instead".
 *
 * Hidden when everything fits on one page at the default size — a single page
 * does not need dead buttons under it. It reappears once the size has been
 * changed deliberately, so the control does not vanish on whoever changed it.
 */
export function RegisterPager({
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
  first: number;
  last: number;
  total: number;
  noun: string;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  if (total === 0) return null;
  if (total <= pageSize && pageSize === DEFAULT_PAGE_SIZE) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-2.5">
      <p className="text-xs tabular-nums text-slate-600">
        Showing <strong className="font-semibold text-slate-900">{first}</strong>–
        <strong className="font-semibold text-slate-900">{last}</strong> of {total} {noun}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-600">
          Rows
          <select
            value={pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
            aria-label={`Rows of ${noun} per page`}
            className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs tabular-nums text-slate-900"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPage(page - 1)}
            disabled={page <= 1}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="whitespace-nowrap px-1.5 text-xs tabular-nums text-slate-600">
            Page {page} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => onPage(page + 1)}
            disabled={page >= pageCount}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
