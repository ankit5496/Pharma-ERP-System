'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useState } from 'react';

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Search, status and date filters, shared by all six Procure-to-Pay lists.
 *
 * THE URL IS THE STATE. Every control writes to the query string and the
 * server component re-renders from it. Three things follow that would each
 * need separate work if the filters lived in component state: a filtered view
 * is a shareable link, the back button behaves, and the summary cards at the
 * top of the page can deep-link into a filtered list simply by pointing at a
 * URL.
 */
export function FilterBar({
  statuses,
  vendors,
  items,
  searchPlaceholder = 'Search…',
  showDates = true,
}: {
  statuses?: readonly FilterOption[];
  vendors?: readonly FilterOption[];
  items?: readonly FilterOption[];
  searchPlaceholder?: string;
  showDates?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const searchId = useId();

  // Local mirror of the search box so typing feels immediate; the URL is
  // updated on a debounce rather than on every keystroke, which would push a
  // history entry per character.
  const [search, setSearch] = useState(params.get('search') ?? '');

  useEffect(() => {
    setSearch(params.get('search') ?? '');
  }, [params]);

  function apply(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }

    // A changed filter invalidates any open detail panel, whose id refers to a
    // row that may no longer be in the list.
    next.delete('open');

    router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false });
  }

  useEffect(() => {
    const current = params.get('search') ?? '';

    if (search === current) return;

    const timer = setTimeout(() => apply({ search }), 300);

    return () => clearTimeout(timer);
    // `apply` is stable enough for this purpose and adding it would re-arm the
    // timer on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const hasFilters = ['search', 'status', 'vendorId', 'itemId', 'dateFrom', 'dateTo'].some((key) =>
    params.get(key),
  );

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-slate-50/60 px-5 py-3">
      <div className="min-w-[12rem] flex-1">
        <label htmlFor={searchId} className="sr-only">
          Search
        </label>
        <input
          id={searchId}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={searchPlaceholder}
          className="field-sm w-full"
        />
      </div>

      {statuses && statuses.length > 0 && (
        <Select
          label="Status"
          value={params.get('status') ?? ''}
          options={statuses}
          allLabel="Any status"
          onChange={(value) => apply({ status: value })}
        />
      )}

      {vendors && vendors.length > 0 && (
        <Select
          label="Vendor"
          value={params.get('vendorId') ?? ''}
          options={vendors}
          allLabel="Any vendor"
          onChange={(value) => apply({ vendorId: value })}
        />
      )}

      {items && items.length > 0 && (
        <Select
          label="Item"
          value={params.get('itemId') ?? ''}
          options={items}
          allLabel="Any item"
          onChange={(value) => apply({ itemId: value })}
        />
      )}

      {showDates && (
        <>
          <DateInput
            label="From"
            value={params.get('dateFrom') ?? ''}
            onChange={(value) => apply({ dateFrom: value })}
          />
          <DateInput
            label="To"
            value={params.get('dateTo') ?? ''}
            onChange={(value) => apply({ dateTo: value })}
          />
        </>
      )}

      {hasFilters && (
        <button
          type="button"
          onClick={() => router.replace(pathname, { scroll: false })}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Clear
        </button>
      )}
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
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="block text-[11px] font-medium text-slate-500">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field-sm mt-0.5"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="block text-[11px] font-medium text-slate-500">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field-sm mt-0.5"
      />
    </div>
  );
}
