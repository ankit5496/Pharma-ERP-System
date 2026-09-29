import Link from 'next/link';
import type { ExpiryBucket } from '@pharma-erp/types';

export interface StatCard {
  key: string;
  label: string;
  count: number;
  detail?: string;
  href: string;
  /** `bad` red, `warn` amber — only while the count is above zero. */
  tone?: 'bad' | 'warn';
  selected?: boolean;
}

/**
 * Link cards in the Procure-to-Pay summary style (`SummaryCards`): the count,
 * and a click through to the list it counts. A zero is greyed, so a screen of
 * zeros reads as "all clear" rather than as a wall of figures.
 */
export function StatCards({ label, cards }: { label: string; cards: readonly StatCard[] }) {
  return (
    <section aria-label={label}>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((card) => {
          const tone = card.count > 0 ? card.tone : undefined;

          return (
            <li key={card.key}>
              <Link
                href={card.href}
                aria-current={card.selected ? 'true' : undefined}
                className={`block h-full rounded-lg border bg-white p-4 transition hover:shadow ${
                  card.selected
                    ? 'border-slate-900 ring-1 ring-slate-900'
                    : tone === 'bad'
                      ? 'border-red-300'
                      : tone === 'warn'
                        ? 'border-amber-300'
                        : 'border-slate-200'
                }`}
              >
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  {card.label}
                </p>
                <p
                  className={`mt-1 text-2xl font-semibold tabular-nums ${
                    card.count === 0
                      ? 'text-slate-300'
                      : tone === 'bad'
                        ? 'text-red-700'
                        : tone === 'warn'
                          ? 'text-status-warn'
                          : 'text-slate-900'
                  }`}
                >
                  {card.count}
                </p>
                {card.detail && <p className="mt-0.5 text-xs text-slate-500">{card.detail}</p>}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * One card per near-expiry window, each linking to the report filtered to
 * it. With `selected`, that card links back to all — the report uses the cards
 * as its window filter. `query` carries the report's other filters along.
 */
export function bucketCards(
  buckets: readonly ExpiryBucket[],
  selected: string | null = null,
  query: URLSearchParams = new URLSearchParams(),
): StatCard[] {
  return buckets.map((bucket, index) => {
    const isSelected = selected === bucket.key;
    const next = new URLSearchParams(query);

    if (isSelected) next.delete('bucket');
    else next.set('bucket', bucket.key);

    return {
      key: bucket.key,
      label: bucket.key === 'EXPIRED' ? 'Expired, still in stock' : `Expiring in ${bucket.label}`,
      count: bucket.batchCount,
      detail: isSelected ? 'Showing these · click to show all' : 'batches',
      href: `/inventory/near-expiry${next.size > 0 ? `?${next}` : ''}`,
      // Expired red, the tightest window amber, the rest plain.
      tone: bucket.key === 'EXPIRED' ? 'bad' : index === 1 ? 'warn' : undefined,
      selected: isSelected,
    };
  });
}
