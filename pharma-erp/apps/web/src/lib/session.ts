import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import {
  AUTH_ROUTES,
  SESSION_COOKIE_NAME,
  canManageUsers,
  type SessionUser,
} from '@pharma-erp/types';

import { apiFetch, type ApiResult } from './api';

/**
 * Reads the session token from its httpOnly cookie.
 *
 * The token lives in a cookie on the WEB origin, not in localStorage and not in
 * a header the browser sets. Three consequences worth knowing:
 *   - `httpOnly` means client-side JavaScript cannot read it, so an XSS bug
 *     cannot exfiltrate the session.
 *   - The browser never calls the API directly; server components and server
 *     actions forward the token as a Bearer header. So there is no CORS
 *     configuration to get wrong, and no cross-site cookie for a browser's
 *     tracking protection to drop.
 *   - It is only readable in a server context. Nothing client-side can reach it.
 */
export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value ?? null;
}

/**
 * Fetches the current user from the API, or null when not signed in.
 *
 * WRAPPED IN `cache()`, which deduplicates it for the duration of ONE server
 * render. A layout and the page inside it both call `requireSession`, and
 * without this that is two `/auth/me` calls per navigation — two API requests,
 * two database round trips, and two connections held out of a pool that every
 * other query on the page is also drawing from. It is not a cross-request
 * cache: each new request still authenticates for itself.
 */
export const getSession = cache(async function getSession(): Promise<ApiResult<SessionUser>> {
  return apiFetch<SessionUser>('/api/v1/auth/me', { authenticated: true });
});

/**
 * Session for a page that requires a fully signed-in user.
 *
 * Redirects rather than returning an error, because each failure has exactly
 * one correct destination and every protected page wants the same one:
 *   - no session / expired    -> /login
 *   - must change password    -> /change-password
 *
 * Call this at the top of a protected server component. It never returns a
 * half-valid session.
 */
export async function requireSession(): Promise<SessionUser> {
  const result = await getSession();

  if (!result.ok) {
    // 401 covers no cookie, an expired token and a deleted account. Routed
    // through /logout rather than straight to /login: the cookie must be
    // CLEARED first, or the middleware sees it again on the login page and
    // redirects back here — an infinite loop that looks like a dead server.
    if (result.status === 401) redirect('/logout?expired=1');
    // 403 is a disabled account or the must-change-password gate. The session is
    // valid, so the cookie stays.
    if (result.status === 403) redirect(AUTH_ROUTES.changePassword);

    // Anything else — the API is down, a 500, a timeout — is not something the
    // user can fix by navigating, so surface it instead of looping.
    throw new Error(`Could not load your session: ${result.error}`);
  }

  if (result.data.mustChangePassword) {
    redirect(AUTH_ROUTES.changePassword);
  }

  return result.data;
}

/**
 * Session for the change-password page: requires a signed-in user but tolerates
 * — indeed expects — the must-change-password state, which every other page
 * refuses.
 */
export async function requireSessionAllowingPasswordChange(): Promise<SessionUser> {
  const result = await getSession();

  if (!result.ok) {
    // Same reason as requireSession: clear the cookie before returning to the
    // login page, or the middleware bounces straight back here.
    if (result.status === 401) redirect('/logout?expired=1');
    throw new Error(`Could not load your session: ${result.error}`);
  }

  return result.data;
}

/**
 * Session for a page only an Admin may open.
 *
 * The check is duplicated on the API — `@Roles('ADMIN')` on the users
 * controller — and that is the one that matters. This exists so a
 * non-Admin gets a redirect rather than a page that renders and then fails
 * every request inside it.
 */
export async function requireAdminSession(): Promise<SessionUser> {
  const user = await requireSession();

  if (!canManageUsers(user.role)) {
    redirect(AUTH_ROUTES.afterLogin);
  }

  return user;
}
