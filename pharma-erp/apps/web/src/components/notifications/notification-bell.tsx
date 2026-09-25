'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { NotificationFeed, NotificationItem } from '@pharma-erp/types';

import { fetchNotificationsAction, markNotificationsAction } from './actions';

/** How often the bell re-checks while a page stays open. */
const REFRESH_MS = 5 * 60 * 1000;

/**
 * The bell in the header — US-COMP-01.
 *
 * LOADED AFTER THE PAGE, not while rendering it. The header is on every page,
 * and fetching notifications during the server render would add a database
 * round trip to all of them. The badge fills in a moment after the page does.
 *
 * Read/unread changes are applied to the list at once and then confirmed by
 * the API, which returns the authoritative feed.
 */
export function NotificationBell() {
  const router = useRouter();
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    const result = await fetchNotificationsAction();

    if (result.ok) {
      setFeed(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);

    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;

      setIsOpen(false);
      buttonRef.current?.focus();
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  async function mark(keys: string[], read: boolean) {
    if (keys.length === 0) return;

    setFeed((current) => (current ? applyRead(current, keys, read) : current));

    const result = await markNotificationsAction(keys, read);

    if (result.ok) {
      setFeed(result.data);
      setError(null);
    } else {
      setError(result.error);
      void load();
    }
  }

  function open(item: NotificationItem) {
    setIsOpen(false);
    if (!item.read) void mark([item.key], true);
    router.push(item.href);
  }

  const unread = feed?.unreadCount ?? 0;
  const unreadKeys = feed?.items.filter((item) => !item.read).map((item) => item.key) ?? [];

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          const next = !isOpen;

          setIsOpen(next);
          if (next) void load();
        }}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
        className="relative rounded-md border border-slate-300 p-2 text-slate-700 transition hover:bg-slate-50"
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-4 w-4"
        >
          <path d="M10 2.5a5 5 0 0 0-5 5v2.8L3.5 13.5h13L15 10.3V7.5a5 5 0 0 0-5-5Z" />
          <path d="M8 16a2 2 0 0 0 4 0" />
        </svg>

        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[1.125rem] rounded-full bg-red-600 px-1 text-center text-[10px] leading-[1.125rem] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            <button
              type="button"
              onClick={() => void mark(unreadKeys, true)}
              disabled={unreadKeys.length === 0}
              className="text-xs font-medium text-slate-700 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
            >
              Mark all as read
            </button>
          </div>

          {error && (
            <p
              role="alert"
              className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-800"
            >
              Could not update notifications: {error}
            </p>
          )}

          {!feed ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              {error ? 'Notifications are unavailable right now.' : 'Loading…'}
            </p>
          ) : feed.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              You&rsquo;re all caught up.
            </p>
          ) : (
            <ul className="max-h-[24rem] divide-y divide-slate-100 overflow-y-auto">
              {feed.items.map((item) => (
                <li key={item.key} className={item.read ? 'bg-white' : 'bg-slate-50'}>
                  <div className="flex items-start gap-3 px-4 py-3">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        item.severity === 'critical' ? 'bg-red-600' : 'bg-amber-500'
                      }`}
                    />

                    <button
                      type="button"
                      onClick={() => open(item)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span
                        className={`block text-sm ${
                          item.read ? 'font-normal text-slate-700' : 'font-semibold text-slate-900'
                        }`}
                      >
                        {item.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-600">{item.message}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void mark([item.key], !item.read)}
                      className="shrink-0 text-[11px] font-medium whitespace-nowrap text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
                    >
                      {item.read ? 'Mark as unread' : 'Mark as read'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function applyRead(feed: NotificationFeed, keys: string[], read: boolean): NotificationFeed {
  const changed = new Set(keys);
  const items = feed.items.map((item) => (changed.has(item.key) ? { ...item, read } : item));

  return { items, unreadCount: items.filter((item) => !item.read).length };
}
