'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { suggestO2cAction, type Suggestion } from './search-actions';

/**
 * The Order-to-Cash search box, with suggestions as you type.
 *
 * STILL A PLAIN GET FORM. The suggestions are an enhancement layered on top:
 * the term lives in the URL, so a filtered list can be bookmarked and shared,
 * and the server component that fetches it reads the term directly. With
 * JavaScript unavailable this is exactly the form it was before — typing and
 * pressing Search works, and the dropdown simply never appears.
 *
 * Suggestions are DEBOUNCED and RACE-GUARDED. Every keystroke would otherwise
 * be a round trip, and replies can arrive out of order — a slow response for
 * "ro" landing after a fast one for "rox" would replace the better list with a
 * worse one. Each request carries a sequence number and a stale reply is
 * dropped.
 */
export function StepSearch({
  step,
  stepKey,
  search,
}: {
  /** Human label, for the visible field name. */
  step: string;
  /** Workflow step key, which decides what is suggested. */
  stepKey: string;
  search?: string;
}) {
  const [value, setValue] = useState(search ?? '');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const formRef = useRef<HTMLFormElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const listId = useId();

  // Debounced lookup. 200ms is long enough to skip most intermediate keystrokes
  // and short enough that the list feels attached to the typing.
  useEffect(() => {
    const term = value.trim();

    if (term.length < 2) {
      setSuggestions([]);
      return;
    }

    const ticket = ++sequence.current;
    const timer = setTimeout(async () => {
      const found = await suggestO2cAction(stepKey, term);

      // A reply for an older keystroke must not overwrite a newer list.
      if (ticket !== sequence.current) return;

      setSuggestions(found);
      setHighlighted(-1);
      setOpen(found.length > 0);
    }, 200);

    return () => clearTimeout(timer);
  }, [value, stepKey]);

  // A click anywhere else dismisses the list. Pointerdown rather than click so
  // it closes before a button elsewhere handles its own press.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const choose = (suggestion: Suggestion) => {
    setValue(suggestion.value);
    setOpen(false);
    // Submitted on the next tick so the input carries the chosen value.
    setTimeout(() => formRef.current?.requestSubmit(), 0);
  };

  return (
    <form ref={formRef} method="get" className="mb-5 flex flex-wrap items-end gap-2">
      <div ref={boxRef} className="relative min-w-[16rem] flex-1">
        <label htmlFor="step-search" className="field-label">
          Search {step.toLowerCase()}
        </label>

        <input
          id="step-search"
          name="search"
          type="search"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setOpen(suggestions.length > 0)}
          onKeyDown={(event) => {
            if (!open || suggestions.length === 0) return;

            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setHighlighted((index) => (index + 1) % suggestions.length);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlighted((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
            } else if (event.key === 'Enter' && highlighted >= 0) {
              // Only intercepts Enter when something is highlighted, so the
              // plain "type and press Enter" search is untouched.
              event.preventDefault();
              choose(suggestions[highlighted]!);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder="Code, name, number…"
          className="field mt-1.5"
        />

        {open && suggestions.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          >
            {suggestions.map((suggestion, index) => (
              <li key={`${suggestion.value}-${index}`} role="option" aria-selected={index === highlighted}>
                <button
                  type="button"
                  // Mousedown, not click: the input's blur would close the list
                  // before a click ever landed.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(suggestion);
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

      <button
        type="submit"
        className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-900"
      >
        Search
      </button>

      {search && (
        <a
          href="?"
          className="px-2 py-2.5 text-sm font-medium text-slate-500 underline hover:text-slate-800"
        >
          Clear
        </a>
      )}
    </form>
  );
}
