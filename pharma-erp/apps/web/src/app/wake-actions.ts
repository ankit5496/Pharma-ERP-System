'use server';

import type { HealthCheckResponse } from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

/**
 * How long to hold a single wake request open.
 *
 * Sized to outlast a cold start, measured at 22-53s on the free instance type
 * this deploys to.
 */
const WAKE_TIMEOUT_MS = 60_000;

/**
 * Wakes the API and resolves once it can serve a request.
 *
 * ONE long request, deliberately, rather than a short poll repeated on a timer.
 * The host starts a suspended container when a request arrives and holds that
 * request open until it is ready, so a single patient call is what actually
 * wakes it — and it costs exactly one request.
 *
 * Polling is not merely wasteful here, it is self-defeating. Server-to-server
 * calls leave the private network and re-enter through the public edge (see
 * readApiUrl in lib/env.ts), and the edge rate-limits: a 3-second poll sends
 * ~50 requests during a boot, gets 429 for all of them, and the container never
 * finishes starting. That was observed — 151 seconds of polling left the API at
 * an uptime of zero, while one direct request woke it in 53.
 *
 * `/health/ready` rather than `/health`: it answers 503 until Postgres actually
 * responds, so a true here means a sign-in can complete, not merely that a
 * process is listening.
 *
 * Returns a bare boolean — the caller is deciding whether to enable a button,
 * and anything more would leak infrastructure state onto a public page.
 */
export async function wakeApiAction(): Promise<boolean> {
  const result = await apiFetch<HealthCheckResponse>('/health/ready', {
    timeoutMs: WAKE_TIMEOUT_MS,
  });

  return result.ok;
}
