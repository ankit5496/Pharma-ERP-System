'use server';

import type { HealthCheckResponse } from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

/**
 * Whether the API can serve a request right now.
 *
 * Exists so a sign-in page can wait for a sleeping API without holding the
 * caller's password while it does. `/health/ready` rather than `/health`: it
 * answers 503 until Postgres actually responds, so a true here means the stack
 * can complete a sign-in, not merely that a process is listening.
 *
 * A server action rather than a route handler, so the API's address stays on
 * the server and no new public endpoint appears on the web app.
 *
 * Returns a plain boolean deliberately — the caller is deciding whether to
 * enable a button, and any detail beyond that would be an invitation to leak
 * infrastructure state onto a page anyone can load.
 */
export async function checkApiReadyAction(): Promise<boolean> {
  // Short: this is a poll, and a request that hangs for the whole cold start
  // would freeze the caller's progress counter.
  const result = await apiFetch<HealthCheckResponse>('/health/ready', { timeoutMs: 10_000 });

  return result.ok;
}
