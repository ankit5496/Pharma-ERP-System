import type { Metadata } from 'next';
import { USER_ROLE_LABELS, type UserListItem } from '@pharma-erp/types';

import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import { requireAdminSession } from '@/lib/session';

import { CreateUserForm } from './create-user-form';
import { UserRowActions } from './user-row-actions';

export const metadata: Metadata = { title: 'User settings' };
export const dynamic = 'force-dynamic';

/**
 * Admin user management.
 *
 * `requireAdminSession` redirects a non-Admin, but the real gate is
 * `@Roles('ADMIN')` on the API's users controller — a non-Admin who reached
 * this URL would get a page with an empty table and 403s on every action.
 */
export default async function UsersPage() {
  const currentUser = await requireAdminSession();
  const result = await apiFetch<UserListItem[]>('/api/v1/users', { authenticated: true });

  return (
    <AppShell user={currentUser}>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">User settings</h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Everyone at {currentUser.tenantName}. You assign roles; nobody chooses their own.
          </p>
        </header>

        <div className="mb-8">
          <CreateUserForm />
        </div>

        <section
          aria-labelledby="user-list"
          className="rounded-lg border border-slate-200 bg-white shadow-sm"
        >
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 id="user-list" className="text-base font-semibold text-slate-900">
              {result.ok
                ? `${result.data.length} user${result.data.length === 1 ? '' : 's'}`
                : 'Users'}
            </h2>
          </div>

          {!result.ok ? (
            <p className="p-6 text-sm text-red-800">Could not load users: {result.error}</p>
          ) : result.data.length === 0 ? (
            <p className="p-6 text-sm text-slate-600">No users yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th scope="col" className="px-6 py-3 font-medium">
                      Name
                    </th>
                    <th scope="col" className="px-6 py-3 font-medium">
                      Role
                    </th>
                    <th scope="col" className="px-6 py-3 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-6 py-3 font-medium">
                      Last sign-in
                    </th>
                    <th scope="col" className="px-6 py-3 font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.data.map((user) => {
                    const isSelf = user.id === currentUser.id;

                    return (
                      <tr key={user.id} className={isSelf ? 'bg-slate-50' : undefined}>
                        <td className="px-6 py-4 align-top">
                          <p className="font-medium text-slate-900">
                            {user.fullName}
                            {isSelf && (
                              <span className="ml-2 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                                You
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">{user.email}</p>
                          {user.phone && <p className="text-xs text-slate-500">{user.phone}</p>}
                        </td>

                        <td className="px-6 py-4 align-top text-slate-700">
                          {USER_ROLE_LABELS[user.role]}
                        </td>

                        <td className="px-6 py-4 align-top">
                          <StatusCell user={user} />
                        </td>

                        <td className="px-6 py-4 align-top text-xs text-slate-600">
                          {user.lastLoginAt
                            ? new Date(user.lastLoginAt)
                                .toISOString()
                                .slice(0, 16)
                                .replace('T', ' ')
                            : 'Never'}
                        </td>

                        <td className="px-6 py-4 align-top">
                          <UserRowActions user={user} isSelf={isSelf} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="mt-6 text-xs text-slate-500">
          Removing a user is a soft delete: they lose access immediately, and their history stays in
          the audit trail — which is append-only and cannot be edited by anyone, including an
          administrator.
        </p>
      </main>
    </AppShell>
  );
}

function StatusCell({ user }: { user: UserListItem }) {
  const badges: { label: string; className: string }[] = [];

  if (user.status === 'ACTIVE') {
    badges.push({ label: 'Active', className: 'bg-green-50 text-green-800 ring-green-200' });
  } else if (user.status === 'DISABLED') {
    badges.push({ label: 'Disabled', className: 'bg-slate-100 text-slate-600 ring-slate-200' });
  } else {
    badges.push({ label: 'No password', className: 'bg-amber-50 text-amber-800 ring-amber-200' });
  }

  // Two states worth surfacing because they explain a support call: someone who
  // cannot get past the password screen, and someone locked out by failed attempts.
  if (user.mustChangePassword) {
    badges.push({
      label: 'Must change password',
      className: 'bg-amber-50 text-amber-800 ring-amber-200',
    });
  }

  if (user.isLocked) {
    badges.push({ label: 'Locked out', className: 'bg-red-50 text-red-800 ring-red-200' });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {badges.map((badge) => (
        <span
          key={badge.label}
          className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${badge.className}`}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}
