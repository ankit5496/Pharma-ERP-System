'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WORKFLOWS, workflowHref } from '@pharma-erp/types';

/**
 * The four main workflow tabs.
 *
 * A client component purely so it can read `usePathname()` for the active
 * state. The alternative — an `active` prop, as PlatformShell takes — means
 * every page that renders the shell has to remember to pass the right value,
 * and the one that forgets shows no tab as current.
 *
 * Every tab is shown to every role: see the note in @pharma-erp/types
 * workflows.ts on why there is no gating here yet.
 */
export function WorkflowNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Workflows" className="mx-auto max-w-7xl px-4 sm:px-6">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {WORKFLOWS.map((workflow) => {
          // Prefix match, so a sub-tab keeps its parent tab highlighted.
          const isActive = pathname.startsWith(`/workflows/${workflow.key}`);

          return (
            <li key={workflow.key}>
              <Link
                href={workflowHref(workflow.key, workflow.steps[0]?.key)}
                aria-current={isActive ? 'page' : undefined}
                title={workflow.purpose}
                className={`inline-block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'
                }`}
              >
                {workflow.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
