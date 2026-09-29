import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { PLATFORM_ROUTES, PLATFORM_SESSION_COOKIE_NAME } from '@pharma-erp/types';

import { publicUrl } from '@/lib/public-url';

/**
 * Clears the platform session and returns to the console sign-in.
 *
 * Same reasoning as /logout: only a Route Handler can delete a cookie, and an
 * invalid platform cookie would otherwise deadlock the console the same way.
 * Deliberately does NOT touch the tenant cookie — the two sessions are
 * independent, and signing out of the console should not sign an operator out
 * of a customer's application in another tab.
 */
export async function GET(request: NextRequest) {
  const store = await cookies();
  store.delete(PLATFORM_SESSION_COOKIE_NAME);

  const target = publicUrl(PLATFORM_ROUTES.login, request);

  if (request.nextUrl.searchParams.get('expired') === '1') {
    target.searchParams.set('expired', '1');
  }

  return NextResponse.redirect(target);
}
