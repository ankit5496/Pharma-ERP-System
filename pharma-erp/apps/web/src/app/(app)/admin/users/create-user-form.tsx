'use client';

import { useActionState, useState } from 'react';

import { Disclosure, FormFooter } from '@/components/procurement/form-kit';
import { useActionToast } from '@/components/toast';
import { USER_ROLES, USER_ROLE_LABELS } from '@pharma-erp/types';

import { createUserAction, type UserFormState } from './actions';

const INITIAL: UserFormState = { status: 'idle' };

/**
 * Add a user, in the same dialog as every other create action.
 *
 * No `closeWhen`: the success view holds a one-time password, so the dialog
 * stays open until the Admin has copied it and pressed Done.
 */
export function CreateUserForm() {
  return (
    <Disclosure
      label="Add user"
      title="Add a user"
      subtitle="You choose their role. They'll get a temporary password and must replace it on first sign-in."
      width="40rem"
    >
      {(close) => <CreateUserFields onDone={close} />}
    </Disclosure>
  );
}

function CreateUserFields({ onDone }: { onDone: () => void }) {
  const [state, formAction, isSubmitting] = useActionState(createUserAction, INITIAL);

  // ONLY THE FAILURE IS A TOAST. The success view below hands over a
  // one-time password that is never shown again; moving that into a
  // notification that dismisses itself after four seconds would destroy the
  // credential before anyone could copy it.
  useActionToast(isSubmitting, 'error', state.status === 'error' ? state.message : undefined);
  const [copied, setCopied] = useState(false);

  if (state.status === 'success' && state.temporaryPassword) {
    return (
      <div className="flex grow flex-col">
        <div
          role="status"
          className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900"
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

        <div className="mt-auto flex justify-end border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={onDone}
            className="whitespace-nowrap rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2" noValidate>
      <div>
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

      <div>
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

      <div>
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
          {/* NOT `disabled`: a disabled option cannot hold the selection, so
              the select fell through to the first real role and quietly
              submitted it for someone who had chosen none. On this form that
              would grant a role nobody picked. `required` is what refuses an
              empty choice. */}
          <option value="">Choose a role…</option>
          {USER_ROLES.map((role) => (
            <option key={role} value={role}>
              {USER_ROLE_LABELS[role]}
            </option>
          ))}
        </select>
        <p className="field-hint">Determines what they can see and change.</p>
      </div>

      <div>
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

      <FormFooter onCancel={onDone} className="sm:col-span-2">
        <button
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className="whitespace-nowrap rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {isSubmitting ? 'Creating…' : 'Create user'}
        </button>
      </FormFooter>
    </form>
  );
}
