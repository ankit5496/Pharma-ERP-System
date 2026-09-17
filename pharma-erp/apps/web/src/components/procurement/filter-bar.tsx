'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from 'react';

export interface FilterOption {
  value: string;
  label: string;
}

/** Every key these controls own. Anything else in the URL is left alone. */
const FILTER_KEYS = [
  'search',
  'status',
  'vendorId',
  'itemId',
  'triggerType',
  'raisedById',
  'requisitionId',
  'dateFrom',
  'dateTo',
] as const;

type FilterKey = (typeof FILTER_KEYS)[number];

// A fixed id, not `useId`: the button and the panel are separate components and
// `aria-controls` has to name the same element from both.
const PANEL_ID = 'list-filters';

// ---------------------------------------------------------------------------
// Open/closed state
// ---------------------------------------------------------------------------

/**
 * WHY A MODULE-LEVEL STORE AND NOT REACT STATE.
 *
 * The button belongs on the title line, inside the panel header; the controls
 * belong on their own row below it. Those are two different places in the tree
 * with the page's own markup in between, so one component cannot render both
 * and `useState` cannot span them.
 *
 * The alternatives were worse. A context provider means every screen has to
 * wrap itself in one. A portal means the controls are positioned rather than
 * laid out, so they would overlap the table instead of pushing it down. Keeping
 * it in the URL — the approach used for the filter VALUES — would make opening
 * the panel a server round trip, and against a remote database that is most of
 * a second to reveal an empty form.
 *
 * One boolean, two subscribers, no round trip.
 */
let panelOpen = false;
const openListeners = new Set<() => void>();

function setPanelOpen(next: boolean) {
  if (panelOpen === next) return;

  panelOpen = next;
  for (const listener of openListeners) listener();
}

function subscribeOpen(listener: () => void) {
  openListeners.add(listener);

  return () => {
    openListeners.delete(listener);
  };
}

const readOpen = () => panelOpen;

// Collapsed on the server: the first client render must match the markup.
const readOpenOnServer = () => false;

function useFilterPanelOpen() {
  return useSyncExternalStore(subscribeOpen, readOpen, readOpenOnServer);
}

/** Counts the filters actually in force, for the badge on the button. */
function useActiveCount() {
  const params = useSearchParams();

  return FILTER_KEYS.filter((key) => params.get(key)).length;
}

// ---------------------------------------------------------------------------
// The button, for the panel header
// ---------------------------------------------------------------------------

/**
 * Sits on the same line as the screen title, at the right-hand end.
 *
 * Carries the count of live filters, so a list showing three of four hundred
 * rows always says why even while the controls are put away.
 */
export function FilterButton() {
  const open = useFilterPanelOpen();
  const activeCount = useActiveCount();
  const pathname = usePathname();

  // A link arriving with filters on it — a shared URL, or a summary card that
  // deep-links into a filtered list — opens the panel. Leaving the reason a
  // list looks short hidden behind a button is how someone concludes the data
  // is missing.
  useEffect(() => {
    if (activeCount > 0) setPanelOpen(true);
  }, [activeCount]);

  // The next screen's filters are different ones, and the panel should not be
  // left standing open over them.
  useEffect(() => () => setPanelOpen(false), [pathname]);

  return (
    <button
      type="button"
      onClick={() => setPanelOpen(!open)}
      aria-expanded={open}
      aria-controls={PANEL_ID}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition ${
        activeCount > 0
          ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      {/* Inline rather than an icon dependency, and aria-hidden because the
          word beside it already names the control. */}
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
  );
}

// ---------------------------------------------------------------------------
// The panel, for directly below the header
// ---------------------------------------------------------------------------

/**
 * The filter controls, shared by every list in the application.
 *
 * THE URL IS THE STATE, so filtering happens in the DATABASE rather than over
 * whichever rows the browser is holding. Three things follow that would each
 * need separate work otherwise: a filtered view is a shareable link, the back
 * button behaves, and a summary card can deep-link into a filtered list.
 *
 * TYPING AND CHOOSING BUILD A DRAFT; APPLY COMMITS IT. Each committed change is
 * a server round trip, so applying on every keystroke and every select meant
 * four round trips to set four filters, with the list rearranging under the
 * reader between each one. Apply sends one.
 *
 * FOUR CONTROLS PER ROW, ALL THE SAME SIZE. They share one grid cell width and
 * one field class, so no control can be wider than its neighbour and the rows
 * line up whatever mix of inputs, selects and dates a screen asks for.
 *
 * Which controls appear is decided by the caller passing options: a screen with
 * no vendor on its records is given no vendor filter rather than an empty one.
 */
export function FilterPanel({
  statuses,
  vendors,
  items,
  triggerTypes,
  raisedBy,
  requisitions,
  searchPlaceholder = 'Search…',
  showDates = true,
}: {
  statuses?: readonly FilterOption[];
  vendors?: readonly FilterOption[];
  items?: readonly FilterOption[];
  triggerTypes?: readonly FilterOption[];
  raisedBy?: readonly FilterOption[];
  requisitions?: readonly FilterOption[];
  searchPlaceholder?: string;
  showDates?: boolean;
}) {
  const open = useFilterPanelOpen();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const committed = useCallback((key: FilterKey) => params.get(key) ?? '', [params]);

  // The draft. Seeded from the URL, and re-seeded whenever the URL changes so
  // that Clear, a shared link and the back button all leave the controls
  // showing what is actually in force.
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(FILTER_KEYS.map((key) => [key, ''])),
  );

  useEffect(() => {
    setDraft(Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ''])));
  }, [params]);

  const set = (key: FilterKey, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const navigate = useCallback(
    (next: URLSearchParams) => {
      // A changed filter invalidates any open detail panel, whose id refers to
      // a row that may no longer be in the list.
      next.delete('open');

      // Back to page 1: the fifth page of the old result set is not a
      // meaningful place to land in a new one, and is frequently past its end.
      next.delete('page');

      startTransition(() => {
        router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false });
      });
    },
    [pathname, router],
  );

  function apply() {
    const next = new URLSearchParams(params.toString());

    for (const key of FILTER_KEYS) {
      const value = (draft[key] ?? '').trim();

      if (value) next.set(key, value);
      else next.delete(key);
    }

    navigate(next);
  }

  /**
   * Clears only the keys these controls own.
   *
   * Replacing the URL with the bare pathname would also drop parameters
   * belonging to other things on the page — the goods-receipt screen's
   * preselected order, the create-PO dialog's requisition — so clearing a
   * filter would silently close a dialog the user was working in.
   */
  function clearAll() {
    const next = new URLSearchParams(params.toString());

    for (const key of FILTER_KEYS) next.delete(key);

    setDraft(Object.fromEntries(FILTER_KEYS.map((key) => [key, ''])));
    navigate(next);
  }

  const dirty = FILTER_KEYS.some((key) => (draft[key] ?? '') !== committed(key));
  const anyCommitted = FILTER_KEYS.some((key) => committed(key));

  return (
    <div
      id={PANEL_ID}
      hidden={!open}
      // Collapsed by swapping the display class, NOT by the `hidden` attribute
      // alone: `hidden` is only a user-agent `display: none`, and any author
      // display rule outranks it. The attribute stays for assistive technology;
      // the class is what actually hides it.
      className={`${open ? 'block' : 'hidden'} border-b border-slate-200 bg-slate-50/60 px-5 py-4`}
    >
      {/* A form, so Enter anywhere in the panel applies. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <div
          className={`grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 ${
            isPending ? 'pointer-events-none opacity-60' : ''
          }`}
        >
          <Control label="Search">
            <input
              type="search"
              value={draft.search ?? ''}
              onChange={(event) => set('search', event.target.value)}
              placeholder={searchPlaceholder}
              className="field h-10"
            />
          </Control>

          {statuses && statuses.length > 0 && (
            <Select
              label="Status"
              value={draft.status ?? ''}
              options={statuses}
              allLabel="Any status"
              onChange={(value) => set('status', value)}
            />
          )}

          {triggerTypes && triggerTypes.length > 0 && (
            <Select
              label="Trigger type"
              value={draft.triggerType ?? ''}
              options={triggerTypes}
              allLabel="Any trigger"
              onChange={(value) => set('triggerType', value)}
            />
          )}

          {requisitions && requisitions.length > 0 && (
            <Select
              label="Requisition"
              value={draft.requisitionId ?? ''}
              options={requisitions}
              allLabel="Any requisition"
              onChange={(value) => set('requisitionId', value)}
            />
          )}

          {vendors && vendors.length > 0 && (
            <Select
              label="Vendor"
              value={draft.vendorId ?? ''}
              options={vendors}
              allLabel="Any vendor"
              onChange={(value) => set('vendorId', value)}
            />
          )}

          {items && items.length > 0 && (
            <Select
              label="Item / product"
              value={draft.itemId ?? ''}
              options={items}
              allLabel="Any item"
              onChange={(value) => set('itemId', value)}
            />
          )}

          {raisedBy && raisedBy.length > 0 && (
            <Select
              label="Raised by"
              value={draft.raisedById ?? ''}
              options={raisedBy}
              allLabel="Anyone"
              onChange={(value) => set('raisedById', value)}
            />
          )}

          {showDates && (
            <>
              <Control label="Date from">
                <input
                  type="date"
                  value={draft.dateFrom ?? ''}
                  onChange={(event) => set('dateFrom', event.target.value)}
                  className="field h-10"
                />
              </Control>

              <Control label="Date to">
                <input
                  type="date"
                  value={draft.dateTo ?? ''}
                  onChange={(event) => set('dateTo', event.target.value)}
                  className="field h-10"
                />
              </Control>
            </>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          {isPending ? (
            <span aria-live="polite" className="mr-auto text-xs text-slate-500">
              Filtering…
            </span>
          ) : (
            dirty && <span className="mr-auto text-xs text-slate-500">Not applied yet.</span>
          )}

          <button
            type="button"
            onClick={clearAll}
            disabled={!anyCommitted && !dirty}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            Clear
          </button>

          <button
            type="submit"
            disabled={isPending}
            className="h-9 rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-400"
          >
            Apply
          </button>
        </div>
      </form>
    </div>
  );
}

/** One cell of the grid: a label above a full-width control. */
function Control({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);

  // The label is bound by id to whichever control the caller passed, so a cell
  // does not need to know whether it wraps an input, a select or a date.
  useEffect(() => {
    const control = ref.current?.querySelector('input, select');

    if (control && !control.id) control.id = id;
  }, [id]);

  return (
    <div ref={ref}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </label>
      {children}
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
  options: readonly FilterOption[];
  allLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <Control label={label}>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="field h-10">
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Control>
  );
}
