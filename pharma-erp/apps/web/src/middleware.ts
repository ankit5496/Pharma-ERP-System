import { NextResponse, type NextRequest } from 'next/server';
import {
  AUTH_ROUTES,
  PLATFORM_ROUTES,
  PLATFORM_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '@pharma-erp/types';

import { publicUrl } from '@/lib/public-url';

/** Reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = new Set<string>([AUTH_ROUTES.login]);

/**
 * A cheap edge gate: is there a session cookie at all.
 *
 * Deliberately does NOT validate the token. Verifying a signature or calling
 * the API here would run on every request including assets, and the middleware
 * cannot see whether the account has since been disabled anyway. Real
 * enforcement happens in two places that can be trusted: `requireSession()` in
 * each protected page, and the API's guard, which re-reads the account from
 * Postgres on every request.
 *
 * So this exists purely to avoid rendering a page that is certain to redirect.
 * A forged or expired cookie gets past it and is rejected one hop later.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The sign-out handlers must always run, with or without a session. They are
  // how an INVALID cookie gets cleared, and gating them on having a session
  // would recreate the exact deadlock they exist to break.
  if (pathname === '/logout' || pathname === '/platform/logout') {
    return NextResponse.next();
  }

  // The root decides for itself. It is the only page that inspects BOTH session
  // cookies, so gating it on the tenant cookie here would send a platform
  // operator to a tenant sign-in page for an account they do not have.
  if (pathname === '/') {
    return NextResponse.next();
  }

  // The platform console is a separate surface with its own cookie, so it gets
  // its own gate. Without this branch the tenant check below would bounce a
  // Super User to the tenant login, which is not an account they have.
  if (pathname.startsWith('/platform')) {
    const hasPlatformSession = Boolean(request.cookies.get(PLATFORM_SESSION_COOKIE_NAME)?.value);

    if (pathname === PLATFORM_ROUTES.login) {
      return hasPlatformSession
        ? NextResponse.redirect(publicUrl(PLATFORM_ROUTES.dashboard, request))
        : NextResponse.next();
    }

    return hasPlatformSession
      ? NextResponse.next()
      : NextResponse.redirect(publicUrl(PLATFORM_ROUTES.login, request));
  }

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (PUBLIC_PATHS.has(pathname)) {
    if (hasSession) {
      return NextResponse.redirect(publicUrl(AUTH_ROUTES.afterLogin, request));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    const target = publicUrl(AUTH_ROUTES.login, request);
    // Preserved so a deep link survives sign-in. Only the path and query are
    // kept — taking the whole URL from the request would let an open-redirect
    // parameter ride along.
    if (pathname !== '/') target.searchParams.set('next', pathname);
    return NextResponse.redirect(target);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip Next internals and static assets.
    '/((?!_next|favicon\\.ico|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
  ],
};
