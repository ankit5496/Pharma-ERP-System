'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { workflowHref, type Workflow } from '@pharma-erp/types';

/**
 * Sub-tabs for one workflow, generated from its `steps` list.
 *
 * Rendered as a scrolling pill row rather than a second underline bar, so the
 * two levels of navigation are distinguishable at a glance instead of relying
 * on the reader noticing which line is which.
 *
 * Scales by construction: a step added to WORKFLOWS appears here and gets a
 * working route with no change to this file.
 */
export function WorkflowSubnav({ workflow }: { workflow: Workflow }) {
  const pathname = usePathname();

  return (
    <nav aria-label={`${workflow.label} steps`} className="overflow-x-auto">
      <ol className="flex min-w-max gap-1.5">
        {workflow.steps.map((step, index) => {
          const href = workflowHref(workflow.key, step.key);
          const isActive = pathname === href;

          return (
            <li key={step.key}>
              <Link
                href={href}
                aria-current={isActive ? 'page' : undefined}
                title={step.purpose}
                className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  isActive
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                }`}
              >
                {/* The step number is what makes this read as a sequence rather
                    than an unordered set of links — these steps happen in order. */}
                <span
                  className={`tabular-nums ${isActive ? 'text-slate-400' : 'text-slate-400'}`}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                {step.label}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
