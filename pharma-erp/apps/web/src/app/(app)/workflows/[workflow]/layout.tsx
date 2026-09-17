import { notFound } from 'next/navigation';
import { findWorkflow } from '@pharma-erp/types';

import { AppShell } from '@/components/app-shell';
import { WorkflowSubnav } from '@/components/workflow-subnav';
import { requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The chrome every step of a workflow shares: the app shell, the workflow
 * heading, and the step tabs.
 *
 * WHY THIS IS A LAYOUT AND NOT PART OF THE PAGE. A layout for a dynamic
 * segment is rendered once per value of that segment and then KEPT across
 * navigations within it. Moving from Formulations to Material issue changes
 * only `[step]`, so this does not run again — which means `requireSession()`
 * does not run again either.
 *
 * That is worth roughly a second per tab click. The session lookup is an API
 * call, and against the hosted database each one was costing 1.2-1.9s; it used
 * to sit at the top of the step page, ahead of everything the panel needed, so
 * every sub-tab click paid it before any data was even requested.
 *
 * It also gives `loading.tsx` somewhere useful to render. With the tab bar in
 * the page, a loading state replaced the tabs too and navigation looked like
 * the whole screen blinked. Here the tabs stay put, stay clickable, and only
 * the panel below them shows a skeleton.
 *
 * The step heading stays in the page, deliberately — it changes per step, so it
 * belongs to the thing that is actually changing.
 */
export default async function WorkflowLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workflow: string }>;
}) {
  const { workflow: workflowKey } = await params;

  // Session first: an unknown workflow should not be a way to find out whether
  // someone is signed in.
  const user = await requireSession();

  const workflow = findWorkflow(workflowKey);

  if (!workflow) notFound();

  return (
    <AppShell user={user}>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{workflow.label}</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-slate-600">{workflow.purpose}</p>
        </header>

        <div className="mb-8">
          <WorkflowSubnav workflow={workflow} />
        </div>

        {children}
      </main>
    </AppShell>
  );
}
