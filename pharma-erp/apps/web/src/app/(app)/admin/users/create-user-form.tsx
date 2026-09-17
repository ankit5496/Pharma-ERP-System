'use client';

import { useActionState, useState } from 'react';

import { useActionToast } from '@/components/toast';
import { USER_ROLES, USER_ROLE_LABELS } from '@pharma-erp/types';

import { createUserAction, type UserFormState } from './actions';

const INITIAL: UserFormState = { status: 'idle' };

export function CreateUserForm() {
  const [state, formAction, isSubmitting] = useActionState(createUserAction, INITIAL);

  // ONLY THE FAILURE IS A TOAST. The success panel below hands over a
  // one-time password that is never shown again; moving that into a
  // notification that dismisses itself after four seconds would destroy the
  // credential before anyone could copy it. An error message has no such
  // content and belongs with every other error in the application.
  useActionToast(isSubmitting, 'error', state.status === 'error' ? state.message : undefined);
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Add a user</h2>
      <p className="mt-1 text-sm text-slate-600">
        You choose their role. They&rsquo;ll get a temporary password and must replace it on first
        sign-in.
      </p>

      {state.status === 'success' && state.temporaryPassword && (
        <div
          role="status"
          className="mt-5 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900"
        >
          <p className="font-medium">{state.message}</p>
          <p className="mt-2">Give them this temporary password:</p>

          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded border border-green-300 bg-white px-3 py-2 font-mono text-sm tracking-wide text-slate-900">
              {state.temporaryPassword}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(state.temporaryPassword ?? '');
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="rounded border border-green-300 bg-white px-3 py-2 text-xs font-semibold text-green-900 hover:bg-green-100"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          {/* Said plainly because it is genuinely true: the API stores only an
              argon2 hash, so nobody — including you — can retrieve this later. */}
          <p className="mt-3 text-xs">
            This is shown once and cannot be recovered. If you lose it, use{' '}
            <strong>Reset password</strong> on their row to set a new one.
          </p>
        </div>
      )}

      <form action={formAction} className="mt-5 grid gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-1">
          <label htmlFor="fullName" className="field-label">
            Full name <span className="text-red-600">*</span>
          </label>
          <input
            id="fullName"
            name="fullName"
            required
            maxLength={255}
            autoComplete="off"
            defaultValue={state.values?.fullName ?? ''}
            className="field mt-1.5"
          />
        </div>

        <div className="sm:col-span-1">
          <label htmlFor="email" className="field-label">
            Email <span className="text-red-600">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            maxLength={320}
            autoComplete="off"
            defaultValue={state.values?.email ?? ''}
            className="field mt-1.5"
          />
          <p className="field-hint">This is what they sign in with.</p>
        </div>

        <div className="sm:col-span-1">
          <label htmlFor="role" className="field-label">
            Role <span className="text-red-600">*</span>
          </label>
          <select
            id="role"
            name="role"
            required
            defaultValue={state.values?.role ?? ''}
            className="field mt-1.5"
          >
            <option value="" disabled>
              Choose a role…
            </option>
            {USER_ROLES.map((role) => (
              <option key={role} value={role}>
                {USER_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          <p className="field-hint">Determines what they can see and change.</p>
        </div>

        <div className="sm:col-span-1">
          <label htmlFor="phone" className="field-label">
            Phone
          </label>
          <input
            id="phone"
            name="phone"
            maxLength={32}
            autoComplete="off"
            defaultValue={state.values?.phone ?? ''}
            className="field mt-1.5"
          />
        </div>

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {isSubmitting ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>
    </div>
  );
}
