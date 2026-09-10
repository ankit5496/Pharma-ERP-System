'use client';

import { useEffect, useState } from 'react';

import { env } from './env';

/**
 * How long to hold a single wake request open.
 *
 * Sized to outlast a cold start, measured at 22-53s on the free instance type
 * this deploys to. The host holds the request open while it starts a suspended
 * container, so one patient call is what actually wakes it.
 */
const WAKE_TIMEOUT_MS = 60_000;

/** Only reached when an attempt fails fast, e.g. the edge answering mid-boot. */
const RETRY_GAP_MS = 5_000;

/**
 * Beyond this the service is not merely asleep, and continuing to say "waking
 * up" would be a lie.
 */
const GIVE_UP_MS = 180_000;

export type WakePhase = 'idle' | 'waking' | 'ready' | 'unreachable';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Asks the API whether it is up — from the BROWSER, deliberately.
 *
 * This was a server action first, and it did not work: two attempts in
 * production left the API at an uptime of zero after minutes of waiting. The
 * reason is the network path. A server action runs on the web service, and a
 * web-service-to-API call leaves the private network and re-enters through the
 * public edge (see readApiUrl in env.ts) — the platform calling itself through
 * its own front door, which it rate-limits. A request from a browser is
 * ordinary outside traffic and is not; every manual request from outside woke
 * this API first time.
 *
 * Reaching the API straight from the browser is fine here: that is exactly what
 * NEXT_PUBLIC_API_URL is, a public address inlined at build time. The endpoint
 * is unauthenticated and no credentials are sent.
 *
 * `/health/ready` rather than `/health`: it answers 503 until Postgres actually
 * responds, so success means a sign-in can complete, not merely that a process
 * is listening.
 */
async function probeApi(): Promise<boolean> {
  try {
    const response = await fetch(`${env.apiUrl}/health/ready`, {
      cache: 'no-store',
      // The probe needs no session, and omitting cookies keeps this a simple
      // CORS request against an endpoint that requires no authentication.
      credentials: 'omit',
      signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
    });

    return response.ok;
  } catch (error) {
    // Expected while the container boots: the edge's own 5xx pages carry no
    // CORS headers, so the browser rejects them as a network error rather than
    // reporting a status. Surfaced to the console because a wake that never
    // succeeds is otherwise invisible — the API cannot log a request that never
    // reached it.
    console.warn(`[wake] probe failed: ${error instanceof Error ? error.message : String(error)}`);

    return false;
  }
}

/**
 * Wakes the API and reports when it can serve a request.
 *
 * Written for the sign-in forms, which face a specific problem: the API sleeps
 * after ~15 minutes of inactivity, and React 19 resets an uncontrolled form
 * once its action completes — so the password field is already empty by the
 * time the failure renders. Resubmitting automatically would send an empty
 * password, and keeping the password in React state to avoid that would put a
 * live credential somewhere it has no business being.
 *
 * So this waits instead of retrying the sign-in: it wakes the API in the
 * background and hands control back when the person can usefully try again.
 *
 * @param active  Whether to be waking at all.
 * @param trigger Any value whose identity changes when a new wait begins;
 *                passing the action's state object restarts for each fresh
 *                attempt, which `active` alone cannot do because it is already
 *                true.
 */
export function useApiWake(active: boolean, trigger?: unknown) {
  const [phase, setPhase] = useState<WakePhase>('idle');
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setPhase('idle');
      setSeconds(0);
      return;
    }

    let cancelled = false;

    const startedAt = Date.now();

    setPhase('waking');
    setSeconds(0);

    // Ticks independently of the request, so the display keeps moving while a
    // single 60-second call is in flight.
    const ticker = setInterval(() => {
      if (!cancelled) setSeconds(Math.round((Date.now() - startedAt) / 1000));
    }, 1_000);

    const wake = async () => {
      while (!cancelled && Date.now() - startedAt < GIVE_UP_MS) {
        if (await probeApi()) {
          if (!cancelled) setPhase('ready');
          return;
        }

        if (cancelled) return;

        await sleep(RETRY_GAP_MS);
      }

      if (!cancelled) setPhase('unreachable');
    };

    void wake().finally(() => clearInterval(ticker));

    return () => {
      cancelled = true;
      clearInterval(ticker);
    };
  }, [active, trigger]);

  return { phase, seconds };
}
