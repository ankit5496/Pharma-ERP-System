'use client';

import { useId } from 'react';

import { pageNumbers } from '@/components/procurement/pagination';

/**
 * The pager under a CLIENT-SIDE list.
 *
 * Deliberately the twin of procurement's `Pagination`, which does the same job
 * for a SERVER-SIDE one, and the difference is the whole reason both exist:
 * procurement keeps the page in the URL so the database can return one slice,
 * while Master Data and Production already hold every row in the browser and
 * page by slicing an array. Those need different state, but they should not
 * look different — the same control in the same place under two lists should
 * not behave like two controls.
 *
 * So the LOOK is shared by matching it here, and `pageNumbers` — the part with
 * actual logic in it, deciding which numbers and gaps to draw — is imported
 * rather than reimplemented. Two copies of that would drift into two different
 * pagers that merely resembled each other.
 *
 * ALWAYS RENDERED, unlike the Prev/Next pager it replaces. That one hid itself
 * when everything fit on one page, which meant the row count and the page-size
 * control disappeared exactly when someone wanted to raise the size to see more.
 * "Showing 1-7 of 7" is information, not furniture.
 */
export function ListPager({
  page,
  pageCount,
  pageSize,
  first,
  last,
  total,
  noun,
  pageSizes,
  onPage,
  onPageSize,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  /** 1-based index of the first row on screen; 0 when there are none. */
  first: number;
  last: number;
  /** Rows AFTER filtering — what the numbers on this line are about. */
  total: number;
  /** Plural noun for the count line: "records", "work orders". */
  noun: string;
  pageSizes: readonly number[];
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const sizeId = useId();

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-slate-200 px-5 py-3 text-sm">
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
            onChange={(event) => onPageSize(Number(event.target.value))}
            aria-label={`Rows of ${noun} per page`}
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm tabular-nums text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <nav aria-label="Pagination" className="flex items-center gap-1">
          <PageButton disabled={page <= 1} onClick={() => onPage(page - 1)} label="Previous">
            Previous
          </PageButton>

          {pageNumbers(page, pageCount).map((entry, index) =>
            entry === null ? (
              // Not a button: the gap stands for pages nobody asked to see.
              <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-slate-400">
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                onClick={() => onPage(entry)}
                aria-current={entry === page ? 'page' : undefined}
                className={`h-8 min-w-8 rounded-md px-2 text-sm font-medium tabular-nums transition ${
                  entry === page
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {entry}
              </button>
            ),
          )}

          <PageButton disabled={page >= pageCount} onClick={() => onPage(page + 1)} label="Next">
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
