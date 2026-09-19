'use client';

import { useMemo, useState } from 'react';

import { ANY, ListFilters, type FilterField } from '@/components/list-filters';
import { useNewAction } from '@/components/production/register';
import { ListPager } from '@/components/list-pager';

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
export const PAGE_SIZES = [10, 25, 50, 100] as const;

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
  matchesField,
}: {
  rows: readonly Row[];
  /** Everything on a row the search box should match against. */
  searchText: (row: Row) => string;
  /** Applied when a filter other than "all" is chosen. */
  matchesFilter?: (row: Row, value: string) => boolean;
  /**
   * Applied per named field for the multi-field filter panel, once for each
   * field actually set. Returning false on any one drops the row, so several
   * filters narrow rather than widen — "schedule H AND active", never "or".
   */
  matchesField?: (row: Row, name: string, value: string) => boolean;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    // Only the fields actually set. An unset field is not a filter that matches
    // everything, it is a filter that was never asked for — and calling the
    // predicate for it would make every register handle an empty value.
    const active = Object.entries(fieldValues).filter(([, value]) => value !== '');

    return rows.filter((row) => {
      if (filter !== 'ALL' && matchesFilter && !matchesFilter(row, filter)) return false;

      if (matchesField) {
        for (const [name, value] of active) {
          if (!matchesField(row, name, value)) return false;
        }
      }

      if (!needle) return true;

      return searchText(row).toLowerCase().includes(needle);
    });
  }, [rows, query, filter, fieldValues, searchText, matchesFilter, matchesField]);

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
    fieldValues,
    setField: (name: string, value: string) => {
      setFieldValues((current) => ({ ...current, [name]: value }));
      setPage(1);
    },
    clearFields: () => {
      setFieldValues({});
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
  fields,
  fieldValues,
  onField,
  onClearFields,
  title,
  singular,
  total = 0,
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
  /** Extra filters for the panel, beyond the single one above. */
  fields?: readonly FilterField[];
  fieldValues?: Record<string, string>;
  onField?: (name: string, value: string) => void;
  onClearFields?: () => void;
  /** The heading. Defaults to the plural noun, capitalised. */
  title?: string;
  /** Defaults to trimming a trailing "s", which is right for every noun here. */
  singular?: string;
  /**
   * Rows AFTER the current filter, which the registers pass as `filtered.length`.
   *
   * ACCEPTED AND IGNORED — the count beside the title is `total`, the whole
   * register. What is on screen is the pager's business, and two counts saying
   * nearly the same thing invite a comparison to check they agree.
   */
  shown?: number;
  /** Rows the register holds, shown under the title. */
  total?: number;
  /** Anything the register wants beside the controls — a New button, usually. */
  children?: React.ReactNode;
}) {
  // The register's New button, if the step has one. From context because the
  // register cannot pass a prop down through its server-rendered children.
  const newAction = useNewAction();

  // The single `filter` prop, presented as one more field in the panel. This is
  // what lets the five registers keep the API they already call while the panel
  // underneath is the shared one — a register that wants a second filter adds
  // `fields`, and a register that does not carries on unchanged.
  const allFields: FilterField[] = [];

  if (filterOptions && onFilter) {
    allFields.push({
      name: LEGACY_FILTER,
      label: filterLabel,
      options: filterOptions,
      allLabel: `All ${noun}`,
    });
  }

  if (fields) allFields.push(...fields);

  const values: Record<string, string> = { ...fieldValues };

  // 'ALL' is this toolbar's "unset"; the panel's is the empty string. Mapping
  // between them here keeps that difference from reaching either side.
  if (filterOptions && onFilter) values[LEGACY_FILTER] = filter === 'ALL' ? ANY : (filter ?? ANY);

  return (
    <ListFilters
      fields={allFields}
      values={values}
      onChange={(name, value) => {
        if (name === LEGACY_FILTER) onFilter?.(value === ANY ? 'ALL' : value);
        else onField?.(name, value);
      }}
      onClear={() => {
        onFilter?.('ALL');
        onClearFields?.();
      }}
      query={query}
      onQuery={onQuery}
      searchPlaceholder={placeholder}
      title={title ?? noun.charAt(0).toUpperCase() + noun.slice(1)}
      total={total}
      noun={noun}
      singular={singular ?? noun.replace(/s$/, '')}
    >
      {children}
      {newAction && (
        <button
          type="button"
          onClick={newAction.onClick}
          className="h-9 whitespace-nowrap rounded-md bg-slate-900 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
        >
          {newAction.label}
        </button>
      )}
    </ListFilters>
  );
}

/** The panel key standing in for the single `filter` prop. */
const LEGACY_FILTER = '__filter';

/**
 * Which slice is on screen, and how to move.
 *
 * A thin wrapper over the shared `ListPager`, so the Production registers, the
 * Master Data grids and the Procurement lists all present the same control.
 * This once drew a Prev/Next pair and hid itself whenever everything fit on one
 * page; both are gone. The numbered strip matches the other lists, and the row
 * count and page-size control are worth having under a short list too — hiding
 * them removed the size control exactly when somebody wanted to raise it.
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
  return (
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
  );
}
