'use server';

import { revalidatePath } from 'next/cache';

import type { StockBatchRow, StockMovement } from '@pharma-erp/types';

import { apiFetch, type ApiResult } from '@/lib/api';

/** Changes the near-expiry windows — US-INV-03's "configurable, not hard-coded". */
export async function setExpiryAlertsAction(
  alertDays: number[],
): Promise<ApiResult<{ alertDays: number[] }>> {
  const result = await apiFetch<{ alertDays: number[] }>('/api/v1/inventory/near-expiry/alerts', {
    method: 'PATCH',
    authenticated: true,
    json: { alertDays },
    timeoutMs: 20_000,
  });

  if (result.ok) {
    revalidatePath('/inventory/near-expiry');
    revalidatePath('/dashboard');
  }

  return result;
}

/** One batch's movement history, read through the server so the session cookie stays httpOnly. */
export async function fetchBatchMovementsAction(
  source: StockBatchRow['source'],
  id: string,
): Promise<ApiResult<StockMovement[]>> {
  const query = new URLSearchParams({ source, id });

  return apiFetch<StockMovement[]>(`/api/v1/inventory/movements?${query}`, {
    authenticated: true,
  });
}
