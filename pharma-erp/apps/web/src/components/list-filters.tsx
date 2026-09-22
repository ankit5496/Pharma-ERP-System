'use client';

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';

import { SearchableSelect } from '@/components/searchable-select';

/**
 * A Filter button and its collapsible panel, for a CLIENT-SIDE list.
 *
 * The twin of procurement's `FilterButton` / `FilterPanel`, which do this for a
 * server-side list. That pair keeps every value in the URL so the DATABASE can
 * do the filtering; this one keeps them in React state because Master Data and
 * Production already hold every row in the browser, and a round trip to narrow
 * an array that is already here would be a slower way to get the same answer.
 *
 * TWO OTHER DIFFERENCES FOLLOW FROM THAT, both deliberate:
 *
 *   * NO APPLY BUTTON. Procurement needs one because each committed change is a
 *     request, so applying per keystroke meant four round trips to set four
 *     filters. Here a change costs an array pass, so filtering as you type is
 *     both affordable and what the search box already did.
 *   * THE FIELDS ARE DECLARED BY THE CALLER rather than fixed. Procurement can
 *     hardcode `vendorId`, `triggerType` and the rest because every one of its
 *     lists is about purchasing. These registers have nothing in common — an
 *     item has a schedule classification, a batch has a release status — so the
 *     shape is a prop.
 *
 * This is ONE component rather than the button-and-panel pair procurement uses.
 * That pair is split because its button sits on the page title line, with the
 * page's own markup between it and the controls, which is what forced the
 * module-level store documented in filter-bar.tsx. Here both live in the same
 * register header, so ordinary state spans them and no store is needed.
 */

export interface FilterField {
  /** Key into the values object. */
  name: string;
  label: string;
  /**
   * What the control is. 'select' is the default and the common case.
   *
   * 'searchable' is for a list that grows with the data — every user who has
   * created a record, every vendor — where a plain dropdown becomes a scroll.
   * A fixed enum stays a 'select': a search box over four statuses is
   * furniture.
   *
   * 'dateRange' renders two date inputs and writes TWO entries — `<name>From`
   * and `<name>To` — because a range is two answers, and squeezing them into
   * one string would mean parsing it back out at every call site.
   */
  kind?: 'select' | 'searchable' | 'dateRange';
  /** Required for a 'select' or 'searchable'; ignored by a 'dateRange'. */
  options?: readonly { value: string; label: string }[];
  /** Shown as the empty choice — "Any status", "All Users". */
  allLabel?: string;
}

/** The two keys a `dateRange` field writes into the values object. */
export const dateRangeKeys = (name: string) => [`${name}From`, `${name}To`] as const;

/** Nothing chosen: the value every field starts at and returns to. */
export const ANY = '';

export function ListFilters({
  title,
  total,
  noun,
  singular,
  fields,
  values,
  onChange,
  onClear,
  searchPlaceholder,
  query,
  onQuery,
  children,
}: {
  title: string;
  /**
   * Rows BEFORE filtering — what the register holds, not what is on screen.
   * The pager below says how much of it is showing, so this staying put while
   * the search narrows is the point: the two lines answer different questions.
   */
  total: number;
  noun: string;
  /**
   * Stated, not derived. Stripping a trailing "s" turns "parties" into
   * "partie", and English plurals are not mechanical.
   */
  singular: string;
  /** Empty renders the search box alone, with no Filter button. */
  fields: readonly FilterField[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onClear: () => void;
  searchPlaceholder: string;
  query: string;
  onQuery: (value: string) => void;
  /** Anything that belongs beside the controls — a New button, usually. */
  children?: ReactNode;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);

  // A date range counts as ONE filter however many of its two ends are set:
  // "created after the 1st" is one narrowing, and showing 2 on the badge for a
  // single range would overstate how much is being hidden.
  const activeCount = useMemo(
    () =>
      fields.filter((field) =>
        field.kind === 'dateRange'
          ? dateRangeKeys(field.name).some((key) => (values[key] ?? ANY) !== ANY)
          : (values[field.name] ?? ANY) !== ANY,
      ).length,
    [fields, values],
  );

  // A filter left set while the panel is shut makes a list look short for no
  // visible reason, which is how somebody concludes records are missing. Only
  // opens: closing it again is the reader's business.
  useEffect(() => {
    if (activeCount > 0) setOpen(true);
  }, [activeCount]);

  return (
    <>
      {/* Title and count on the left, controls on the right, all on ONE line —
          the arrangement every Procure-to-Pay list uses. The count is a
          subtitle under the title rather than a separate line of its own,
          which is what keeps the header a single row. */}
      <div className="flex items-center justify-between gap-x-4 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0 shrink">
          <h2 className="truncate text-base font-semibold text-slate-900">{title}</h2>
          <p className="mt-0.5 truncate text-sm text-slate-600">
            {total} {total === 1 ? singular : noun}
          </p>
        </div>

        {/* ONE ROW: search, Filter, then the register's own button. `flex-nowrap`
            with a shrinkable search box, NOT `flex-wrap` with a full-width one —
            `w-full` on the input claims the whole line, which pushed it above
            the buttons instead of sitting beside them. The search gives up
            width first as the screen narrows; the two buttons never shrink. */}
        <div className="flex min-w-0 flex-nowrap items-center gap-2">
          {/* Outside the filter panel, immediately left of the Filter button:
              searching is the one control reached for constantly, and putting
              it behind a toggle costs a click every time. */}
          <input
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={`Search ${noun}`}
            className="h-9 w-56 min-w-0 flex-shrink rounded-md border border-slate-300 px-3 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
          />

          {fields.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-controls={panelId}
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition ${
                activeCount > 0
                  ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {/* Inline rather than an icon dependency, and aria-hidden because
                  the word beside it already names the control. */}
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 3h12l-4.5 5.5V13L6.5 11.5V8.5L2 3Z" />
              </svg>
              Filter
              {activeCount > 0 && (
                <span className="ml-0.5 rounded-full bg-white px-1.5 text-[11px] font-semibold text-slate-900">
                  {activeCount}
                </span>
              )}
            </button>
          )}

          {children}
        </div>
      </div>

      {fields.length > 0 && (
        <div
          id={panelId}
          hidden={!open}
          // Hidden by the class, not the attribute alone: `hidden` is only a
          // user-agent `display: none` and any author display rule outranks it.
          // The attribute stays for assistive technology.
          className={`${open ? 'block' : 'hidden'} border-b border-slate-200 bg-slate-50/60 px-5 py-4`}
        >
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            {fields.map((field) =>
              field.kind === 'dateRange' ? (
                <DateRange
                  key={field.name}
                  label={field.label}
                  from={values[`${field.name}From`] ?? ANY}
                  to={values[`${field.name}To`] ?? ANY}
                  onFrom={(value) => onChange(`${field.name}From`, value)}
                  onTo={(value) => onChange(`${field.name}To`, value)}
                />
              ) : field.kind === 'searchable' ? (
                <SearchableFilter
                  key={field.name}
                  label={field.label}
                  value={values[field.name] ?? ANY}
                  options={field.options ?? []}
                  allLabel={field.allLabel ?? 'Any'}
                  onChange={(value) => onChange(field.name, value)}
                />
              ) : (
                <Select
                  key={field.name}
                  label={field.label}
                  value={values[field.name] ?? ANY}
                  options={field.options ?? []}
                  allLabel={field.allLabel ?? 'Any'}
                  onChange={(value) => onChange(field.name, value)}
                />
              ),
            )}
          </div>

          {activeCount > 0 && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={onClear}
                className="text-sm font-medium text-slate-600 underline-offset-2 transition hover:text-slate-900 hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Two date inputs, From and To, as one filter.
 *
 * BOTH ENDS ARE OPTIONAL and mean what they say on their own: From alone is
 * "on or after", To alone is "on or before", neither is "any time". That is
 * why the two are separate values rather than one range object — a half-filled
 * range is the normal case, not an incomplete one.
 *
 * `max` and `min` cross-bound the pair, so the browser refuses a To earlier
 * than the From before anything is filtered and a range that can only ever
 * match nothing cannot be entered.
 */
function DateRange({
  label,
  from,
  to,
  onFrom,
  onTo,
}: {
  label: string;
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
}) {
  const fromId = useId();
  const toId = useId();

  const field =
    'mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900';

  return (
    // Spans two cells of the four-column grid, because it holds two controls:
    // squeezed into one, the date inputs are narrower than the dates in them.
    <div className="sm:col-span-2">
      <span className="block text-xs font-medium text-slate-600">{label}</span>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={fromId} className="sr-only">
            {label} from
          </label>
          <input
            id={fromId}
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => onFrom(event.target.value)}
            className={field}
          />
        </div>
        <span aria-hidden="true" className="mt-1 text-xs text-slate-400">
          to
        </span>
        <div className="min-w-0 flex-1">
          <label htmlFor={toId} className="sr-only">
            {label} to
          </label>
          <input
            id={toId}
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => onTo(event.target.value)}
            className={field}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * A filter you can type into, for a list that grows with the data.
 *
 * The same lookup the forms use, so a picklist behaves identically whether it
 * is choosing a value to save or narrowing a register. Labelled the way
 * `Select` is, so the two line up in the panel's grid.
 *
 * `emptyLabel` carries `allLabel` because they are the same idea under two
 * names: the row that means "no choice made", which for a filter is "do not
 * narrow by this".
 */
function SearchableFilter({
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  allLabel: string;
  onChange: (value: string) => void;
}) {
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-600">
        {label}
      </label>
      <div className="mt-1">
        <SearchableSelect
          id={id}
          options={options}
          value={value}
          onChange={onChange}
          emptyLabel={allLabel}
          placeholder="Type to search…"
          className="field h-10 w-full"
        />
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  allLabel: string;
  onChange: (value: string) => void;
}) {
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-600">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
      >
        <option value={ANY}>{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
