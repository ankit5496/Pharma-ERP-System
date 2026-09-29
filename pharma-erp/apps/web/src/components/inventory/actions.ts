'use server';

import type { StockBatchRow, StockMovement } from '@pharma-erp/types';

import { apiFetch, type ApiResult } from '@/lib/api';

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
