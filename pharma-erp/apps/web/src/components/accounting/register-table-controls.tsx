'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';

import { pageNumbers } from '@/components/procurement/pagination';

/**
 * Search, filter and paging for a register table.
 *
 * THE SAME THREE CONTROLS THE ORDER-TO-CASH TABLES HAVE, and written the same
 * way: every one of them writes to the URL rather than to React state, so a
 * narrowed register is a link, the back button undoes a filter, and the server
 * component that renders the rows reads the answer directly.
 *
 * SEARCH AND FILTER DO NOT OVERLAP. Typing matches the document identifiers —
 * invoice number, GSTIN, HSN — while the filter holds the closed sets: the
 * period, the rate, the party, the product, the tax treatment. Which is which
 * is decided in register-view's `narrow`; this file only draws the controls.
 *
 * THE PERIOD IS THE EXCEPTION TO "NARROWS THE TABLE ONLY". Changing a date
 * re-runs the whole report — cards included — because the period is what the
 * report is of. The rest narrow the table, and export follows the table.
 */

/** Replaces the current URL, keeping everything except the keys given. */
function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());

      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value.trim() === '') next.delete(key);
        else next.set(key, value.trim());
      }

      router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
}

export interface RegisterSuggestion {
  value: string;
  /** What the value belongs to: the party, the product, the line count. */
  hint: string;
}

/**
 * Free text over the rows on screen, with the typeahead the Order-to-Cash
 * tables have.
 *
 * SUGGESTIONS COME FROM THE PERIOD ALREADY LOADED, not from a lookup. The
 * server component has every row in hand to render the table, so offering the
 * invoice numbers, HSN codes and GSTINs it actually contains costs one prop
 * and no round trip — and it cannot suggest something that would then match
 * nothing.
 *
 * Debounced rather than live: each committed search re-renders a server
 * component, and a register can be a few thousand lines.
 */
export function RegisterSearch({
  placeholder,
  suggestions = [],
}: {
  placeholder: string;
  suggestions?: readonly RegisterSuggestion[];
}) {
  const params = useSearchParams();
  const setUrl = useUrlState();
  const [, startTransition] = useTransition();

  const committed = params.get('q') ?? '';
  const [draft, setDraft] = useState(committed);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Keeps the box in step when the URL changes from elsewhere — Clear, or the
  // back button.
  useEffect(() => setDraft(committed), [committed]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A timer outliving the box would navigate after the user had left.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const needle = draft.trim().toLowerCase();

  // The list follows typing rather than opening on focus: a menu of every
  // invoice in the month would cover the table before anything was asked.
  const matches =
    needle.length < 1
      ? []
      : suggestions
          .filter((suggestion) =>
            `${suggestion.value} ${suggestion.hint}`.toLowerCase().includes(needle),
          )
          .slice(0, 8);

  const commit = (value: string) => {
    setDraft(value);
    setOpen(false);
    if (timer.current) clearTimeout(timer.current);
    // Back to page one: the row that was on page four of the old search is
    // rarely on page four of the new one.
    startTransition(() => setUrl({ q: value, page: null }));
  };

  return (
    <div ref={boxRef} className="relative w-full min-w-0 sm:w-96">
      <input
        type="search"
        value={draft}
        placeholder={placeholder}
        aria-label={placeholder}
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(event) => {
          const value = event.target.value;
          setDraft(value);
          setOpen(true);
          setHighlighted(-1);

          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            startTransition(() => setUrl({ q: value, page: null }));
          }, 300);
        }}
        onKeyDown={(event) => {
          if (!open || matches.length === 0) return;

          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlighted((index) => (index + 1) % matches.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlighted((index) => (index <= 0 ? matches.length - 1 : index - 1));
          } else if (event.key === 'Enter' && highlighted >= 0) {
            event.preventDefault();
            commit(matches[highlighted]!.value);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="field h-9 w-full text-sm"
      />

      {open && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {matches.map((suggestion, index) => (
            <li
              key={`${suggestion.value}-${index}`}
              role="option"
              aria-selected={index === highlighted}
            >
              <button
                type="button"
                // Mousedown, not click: the input's blur would close the list
                // before a click ever landed on it.
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(suggestion.value);
                }}
                onMouseEnter={() => setHighlighted(index)}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm ${
                  index === highlighted ? 'bg-slate-100' : 'hover:bg-slate-50'
                }`}
              >
                <span className="font-medium text-slate-800">{suggestion.value}</span>
                <span className="shrink-0 text-[11px] text-slate-500">{suggestion.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface RegisterFilterField {
  param: string;
  label: string;
  allLabel: string;
  choices: readonly { value: string; label: string }[];
}

/** The Filter button. Open state is in the URL — see FilterPanel. */
export function RegisterFilterToggle({ fields }: { fields: readonly RegisterFilterField[] }) {
  const params = useSearchParams();
  const setUrl = useUrlState();

  const open = params.get('filters') === '1';
  const activeCount = fields.filter((field) => params.get(field.param)).length;

  return (
    <button
      type="button"
      onClick={() => setUrl({ filters: open ? null : '1' })}
      aria-expanded={open}
      aria-controls="register-filters"
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition ${
        activeCount > 0
          ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
        <path d="M1.5 3A.5.5 0 0 1 2 2.5h12a.5.5 0 0 1 .38.82L10 8.7V13a.5.5 0 0 1-.74.44l-2.5-1.4A.5.5 0 0 1 6.5 11.6V8.7L1.62 3.32A.5.5 0 0 1 1.5 3Z" />
      </svg>
      Filter
      {activeCount > 0 && <span className="text-xs">({activeCount})</span>}
    </button>
  );
}

/**
 * The expanding row of filter controls.
 *
 * Whether it is open lives in the URL because the button sits on the table's
 * header row and the panel sits under it — two places in the tree with no
 * common client ancestor.
 */
export function RegisterFilterPanel({
  fields,
  from,
  to,
}: {
  fields: readonly RegisterFilterField[];
  /** The period. It lives here because it is the register's first filter. */
  from: string;
  to: string;
}) {
  const params = useSearchParams();
  const setUrl = useUrlState();
  const [isPending, startTransition] = useTransition();

  const open = params.get('filters') === '1';
  const anyActive = fields.some((field) => params.get(field.param));

  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  // Keeps the boxes in step when the URL changes from elsewhere — the back
  // button, or switching register.
  useEffect(() => setDraftFrom(from), [from]);
  useEffect(() => setDraftTo(to), [to]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const badRange = Boolean(draftFrom && draftTo && draftFrom > draftTo);

  /**
   * Changing a date re-runs the register.
   *
   * A date input holds an empty string until the whole date is valid, so a
   * half-typed year never reaches the server. The debounce is for the picker,
   * where clicking through months would otherwise fire a query per click.
   */
  const changeRange = (nextFrom: string, nextTo: string) => {
    setDraftFrom(nextFrom);
    setDraftTo(nextTo);

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!nextFrom || !nextTo || nextFrom > nextTo) return;
      // Back to page one: the line on page four of September is not the line
      // on page four of October.
      startTransition(() => setUrl({ from: nextFrom, to: nextTo, page: null }));
    }, 400);
  };

  return (
    <div
      id="register-filters"
      hidden={!open}
      // Hidden by the class, not the attribute alone: `hidden` is only a
      // user-agent rule and any author rule outranks it.
      className={`${open ? 'block' : 'hidden'} border-b border-slate-200 bg-slate-50/60 px-5 py-4`}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* The period first: every other control narrows what it returns. */}
        <div>
          <label htmlFor="register-from" className="mb-1 block text-xs font-medium text-slate-600">
            From date
          </label>
          <input
            id="register-from"
            type="date"
            value={draftFrom}
            onChange={(event) => changeRange(event.target.value, draftTo)}
            className="field h-10 w-full"
          />
        </div>

        <div>
          <label htmlFor="register-to" className="mb-1 block text-xs font-medium text-slate-600">
            To date
          </label>
          <input
            id="register-to"
            type="date"
            value={draftTo}
            onChange={(event) => changeRange(draftFrom, event.target.value)}
            className="field h-10 w-full"
          />
        </div>

        {fields.map((field) => (
          <div key={field.param}>
            <label
              htmlFor={`register-filter-${field.param}`}
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              {field.label}
            </label>
            <select
              id={`register-filter-${field.param}`}
              value={params.get(field.param) ?? ''}
              onChange={(event) =>
                startTransition(() => setUrl({ [field.param]: event.target.value, page: null }))
              }
              className="field h-10 w-full"
            >
              <option value="">{field.allLabel}</option>
              {field.choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <span aria-live="polite" className="mr-auto text-xs text-slate-500">
          {isPending
            ? 'Running the register…'
            : badRange
              ? 'The From date is after the To date, so the register has not been re-run.'
              : 'The dates decide the whole report; the rest narrow the table.'}
        </span>
        <button
          type="button"
          disabled={!anyActive}
          onClick={() =>
            startTransition(() =>
              setUrl({
                ...Object.fromEntries(fields.map((field) => [field.param, null])),
                page: null,
              }),
            )
          }
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

/**
 * The pager under the table.
 *
 * `pageNumbers` is imported from procurement rather than rewritten, so which
 * numbers and gaps are drawn is decided in exactly one place across the app.
 * Always rendered: hiding it would take the row count and the page-size
 * control away exactly when someone wants to raise the size to see more.
 */
export function RegisterPager({
  page,
  pageCount,
  pageSize,
  pageSizes,
  first,
  last,
  total,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  pageSizes: readonly number[];
  first: number;
  last: number;
  total: number;
}) {
  const setUrl = useUrlState();
  const sizeId = useId();

  const goto = (next: number) => setUrl({ page: next <= 1 ? null : String(next) });

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-slate-200 px-5 py-3 text-sm">
      <p aria-live="polite" className="text-slate-600">
        {total === 0 ? (
          <>No lines</>
        ) : (
          <>
            Showing <span className="font-medium tabular-nums text-slate-900">{first}</span>–
            <span className="font-medium tabular-nums text-slate-900">{last}</span> of{' '}
            <span className="font-medium tabular-nums text-slate-900">{total}</span> lines
          </>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor={sizeId} className="whitespace-nowrap text-xs text-slate-600">
            Rows per page
          </label>
          <select
            id={sizeId}
            value={pageSize}
            onChange={(event) =>
              setUrl({
                rows: event.target.value,
                // Page 9 of the old size is rarely page 9 of the new one.
                page: null,
              })
            }
            aria-label="Rows per page"
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm tabular-nums text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <nav aria-label="Pagination" className="flex items-center gap-1">
          <Step disabled={page <= 1} onClick={() => goto(page - 1)}>
            Previous
          </Step>

          {pageNumbers(page, pageCount).map((entry, index) =>
            entry === null ? (
              <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-slate-400">
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                onClick={() => goto(entry)}
                aria-current={entry === page ? 'page' : undefined}
                className={`h-8 min-w-8 rounded-md px-2 text-sm font-medium tabular-nums transition ${
                  entry === page
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {entry}
              </button>
            ),
          )}

          <Step disabled={page >= pageCount} onClick={() => goto(page + 1)}>
            Next
          </Step>
        </nav>
      </div>
    </div>
  );
}

function Step({
  children,
  disabled,
  onClick,
}: {
  children: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-8 rounded-md border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
    >
      {children}
    </button>
  );
}
