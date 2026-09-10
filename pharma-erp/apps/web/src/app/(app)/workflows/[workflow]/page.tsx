import { notFound, redirect } from 'next/navigation';
import { findWorkflow, workflowHref } from '@pharma-erp/types';

export const dynamic = 'force-dynamic';

/**
 * A workflow with no step names its first one.
 *
 * A workflow has no content of its own — the steps are the content — so this
 * forwards rather than rendering a landing page nobody would read. It also
 * means `/workflows/job-work` is a durable link even if the first step is
 * later reordered.
 */
export default async function WorkflowIndexPage({
  params,
}: {
  params: Promise<{ workflow: string }>;
}) {
  const { workflow: workflowKey } = await params;
  const workflow = findWorkflow(workflowKey);

  if (!workflow) notFound();

  const first = workflow.steps[0];

  if (!first) notFound();

  redirect(workflowHref(workflow.key, first.key));
}
