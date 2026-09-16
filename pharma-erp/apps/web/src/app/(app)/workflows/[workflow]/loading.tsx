/**
 * Shown while a step's data is being fetched.
 *
 * WHY THIS EXISTS. Without a loading state Next.js holds the OLD step on screen
 * for the whole server render: you click Material issue, nothing happens,
 * nothing indicates anything is happening, and after several seconds the page
 * swaps. It reads as a frozen application rather than a slow one, and the
 * difference matters — people click again, which starts the whole wait over.
 *
 * The waiting is real. Each screen reads two or three things from the API, and
 * each of those is a call to a database in another region. This does not make
 * any of it faster; it makes it visible, and it keeps the tab bar above — which
 * lives in the layout — interactive throughout, so changing your mind costs
 * nothing.
 *
 * The step heading is part of the skeleton because it lives in the page, which
 * is the thing being replaced.
 */
export default function Loading() {
  return (
    <section role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="h-5 w-52 animate-pulse rounded bg-slate-200" />
      <div className="mt-2 h-3 w-96 max-w-full animate-pulse rounded bg-slate-100" />

      <div className="mt-5 rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="space-y-2">
            <div className="h-4 w-44 animate-pulse rounded bg-slate-200" />
            <div className="h-3 w-64 max-w-full animate-pulse rounded bg-slate-100" />
          </div>
          <div className="h-8 w-32 animate-pulse rounded-md bg-slate-100" />
        </div>

        <div className="space-y-3 px-6 py-5">
          {/* Six rows: enough to read as a table rather than as an error, and
              about the height of a typical first page of results, so the real
              content does not make the page jump when it arrives. */}
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="flex items-center gap-4">
              <div className="h-3 w-28 animate-pulse rounded bg-slate-200" />
              <div className="h-3 flex-1 animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
