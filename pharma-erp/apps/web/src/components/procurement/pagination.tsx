'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId, useTransition } from 'react';

import { PAGE_SIZES } from '@pharma-erp/types';

/**
 * The pager under every list.
 *
 * THE PAGE IS IN THE URL, like the filters, so a page of results is a link
 * somebody can send — and, more importantly, so the page number survives the
 * server re-render that fetching it causes. The server reads it back out of the
 * query string and asks the database for that slice; the browser is never sent
 * rows it is not going to show.
 *
 * TOTALS COME FROM THE SERVER, not from counting what arrived. Counting the
 * rows on screen can only ever produce "1-25 of 25", which is the one thing
 * this line must not say.
 *
 * It renders nothing when everything fits on one page at the smallest offered
 * size. A pager under seven rows is furniture.
 */
export function Pagination({
  total,
  page,
  pageSize,
  /** Plural noun for the line above the buttons: "records", "orders". */
  noun = 'records',
}: {
  total: number;
  page: number;
  pageSize: number;
  noun?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const sizeId = useId();
  const [isPending, startTransition] = useTransition();

  const pageCount = Math.max(Math.ceil(total / pageSize), 1);

  // Clamped for display: a stale `?page=9` on a list that has shrunk to three
  // pages should show the pager as it really is rather than highlighting a
  // page that does not exist.
  const current = Math.min(Math.max(page, 1), pageCount);

  const first = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const last = Math.min(current * pageSize, total);

  function go(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }

    startTransition(() => {
      router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false });
    });
  }

  if (total <= PAGE_SIZES[0] && pageSize >= total) return null;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-slate-200 px-5 py-3 text-sm ${
        isPending ? 'pointer-events-none opacity-60' : ''
      }`}
    >
      <p aria-live="polite" className="text-slate-600">
        {total === 0 ? (
          <>No {noun}</>
        ) : (
          <>
            Showing <span className="font-medium tabular-nums text-slate-900">{first}</span>–
            <span className="font-medium tabular-nums text-slate-900">{last}</span> of{' '}
            <span className="font-medium tabular-nums text-slate-900">{total}</span> {noun}
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
            // Back to page 1: page 6 of 25-row pages is page 2 of 100-row
            // pages, and silently landing somewhere else in the list is more
            // confusing than starting again.
            onChange={(event) => go({ pageSize: event.target.value, page: null })}
            className="field-sm w-20"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <nav aria-label="Pagination" className="flex items-center gap-1">
          <PageButton
            disabled={current <= 1}
            onClick={() => go({ page: String(current - 1) })}
            label="Previous"
          >
            Previous
          </PageButton>

          {pageNumbers(current, pageCount).map((entry, index) =>
            entry === null ? (
              // Not a button: the gap stands for pages nobody asked to see.
              <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-slate-400">
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                onClick={() => go({ page: entry === 1 ? null : String(entry) })}
                aria-current={entry === current ? 'page' : undefined}
                className={`h-8 min-w-8 rounded-md px-2 text-sm font-medium tabular-nums transition ${
                  entry === current
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {entry}
              </button>
            ),
          )}

          <PageButton
            disabled={current >= pageCount}
            onClick={() => go({ page: String(current + 1) })}
            label="Next"
          >
            Next
          </PageButton>
        </nav>
      </div>
    </div>
  );
}

function PageButton({
  children,
  disabled,
  onClick,
  label,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="h-8 rounded-md border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300"
    >
      {children}
    </button>
  );
}

/**
 * The page numbers to draw: the ends, the neighbourhood of the current page,
 * and gaps for the rest.
 *
 * `null` marks a gap. Thirteen pages fit; two hundred would wrap the pager onto
 * three lines and bury the Next button, which is the control actually being
 * reached for.
 */
export function pageNumbers(current: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, pageCount, current]);

  if (current - 1 > 1) pages.add(current - 1);
  if (current + 1 < pageCount) pages.add(current + 1);

  // Keep the row a stable width near the ends, where the neighbourhood is
  // one-sided and the pager would otherwise visibly shrink.
  if (current <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }

  if (current >= pageCount - 2) {
    pages.add(pageCount - 1);
    pages.add(pageCount - 2);
    pages.add(pageCount - 3);
  }

  const sorted = [...pages].filter((page) => page >= 1 && page <= pageCount).sort((a, b) => a - b);

  const out: (number | null)[] = [];

  for (const [index, page] of sorted.entries()) {
    if (index > 0 && page - sorted[index - 1]! > 1) out.push(null);
    out.push(page);
  }

  return out;
}
