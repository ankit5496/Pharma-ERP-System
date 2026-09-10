import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findWorkflow, findWorkflowStep } from '@pharma-erp/types';

import { AppShell } from '@/components/app-shell';
import { WorkflowSubnav } from '@/components/workflow-subnav';
import { requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * One step of one workflow.
 *
 * Two dynamic segments serve all four tabs and all twenty-eight steps, driven
 * entirely by WORKFLOWS in @pharma-erp/types. Adding a step is a data change;
 * no route, no file. That is what "scalable for future workflow steps" has to
 * mean in practice, otherwise every new step is a copy-pasted page that drifts.
 */

interface PageProps {
  // Next 15 hands params in as a promise.
  params: Promise<{ workflow: string; step: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { workflow: workflowKey, step: stepKey } = await params;
  const workflow = findWorkflow(workflowKey);
  const step = workflow && findWorkflowStep(workflow, stepKey);

  if (!workflow || !step) return { title: 'Not found' };

  return { title: `${step.label} · ${workflow.label}` };
}

export default async function WorkflowStepPage({ params }: PageProps) {
  const { workflow: workflowKey, step: stepKey } = await params;

  // Session first: an unknown step should not be a way to find out whether
  // someone is signed in.
  const user = await requireSession();

  const workflow = findWorkflow(workflowKey);
  const step = workflow && findWorkflowStep(workflow, stepKey);

  if (!workflow || !step) notFound();

  return (
    <AppShell user={user}>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {workflow.label}
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm text-slate-600">{workflow.purpose}</p>
        </header>

        <div className="mb-8">
          <WorkflowSubnav workflow={workflow} />
        </div>

        <section aria-labelledby="step-heading">
          <h2 id="step-heading" className="text-lg font-semibold text-slate-900">
            {step.label}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{step.purpose}</p>

          <div className="mt-5">
            {/* When a step gains a real screen, flip its `state` to 'ready' in
                WORKFLOWS and render it here — the branch is the extension
                point, and until then the panel below is the honest answer. */}
            <StepPlaceholder workflowLabel={workflow.label} stepLabel={step.label} />
          </div>
        </section>
      </main>
    </AppShell>
  );
}

/**
 * What a step shows before it is built.
 *
 * Says so plainly rather than rendering an empty table. An empty table asserts
 * that there are no records; in a pharma system that assertion being wrong is
 * worse than an obvious gap, which is the same reasoning the dashboard's
 * `pending` widgets already follow.
 */
function StepPlaceholder({
  workflowLabel,
  stepLabel,
}: {
  workflowLabel: string;
  stepLabel: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white/60 p-8 text-center">
      <p className="text-sm font-medium text-slate-700">{stepLabel} is not built yet.</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        The navigation for {workflowLabel} is in place so the flow is reviewable. This step needs
        its domain tables before it can show anything real.
      </p>
      <p className="mx-auto mt-4 max-w-md text-xs text-slate-500">
        Records from the tables that do exist are available from the{' '}
        <strong className="font-semibold text-slate-600">Inspect a table</strong> dropdown, top
        right.
      </p>
    </div>
  );
}
