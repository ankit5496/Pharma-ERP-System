'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WORKFLOWS, findSectionForPath, workflowHref } from '@pharma-erp/types';

/**
 * The header's tab row: the four workflows.
 *
 * Renders nothing inside Master Data, where the registers are a rail beside
 * the form instead. The alternative was to keep showing the workflow tabs
 * there, but none of them would be current — and a tab bar with no tab
 * selected reads as a bug rather than as "you are somewhere else".
 *
 * A client component purely to read `usePathname()`. The alternative — an
 * `active` prop, as PlatformShell takes — means every page rendering the shell
 * has to pass the right value, and the one that forgets shows no tab as
 * current. This one cannot be got wrong from a call site.
 */
export function PrimaryNav() {
  const pathname = usePathname();

  if (findSectionForPath(pathname)?.key === 'master-data') return null;

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
