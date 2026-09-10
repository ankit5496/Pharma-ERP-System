'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AUTH_ROUTES, SESSION_COOKIE_NAME, type LoginResponse } from '@pharma-erp/types';

import { apiFetch, isColdStart, COLD_START_MESSAGE } from '@/lib/api';

export interface LoginState {
  /** 'waking' is not a failure: the API is booting and the form retries itself. */
  status: 'idle' | 'error' | 'waking';
  message?: string;
  /** Echoed back so the email survives a failed submit. */
  email?: string;
}

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { status: 'error', message: 'Enter your email and password.', email };
  }

  const result = await apiFetch<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    json: { email, password },
    // argon2 verification is intentionally slow, and a cold API instance may
    // also be waking up — measured at 22-53s on the free instance type this
    // deploys to, which the previous 20s budget could not outlast. A sign-in
    // that expires before the container finishes booting can never succeed,
    // however correct the password.
    timeoutMs: 75_000,
  });

  if (!result.ok) {
    // A sleeping API is a wait, not a refusal, and the two want opposite
    // reactions from the person at the screen.
    if (isColdStart(result)) return { status: 'waking', message: COLD_START_MESSAGE, email };

    // The API returns one generic message for every credential failure, so
    // there is nothing to translate here — passing it through verbatim avoids
    // this layer accidentally becoming more specific than the API intended.
    return { status: 'error', message: result.error, email };
  }

  const store = await cookies();

  store.set(SESSION_COOKIE_NAME, result.data.accessToken, {
    // Unreadable from client-side JavaScript, so an XSS bug cannot steal the
    // session.
    httpOnly: true,
    // Only over TLS in production. Left off locally because localhost is http
    // and a Secure cookie would simply never be stored.
    secure: process.env.NODE_ENV === 'production',
    // 'lax' rather than 'strict': the browser only ever talks to this origin,
    // and 'strict' would drop the cookie on a top-level navigation arriving
    // from an external link, silently signing the user out.
    sameSite: 'lax',
    path: '/',
    maxAge: result.data.expiresInSeconds,
  });

  // A forced password change takes precedence over wherever they were going —
  // the API refuses every other route until it is done.
  redirect(
    result.data.user.mustChangePassword ? AUTH_ROUTES.changePassword : AUTH_ROUTES.afterLogin,
  );
}

/**
 * Clears the session cookie and tells the API, so the sign-out is recorded in
 * the audit trail.
 *
 * The cookie is deleted regardless of whether the API call succeeds: leaving a
 * user apparently signed in because a network hop failed is the worse outcome.
 */
export async function logoutAction(): Promise<void> {
  await apiFetch<void>('/api/v1/auth/logout', {
    method: 'POST',
    authenticated: true,
    timeoutMs: 5_000,
  });

  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);

  redirect(AUTH_ROUTES.afterLogout);
}
