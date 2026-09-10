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
export function dateRange(
  from?: string,
  to?: string,
): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;

  return {
    ...(from ? { gte: startOfDay(from) } : {}),
    ...(to ? { lte: endOfDay(to) } : {}),
  };
}

/** Case-insensitive "contains" clause, or undefined for an empty search. */
export function contains(search: string | undefined): { contains: string; mode: 'insensitive' } | undefined {
  const trimmed = search?.trim();

  return trimmed ? { contains: trimmed, mode: 'insensitive' as const } : undefined;
}
