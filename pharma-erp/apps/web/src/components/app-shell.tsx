import type { ReactNode } from 'react';

import { logoutAction } from '@/app/(auth)/login/actions';
import { WorkflowNav } from '@/components/workflow-nav';
import {
  READ_ONLY_ROLES,
  USER_ROLE_LABELS,
  canManageUsers,
  type SessionUser,
} from '@pharma-erp/types';

/**
 * Chrome for every signed-in staff page: company header, the four workflow
 * tabs, the account block and the record-browser dropdown.
 *
 * The navigation is the four workflows and nothing else. The previous
 * per-module menu (Dashboard, Items & parties, Purchase, …) was mostly
 * disabled placeholder rows; the workflows say the same thing in terms of the
 * work rather than in terms of the tables, and the steps that were placeholders
 * are now sub-tabs where they belong. Nothing was deleted to achieve that —
 * /dashboard and /admin/users still resolve, and the API is untouched.
 *
 * Every tab is visible to every role for now, deliberately. Worth restating
 * because the old comment here claimed otherwise: hiding a link was never the
 * security boundary. RolesGuard and row-level security are, and both still
 * hold regardless of what this renders.
 */
export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const isReadOnly = READ_ONLY_ROLES.includes(user.role);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              Pharma ERP
            </p>
            <p className="truncate text-sm font-semibold text-slate-900">{user.tenantName}</p>
          </div>

          {/* The account block. A raw-table picker used to sit beneath it;
              it was removed because browsing tables is not something staff do
              as part of their work, and offering it beside their own name
              invited it. The /data routes still resolve for anyone who needs
              them. */}
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <div className="min-w-0 text-left sm:text-right">
              <p className="truncate text-sm font-medium text-slate-900">{user.fullName}</p>
              <p className="truncate text-xs text-slate-500">{USER_ROLE_LABELS[user.role]}</p>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                className="whitespace-nowrap rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        {/* The User settings tab is offered only to roles that can actually
            use it. See the note in WorkflowNav: this is a courtesy, not the
            access control. */}
        <WorkflowNav canManageUsers={canManageUsers(user.role)} />
      </header>

      {isReadOnly && (
        <p
          role="status"
          className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-center text-xs font-medium text-amber-900"
        >
          Read-only access — you can view every module but cannot create or change records.
        </p>
      )}

      {user.status === 'INVITED' && (
        <p
          role="status"
          className="border-b border-slate-200 bg-slate-100 px-6 py-2 text-center text-xs font-medium text-slate-700"
        >
          Your account is pending activation by an administrator.
        </p>
      )}

      {children}
    </div>
  );
}
