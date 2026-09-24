import type { Metadata } from 'next';
import {
  USER_ROLES,
  USER_ROLE_LABELS,
  type UserAccountStatus,
  type UserListItem,
} from '@pharma-erp/types';

import { AppShell } from '@/components/app-shell';
import { FilterButton, FilterPanel, SearchBox } from '@/components/procurement/filter-bar';
import { EmptyState, ErrorState, Panel, TableWrap, Td, Th } from '@/components/procurement/ui';
import { apiFetch } from '@/lib/api';
import { requireAdminSession } from '@/lib/session';

import { CreateUserForm } from './create-user-form';
import { UserRowActions } from './user-row-actions';

export const metadata: Metadata = { title: 'User settings' };
export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<UserAccountStatus, string> = {
  ACTIVE: 'Active',
  DISABLED: 'Disabled',
  INVITED: 'No password',
};

function param(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

/**
 * Admin user management.
 *
 * `requireAdminSession` redirects a non-Admin, but the real gate is
 * `@Roles('ADMIN')` on the API's users controller — a non-Admin who reached
 * this URL would get a page with an empty table and 403s on every action.
 *
 * Search and filters are applied here rather than by the API: the users
 * endpoint returns the whole company's list, which is short.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const search = param(params.search).toLowerCase();
  const status = param(params.status);
  const role = param(params.role);
  const isFiltered = Boolean(search || status || role);

  const currentUser = await requireAdminSession();
  const result = await apiFetch<UserListItem[]>('/api/v1/users', { authenticated: true });

  const users = result.ok
    ? result.data
        .filter(
          (user) =>
            (!status || user.status === status) &&
            (!role || user.role === role) &&
            (!search ||
              [user.fullName, user.email, user.phone ?? ''].some((field) =>
                field.toLowerCase().includes(search),
              )),
        )
        // Disabled accounts go to the bottom; the API's order is kept otherwise.
        .sort(
          (a, b) => Number(a.status === 'DISABLED') - Number(b.status === 'DISABLED'),
        )
    : [];

  const noun = (count: number) => `user${count === 1 ? '' : 's'}`;
  const subtitle = !result.ok
    ? undefined
    : isFiltered
      ? `${users.length} of ${result.data.length} ${noun(result.data.length)}`
      : `${result.data.length} ${noun(result.data.length)}`;

  return (
    <AppShell user={currentUser}>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">User settings</h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Everyone at {currentUser.tenantName}. You assign roles; nobody chooses their own.
          </p>
        </header>

        <Panel
          title="Users"
          subtitle={subtitle}
          action={
            <>
              <SearchBox placeholder="Search by name, email or phone…" />
              <FilterButton />
              <CreateUserForm />
            </>
          }
        >
          <FilterPanel
            statuses={(Object.keys(STATUS_LABELS) as UserAccountStatus[]).map((value) => ({
              value,
              label: STATUS_LABELS[value],
            }))}
            roles={USER_ROLES.map((value) => ({ value, label: USER_ROLE_LABELS[value] }))}
            showDates={false}
          />

          {!result.ok ? (
            <ErrorState message={`Could not load users: ${result.error}`} />
          ) : users.length === 0 ? (
            <EmptyState
              title="No users yet."
              hint="Use Add user above to create the first one."
              filtered={isFiltered}
            />
          ) : (
            <TableWrap>
              <table className="w-full min-w-[52rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <Th>Name</Th>
                    <Th>Role</Th>
                    <Th>Status</Th>
                    <Th>Last sign-in</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((user) => {
                    const isSelf = user.id === currentUser.id;
                    const isDisabled = user.status === 'DISABLED';
                    // Greys the data, not the Actions cell, so Enable stays readable.
                    const muted = isDisabled ? 'opacity-50' : '';

                    return (
                      <tr key={user.id} className={isDisabled || isSelf ? 'bg-slate-50' : undefined}>
                        <Td className={muted}>
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
                        </Td>

                        <Td className={muted}>
                          <span className="text-slate-700">{USER_ROLE_LABELS[user.role]}</span>
                        </Td>

                        <Td className={muted}>
                          <StatusCell user={user} />
                        </Td>

                        <Td className={muted}>
                          <span className="whitespace-nowrap text-xs text-slate-600">
                            {user.lastLoginAt
                              ? new Date(user.lastLoginAt)
                                  .toISOString()
                                  .slice(0, 16)
                                  .replace('T', ' ')
                              : 'Never'}
                          </span>
                        </Td>

                        <Td>
                          <UserRowActions user={user} isSelf={isSelf} />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>
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
