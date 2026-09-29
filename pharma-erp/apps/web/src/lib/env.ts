/**
 * Validates the web app's environment at module load, which happens during
 * `next build` and at the start of `next dev` — so a missing variable is a
 * build/boot failure rather than a broken page at runtime.
 *
 * Hand-rolled rather than schema-library-based on purpose: this runs in the
 * client bundle too, and there is no reason to ship a validator to the browser
 * for two variables.
 *
 * Server-only in practice: browser code must use `browserApiBase()` from
 * ./api-url instead, because the module-level validation below throws when
 * neither variable reaches the bundle — which is the merged deployment's
 * normal state, since it sets only the runtime API_URL.
 */

import { hasScheme, withDefaultScheme } from './api-url';

interface WebEnv {
  /** Base URL of the API, no trailing slash. */
  readonly apiUrl: string;
  readonly isProduction: boolean;
}

function readApiUrl(): string {
  // API_URL wins when set, and is the one to use on a host with a private
  // network.
  //
  // Only apiFetch reads this, and apiFetch is server-only — it imports
  // `cookies` from next/headers, which cannot run in a browser. So the API's
  // address never needs to be publicly reachable, and routing service-to-service
  // traffic through the public hostname means every page render leaves the
  // platform's network and comes back in through its edge. That is slower, and
  // it is subject to edge rate limiting: enough traffic and the API starts
  // answering 429 to its own web app, which looks nothing like a configuration
  // choice when you read it in a log.
  //
  // API_URL is a plain runtime lookup, so it is NOT inlined at build time —
  // changing it needs a restart rather than a rebuild, unlike the variable
  // below.
  //
  // NEXT_PUBLIC_API_URL remains the fallback, and must stay a static property
  // access: that is what lets Next replace it at build time. `process.env[key]`
  // would silently be undefined in the browser.
  const raw = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;

  if (!raw || raw.trim() === '') {
    throw new Error(
      [
        'Neither API_URL nor NEXT_PUBLIC_API_URL is set.',
        '  Local:  copy .env.example to .env at the repo root, set NEXT_PUBLIC_API_URL to',
        '          http://localhost:4000',
        '  Hosted: prefer API_URL on the WEB service, pointing at the API over the private',
        '          network (on Render: http://<api-service-name>:<port>). It is read at',
        '          runtime, so a change needs only a restart.',
        '          NEXT_PUBLIC_API_URL still works, but is inlined at BUILD time and sends',
        '          every request out through the public edge.',
      ].join('\n'),
    );
  }

  // Name the variable the value actually came from, so an error is actionable
  // when both are present.
  const source = process.env.API_URL ? 'API_URL' : 'NEXT_PUBLIC_API_URL';

  let trimmed = raw.trim().replace(/\/+$/, '');

  if (!hasScheme(trimmed)) {
    // A missing scheme is tolerated ONLY for NEXT_PUBLIC_API_URL, because
    // Render's Blueprint `fromService` exposes a service's address as `host` — a
    // hostname with no scheme ("pharma-erp-api.onrender.com"), and no property
    // includes one. Rejecting that would make the auto-wiring in render.yaml
    // unusable.
    //
    // API_URL is set by hand and must be explicit, because guessing is actively
    // harmful here: a private-network address like "pharma-erp-api:10000" has
    // no scheme, is not loopback, and would be upgraded to https — which the
    // private network does not serve. The failure would then look like a
    // TLS or connection error rather than a rewritten URL.
    if (source === 'API_URL') {
      throw new Error(
        [
          `API_URL must include a scheme (received: ${raw}).`,
          '  Private network: http://<api-service-name>:<port>',
          '  Public URL:      https://<api-service-name>.onrender.com',
          '  No scheme is assumed for API_URL: a private address is plain http, and',
          '  silently upgrading it to https produces an error that looks nothing like',
          '  its cause.',
        ].join('\n'),
      );
    }

    // localhost must NOT be upgraded to https: a local API serves plain http.
    trimmed = withDefaultScheme(trimmed);
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${source} is not a usable URL or hostname (received: ${raw}).`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${source} must be http or https (received protocol: ${parsed.protocol}).`);
  }

  return trimmed;
}

export const env: WebEnv = {
  apiUrl: readApiUrl(),
  isProduction: process.env.NODE_ENV === 'production',
};
