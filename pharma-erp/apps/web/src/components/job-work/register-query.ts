'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { ANY, type FilterField } from '@/components/list-filters';
import { PAGE_SIZES } from '@/components/production/register-toolbar';

/**
 * The Production to Batch Release registers, filtered by the DATABASE.
 *
 * WHY THIS EXISTS BESIDE `useRegisterView`. These four screens are built from
 * Production & Quality Gate's register kit, and that kit filters the array it
 * was handed: every internal register already fetches its rows in full, so a
 * substring test is cheaper than a request. Job Work's registers are not in
 * that position — the filters here are asked for as filters ON THE RECORDS,
 * the API has taken them on every other Job Work screen since the last round,
 * and a page that fetched a thousand batches to show four would have a pager
 * that pages the wrong set and a request that carries rows nobody sees.
 *
 * SO THE TOOLBAR STAYS AND THE STATE MOVES. `RegisterToolbar` and
 * `RegisterPager` are unchanged and still drawn — these screens are meant to
 * read as the internal ones — but what the controls write goes into the URL
 * instead of into `useState`, the server component re-runs, and the rows that
 * come back are the answer. This hook returns the same shape `useRegisterView`
 * returns, so a table swapping one for the other changes one line.
 *
 * THE URL KEYS ARE THE ONES EVERY OTHER JOB WORK SCREEN USES — `search`,
 * `status`, `dateFrom`, `dateTo`, `createdById` — so a filtered link means the
 * same thing wherever it is pasted, and `listQuery` in panels.tsx forwards
 * them without knowing which screen asked.
 *
 * WHAT IS STILL LOCAL: the page number and the page size. Paging is a position
 * in a result, not a question about the data, and putting it in the URL would
 * make the back button walk through pages one at a time.
 */

/** The date-range field's name. Its two ends are `dateFrom` and `dateTo`. */
const DATE_FIELD = 'date';

/**
 * Keys this hook owns. Clear resets exactly these and leaves the rest alone —
 * a Clear that emptied the whole query string would also throw away which
 * sub-tab the reader is on, which is not a filter.
 */
const OWNED = ['search', 'dateFrom', 'dateTo', 'createdById'];

export interface PersonOption {
  value: string;
  label: string;
}

/**
 * "Created between" and "Created by", for a register the API filters.
 *
 * SEPARATE FROM `createdFilters` in the production kit, which names its date
 * field `created` and offers the people found among the loaded rows. Here the
 * two ends have to be called `dateFrom`/`dateTo` because that is what the API
 * reads, and the people come from the colleague lookup rather than from the
 * rows — the rows on screen are the FILTERED ones, so deriving the list from
 * them would drop whoever the current filter is hiding and strand the reader
 * with no way back to them.
 */
export function serverCreatedFilters(
  people: readonly PersonOption[],
  dateLabel = 'Created date',
): FilterField[] {
  const fields: FilterField[] = [{ name: DATE_FIELD, label: dateLabel, kind: 'dateRange' }];

  if (people.length > 0) {
    fields.push({
      name: 'createdById',
      label: 'Created by',
      // Searchable, and searchable BY NAME: people are remembered by name and
      // filtered by id, and the control is what bridges the two.
      kind: 'searchable',
      options: [...people],
      allLabel: 'All Users',
    });
  }

  return fields;
}

export function useJobWorkRegisterView<Row>({
  rows,
  statusKey = 'status',
  extraKeys = [],
  pageSize: initialPageSize = PAGE_SIZES[0],
}: {
  /**
   * What the API returned for the current filters. NOT the whole register —
   * the narrowing already happened, and re-applying it here would be a second
   * filter that can disagree with the first.
   */
  rows: readonly Row[];
  /**
   * The URL key the single status control writes.
   *
   * NAMED BY THE CALLER because Batch Release draws three registers over ONE
   * fetch and one URL: 'Awaiting a Decision' and 'Released Stock' are fixed
   * slices, and only the 'Released' tab offers a verdict to choose. If that
   * control wrote `status` it would narrow its two neighbours as well — pick
   * Rejected on one tab and the other two empty for reasons nothing on them
   * explains.
   */
  statusKey?: string;
  /**
   * Any further URL keys this register's own filters write.
   *
   * THE BATCH REGISTER HAS TWO DATE RANGES — when the row was written and when
   * the batch was MADE — because those are different days and people look
   * batches up by the date on the carton. Naming the extra keys here is what
   * makes Clear clear them and the empty state count them as narrowing; a
   * filter the hook does not know about is one Clear silently leaves set.
   */
  extraKeys?: readonly string[];
  pageSize?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const read = useCallback((key: string) => params.get(key) ?? '', [params]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  // The search box is typed into, so it holds its own text and the URL follows
  // a beat later. Everything else commits on the spot — a dropdown is one
  // decision, not a stream of them.
  const urlSearch = params.get('search') ?? '';
  const [draft, setDraft] = useState(urlSearch);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A shared link, the back button and Clear all arrive as a new URL with no
  // keystroke behind them; without this the box would keep showing what was
  // last typed into it.
  useEffect(() => {
    if (debounce.current === null) setDraft(urlSearch);
  }, [urlSearch]);

  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
  }, []);

  /**
   * The query string this hook has WRITTEN but not yet seen come back, and the
   * changes waiting to go into it.
   *
   * ONE NAVIGATION PER EVENT, however many controls moved. This is not a
   * refinement — Clear does not work without it. The toolbar's Clear resets the
   * status and then the fields, two calls in one click, and two
   * `router.replace` calls raised in the same event do not queue: the second is
   * dropped and the filters stay exactly where they were. A date range has the
   * same shape, From and To being separate controls that a paste or a Clear
   * moves together.
   *
   * So a push does not navigate. It merges its changes into `queued` and the
   * first one schedules a flush at the end of the tick, by which time every
   * control that moved has had its say.
   *
   * THE FLUSH READS THE LIVE URL rather than `params`, which is the URL as of
   * the last render and can be a navigation behind. `pending` covers the case
   * where even that is stale — a flush landing while the previous one is still
   * in flight — and goes back to null as soon as the router catches up.
   */
  const pending = useRef<string | null>(null);
  const queued = useRef<Record<string, string> | null>(null);

  useEffect(() => {
    if (pending.current === params.toString()) pending.current = null;
  }, [params]);

  const push = useCallback(
    (changes: Record<string, string>) => {
      const first = queued.current === null;

      queued.current = { ...(queued.current ?? {}), ...changes };

      if (!first) return;

      queueMicrotask(() => {
        const all = queued.current ?? {};
        queued.current = null;

        const next = new URLSearchParams(
          pending.current ?? window.location.search,
        );

        for (const [key, value] of Object.entries(all)) {
          if (value === '' || value === ANY) next.delete(key);
          else next.set(key, value);
        }

        const search = next.toString();

        pending.current = search;

        startTransition(() => {
          router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
        });
      });
    },
    [pathname, router],
  );

  // Every key that narrows this register, search included. Plainly computed
  // rather than memoised: it is five string reads, and a memo over an array
  // literal prop would need a dependency that is itself recomputed each render.
  const owned = [...OWNED, statusKey, ...extraKeys];

  const filterKey = owned.map((key) => params.get(key) ?? '').join('|');

  // A narrower result under the current page number renders empty, which looks
  // exactly like "nothing matches". Any change to the filters goes back to the
  // first page.
  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  const visible = rows.slice(start, start + pageSize);

  // Everything the FILTER PANEL draws — so not the search box, which has its
  // own control, and not the status, which the toolbar passes separately.
  const fieldValues = Object.fromEntries(
    owned.filter((key) => key !== 'search' && key !== statusKey).map((key) => [key, read(key)]),
  );

  // CANCELS A KEYSTROKE STILL IN FLIGHT as well as emptying the box: a Clear
  // that let a queued search land a moment later would look like it had failed.
  const clearAll = () => {
    if (debounce.current) {
      clearTimeout(debounce.current);
      debounce.current = null;
    }

    setDraft('');
    push(Object.fromEntries(owned.map((key) => [key, ''])));
  };

  return {
    /** True while the filtered rows are on their way. */
    isPending,

    /**
     * Whether anything is narrowing the register right now.
     *
     * THE EMPTY STATE NEEDS THIS AND CANNOT DERIVE IT. With the filtering done
     * in the database, `rows` is empty in two completely different
     * situations — nothing has been recorded yet, and nothing matches — and
     * the row count alone cannot tell them apart. Telling somebody there are
     * no batches when there are forty they have filtered out is the kind of
     * wrong that sends people looking for lost data.
     */
    isFiltered: filterKey.split('|').some((value) => value !== ''),

    query: draft,
    setQuery: (value: string) => {
      setDraft(value);

      if (debounce.current) clearTimeout(debounce.current);

      debounce.current = setTimeout(() => {
        debounce.current = null;
        push({ search: value.trim() });
      }, 300);
    },

    /** 'ALL' is the toolbar's "unset"; the URL's is the key being absent. */
    filter: params.get(statusKey) ?? 'ALL',
    setFilter: (value: string) => push({ [statusKey]: value === 'ALL' ? '' : value }),

    fieldValues,
    setField: (name: string, value: string) => {
      // The date range writes `dateFrom`/`dateTo` already, because the field is
      // named `date`; the person writes `createdById`. Nothing needs mapping.
      push({ [name]: value });
    },
    clearFields: clearAll,

    /**
     * Everything off, in one call — the same thing Clear does.
     *
     * SEPARATELY NAMED because a register also calls it for itself: when a
     * record the reader has just created arrives, the register clears whatever
     * is hiding it. A batch is opened PENDING, and a list left filtered to
     * "Released" would answer the save by showing nothing.
     */
    reset: clearAll,

    // The server already answered the question these would have answered.
    filtered: rows,
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
