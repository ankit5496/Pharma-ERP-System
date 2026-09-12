import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { canManageUsers, findDataset, mayReadDataset } from '@pharma-erp/types';

import { AppShell } from '@/components/app-shell';
import { RecordTable } from '@/components/record-table';
import { loadDatasetRecords } from '@/lib/datasets';
import { requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The record browser: one route for every data table.
 *
 * This is the whole point of the DATASETS registry — the dropdown, the columns
 * and the endpoint all come from data, so a new table needs an entry rather
 * than a page. Read-only by design: editing belongs on the screen that owns
 * the record (Users has one), where the rules for that entity live.
 */

interface PageProps {
  params: Promise<{ table: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { table } = await params;
  const dataset = findDataset(table);

  return { title: dataset ? dataset.label : 'Not found' };
}

export default async function DataTablePage({ params }: PageProps) {
  const { table } = await params;

  const user = await requireSession();
  const dataset = findDataset(table);

  if (!dataset) notFound();

  const result =
    dataset.source.kind === 'endpoint' ? await loadDatasetRecords(dataset) : null;

  return (
    <AppShell user={user}>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
            Records
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            {dataset.label}
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm text-slate-600">{dataset.description}</p>
          {/* The model and table names, because someone reconciling against
              the database or a migration needs to know which table this is. */}
          <p className="mt-2 font-mono text-xs text-slate-400">
            {dataset.model} · {dataset.table}
          </p>
        </header>

        <section
          aria-labelledby="records"
          className="rounded-lg border border-slate-200 bg-white shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
            <h2 id="records" className="text-base font-semibold text-slate-900">
              {result?.ok
                ? `${result.data.length} record${result.data.length === 1 ? '' : 's'}`
                : dataset.label}
            </h2>

            {/* Inspecting is read-only, so point at the screen that can act. */}
            {dataset.key === 'users' && canManageUsers(user.role) && (
              <Link
                href="/admin/users"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Manage users
              </Link>
            )}
          </div>

          {!result ? (
            <NotBuiltYet label={dataset.label} model={dataset.model} />
          ) : !result.ok ? (
            <RecordsError
              status={result.status}
              error={result.error}
              restricted={!mayReadDataset(dataset, user.role)}
            />
          ) : result.data.length === 0 ? (
            <p className="p-6 text-sm text-slate-600">No records.</p>
          ) : (
            <RecordTable
              columns={dataset.columns}
              rows={result.data}
              rowKey={dataset.rowKey}
            />
          )}
        </section>

        <p className="mt-6 text-xs text-slate-500">
          Read-only. Every row here is scoped to {user.tenantName} by row-level security in
          Postgres, and by the API&rsquo;s role checks — not by this page.
        </p>
      </main>
    </AppShell>
  );
}

function NotBuiltYet({ label, model }: { label: string; model: string }) {
  return (
    <div className="p-8 text-center">
      <p className="text-sm font-medium text-slate-700">{label} does not exist yet.</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        The <code className="font-mono text-xs">{model}</code> model is on the schema roadmap but
        has no table behind it, so there is nothing to show. It appears in the dropdown as
        unselectable until it does.
      </p>
    </div>
  );
}

/**
 * A failed read.
 *
 * A 403 gets its own wording: it is not a fault, it is the API declining, and
 * telling someone their role cannot read this table saves them retrying.
 */
function RecordsError({
  status,
  error,
  restricted,
}: {
  status: number | null;
  error: string;
  restricted: boolean;
}) {
  if (status === 403 || restricted) {
    return (
      <div className="p-6">
        <p className="text-sm font-medium text-slate-800">Your role cannot read this table.</p>
        <p className="mt-1.5 text-sm text-slate-600">
          The table is listed for everyone, but the API restricts who may read it. Ask an Admin if
          you need access.
        </p>
      </div>
    );
  }

  return <p className="p-6 text-sm text-red-800">Could not load records: {error}</p>;
}
