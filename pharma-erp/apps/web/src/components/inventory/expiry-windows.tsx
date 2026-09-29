'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import {
  MAX_EXPIRY_ALERT_DAYS,
  MAX_EXPIRY_ALERT_WINDOWS,
  MIN_EXPIRY_ALERT_DAYS,
} from '@pharma-erp/types';

import { setExpiryAlertsAction } from './actions';

/** "90, 60, 30" → [30, 60, 90], or a sentence saying what is wrong. */
function parse(text: string): number[] | string {
  const parts = text
    .split(/[\s,/]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return 'Enter at least one window, e.g. 90, 60, 30.';
  if (parts.length > MAX_EXPIRY_ALERT_WINDOWS) {
    return `At most ${MAX_EXPIRY_ALERT_WINDOWS} windows.`;
  }

  const days = parts.map(Number);

  if (
    days.some((d) => !Number.isInteger(d) || d < MIN_EXPIRY_ALERT_DAYS || d > MAX_EXPIRY_ALERT_DAYS)
  ) {
    return `Each window must be a whole number of days from ${MIN_EXPIRY_ALERT_DAYS} to ${MAX_EXPIRY_ALERT_DAYS}.`;
  }
  if (new Set(days).size !== days.length) return 'Each window can appear only once.';

  return days.sort((a, b) => a - b);
}

/**
 * The company's near-expiry windows, and — for Store and Admin — the control
 * that changes them. Saved per company, so the report and the dashboard move
 * together.
 */
export function ExpiryWindows({ alertDays, canEdit }: { alertDays: number[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(alertDays.join(', '));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // The saved value is the source of truth once a save lands.
  useEffect(() => setText(alertDays.join(', ')), [alertDays]);

  function save() {
    const parsed = parse(text);

    if (typeof parsed === 'string') {
      setError(parsed);
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await setExpiryAlertsAction(parsed);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setEditing(false);
      router.refresh();
    });
  }

  function cancel() {
    setText(alertDays.join(', '));
    setError(null);
    setEditing(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span className="font-medium text-slate-700">Alert windows</span>

      {editing ? (
        <>
          <input
            value={text}
            disabled={isPending}
            autoFocus
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
              if (event.key === 'Escape') cancel();
            }}
            aria-label="Alert windows in days, separated by commas"
            aria-invalid={error ? true : undefined}
            placeholder="90, 60, 30"
            className="w-36 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-900 tabular-nums disabled:bg-slate-100"
          />
          <span>days</span>
          <button
            type="button"
            onClick={save}
            disabled={isPending}
            className="rounded-md bg-slate-900 px-2.5 py-1 font-medium text-white transition hover:bg-slate-700 disabled:opacity-60"
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={isPending}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          {alertDays.map((days) => (
            <span
              key={days}
              className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 tabular-nums ring-1 ring-slate-200 ring-inset"
            >
              {days} days
            </span>
          ))}
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Change
            </button>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="w-full text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
