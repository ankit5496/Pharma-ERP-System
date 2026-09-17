import { DEFAULT_PAGE_SIZE } from '@pharma-erp/types';

/**
 * Shared list-filter helpers.
 *
 * All six Procure-to-Pay lists accept the same query shape, so the date and
 * search handling lives here rather than being re-implemented six times with
 * six slightly different ideas of whether `dateTo` is inclusive.
 */

/** Midnight UTC on the given day. */
export function startOfDay(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

/**
 * The last instant of the given day.
 *
 * Inclusive, because a user who filters "to 31 March" means documents dated
 * the 31st. An exclusive bound silently drops a whole day, and the omission is
 * invisible unless someone counts.
 */
export function endOfDay(value: string): Date {
  return new Date(`${value.slice(0, 10)}T23:59:59.999Z`);
}

/** Builds a Prisma date range, or undefined when neither bound was given. */
export function dateRange(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;

  return {
    ...(from ? { gte: startOfDay(from) } : {}),
    ...(to ? { lte: endOfDay(to) } : {}),
  };
}

/**
 * Turns a page number and size into Prisma's skip/take.
 *
 * CLAMPED, NEVER REFUSED. A page number can go stale in ordinary use — someone
 * is on page 6, a filter narrows the list to two pages, and the number in the
 * URL now points past the end. Refusing it gives an error page for what is
 * really just an empty page; clamping the size and letting an over-range page
 * return no rows lets the caller show "no records" and offer the pager back.
 */
export function paginate(query: { page?: number; pageSize?: number }): {
  skip: number;
  take: number;
  page: number;
  pageSize: number;
} {
  const pageSize = Math.min(Math.max(Math.trunc(query.pageSize ?? DEFAULT_PAGE_SIZE), 1), 100);
  const page = Math.max(Math.trunc(query.page ?? 1), 1);

  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

/** Case-insensitive "contains" clause, or undefined for an empty search. */
export function contains(
  search: string | undefined,
): { contains: string; mode: 'insensitive' } | undefined {
  const trimmed = search?.trim();

  return trimmed ? { contains: trimmed, mode: 'insensitive' as const } : undefined;
}
