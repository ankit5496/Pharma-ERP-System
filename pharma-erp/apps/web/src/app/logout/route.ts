import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_ROUTES, SESSION_COOKIE_NAME } from '@pharma-erp/types';

import { publicUrl } from '@/lib/public-url';

/**
 * Clears the tenant session and returns to sign-in.
 *
 * A Route Handler rather than a page, because only a handler can WRITE cookies —
 * a server component can read them but not delete them. That distinction is
 * what this route exists for.
 *
 * It is the destination for an invalid session, not just a deliberate sign-out.
 * Without it a stale cookie deadlocks the app: the middleware sees a cookie and
 * sends you to the dashboard, the dashboard's session check fails and sends you
 * to sign-in, the middleware sees the cookie again — an infinite redirect that
 * looks exactly like the server being down. Clearing the cookie is the only way
 * to break that cycle, because the middleware cannot tell a dead token from a
 * live one without a round trip on every request.
 */
export async function GET(request: NextRequest) {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);

  const target = publicUrl(AUTH_ROUTES.login, request);

  // Distinguishes "your session ended" from a fresh visit, so the login page can
  // say so rather than leaving the user wondering why they were signed out.
  if (request.nextUrl.searchParams.get('expired') === '1') {
    target.searchParams.set('expired', '1');
  }

  return NextResponse.redirect(target);
}
