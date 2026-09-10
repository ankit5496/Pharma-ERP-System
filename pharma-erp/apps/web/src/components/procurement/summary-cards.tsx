import Link from 'next/link';
import type { ProcurementSummary } from '@pharma-erp/types';

/**
 * The counts across the top of every Procure-to-Pay screen.
 *
 * Each card is a link, and the destination comes from the API alongside the
 * count. That pairing is the point: the number and the filtered list it opens
 * are produced by the same code, so a card saying "3 batches pending QC"
 * cannot open a list showing four.
 */
export function SummaryCards({ summary }: { summary: ProcurementSummary }) {
  return (
    <section aria-label="Procurement summary" className="mb-6">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {summary.cards.map((card) => (
          <li key={card.key}>
            <Link
              href={card.href}
              className={`block h-full rounded-lg border bg-white p-4 transition hover:shadow ${
                card.tone === 'warn'
                  ? 'border-amber-300'
                  : card.tone === 'attention'
                    ? 'border-slate-300'
                    : 'border-slate-200'
              }`}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {card.label}
              </p>
              <p
                className={`mt-1 text-2xl font-semibold tabular-nums ${
                  card.count === 0
                    ? 'text-slate-300'
                    : card.tone === 'warn'
                      ? 'text-status-warn'
                      : 'text-slate-900'
                }`}
              >
                {card.count}
              </p>
              {card.detail && <p className="mt-0.5 text-xs text-slate-500">{card.detail}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
