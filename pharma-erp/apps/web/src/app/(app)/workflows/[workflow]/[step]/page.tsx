import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findWorkflow, findWorkflowStep } from '@pharma-erp/types';

import { AppShell } from '@/components/app-shell';
import {
  BatchRecordPanel,
  BatchReleasePanel,
  FormulationsPanel,
  MaterialIssuePanel,
  ProductionOrdersPanel,
} from '@/components/production/panels';
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
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{workflow.label}</h1>
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
            {/* The extension point promised in WORKFLOWS: a step whose `state`
                is 'ready' has an entry in the registry and renders it; anything
                else still gets the honest placeholder. */}
            {step.state === 'ready' ? (
              <ProductionStep workflowKey={workflow.key} stepKey={step.key} role={user.role} />
            ) : (
              <StepPlaceholder workflowLabel={workflow.label} stepLabel={step.label} />
            )}
          </div>
        </section>
      </main>
    </AppShell>
  );
}

/**
 * Which component serves a built step.
 *
 * A lookup rather than a chain of conditionals, keyed by the same strings as
 * WORKFLOWS, so a step that is marked 'ready' without a screen behind it is a
 * missing key here rather than a silently blank page. `state: 'ready'` and an
 * entry in this table have to be changed together, and that is the point.
 */
const PRODUCTION_STEPS: Record<string, (props: { role: string }) => React.ReactNode> = {
  formulations: () => <FormulationsPanel />,
  'production-orders': () => <ProductionOrdersPanel />,
  'material-issue': () => <MaterialIssuePanel />,
  'batch-record': () => <BatchRecordPanel />,
  'batch-release': ({ role }) => <BatchReleasePanel role={role} />,
};

function ProductionStep({
  workflowKey,
  stepKey,
  role,
}: {
  workflowKey: string;
  stepKey: string;
  role: string;
}) {
  const render = workflowKey === 'production-quality' ? PRODUCTION_STEPS[stepKey] : undefined;

  if (!render) {
    // Reachable only by marking a step 'ready' without adding it above. Says
    // so plainly rather than rendering nothing, because a blank panel looks
    // like a data problem and this is a wiring one.
    return (
      <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/60 p-6 text-sm text-amber-900">
        This step is marked ready but has no screen registered for it.
      </div>
    );
  }

  return <>{render({ role })}</>;
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
    </div>
  );
}
