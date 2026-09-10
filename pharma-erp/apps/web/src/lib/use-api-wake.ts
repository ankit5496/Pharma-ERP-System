'use client';

import { useEffect, useState } from 'react';

import { wakeApiAction } from '@/app/wake-actions';

/**
 * Gap between wake attempts.
 *
 * Only reached when an attempt fails *fast* — the edge answering 429 or 502
 * before the container is listening. An attempt that is held open through the
 * boot paces itself, and needs no gap at all. Kept generous because impatience
 * is what breaks this: enough requests during a boot and the edge rate-limits
 * every one of them, so the container never finishes starting.
 */
const RETRY_GAP_MS = 8_000;

/**
 * Beyond this the service is not merely asleep. A cold start measured 22-53s on
 * this instance type, so three minutes means something is actually wrong and
 * continuing to say "waking up" would be a lie.
 */
const GIVE_UP_MS = 180_000;

export type WakePhase = 'idle' | 'waking' | 'ready' | 'unreachable';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
 * The displayed counter ticks on its own timer rather than advancing once per
 * request, because the request is deliberately a single long one — see
 * wakeApiAction for why polling makes this worse rather than better.
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

    // Independent of the request, so the display keeps moving while a single
    // 60-second call is in flight.
    const ticker = setInterval(() => {
      if (!cancelled) setSeconds(Math.round((Date.now() - startedAt) / 1000));
    }, 1_000);

    const wake = async () => {
      while (!cancelled && Date.now() - startedAt < GIVE_UP_MS) {
        if (await wakeApiAction()) {
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
