/**
 * Applying the Filter panel's selections to a list.
 *
 * WHAT BELONGS IN THE FILTER AND WHAT BELONGS IN SEARCH ARE DISJOINT, and this
 * file is where that line is kept. Search takes free text — numbers, names,
 * references, an item on an order, a vehicle on a dispatch — and is answered by
 * the API, which can look inside related records the list never shows. The
 * filter takes the things that are not text at all: a status, a payment state,
 * a reason, a date range. Neither offers what the other does, so a filter never
 * restates a search box and the two compose instead of competing.
 *
 * Filtering happens here rather than on the wire because these lists are
 * already loaded in full and the values are closed sets the rows carry.
 */
export type Filters = Record<string, string>;

/** True when no choice is made, or when the row matches the choice. */
export function matchesChoice(value: string | null | undefined, wanted?: string): boolean {
  if (!wanted) return true;
  return value === wanted;
}

/**
 * True when the row's date falls inside the range.
 *
 * Compares ISO date strings directly. They are fixed-width and zero-padded, so
 * lexicographic order IS chronological order, and parsing them into Date
 * objects would only reintroduce the timezone question the API already settled
 * by sending days rather than instants.
 */
export function withinDates(date: string | null | undefined, from?: string, to?: string): boolean {
  if (!date) return !from && !to;

  const day = date.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

/**
 * Turns a vocabulary and its labels into filter choices.
 *
 * Hand-written lists drift: written out by hand, this file offered a return
 * reason of EXCESS_SUPPLY that the API has never heard of, and omitted two it
 * does accept. Deriving them from the same constant the rows are rendered with
 * makes that impossible.
 */
export function choicesFrom<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): readonly { value: T; label: string }[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

/** Page sizes offered under every Order-to-Cash list. */
export const PAGE_SIZES = [10, 25, 50, 100] as const;

export const DEFAULT_PAGE_SIZE = 25;

export interface Page<T> {
  rows: readonly T[];
  page: number;
  pageCount: number;
  pageSize: number;
  /** 1-based index of the first row shown; 0 when there are none. */
  first: number;
  last: number;
  total: number;
}

/**
 * One page of an already-filtered list.
 *
 * THE PAGE LIVES IN THE URL, like the search term and the filters. The shared
 * `ListPager` keeps it in React state and reports changes through callbacks,
 * which these panels cannot use: they are server components, and a function
 * cannot cross that boundary — the page fails to render rather than failing to
 * compile. Reading it from the URL also means a page is a link somebody can
 * send, and the back button steps through pages.
 *
 * The page number is CLAMPED rather than trusted. Narrowing a filter shortens
 * the list under whatever page is in the URL, and page 7 of a now 2-page list
 * has to show something; it shows the last page.
 */
export function paginate<T>(rows: readonly T[], filters: Filters): Page<T> {
  const size = Number(filters.rows);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE;

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const asked = Number(filters.page);
  const page = Math.min(Math.max(Number.isFinite(asked) && asked > 0 ? asked : 1, 1), pageCount);

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
