'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * A picklist you can type into, for options that come from RECORDS.
 *
 * Only for those. A fixed enum — item type, GST rate, licence status — is a
 * handful of choices that never grows, and a search box over five options is
 * furniture. The registers are the opposite: every item, party or formulation
 * ever created is in the list, it only grows, and by the time it is long enough
 * to be a problem it is far too long to scroll.
 *
 * WHAT IT SHOWS BEFORE YOU TYPE. Not the whole list: the most recently created
 * few, which is a deliberate bet about what someone is reaching for. A person
 * writing a formulation for a product they added minutes ago should find it
 * without typing, and someone after an older record was going to search anyway.
 * The count is RECENT_COUNT below.
 *
 * THE CALLER SORTS. This component takes the order it is given and shows the
 * first few, so every call site sorts newest-first before passing options in.
 * Deliberate: "newest" is a different field on each record — `createdAt` for an
 * item or a party, `version` for a formulation, and the work-order list arrives
 * newest-first from the API already — and a sort here would need to know all of
 * them.
 *
 * A NATIVE <select> IS STILL UNDERNEATH, hidden, holding the real value. Three
 * things depend on it and none are worth reimplementing: the form submits by
 * `name` with no JavaScript of ours, React 19's form-reset repair in
 * SelectField works by writing to `element.value`, and an unstyled native
 * control is what assistive technology handles best. This adds a text input and
 * a list ON TOP of that, and writes through to it.
 */

/** How many records to offer before anything is typed. */
const RECENT_COUNT = 3;

export interface SelectOption {
  value: string;
  label: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = '--None--',
  id,
  required,
  disabled,
  invalid,
  describedBy,
}: {
  /** Newest first — see the note above on what is shown before typing. */
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** The empty choice. Null hides it, for a field that cannot be cleared. */
  placeholder?: string | null;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value) ?? null;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();

    // Nothing typed: the most recent few. Typed: everything that matches, with
    // no cap — a search that silently stopped at three would hide the record
    // somebody was looking for.
    if (!needle) return options.slice(0, RECENT_COUNT);

    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  // Close on a click anywhere else. Pointerdown rather than click: a click on
  // another control would otherwise land while this list is still over it.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setQuery('');
    }

    document.addEventListener('pointerdown', onPointerDown);

    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // The highlight belongs to the current result set, not to wherever it was
  // left: after typing, "the first match" is the only sensible starting point.
  useEffect(() => setActive(0), [query, open]);

  function choose(option: SelectOption | null) {
    onChange(option?.value ?? '');
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();

      if (!open) {
        setOpen(true);
        return;
      }

      const step = event.key === 'ArrowDown' ? 1 : -1;
      const count = matches.length + (placeholder === null ? 0 : 1);

      if (count > 0) setActive((current) => (current + step + count) % count);

      return;
    }

    if (event.key === 'Enter' && open) {
      event.preventDefault();

      // Index 0 is the "none" row whenever a placeholder is offered, so the
      // options start one later.
      const offset = placeholder === null ? 0 : 1;

      if (placeholder !== null && active === 0) choose(null);
      else choose(matches[active - offset] ?? null);

      return;
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault();
      // Stopped here so Escape closes the list rather than the drawer the form
      // is in — one Escape, one thing closed.
      event.stopPropagation();
      setOpen(false);
      setQuery('');
    }
  }

  const offset = placeholder === null ? 0 : 1;

  return (
    <div ref={rootRef} className="relative">
      {/* The real control. Hidden from sight and from assistive technology —
          the text input above carries the accessible name and the value — but
          still submitted with the form, and still what SelectField's reset
          repair writes to. */}
      <select
        id={id}
        aria-hidden="true"
        tabIndex={-1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled}
        className="sr-only"
      >
        {placeholder !== null && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-required={required}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        disabled={disabled}
        // Typing filters; not typing shows what is chosen. Keeping the query in
        // the box after a choice would leave a half-typed string beside a
        // different selected value.
        value={open ? query : (selected?.label ?? '')}
        placeholder={selected ? undefined : (placeholder ?? 'Search…')}
        onChange={(event) => {
          setQuery(event.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-slate-50 ${
          invalid
            ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
            : 'border-slate-300 focus:border-slate-900 focus:ring-slate-900'
        }`}
      />

      {/* Purely decorative: the caret says "this is a picklist" to anyone who
          would otherwise read a text box and not think to click. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400"
      >
        ▾
      </span>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {placeholder !== null && (
            <Row active={active === 0} selected={value === ''} onPick={() => choose(null)} muted>
              {placeholder}
            </Row>
          )}

          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">No match for “{query.trim()}”.</li>
          ) : (
            matches.map((option, index) => (
              <Row
                key={option.value}
                active={active === index + offset}
                selected={option.value === value}
                onPick={() => choose(option)}
              >
                {option.label}
              </Row>
            ))
          )}

          {/* Said only when the list is the recent few AND there are more
              behind it — otherwise it would claim a shortening that is not
              happening. */}
          {!query.trim() && options.length > RECENT_COUNT && (
            <li className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-500">
              Showing the {RECENT_COUNT} most recent of {options.length}. Type to search.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function Row({
  active,
  selected,
  muted,
  onPick,
  children,
}: {
  active: boolean;
  selected: boolean;
  muted?: boolean;
  onPick: () => void;
  children: React.ReactNode;
}) {
  return (
    <li
      role="option"
      aria-selected={selected}
      // Mousedown, not click: click fires after blur, by which point the list
      // has already closed and the choice is lost.
      onMouseDown={(event) => {
        event.preventDefault();
        onPick();
      }}
      className={`cursor-pointer px-3 py-2 text-sm ${
        active ? 'bg-slate-100' : ''
      } ${selected ? 'font-semibold text-slate-900' : muted ? 'text-slate-500' : 'text-slate-700'}`}
    >
      {children}
    </li>
  );
}
