'use client';

import { useEffect, useState } from 'react';

import { checkApiReadyAction } from '@/app/wake-actions';

/** How often to ask whether the API is up yet. */
const POLL_INTERVAL_MS = 3_000;

/**
 * Beyond this the service is not merely asleep. A cold start on the free
 * instance type measured 22-53s; two and a half minutes means something is
 * actually wrong, and continuing to say "waking up" would be a lie.
 */
const GIVE_UP_MS = 150_000;

export type WakePhase = 'idle' | 'waking' | 'ready' | 'unreachable';

/**
 * Polls the API until it can serve a request, reporting progress.
 *
 * Written for the sign-in forms, which face a specific problem: the API sleeps
 * after ~15 minutes of inactivity, and React 19 resets an uncontrolled form
 * once its action completes — so the password field is empty by the time the
 * failure is rendered. Resubmitting automatically would therefore send an empty
 * password, and keeping the password in React state to avoid that would put a
 * live credential somewhere it has no business being.
 *
 * So this waits instead of retrying: it wakes the API in the background and
 * reports when the person at the keyboard can usefully try again.
 *
 * @param active  Whether to be polling at all.
 * @param trigger Any value whose identity changes when a new wait begins;
 *                passing the action's state object restarts the poll for each
 *                fresh attempt, which `active` alone cannot do because it is
 *                already true.
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
    let timer: ReturnType<typeof setTimeout>;

    const startedAt = Date.now();

    setPhase('waking');
    setSeconds(0);

    const poll = async () => {
      const ready = await checkApiReadyAction();

      // The component may have unmounted, or a new attempt superseded this one,
      // while the request was in flight.
      if (cancelled) return;

      if (ready) {
        setPhase('ready');
        return;
      }

      const elapsed = Date.now() - startedAt;
      setSeconds(Math.round(elapsed / 1000));

      if (elapsed > GIVE_UP_MS) {
        setPhase('unreachable');
        return;
      }

      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    void poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, trigger]);

  return { phase, seconds };
}
