'use server';

import type { NotificationFeed } from '@pharma-erp/types';

import { apiFetch, type ApiResult } from '@/lib/api';

/**
 * The bell's two calls, as server actions.
 *
 * The browser never calls the API itself — the session token is an httpOnly
 * cookie only the Next server can read — so the bell goes through here.
 */
export async function fetchNotificationsAction(): Promise<ApiResult<NotificationFeed>> {
  return apiFetch<NotificationFeed>('/api/v1/notifications', { authenticated: true });
}

export async function markNotificationsAction(
  keys: string[],
  read: boolean,
): Promise<ApiResult<NotificationFeed>> {
  return apiFetch<NotificationFeed>('/api/v1/notifications/read', {
    method: 'POST',
    json: { keys, read },
    authenticated: true,
  });
}
