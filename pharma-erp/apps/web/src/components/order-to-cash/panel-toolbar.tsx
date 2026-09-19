'use client';

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Modal } from './modal';
import { suggestO2cAction, type Suggestion } from './search-actions';


/**
 * The create button, sized to the search box and the filter toggle it shares a
 * line with. PRIMARY_BUTTON is the same look with `py-2.5`, which makes it
 * visibly taller than its neighbours; height and padding cannot be overridden
 * from a second class without relying on stylesheet order.
 */
const TOOLBAR_CREATE_BUTTON =
  'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400';

/**
 * The toolbar that sits on an Order-to-Cash panel's header row.
 *
 * Search, filter and create, on one line beside the record count — the
 * arrangement Procure-to-Pay already uses. Before this they were stacked above
 * the table: a search band, then a create card, then the list, which pushed the
 * records people came to read below the fold.
 *
 * EVERY CONTROL WRITES TO THE URL, not to component state. A filtered list can
 * then be bookmarked and shared, the back button undoes a filter, and the
 * server component that fetches the rows reads the term directly — which is
 * what keeps the filtering honest rather than hiding rows the page already
 * loaded.
 */

/** Replaces the current URL, preserving everything except the keys given. */
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

/**
 * A compact search box, debounced.
 *
 * No Search button: the list narrows as you type. 300ms is long enough to skip
 * most intermediate keystrokes and short enough that the delay is not read as
 * the page being slow.
 */
export function PanelSearch({
  placeholder = 'Search…',
  stepKey,
}: {
  placeholder?: string;
  /**
   * Enables suggestions. They come from the tab's own list endpoint, so the
   * dropdown and the filtered list always agree about what matches.
   */
  stepKey?: string;
}) {
  const params = useSearchParams();
  const setUrl = useUrlState();
  const [, startTransition] = useTransition();

  const committed = params.get('search') ?? '';
  const [draft, setDraft] = useState(committed);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const boxRef = useRef<HTMLDivElement>(null);

  // Keeps the box in step when the URL changes from elsewhere — a Clear
  // elsewhere on the page, or the back button.
  useEffect(() => setDraft(committed), [committed]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A timer outliving the box would navigate after the user had left.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Suggestions are race-guarded: a slow reply for "ro" must not overwrite a
  // newer list for "rox".
  const sequence = useRef(0);

  useEffect(() => {
    if (!stepKey || draft.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    const ticket = ++sequence.current;
    const handle = setTimeout(async () => {
      const found = await suggestO2cAction(stepKey, draft.trim());
      if (ticket !== sequence.current) return;

      setSuggestions(found);
      setHighlighted(-1);
      setOpen(found.length > 0);
    }, 250);

    return () => clearTimeout(handle);
  }, [draft, stepKey]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const commit = (value: string) => {
    setDraft(value);
    setOpen(false);
    if (timer.current) clearTimeout(timer.current);
    startTransition(() => setUrl({ search: value }));
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        type="search"
        value={draft}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        onChange={(event) => {
          const value = event.target.value;
          setDraft(value);

          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            startTransition(() => setUrl({ search: value }));
          }, 300);
        }}
        onKeyDown={(event) => {
          if (!open || suggestions.length === 0) return;

          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlighted((index) => (index + 1) % suggestions.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlighted((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
          } else if (event.key === 'Enter' && highlighted >= 0) {
            event.preventDefault();
            commit(suggestions[highlighted]!.value);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="field-sm h-9 w-56 text-sm"
      />

      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute right-0 top-full z-30 mt-1 w-72 max-h-64 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {suggestions.map((suggestion, index) => (
            <li key={`${suggestion.value}-${index}`} role="option" aria-selected={index === highlighted}>
              <button
                type="button"
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

export interface FilterChoice {
  /** The value written to the URL. */
  value: string;
  label: string;
}

export interface FilterField {
  /** URL parameter this control owns. */
  param: string;
  label: string;
  /** A select when given, otherwise a date input. */
  choices?: readonly FilterChoice[];
  /** Shown as the select's empty option, e.g. "Any status". */
  allLabel?: string;
}

/**
 * The filter panel, opened by the button beside the search box.
 *
 * AN INLINE PANEL, NOT A MENU. Every control is visible at once with its label
 * above it, which is what lets someone see at a glance why a list is short — a
 * filter hidden behind a dropdown is how a filtered list gets mistaken for
 * missing data. It matches the Procure-to-Pay panel for the same reason.
 *
 * CHANGES APPLY IMMEDIATELY. There is no Apply button, so there is no state in
 * which the controls and the table disagree about what is being shown.
 */
/**
 * The Filter button.
 *
 * Whether the panel is open lives in the URL (`?filters=1`), not in React
 * state, because the button sits on the header row and the panel sits under
 * it — two different places in the tree with no common client ancestor. The
 * URL is the one thing both can read, and it makes an open panel survive a
 * filter change, which re-renders the server component.
 */
export function FilterToggle({ fields }: { fields: readonly FilterField[] }) {
  const params = useSearchParams();
  const setUrl = useUrlState();

  const open = params.get('filters') === '1';
  const activeCount = fields.filter((field) => params.get(field.param)).length;

  return (
    <button
      type="button"
      onClick={() => setUrl({ filters: open ? null : '1' })}
      aria-expanded={open}
      aria-controls="o2c-filters"
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

/** The expanding row of controls. Rendered by the panel, under its header. */
export function FilterPanel({ fields }: { fields: readonly FilterField[] }) {
  const params = useSearchParams();
  const open = params.get('filters') === '1';
  const setUrl = useUrlState();
  const [isPending, startTransition] = useTransition();

  const anyActive = fields.some((field) => params.get(field.param));

  const set = (param: string, value: string) =>
    startTransition(() => setUrl({ [param]: value || null }));

  return (
    <div
      id="o2c-filters"
      hidden={!open}
      // Hidden by the class, not the attribute alone: `hidden` is only a
      // user-agent display rule and any author rule outranks it. The attribute
      // stays for assistive technology.
      className={`${open ? 'block' : 'hidden'} border-b border-slate-200 bg-slate-50/60 px-5 py-4`}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map((field) => (
          <div key={field.param}>
            <label
              htmlFor={`o2c-filter-${field.param}`}
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              {field.label}
            </label>

            {field.choices ? (
              <select
                id={`o2c-filter-${field.param}`}
                value={params.get(field.param) ?? ''}
                onChange={(event) => set(field.param, event.target.value)}
                // h-10 on every control, so the row lines up whatever it holds.
                className="field h-10 w-full"
              >
                <option value="">{field.allLabel ?? 'Any'}</option>
                {field.choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`o2c-filter-${field.param}`}
                type="date"
                value={params.get(field.param) ?? ''}
                onChange={(event) => set(field.param, event.target.value)}
                className="field h-10 w-full"
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <span aria-live="polite" className="mr-auto text-xs text-slate-500">
          {isPending ? 'Filtering…' : 'Filters apply as you change them.'}
        </span>

        <button
          type="button"
          disabled={!anyActive}
          onClick={() =>
            startTransition(() =>
              setUrl(Object.fromEntries(fields.map((field) => [field.param, null]))),
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
 * A button that opens its form in a dialog.
 *
 * THE FORM IS A POPUP, not a card that expands above the list. An inline form
 * pushes the records down the page the moment someone goes to add one, so the
 * thing they were reading moves. The dialog leaves the list where it is.
 *
 * `closeOn` is how the form reports success: it cannot close the dialog itself
 * without the two disagreeing about whether it is open, so the caller flips
 * this and the dialog follows.
 */
export function CreateDialogButton({
  label,
  title,
  description,
  disabled = false,
  disabledHint,
  closeOn = false,
  children,
}: {
  label: string;
  title: string;
  description?: string;
  disabled?: boolean;
  disabledHint?: string;
  closeOn?: boolean;
  /**
   * A PLAIN NODE, not a render function.
   *
   * These panels are server components, and a function cannot cross the
   * server/client boundary — React has nothing to serialise it into, so the
   * page fails to render rather than failing to compile. Passing the form as
   * an element keeps the boundary crossable: the server renders it, this
   * client component only decides whether to mount it.
   */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // Closed by the caller once the record is saved.
  useEffect(() => {
    if (closeOn) setOpen(false);
  }, [closeOn]);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        title={disabled ? disabledHint : undefined}
        onClick={() => setOpen(true)}
        className={TOOLBAR_CREATE_BUTTON}
      >
        {label}
      </button>

      {open && (
        <Modal title={title} description={description} onClose={() => setOpen(false)}>
          {children}
        </Modal>
      )}
    </>
  );
}
