import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findWorkflow, findWorkflowStep } from '@pharma-erp/types';

// AppShell is deliberately absent: the workflow layout renders it now, so a
// sub-tab change no longer re-runs the session lookup. See ../layout.tsx.
import { JOB_WORK_STEPS } from '@/components/job-work/panels';
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
 * The workflows that title their own screens.
 *
 * Their panels each render a card with a heading and a record count, above
 * their own search and filter controls, and the sub-tab bar has already named
 * the step — so a page-level heading here was the third name for one screen,
 * with a paragraph under it restating what the table shows. Both were
 * withdrawn at the product owner's request.
 *
 * ONE LIST RATHER THAN A PREDICATE PER WORKFLOW. The two were added on separate
 * branches as `showStepHeading` and `ownsItsHeading`, which is precisely how
 * this file ended up in conflict: the same rule, written twice, in opposite
 * polarities. Production and the rest still render the heading, so this is a
 * list of exceptions and not a flag to delete.
 */
const WORKFLOWS_OWNING_THEIR_HEADING: ReadonlySet<string> = new Set(['order-to-cash', 'job-work']);

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
  // Written by the panel's Filter button. Read here so a filtered list is a
  // URL somebody can share, and so the back button undoes it. Every string
  // parameter is passed on: each Order-to-Cash tab filters on different fields,
  // and naming them here would mean editing this shared page for each one.
  const filters: Record<string, string> = Object.fromEntries(
    Object.entries(query).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
    ),
  );

  const showStepHeading = !WORKFLOWS_OWNING_THEIR_HEADING.has(workflow.key);

  return (
    // Without a visible heading the section still needs a name, so it is given
    // one directly rather than pointing at an element that is not rendered.
    <section
      {...(showStepHeading ? { 'aria-labelledby': 'step-heading' } : { 'aria-label': step.label })}
    >
      {showStepHeading && (
        <>
          <h2 id="step-heading" className="text-lg font-semibold text-slate-900">
            {step.label}
          </h2>
          {step.purpose && (
            <p className="mt-1 max-w-3xl text-sm text-slate-600">{step.purpose}</p>
          )}
        </>
      )}

      <div className={showStepHeading ? 'mt-5' : undefined}>
        {/* The extension point promised in WORKFLOWS: a step whose `state` is
            'ready' has a screen registered for it and renders it; anything else
            still gets the honest placeholder. */}
        {workflow.key === 'order-to-cash' && step.state === 'ready' ? (
          <OrderToCashStep step={step.key} search={search} filters={filters} />
        ) : step.state === 'ready' ? (
          <BuiltStep workflowKey={workflow.key} stepKey={step.key} query={query} />
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
/** A screen, given the URL it was asked for. */
export type StepQuery = Record<string, string | string[] | undefined>;

const PRODUCTION_STEPS: Record<string, (query: StepQuery) => React.ReactNode> = {
  formulations: () => <FormulationsPanel />,
  'production-orders': () => <ProductionOrdersPanel />,
  'material-issue': () => <MaterialIssuePanel />,
  'batch-record': () => <BatchRecordPanel />,
  'batch-release': () => <BatchReleasePanel />,
};

function BuiltStep({
  workflowKey,
  stepKey,
  query,
}: {
  workflowKey: string;
  stepKey: string;
  /**
   * The URL's query, handed to whichever panel renders.
   *
   * Job Work's lists filter themselves from it — the same `search` and filter
   * keys the Procure-to-Pay screens write, so both use one set of controls.
   */
  query: Record<string, string | string[] | undefined>;
}) {
  const table =
    workflowKey === 'production-quality'
      ? PRODUCTION_STEPS
      : workflowKey === 'job-work'
        ? JOB_WORK_STEPS
        : undefined;

  const render = table?.[stepKey];

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

  return <>{render(query)}</>;
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
