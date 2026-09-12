/**
 * Shown while a sub-tab's data is being fetched.
 *
 * WHY THIS EXISTS. Every query against the database costs four network round
 * trips — `BEGIN`, set the current company, the query, `COMMIT` — and a screen
 * reads several things. Against a database in another region that is seconds,
 * and without a loading state Next holds the OLD tab on screen for the whole
 * wait: you click GRN, nothing happens, nothing indicates anything is
 * happening, and it looks broken.
 *
 * Being a `loading.tsx` in this segment, it renders the instant a tab is
 * clicked, and the summary cards and tab bar above it — which live in the
 * layout — stay put and are not re-fetched. So navigation is immediate and
 * only the panel below waits.
 *
 * It does NOT make anything faster. It makes the waiting visible and keeps the
 * page usable while it happens, which is a different and achievable thing.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-slate-200 bg-white shadow-sm"
    >
      <span className="sr-only">Loading…</span>

      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div className="space-y-2">
          <div className="h-4 w-44 animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-28 animate-pulse rounded bg-slate-100" />
        </div>
        <div className="h-8 w-40 animate-pulse rounded-md bg-slate-100" />
      </div>

      <div className="space-y-3 p-5">
        {/* Six rows: enough to read as a table rather than as an error, and
            the same height as a typical first page of results, so the real
            content does not make the page jump when it arrives. */}
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="flex items-center gap-4">
            <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
            <div className="h-3 flex-1 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
