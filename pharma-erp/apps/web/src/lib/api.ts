import { cookies } from 'next/headers';

import { SESSION_COOKIE_NAME, type HealthCheckResponse } from '@pharma-erp/types';

import { env } from './env';

/** Shape returned to the UI so a failed call renders as data, not an exception. */
export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; status: number | null; error: string };

/**
 * How long to wait for the API before giving up.
 *
 * Raised from 5s once the database moved to a managed host in another region.
 * The web app talks to a local API, so the hop itself is still fast — but the
 * API's own work is not: every tenant-scoped operation costs an extra round
 * trip to set `app.current_tenant_id`, and a page like Incoming QC issues
 * several queries with deep includes. Against Postgres on localhost that is a
 * few milliseconds; against Oregon it is hundreds each, and `/auth/me` alone
 * was exceeding the old 5s budget.
 *
 * Still deliberately finite. This delay is paid on every page load when the
 * API is genuinely down, and a page that fails in thirty seconds is far more
 * useful than one that hangs.
 *
 * MEASURED, so the number is not a guess. From a development machine in India
 * against the database in Oregon:
 *
 *   plain query to Postgres      281 ms
 *   one tenant-scoped operation  1241 ms   <- four round trips, not one
 *
 * The multiplier is the cost of correctness: `BEGIN`, `set_config`, the query
 * itself, `COMMIT`. A list endpoint that reads rows and then resolves the user
 * names on them cannot avoid doing that twice in sequence, so five seconds for
 * one screen is arithmetic rather than a defect, and 15s was being exceeded.
 *
 * THIS IS A DEVELOPMENT-ONLY COST. Deployed on Render alongside the database,
 * the same round trip is under a millisecond and the same page is fast. Raising
 * this further would be treating the symptom; if it is ever hit in production,
 * the cause is real and the answer is fewer round trips, not a bigger number.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Statuses that mean "nothing is serving this yet" rather than "the API said
 * no".
 *
 * These are answered by the host's edge, not by the API: a service whose
 * container has been suspended for inactivity has no instance to route to, so
 * the edge replies itself — 429 when it sheds the requests piling up during a
 * boot, 5xx while the container is still coming up. The API's own errors are
 * always JSON and carry a message, so they never surface as a bare status here.
 *
 * 500 is deliberately absent: that is a real application fault, and telling
 * someone to wait for it to finish starting would be a lie.
 */
const COLD_START_STATUSES = new Set([429, 502, 503, 504]);

/** Connection-level failures that mean the API is not listening *yet*. */
const COLD_START_PREFIXES = ['Timed out after', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN'];

/**
 * Shown when {@link isColdStart} matches. Phrased as a wait rather than a
 * failure, because that is what it is.
 */
export const COLD_START_MESSAGE =
  'The server is waking up. This can take up to a minute after a period of inactivity.';

/**
 * Whether a failed call looks like the API being asleep rather than refusing.
 *
 * Worth distinguishing because the two need opposite reactions from the person
 * at the screen: a real error means stop and read it, a cold start means wait a
 * moment. Rendering "429 Too Many Requests" for the latter sends people looking
 * for a rate limit that does not exist — this codebase has no throttler.
 */
export function isColdStart(result: ApiResult<unknown>): boolean {
  if (result.ok) return false;

  if (result.status !== null) return COLD_START_STATUSES.has(result.status);

  // No status at all: the request never completed. Either it outlived its
  // budget while the container booted, or nothing was listening to accept it.
  return COLD_START_PREFIXES.some((prefix) => result.error.startsWith(prefix));
}

/**
 * How often to retry a request that never reached the API, and how long to wait
 * between attempts (multiplied by the attempt number, so 300ms, 600ms, 900ms).
 *
 * Sized from this project's measured restart time: an incremental
 * `nest start --watch` rebuild logs "File change detected" and is listening
 * again 1-2s later. A 900ms budget was tried first and was too short to cover
 * that, so the total is ~1.8s across four attempts.
 *
 * Deliberately not longer. This delay is also paid on every page load when the
 * API is genuinely down, and a page that fails in under two seconds is far more
 * useful than one that hangs while retrying something that will not recover.
 */
const CONNECTION_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 300;

/**
 * Methods that may be retried after a connection was established and then
 * broke. A GET can always be repeated; a POST cannot, because the server may
 * have already acted on it.
 */
const REPLAYABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The OS-level error code behind a failed fetch, or null if this was not a
 * connection failure.
 *
 * undici throws a bare `TypeError: fetch failed` and puts the real reason on
 * `cause`. With a hostname that resolves to several addresses — `localhost` is
 * both ::1 and 127.0.0.1 — `cause` is an AggregateError whose `errors` hold one
 * failure per address; its own `code` is set when they agree, so prefer it and
 * fall back to the first entry.
 */
function connectionErrorCode(error: unknown): string | null {
  if (!(error instanceof Error) || !(error.cause instanceof Error)) return null;

  const cause = error.cause as Error & { code?: string; errors?: unknown };

  if (cause.code) return cause.code;

  if (Array.isArray(cause.errors)) {
    for (const entry of cause.errors) {
      const code: unknown = (entry as { code?: unknown } | null)?.code;

      if (typeof code === 'string') return code;
    }
  }

  return null;
}

interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  timeoutMs?: number;
  /** Serialised as JSON with the appropriate content type. */
  json?: unknown;
  /**
   * Attach the caller's session token from its httpOnly cookie. Server-side
   * only: `cookies()` reads the request via Next's async context and is
   * unavailable in the browser — deliberately, since the token must never be
   * reachable from client-side JavaScript.
   */
  authenticated?: boolean;
}

/**
 * Thin fetch wrapper for the NestJS API.
 *
 * Returns a result object rather than throwing: an unreachable API or a 403 is
 * an expected state that a page has to render, and modelling it as data keeps
 * the handling next to the message the user actually sees.
 */
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<ApiResult<T>> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, json, authenticated = false, ...init } = options;
  const url = `${env.apiUrl}${path.startsWith('/') ? path : `/${path}`}`;

  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');

  if (json !== undefined) headers.set('Content-Type', 'application/json');

  if (authenticated) {
    const token = await getSessionToken();

    if (!token) {
      return { ok: false, status: 401, error: 'Not signed in.' };
    }

    headers.set('Authorization', `Bearer ${token}`);
  }

  const method = (init.method ?? 'GET').toUpperCase();
  const body = json === undefined ? undefined : JSON.stringify(json);

  let lastError: unknown;
  let lastCode: string | null = null;

  for (let attempt = 0; ; attempt++) {
    // A fresh timeout per attempt, and AbortSignal.timeout rather than a manual
    // controller + setTimeout: it cannot leak a pending timer if the request
    // settles first. Reusing one signal across attempts would mean the second
    // attempt inherits an already-spent budget.
    const signal = init.signal ?? AbortSignal.timeout(timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal,
        headers,
        body,
        // Anything behind a session is per-user and must never be shared from a
        // cache. Callers that want caching should say so explicitly.
        cache: init.cache ?? 'no-store',
      });

      if (!response.ok) {
        return { ok: false, status: response.status, error: await readErrorMessage(response) };
      }

      // 204 and friends have no body to parse.
      if (response.status === 204) return { ok: true, data: undefined as T };

      return { ok: true, data: (await response.json()) as T };
    } catch (error) {
      lastError = error;

      // Not retried: the server may still be working on it, and the caller set
      // this budget deliberately.
      if (error instanceof DOMException && error.name === 'TimeoutError') break;

      lastCode = connectionErrorCode(error);

      // ECONNREFUSED means no connection was ever established, so the API
      // cannot have seen the request — safe to repeat whatever the method.
      // ECONNRESET means it was established and then broke, so a POST may
      // already have been acted on; only replay the safe methods.
      const worthRetrying =
        lastCode === 'ECONNREFUSED' ||
        ((lastCode === 'ECONNRESET' || lastCode === 'EAI_AGAIN') && REPLAYABLE_METHODS.has(method));

      // A caller-supplied signal owns its own lifecycle; retrying behind its
      // back would outlive whatever it is tied to.
      if (!worthRetrying || attempt >= CONNECTION_RETRIES || init.signal) break;

      await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
    }
  }

  if (lastError instanceof DOMException && lastError.name === 'TimeoutError') {
    return {
      ok: false,
      status: null,
      error: `Timed out after ${timeoutMs}ms — is the API running? (${url})`,
    };
  }

  // Report the OS-level code, not undici's bare "fetch failed", which reads
  // identically whether the API is down, mid-restart, or the hostname is wrong.
  if (lastCode) {
    const hint =
      lastCode === 'ECONNREFUSED' || lastCode === 'ECONNRESET'
        ? ' — the API is not accepting connections (starting up, restarting, or not running)'
        : '';

    return { ok: false, status: null, error: `${lastCode}${hint} — ${url}` };
  }

  return {
    ok: false,
    status: null,
    error: lastError instanceof Error ? `${lastError.message} — ${url}` : `Unknown error — ${url}`,
  };
}

/**
 * The session token for the current server request, from its httpOnly cookie.
 *
 * Returns null rather than throwing when called outside a request context, so a
 * component rendered at build time degrades to "not signed in" instead of
 * failing the build — which is exactly what happens during  when
 * Next collects page data.
 */
async function getSessionToken(): Promise<string | null> {
  try {
    const store = await cookies();
    return store.get(SESSION_COOKIE_NAME)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Pulls a human-usable message out of a Nest error response.
 *
 * Nest's exception filter returns `{ message: string | string[], error, statusCode }`,
 * and the array form is what the ValidationPipe produces — one entry per failed
 * constraint. Joining them is what turns a 400 into something a form can show.
 */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();

    if (body && typeof body === 'object' && 'message' in body) {
      const message = (body as { message: unknown }).message;

      if (Array.isArray(message)) return message.join('. ');
      if (typeof message === 'string' && message.length > 0) return message;
    }
  } catch {
    // Not JSON — fall through to the status line.
  }

  return `${response.status} ${response.statusText || 'Request failed'}`;
}

/** Calls the API's unauthenticated health endpoint. */
export async function fetchHealth(): Promise<ApiResult<HealthCheckResponse>> {
  return apiFetch<HealthCheckResponse>('/health');
}
