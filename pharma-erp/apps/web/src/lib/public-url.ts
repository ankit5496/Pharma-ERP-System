import type { NextRequest } from 'next/server';

/**
 * Builds an absolute URL on the origin the BROWSER used, for redirects.
 *
 * `new URL(path, request.url)` is not enough behind the merged server
 * (apps/server). A custom Next.js server builds `request.url` from the hostname
 * and port it was constructed with, which default to localhost:3000 — while the
 * protocol comes from the proxy's x-forwarded-proto. On Render that produced
 * redirects to https://localhost:3000/login. The Host header is what the
 * browser actually asked for, so the origin is rebuilt from it.
 *
 * x-forwarded-host is deliberately NOT trusted: a client can set it, and it
 * would turn every redirect into one pointing wherever that header says.
 */
export function publicUrl(path: string, request: NextRequest): URL {
  const host = request.headers.get('host');

  if (!host) return new URL(path, request.url);

  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol =
    forwardedProto === 'http' || forwardedProto === 'https'
      ? forwardedProto
      : request.nextUrl.protocol.replace(/:$/, '');

  return new URL(path, `${protocol}://${host}`);
}
