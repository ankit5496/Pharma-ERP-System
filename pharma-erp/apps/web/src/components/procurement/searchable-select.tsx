'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * A lookup field you can type into.
 *
 * A NATIVE <select> IS NOT SEARCHABLE IN ANY USEFUL SENSE. Typing into one
 * jumps to the first option starting with those letters and resets after a
 * second, so finding "Shree Krishna Pharmaceuticals" among two hundred vendors
 * means either knowing it starts with S and typing fast, or scrolling. A lookup
 * points at another record, and the way anyone actually finds a record is by
 * typing part of what they remember of it — a fragment of the name, a code, a
 * document number.
 *
 * SO THIS MATCHES ON ANY SUBSTRING of the label or the hint, which is what puts
 * "PO-2026-0158 — Render Vendor" within reach of typing "render" or "0158".
 *
 * IT SUBMITS LIKE A SELECT. When `name` is given, the chosen value is carried
 * by a hidden input, so a plain form submission posts exactly what a <select>
 * would have posted and no calling form needs to know this is a combobox. The
 * visible text box is deliberately NOT the posted field: it holds whatever was
 * typed, which is a search term and not an id.
 *
 * WHAT IS TYPED IS NEVER A VALUE. Closing without choosing restores the label
 * of whatever is actually selected, so the box can never be left showing a
 * vendor that was not picked — the failure mode that makes home-made
 * autocompletes untrustworthy.
 */
export interface LookupOption {
  value: string;
  label: string;
  /** Searched alongside the label, and shown under it. A code, a date, a total. */
  hint?: string;
}

export function SearchableSelect({
  id,
  name,
  options,
  value,
  onChange,
  emptyLabel = 'None',
  placeholder = 'Type to search…',
  required = false,
  disabled = false,
  className = 'field-sm w-full',
}: {
  id: string;
  /** Omit for a control that only filters the page — nothing is then posted. */
  name?: string;
  options: readonly LookupOption[];
  value: string;
  onChange: (value: string) => void;
  /**
   * What an empty field says, and — where a blank is legal — the row that
   * clears it.
   *
   * ON A REQUIRED FIELD IT IS A PLACEHOLDER AND NOTHING MORE: no row is
   * offered for it, because "nothing" is not one of the answers. On an optional
   * field it is also offered as the top row, so a choice can be undone.
   */
  emptyLabel?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  /**
   * The row the keyboard is on. -1 is "none yet", and that is the value the
   * list opens with.
   *
   * NOTHING IS PICKED FOR YOU. Opening a list is not choosing from it, so the
   * first row is not pre-armed and Enter on an untouched list commits nothing.
   * Arrowing in, or typing, is what puts the keyboard on a row.
   */
  const [active, setActive] = useState(-1);

  const wrapper = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const selected = options.find((option) => option.value === value) ?? null;

  /**
   * The list as it stands.
   *
   * Filtered case-insensitively on label AND hint, so a vendor can be found by
   * its code and an order by its number, which is how people remember them.
   *
   * The "none" row is there only when a blank is a legal answer. A required
   * field that offered one would be presenting the thing it is about to refuse
   * as if it were a choice — and, sitting at the top of the list, it reads as
   * an item that is already selected.
   */
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    const all: LookupOption[] = required
      ? [...options]
      : [{ value: '', label: emptyLabel }, ...options];

    if (!term) return all;

    return all.filter(
      (option) =>
        option.value === '' ||
        `${option.label} ${option.hint ?? ''}`.toLowerCase().includes(term),
    );
  }, [options, query, emptyLabel, required]);

  // Closing on an outside pointer press rather than on blur: blur fires before
  // the click that caused it lands, so closing there would dismiss the list
  // under the pointer and swallow the choice being made.
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);

    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const choose = (option: LookupOption) => {
    onChange(option.value);
    setQuery('');
    setActive(-1);
    setOpen(false);
    input.current?.focus();
  };

  const openList = () => {
    if (disabled) return;
    setActive(-1);
    setOpen(true);
  };

  return (
    <div ref={wrapper} className="relative">
      {/* What the form posts. The text box above it is a search term. */}
      {name && <input type="hidden" name={name} value={value} />}

      <input
        ref={input}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-required={required || undefined}
        autoComplete="off"
        disabled={disabled}
        // Closed, it reads as the current selection; open, it is a search box.
        value={open ? query : (selected?.label ?? '')}
        // Read-only while closed, so a click lands on the control rather than
        // placing a caret in text that is a label, not an editable value. It
        // becomes writable the moment the list opens.
        readOnly={!open}
        // Open with a selection, the placeholder IS the selection: the box
        // is empty because it is waiting for a search term, not because the
        // choice was lost.
        placeholder={open ? (selected?.label ?? placeholder) : emptyLabel}
        // NOT onFocus. A dialog focuses its first control on open, and tabbing
        // past a lookup focuses it too — neither is a request to see the list.
        onClick={openList}
        onChange={(event) => {
          if (!open) openList();
          setQuery(event.target.value);
          // Typing narrows the list to what was asked for, so arming the top
          // row is a genuine shortcut rather than a guess: Enter then takes
          // the best match for what the user actually typed.
          setActive(event.target.value.trim() ? 0 : -1);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();

            if (!open) {
              openList();

              return;
            }

            const step = event.key === 'ArrowDown' ? 1 : -1;

            setActive((current) => {
              // From "none yet", Down lands on the first row and Up on the
              // last, which is what both keys mean when nothing is active.
              if (current < 0) return step > 0 ? 0 : matches.length - 1;

              const next = current + step;

              if (next < 0) return matches.length - 1;
              if (next >= matches.length) return 0;

              return next;
            });

            return;
          }

          if (event.key === 'Enter' && open) {
            // Only swallowed while the list is open, so Enter still submits
            // the surrounding form the rest of the time.
            event.preventDefault();

            // Nothing arrowed to and nothing typed means nothing chosen —
            // Enter must not commit whichever row happens to be first.
            const option = active >= 0 ? matches[active] : undefined;

            if (option) choose(option);

            return;
          }

          if (event.key === 'Escape' && open) {
            event.preventDefault();
            setQuery('');
            setOpen(false);
          }
        }}
        className={className}
      />

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-left shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-500">
              {query.trim() ? `No match for “${query.trim()}”.` : 'Nothing to choose from yet.'}
            </li>
          ) : (
            matches.map((option, index) => (
              <li key={option.value || '__none'}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  // pointerdown rather than click: the outside-press handler
                  // runs on pointerdown, and a click would arrive after it.
                  onPointerDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={`block w-full px-3 py-1.5 text-left text-xs ${
                    index === active ? 'bg-slate-100' : ''
                  } ${option.value === value ? 'font-semibold text-slate-900' : 'text-slate-700'}`}
                >
                  {option.value === '' ? (
                    <span className="text-slate-500">{option.label}</span>
                  ) : (
                    <>
                      <span className="block">{option.label}</span>
                      {option.hint && (
                        <span className="block text-[11px] text-slate-500">{option.hint}</span>
                      )}
                    </>
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
