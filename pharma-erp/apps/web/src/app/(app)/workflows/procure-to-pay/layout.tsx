import type { ReactNode } from 'react';
import { findWorkflow } from '@pharma-erp/types';

import { AppShell } from '@/components/app-shell';
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
        {/* ORDER: counts, then tabs, then the tab's own content.

            The counts come first because they are what decides which tab to
            open — reading "3 batches pending QC" and then choosing Incoming QC
            is the actual sequence, so the page is laid out in that order.

            THEY ARE IN THE LAYOUT, WHICH IS THE POINT. A layout is rendered
            once and kept while you move between its children, so these cards
            neither flicker nor reload on every tab change, and no sub-tab
            repeats them. Putting them in the pages would mean six copies that
            drift apart and six extra fetches.

            A failed summary is not a reason to hide the workflow: the tab
            below still loads, and the cards are a convenience. */}
        {summary.ok ? (
          <SummaryCards summary={summary.data} />
        ) : (
          <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Summary counts unavailable: {summary.error}
          </p>
        )}

        {/* ONE NAVIGATION BAR. There was a flow strip here too — Low stock ->
            Requisition -> ... -> Payment — naming the same six destinations as
            these tabs. And above it a heading repeating the tab's own name
            with a sentence describing the module, on every single sub-tab.
            Neither survived: the tabs navigate and show where you are, which
            is all a person needs on arrival. */}
        {workflow && (
          <div className="mb-6">
            <WorkflowSubnav workflow={workflow} />
          </div>
        )}

        {children}
      </main>
    </AppShell>
  );
}
