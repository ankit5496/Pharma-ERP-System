'use client';

import { useState, useTransition } from 'react';
import { USER_ROLES, USER_ROLE_LABELS, type UserListItem, type UserRole } from '@pharma-erp/types';

import { RowActionMenu, type RowAction } from '@/components/row-action-menu';

import { resetPasswordAction, updateUserAction } from './actions';

/**
 * Per-row controls: the role picker, and an Actions menu holding reset
 * password and enable/disable.
 *
 * Every one of these is also enforced on the API (`@Roles('ADMIN')`, plus
 * last-admin and self-modification guards). This component's job is to make the
 * outcome visible, not to be the check — a disabled control is a hint, not a
 * boundary.
 */
export function UserRowActions({ user, isSelf }: { user: UserListItem; isSelf: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? 'Something went wrong.');
    });
  }

  const isDisabled = user.status === 'DISABLED';

  // A disabled account can only be brought back; everything else waits until
  // it is enabled again.
  const actions: RowAction[] = isDisabled
    ? [
        {
          label: 'Enable',
          onSelect: () => run(() => updateUserAction(user.id, { status: 'ACTIVE' })),
        },
      ]
    : [
        {
          label: 'Reset password',
          onSelect: () =>
            run(async () => {
              const result = await resetPasswordAction(user.id);
              if (result.ok && result.temporaryPassword) setNewPassword(result.temporaryPassword);
              return result;
            }),
        },
        {
          label: 'Disable',
          tone: 'danger',
          disabledReason: isSelf ? 'You cannot disable your own account.' : null,
          onSelect: () => run(() => updateUserAction(user.id, { status: 'DISABLED' })),
        },
      ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`Role for ${user.fullName}`}
          value={user.role}
          // An Admin changing their own role can lock the company out of user
          // management entirely, so the API refuses it and so does this.
          disabled={isPending || isSelf || isDisabled}
          title={isDisabled ? 'Enable this user to change their role.' : undefined}
          onChange={(event) => {
            const role = event.target.value as UserRole;
            run(() => updateUserAction(user.id, { role }));
          }}
          className="field-sm"
        >
          {USER_ROLES.map((role) => (
            <option key={role} value={role}>
              {USER_ROLE_LABELS[role]}
            </option>
          ))}
        </select>

        <RowActionMenu label={user.fullName} actions={actions} busy={isPending} />
      </div>

      {newPassword && (
        <div className="rounded border border-green-200 bg-green-50 p-2 text-xs text-green-900">
          <p className="font-medium">New temporary password — shown once:</p>
          <code className="mt-1 block rounded border border-green-300 bg-white px-2 py-1 font-mono tracking-wide text-slate-900">
            {newPassword}
          </code>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
