import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findWorkflow, findWorkflowStep } from '@pharma-erp/types';

// AppShell is deliberately absent: the workflow layout renders it now, so a
// sub-tab change no longer re-runs the session lookup. See ../layout.tsx.
import { OrderToCashStep } from '@/components/order-to-cash';
import {
  BatchRecordPanel,
  BatchReleasePanel,
  FormulationsPanel,
  MaterialIssuePanel,
  ProductionOrdersPanel,
} from '@/components/production/panels';

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
  /** `?search=` is forwarded to whichever panel renders, for its list filter. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { workflow: workflowKey, step: stepKey } = await params;
  const workflow = findWorkflow(workflowKey);
  const step = workflow && findWorkflowStep(workflow, stepKey);

  if (!workflow || !step) return { title: 'Not found' };

  return { title: `${step.label} · ${workflow.label}` };
}

export default async function WorkflowStepPage({ params, searchParams }: PageProps) {
  const { workflow: workflowKey, step: stepKey } = await params;

  // No session call here. The layout above establishes it, and a layout for a
  // dynamic segment is not re-rendered when only the segment BELOW it changes —
  // so moving between steps costs nothing extra. Reaching this page at all
  // means the layout has already admitted the request.
  const workflow = findWorkflow(workflowKey);
  const step = workflow && findWorkflowStep(workflow, stepKey);

  if (!workflow || !step) notFound();

  const query = await searchParams;
  const search = typeof query.search === 'string' ? query.search : undefined;

  return (
    <section aria-labelledby="step-heading">
      <h2 id="step-heading" className="text-lg font-semibold text-slate-900">
        {step.label}
      </h2>
      {step.purpose && <p className="mt-1 max-w-3xl text-sm text-slate-600">{step.purpose}</p>}

      <div className="mt-5">
        {/* The extension point promised in WORKFLOWS: a step whose `state` is
            'ready' has a screen registered for it and renders it; anything else
            still gets the honest placeholder.

            Order-to-Cash takes its own branch because each of its panels
            renders its own heading — they need the room for a search box and a
            create button beside the title. Production steps sit under the
            shared heading above. */}
        {workflow.key === 'order-to-cash' && step.state === 'ready' ? (
          <>
            <StepSearch step={step.label} search={search} />
            <OrderToCashStep step={step.key} search={search} />
          </>
        ) : step.state === 'ready' ? (
          <ProductionStep workflowKey={workflow.key} stepKey={step.key} />
        ) : (
          <StepPlaceholder workflowLabel={workflow.label} stepLabel={step.label} />
        )}
      </div>
    </section>
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
const PRODUCTION_STEPS: Record<string, () => React.ReactNode> = {
  formulations: () => <FormulationsPanel />,
  'production-orders': () => <ProductionOrdersPanel />,
  'material-issue': () => <MaterialIssuePanel />,
  'batch-record': () => <BatchRecordPanel />,
  'batch-release': () => <BatchReleasePanel />,
};

function ProductionStep({ workflowKey, stepKey }: { workflowKey: string; stepKey: string }) {
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

  return <>{render()}</>;
}

/**
 * A plain GET search box.
 *
 * A form rather than a controlled input, so the whole thing works without
 * JavaScript and the search term lives in the URL — which means a filtered list
 * can be bookmarked and shared, and the server component that fetches it can
 * read the term directly.
 */
function StepSearch({ step, search }: { step: string; search?: string }) {
  return (
    <form method="get" className="mb-5 flex flex-wrap items-end gap-2">
      <div className="min-w-[16rem] flex-1">
        <label htmlFor="step-search" className="field-label">
          Search {step.toLowerCase()}
        </label>
        <input
          id="step-search"
          name="search"
          type="search"
          defaultValue={search ?? ''}
          placeholder="Code, name, number…"
          className="field mt-1.5"
        />
      </div>

      <button
        type="submit"
        className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-900"
      >
        Search
      </button>

      {search && (
        <a
          href="?"
          className="px-2 py-2.5 text-sm font-medium text-slate-500 underline hover:text-slate-800"
        >
          Clear
        </a>
      )}
    </form>
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
    </div>
  );
}
