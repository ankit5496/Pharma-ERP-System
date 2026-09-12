'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WORKFLOWS, workflowHref } from '@pharma-erp/types';

/**
 * The four main workflow tabs, plus User settings for administrators.
 *
 * A client component purely so it can read `usePathname()` for the active
 * state. The alternative — an `active` prop, as PlatformShell takes — means
 * every page that renders the shell has to remember to pass the right value,
 * and the one that forgets shows no tab as current.
 *
 * The four workflow tabs are shown to every role: see the note in
 * @pharma-erp/types workflows.ts on why there is no gating there yet.
 *
 * USER SETTINGS IS THE EXCEPTION, and for a plain reason rather than a
 * security one. `/admin/users` redirects anybody who is not an Admin, so
 * showing the tab to everyone would offer most of the company a link that
 * bounces them back where they came from with no explanation. Hiding it is a
 * courtesy, NOT the boundary: the boundary is `@Roles('ADMIN')` on the API's
 * users controller and `requireAdminSession` on the page, both of which hold
 * whatever this component renders.
 */
export function WorkflowNav({ canManageUsers = false }: { canManageUsers?: boolean }) {
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

        {/* Pushed to the right and given a divider, because it is not a fifth
            workflow — it is the setting that decides who may use the other
            four. Grouping it with them would suggest it is a step in the work. */}
        {canManageUsers && (
          <li className="ml-auto flex items-center gap-1 pl-3">
            <span aria-hidden="true" className="h-4 w-px bg-slate-200" />
            <Link
              href={ADMIN_USERS_HREF}
              aria-current={pathname.startsWith('/admin/users') ? 'page' : undefined}
              title="Create staff accounts and assign their roles."
              className={`inline-block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                pathname.startsWith('/admin/users')
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              User settings
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}

const ADMIN_USERS_HREF = '/admin/users';
