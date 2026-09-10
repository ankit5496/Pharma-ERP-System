import type { Dataset } from '@pharma-erp/types';

import { apiFetch, type ApiResult } from './api';

/** Rows as the record viewer consumes them. */
export type DatasetRows = readonly Record<string, unknown>[];

/**
 * Fetches the records behind a dataset.
 *
 * Goes through the same `apiFetch` every other page uses, so the call carries
 * the caller's own bearer token and lands on the same guards: role checks in
 * NestJS, row-level security in Postgres. The browser is never told to trust
 * this layer — a Store Officer opening the Users table gets the API's 403,
 * exactly as they would from any other route, and tenant isolation is enforced
 * a layer below that regardless of what is asked for here.
 *
 * Errors come back as data rather than thrown, matching `ApiResult`, because a
 * 403 on a table someone chose from a dropdown is an ordinary state the page
 * has to render.
 */
export async function loadDatasetRecords(dataset: Dataset): Promise<ApiResult<DatasetRows>> {
  if (dataset.source.kind !== 'endpoint') {
    return { ok: false, status: null, error: 'This table does not exist yet.' };
  }

  const { path, pick } = dataset.source;
  const result = await apiFetch<unknown>(path, { authenticated: true });

  if (!result.ok) return result;

  return { ok: true, data: toRows(pick ? pluck(result.data, pick) : result.data) };
}

function pluck(payload: unknown, key: string): unknown {
  if (payload && typeof payload === 'object' && key in payload) {
    return (payload as Record<string, unknown>)[key];
  }

  return undefined;
}

/**
 * Normalises whatever the endpoint returned into a list of rows.
 *
 * A picked value that is a single object — the dashboard's `company`, say — is
 * a one-row table rather than a special case for the viewer to know about.
 */
function toRows(value: unknown): DatasetRows {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  return isRecord(value) ? [value] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
