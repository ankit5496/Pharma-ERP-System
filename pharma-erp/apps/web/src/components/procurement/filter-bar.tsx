'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';

import { SearchableSelect } from './searchable-select';
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
  // Job Work: whose work a record is, and on what terms.
  'principalId',
  'billingModel',
  'role',
  'dateFrom',
  'dateTo',
] as const;

type FilterKey = (typeof FILTER_KEYS)[number];

/**
 * The keys that count as A FILTER BEING IN FORCE.
 *
 * The search term is deliberately not among them. It has its own box
 * outside the panel, it is plainly visible, and counting it here is what
 * used to make typing a search term open the filter panel by itself.
 */
const ACTIVE_FILTER_KEYS = FILTER_KEYS.filter((key) => key !== 'search');

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

/**
 * The screen this open/closed state was decided for.
 *
 * WITHOUT IT, A REMOUNT RESETS THE PANEL. Committing a search re-renders
 * the page from the server and remounts the button; if arriving were the
 * same as mounting, every keystroke would re-decide whether the panel
 * should be open. Comparing the pathname makes "a new screen" mean what it
 * says.
 */
let panelPath: string | null = null;
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

  return ACTIVE_FILTER_KEYS.filter((key) => params.get(key)).length;
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

  /**
   * Decided ONCE PER SCREEN, and never again.
   *
   * Arriving on a list that is already filtered — a shared URL, or a summary
   * card that deep-links into one — opens the panel, because a list looking
   * short for a reason nobody can see is how someone concludes the data is
   * missing. Arriving on an unfiltered one leaves it closed.
   *
   * AFTER THAT THE PANEL IS THE USER’S. Typing in the search box, clearing
   * it, changing a filter, and the remount that a committed search causes
   * all leave it exactly as they found it. The stored pathname is what makes
   * a remount different from an arrival.
   */
  useEffect(() => {
    if (panelPath === pathname) return;

    panelPath = pathname;
    setPanelOpen(activeCount > 0);
    // activeCount is read ON ARRIVAL ONLY. Listing it as a dependency would
    // re-decide the panel every time a filter or the search term changed,
    // which is the coupling being removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

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
 * CHANGING A CONTROL FILTERS IMMEDIATELY. There is no Apply button: every
 * select, date and clear commits as soon as it changes, and the table refreshes
 * under it.
 *
 * THE TEXT BOX IS DEBOUNCED, and that is not a detail. Each commit is a server
 * round trip, so committing per keystroke would fire one request per letter and
 * leave the list rearranging while somebody is still typing the word. The
 * selects commit at once because a select changes once per decision; the search
 * box waits for a pause.
 *
 * THE LAST CHANGE ALWAYS WINS. Each commit is built from a ref holding the
 * latest draft rather than from the state React has rendered, so two changes in
 * quick succession cannot race: the second reads what the first wrote, and a
 * pending debounce is cancelled by any immediate commit that overtakes it.
 *
 * FOUR CONTROLS PER ROW, ALL THE SAME SIZE. They share one grid cell width and
 * one field class, so no control can be wider than its neighbour and the rows
 * line up whatever mix of inputs, selects and dates a screen asks for.
 *
 * Which controls appear is decided by the caller passing options: a screen with
 * no vendor on its records is given no vendor filter rather than an empty one.
 */
/**
 * How long the text box waits after the last keystroke.
 *
 * Long enough that typing a word is one request, short enough that it does not
 * feel like the filter is ignoring you. Only the free-text controls use it;
 * a select commits the moment it changes.
 */
const SEARCH_DEBOUNCE_MS = 350;

/** The controls somebody types into, rather than picks from. */
const DEBOUNCED_KEYS = new Set<FilterKey>(['search']);

export function FilterPanel({
  statuses,
  vendors,
  items,
  triggerTypes,
  raisedBy,
  requisitions,
  principals,
  billingModels,
  roles,
  showDates = true,
  searchableLookups = true,
}: {
  statuses?: readonly FilterOption[];
  vendors?: readonly FilterOption[];
  items?: readonly FilterOption[];
  triggerTypes?: readonly FilterOption[];
  raisedBy?: readonly FilterOption[];
  requisitions?: readonly FilterOption[];
  /** Job Work: the brand owners whose records this list holds. */
  principals?: readonly FilterOption[];
  /** Job Work: pure conversion or own procurement. */
  billingModels?: readonly FilterOption[];
  /** User settings: the role a person was assigned. */
  roles?: readonly FilterOption[];
  showDates?: boolean;
  /** Renders the record lookups — vendor, item, requisition — as typeable. */
  /**
   * Whether the record lookups are typeable. On by default.
   *
   * A lookup points at a record, and records are found by typing part of what
   * you remember of one — a vendor's name, an order number, a colleague's
   * surname. Pass false only for a list short enough to read at a glance.
   *
   * The enum controls beside them — status, trigger type, billing model — are
   * never searchable regardless: they are five fixed options, and a search box
   * over five options is furniture.
   */
  searchableLookups?: boolean;
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

  /**
   * The latest draft, readable synchronously.
   *
   * `draft` is state and is one render behind inside an event handler, so
   * committing from it would send the value BEFORE the one just typed. Two
   * quick changes would then commit the first twice and lose the second, which
   * is exactly the race the brief asks to avoid.
   */
  const draftRef = useRef(draft);

  /** Pending text-box commit, cancelled whenever something overtakes it. */
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // A timer outliving the panel would navigate after the user left it.
  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

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

  /** Puts a draft into the URL, which is what actually filters the list. */
  const commit = useCallback(
    (source: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());

      for (const key of FILTER_KEYS) {
        const value = (source[key] ?? '').trim();

        if (value) next.set(key, value);
        else next.delete(key);
      }

      navigate(next);
    },
    [params, navigate],
  );

  /**
   * Records a change and filters on it.
   *
   * Free text waits for a pause; everything else commits at once. Any
   * immediate commit cancels a pending text commit, so choosing a status
   * mid-word sends ONE request carrying both — rather than the status now and
   * the half-typed word a moment later.
   */
  const set = (key: FilterKey, value: string) => {
    const next = { ...draftRef.current, [key]: value };

    draftRef.current = next;
    setDraft(next);

    if (debounce.current) {
      clearTimeout(debounce.current);
      debounce.current = null;
    }

    if (DEBOUNCED_KEYS.has(key)) {
      debounce.current = setTimeout(() => {
        debounce.current = null;
        commit(draftRef.current);
      }, SEARCH_DEBOUNCE_MS);

      return;
    }

    commit(next);
  };

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

    // A queued text commit would otherwise fire after this and put the cleared
    // term straight back.
    if (debounce.current) {
      clearTimeout(debounce.current);
      debounce.current = null;
    }

    const empty = Object.fromEntries(FILTER_KEYS.map((key) => [key, '']));

    draftRef.current = empty;
    setDraft(empty);
    navigate(next);
  }

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
      {/* Still a form, so Enter in the text box is meaningful — it commits the
          typed term at once rather than waiting out the debounce. There is no
          Apply button for it to press; the submit exists only to short-circuit
          that wait. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();

          if (debounce.current) {
            clearTimeout(debounce.current);
            debounce.current = null;
          }

          commit(draftRef.current);
        }}
      >
        <div
          className={`grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 ${
            isPending ? 'pointer-events-none opacity-60' : ''
          }`}
        >

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
              searchable={searchableLookups}
              value={draft.requisitionId ?? ''}
              options={requisitions}
              allLabel="Any requisition"
              onChange={(value) => set('requisitionId', value)}
            />
          )}

          {principals && principals.length > 0 && (
            <Select
              label="Principal"
              searchable={searchableLookups}
              value={draft.principalId ?? ''}
              options={principals}
              allLabel="Any principal"
              onChange={(value) => set('principalId', value)}
            />
          )}

          {billingModels && billingModels.length > 0 && (
            <Select
              label="Billing model"
              value={draft.billingModel ?? ''}
              options={billingModels}
              allLabel="Any model"
              onChange={(value) => set('billingModel', value)}
            />
          )}

          {roles && roles.length > 0 && (
            <Select
              label="Role"
              value={draft.role ?? ''}
              options={roles}
              allLabel="Any role"
              onChange={(value) => set('role', value)}
            />
          )}

          {vendors && vendors.length > 0 && (
            <Select
              label="Vendor"
              searchable={searchableLookups}
              value={draft.vendorId ?? ''}
              options={vendors}
              allLabel="Any vendor"
              onChange={(value) => set('vendorId', value)}
            />
          )}

          {items && items.length > 0 && (
            <Select
              label="Item / product"
              searchable={searchableLookups}
              value={draft.itemId ?? ''}
              options={items}
              allLabel="Any item"
              onChange={(value) => set('itemId', value)}
            />
          )}

          {raisedBy && raisedBy.length > 0 && (
            <Select
              label="Raised by"
              searchable={searchableLookups}
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
          {/* No "not applied yet" any more: there is no gap between changing a
              control and the change taking effect. What is worth saying is that
              a request is in flight, because the table below has not caught up
              yet and the reader can see that it has not. */}
          <span aria-live="polite" className="mr-auto text-xs text-slate-500">
            {isPending ? 'Filtering…' : 'Filters apply as you change them.'}
          </span>

          <button
            type="button"
            onClick={clearAll}
            disabled={!anyCommitted}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            Clear
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
  searchable = false,
}: {
  label: string;
  value: string;
  options: readonly FilterOption[];
  allLabel: string;
  onChange: (value: string) => void;
  /** Renders a typeable lookup instead of a plain select. */
  searchable?: boolean;
}) {
  return (
    <Control label={label}>
      {searchable ? (
        <SearchableSelect
          id={`filter-${label.replace(/W+/g, '-').toLowerCase()}`}
          options={options}
          value={value}
          onChange={onChange}
          emptyLabel={allLabel}
          className="field h-10"
        />
      ) : (
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="field h-10"
        >
          <option value="">{allLabel}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Control>
  );
}

/**
 * The search box, outside the filter panel.
 *
 * Sits on the title line beside the Filter button, so it is visible and usable
 * without opening anything. Writes the same `search` parameter the panel used
 * to write, so every list keeps searching exactly as it did.
 *
 * SEEDED FROM THE URL AND RE-SEEDED WHENEVER IT CHANGES, which is what makes a
 * shared link, the back button and the panel's own Clear all arrive here
 * correctly rather than leaving a stale term in the box.
 */
export function SearchBox({ placeholder = 'Search…' }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const committed = params.get('search') ?? '';
  const [draft, setDraft] = useState(committed);

  useEffect(() => {
    setDraft(committed);
  }, [committed]);

  /** Pending commit, cancelled whenever something overtakes it. */
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A timer outliving the box would navigate after the user left the screen.
  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  const commit = useCallback(
    (value: string) => {
      const next = new URLSearchParams(params.toString());

      if (value.trim()) next.set('search', value.trim());
      else next.delete('search');

      // Page 1: a search narrowing the list to fewer rows than the page you
      // were on would otherwise land you on an empty page.
      next.delete('page');

      startTransition(() => {
        router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, { scroll: false });
      });
    },
    [params, pathname, router],
  );

  const change = (value: string) => {
    setDraft(value);

    if (debounce.current) clearTimeout(debounce.current);

    debounce.current = setTimeout(() => {
      debounce.current = null;
      commit(value);
    }, SEARCH_DEBOUNCE_MS);
  };

  return (
    <form
      // Enter commits at once rather than waiting out the debounce. There is no
      // Apply button for it to press; the submit exists only to skip the wait.
      onSubmit={(event) => {
        event.preventDefault();

        if (debounce.current) {
          clearTimeout(debounce.current);
          debounce.current = null;
        }

        commit(draft);
      }}
      // A WIDTH, NOT A CAP. flex-1 had nothing to expand into -- the row
      // sizes to its content -- so a larger max-width changed nothing and the
      // box stayed at the 189px its placeholder asked for. 24rem is close to
      // twice that; full width below the breakpoint, so it does not crowd the
      // Filter button on a phone.
      className="w-full min-w-0 sm:w-96"
      role="search"
    >
      <label className="sr-only" htmlFor="list-search">
        Search
      </label>

      <input
        id="list-search"
        type="search"
        value={draft}
        onChange={(event) => change(event.target.value)}
        placeholder={placeholder}
        className={`field h-9 w-full ${isPending ? 'opacity-70' : ''}`}
      />
    </form>
  );
}
