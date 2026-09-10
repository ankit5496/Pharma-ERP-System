import type { Metadata } from 'next';
import Link from 'next/link';
import { DATASETS, type Dataset } from '@pharma-erp/types';

import { AppShell } from '@/components/app-shell';
import { requireSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Records' };
export const dynamic = 'force-dynamic';

/**
 * Index for the record browser.
 *
 * The dropdown in the header is the normal way in; this exists so `/data` is
 * not a dead URL and so the full list, including what is not built yet, is
 * readable somewhere other than inside a <select>.
 */
export default async function DataIndexPage() {
  const user = await requireSession();

  const available = DATASETS.filter((dataset) => dataset.source.kind === 'endpoint');
  const planned = DATASETS.filter((dataset) => dataset.source.kind === 'planned');

  return (
    <AppShell user={user}>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Records</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-slate-600">
            Read-only views of the data tables, for looking something up without going through the
            screen that owns it. Everything is scoped to {user.tenantName}.
          </p>
        </header>

        <section aria-labelledby="available" className="mb-10">
          <h2 id="available" className="text-sm font-semibold text-slate-900">
            Available
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {available.map((dataset) => (
              <li key={dataset.key}>
                <Link
                  href={`/data/${dataset.key}`}
                  className="block h-full rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow"
                >
                  <p className="text-sm font-medium text-slate-900">{dataset.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    {dataset.description}
                  </p>
                  <p className="mt-2 font-mono text-[11px] text-slate-400">{dataset.table}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="planned">
          <h2 id="planned" className="text-sm font-semibold text-slate-900">
            Not built yet
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            On the schema roadmap. Listed so the shape of the system is visible; there are no rows
            behind them.
          </p>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {planned.map((dataset) => (
              <PlannedCard key={dataset.key} dataset={dataset} />
            ))}
          </ul>
        </section>
      </main>
    </AppShell>
  );
}

function PlannedCard({ dataset }: { dataset: Dataset }) {
  return (
    <li className="h-full rounded-lg border border-dashed border-slate-300 bg-white/60 p-4">
      <p className="text-sm font-medium text-slate-500">{dataset.label}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{dataset.description}</p>
      <p className="mt-2 font-mono text-[11px] text-slate-300">{dataset.table}</p>
    </li>
  );
}
