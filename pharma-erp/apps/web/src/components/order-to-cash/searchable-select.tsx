'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  /** What is typed against and shown once chosen. */
  label: string;
  /** Secondary line in the list — a total, a status, a due date. */
  hint?: string;
}

/**
 * A select you can type into.
 *
 * A NATIVE <select> IS FINE UNTIL THE LIST IS LONG. Two customers are easy to
 * pick from a dropdown; two hundred invoices are not, and the browser's own
 * type-ahead only matches from the first character, so searching for a customer
 * by the middle of their name is impossible. This filters on any substring of
 * the label or the hint.
 *
 * THE LIST FOLLOWS TYPING. Nothing drops down on focus: a menu of every
 * option would cover the fields below before the user has asked anything, and
 * the point of this control is that the list is a reply to a search.
 *
 * KEPT CLOSE TO THE THING IT REPLACES. It renders the same `field` classes, so
 * it sits in the existing grids without relayout, and it reports its value
 * through `onChange(value)` exactly as the <select> did — the call sites keep
 * their state, their validation and their disabled logic unchanged.
 *
 * WHAT IT IS NOT: a free-text field. Only a value from `options` can be chosen;
 * typing something with no match selects nothing rather than inventing an id.
 * The input shows the chosen label when closed, so the field always reads as
 * the record it holds rather than as whatever was last typed.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Search…',
  id,
  ariaLabel,
  disabled = false,
  small = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Matches the `field-sm` sizing used inside the order-line grid. */
  small?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find((option) => option.value === value) ?? null;

  const needle = query.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!needle) return [];

    return options.filter((option) =>
      `${option.label} ${option.hint ?? ''}`.toLowerCase().includes(needle),
    );
  }, [options, needle]);

  // The list appears once something has been typed, not on focus. Opening a
  // dropdown over the fields below it before the user has asked a question
  // hides the form they are working down.
  const showList = open && needle !== '';

  // Clicking elsewhere closes the list and restores the chosen label, so a
  // half-typed search is never left sitting in a field that still holds a value.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (boxRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setQuery('');
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const choose = (option: SelectOption) => {
    onChange(option.value);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        // Closed, it shows what is selected; open, it shows what is being typed.
        value={open ? query : (selected?.label ?? '')}
        placeholder={selected ? selected.label : placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery('');
          setHighlighted(-1);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setHighlighted(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            if (matches.length === 0) return;
            event.preventDefault();
            setOpen(true);
            setHighlighted((index) => (index + 1) % matches.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlighted((index) =>
              matches.length === 0 ? -1 : index <= 0 ? matches.length - 1 : index - 1,
            );
          } else if (event.key === 'Enter') {
            // Only swallows Enter when a row is highlighted, so Enter in a form
            // with nothing chosen still submits as it did before.
            if (open && highlighted >= 0 && matches[highlighted]) {
              event.preventDefault();
              choose(matches[highlighted]);
            }
          } else if (event.key === 'Escape') {
            setOpen(false);
            setQuery('');
          }
        }}
        className={`${small ? 'field-sm' : 'field'} w-full`}
      />

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">No match.</li>
          ) : (
            matches.map((option, index) => (
              <li key={option.value} role="option" aria-selected={option.value === value}>
                <button
                  type="button"
                  // Mousedown, not click: the input's blur would close the list
                  // before a click ever landed on it.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                  onMouseEnter={() => setHighlighted(index)}
                  className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm ${
                    index === highlighted
                      ? 'bg-slate-100'
                      : option.value === value
                        ? 'bg-slate-50'
                        : 'hover:bg-slate-50'
                  }`}
                >
                  <span className="text-slate-800">{option.label}</span>
                  {option.hint && (
                    <span className="shrink-0 text-[11px] text-slate-500">{option.hint}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
