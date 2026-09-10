'use client';

import { useActionState, useEffect, useRef } from 'react';

import { useApiWake } from '@/lib/use-api-wake';

import { platformLoginAction, type PlatformLoginState } from '../actions';

const INITIAL: PlatformLoginState = { status: 'idle' };

export function PlatformLoginForm() {
  const [state, formAction, isSubmitting] = useActionState(platformLoginAction, INITIAL);

  const isWaking = state.status === 'waking';

  // Wakes the API in the background while the operator waits. Deliberately not
  // an automatic resubmit: React 19 resets an uncontrolled form once its action
  // completes, so the password field is already empty here — resubmitting would
  // send nothing, and holding the password in state to prevent that would put a
  // live credential somewhere it does not belong.
  const { phase, seconds } = useApiWake(isWaking, state);

  const ready = phase === 'ready';
  const unreachable = phase === 'unreachable';
  const stillWaiting = isWaking && !ready && !unreachable;

  // Once the API is up, the only thing left to do is retype the password — so
  // put the cursor there rather than making them find it.
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ready) passwordRef.current?.focus();
  }, [ready]);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {/* Amber and role="status": progress being reported, not a failure. A
          screen reader should hear it politely rather than be interrupted. */}
      {stillWaiting && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200"
        >
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-300"
            />
            <div>
              <p className="font-medium">
                The server is waking up. This can take up to a minute after a period of inactivity.
              </p>
              <p className="mt-1 text-amber-200/70">
                Starting it now — {seconds}s. You can sign in as soon as this clears.
              </p>
            </div>
          </div>
        </div>
      )}

      {isWaking && ready && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200"
        >
          <p className="font-medium">The server is ready.</p>
          <p className="mt-1 text-emerald-200/70">Enter your password again and sign in.</p>
        </div>
      )}

      {isWaking && unreachable && (
        <div
          role="alert"
          className="rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200"
        >
          <p className="font-medium">The server did not start.</p>
          <p className="mt-1 text-red-200/70">
            It has been {seconds} seconds, which is longer than a normal start. Check the service
            logs before trying again.
          </p>
        </div>
      )}

      {state.status === 'error' && state.message && (
        <div
          role="alert"
          className="rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200"
        >
          {state.message}
        </div>
      )}

      <div>
        <label htmlFor="email" className="field-label-dark">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          autoFocus
          defaultValue={state.email ?? ''}
          className="field-dark mt-1.5"
        />
      </div>

      <div>
        <label htmlFor="password" className="field-label-dark">
          Password
        </label>
        <input
          ref={passwordRef}
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="field-dark mt-1.5"
        />
      </div>

      <button
        type="submit"
        // Disabled only while there is genuinely nothing to send: mid-request,
        // or while the API is still coming up. Once it is ready — or has failed
        // to start — the button is theirs again.
        disabled={isSubmitting || stillWaiting}
        className="w-full rounded-md bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-500"
      >
        {isSubmitting
          ? 'Signing in…'
          : stillWaiting
            ? 'Waiting for the server…'
            : 'Sign in to console'}
      </button>
    </form>
  );
}
