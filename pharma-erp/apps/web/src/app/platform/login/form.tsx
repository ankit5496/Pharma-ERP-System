'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { platformLoginAction, type PlatformLoginState } from '../actions';

const INITIAL: PlatformLoginState = { status: 'idle' };

/**
 * How many times to resubmit on our own before handing back to the operator.
 *
 * The request itself already waits 75s, which covers a normal cold start, so
 * these retries exist for the case that fails *fast*: the edge answering 429 or
 * 502 because there is no instance to route to yet. Three attempts five seconds
 * apart covers that without leaving someone staring at a spinner for minutes.
 */
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5_000;

export function PlatformLoginForm() {
  const [state, formAction, isSubmitting] = useActionState(platformLoginAction, INITIAL);

  // requestSubmit() rather than calling the action directly: it re-reads the
  // live form, so the password field — which is never cleared on failure — is
  // resent without this component ever holding the credential in state.
  const formRef = useRef<HTMLFormElement>(null);
  const [retries, setRetries] = useState(0);

  const isWaking = state.status === 'waking';
  const retriesLeft = isWaking && retries < MAX_RETRIES;

  useEffect(() => {
    if (!retriesLeft) return;

    const timer = setTimeout(() => {
      setRetries((attempt) => attempt + 1);
      formRef.current?.requestSubmit();
    }, RETRY_DELAY_MS);

    // Cleared if the operator submits by hand first, so two requests never race.
    return () => clearTimeout(timer);
    // `state` by identity, not by field: every submit produces a fresh object,
    // which is what makes a repeated 'waking' result schedule the next attempt.
  }, [state, retriesLeft]);

  // A manual submit is a fresh start, so the automatic attempts start over too.
  const handleSubmit = () => setRetries(0);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={handleSubmit}
      className="space-y-5"
      noValidate
    >
      {/* Amber, not red, and role="status" rather than "alert": this is progress
          being reported, not a failure. A screen reader should hear it politely,
          without interrupting. */}
      {isWaking && (
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
              <p className="font-medium">{state.message}</p>
              <p className="mt-1 text-amber-200/70">
                {retriesLeft
                  ? `Retrying automatically — attempt ${retries + 1} of ${MAX_RETRIES}.`
                  : 'Still starting. Wait a few seconds and press Sign in again.'}
              </p>
            </div>
          </div>
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
        // Left enabled once the automatic attempts are spent, so the operator is
        // never stuck with a dead button and no way to try again.
        disabled={isSubmitting || retriesLeft}
        className="w-full rounded-md bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-500"
      >
        {isSubmitting
          ? 'Signing in…'
          : retriesLeft
            ? 'Waiting for the server…'
            : 'Sign in to console'}
      </button>
    </form>
  );
}
