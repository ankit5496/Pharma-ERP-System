import type { ReactNode } from 'react';
import { findWorkflow } from '@pharma-erp/types';

import { AppShell } from '@/components/app-shell';
import { FlowStrip } from '@/components/procurement/flow-strip';
import { SummaryCards } from '@/components/procurement/summary-cards';
import { WorkflowSubnav } from '@/components/workflow-subnav';
import { fetchSummary } from '@/lib/procurement';
import { requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Chrome shared by all six Procure-to-Pay sub-tabs.
 *
 * The session check, the shell, the sub-tab bar, the flow diagram and the
 * summary cards live here rather than in each page. Six copies would drift —
 * and the summary in particular has to be identical everywhere, because its
 * counts are how someone decides which sub-tab to open next.
 *
 * Static route segments take precedence over the `[workflow]/[step]` dynamic
 * route, so these pages replace the generic placeholder without it needing to
 * know they exist. The other three workflows still fall through to it.
 */
export default async function ProcureToPayLayout({ children }: { children: ReactNode }) {
  const user = await requireSession();
  const workflow = findWorkflow('procure-to-pay');
  const summary = await fetchSummary();

  return (
    <AppShell user={user}>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Procure-to-Pay</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-slate-600">
            {workflow?.purpose ??
              'Manage the complete process of procuring raw materials, from identifying low stock through vendor payment.'}
          </p>
        </header>

        {workflow && (
          <div className="mb-6">
            <WorkflowSubnav workflow={workflow} />
          </div>
        )}

        <FlowStrip />

        {/* A failed summary is not a reason to hide the whole workflow: the
            sub-tab below can still load, and the cards are a convenience. */}
        {summary.ok ? (
          <SummaryCards summary={summary.data} />
        ) : (
          <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Summary counts unavailable: {summary.error}
          </p>
        )}

        {children}
      </main>
    </AppShell>
  );
}
