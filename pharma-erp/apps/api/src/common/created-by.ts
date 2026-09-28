import type { PrismaService } from '../prisma/prisma.service';

/**
 * Fills in `createdBy` on a list of records that hold the creator as a UUID.
 *
 * WHY THE MAPPERS DO NOT DO THIS. Master-data rows store `createdById` as a
 * bare UUID with no Prisma relation — the schema header explains that choice:
 * eight named back-relation arrays on User would make that model unreadable,
 * and nobody navigates "everything this person created" from the user side.
 * So a mapper, which sees one row and has no database handle, cannot turn that
 * id into a name. The register that lists the rows can, in ONE query for the
 * whole page rather than a join per row.
 *
 * Soft-deleted users still resolve, deliberately: a formulation written last
 * year by someone who has since left must still say who wrote it. Attribution
 * is not something a departure erases.
 *
 * An id that resolves to nothing leaves `createdBy` null rather than inventing
 * a placeholder — "Unknown" in a name column reads as a user actually called
 * that. Null is what the registers already render as a dash.
 */
export async function withCreatedBy<T extends { createdBy: string | null }>(
  prisma: PrismaService,
  rows: readonly { createdById: string | null }[],
  views: T[],
): Promise<T[]> {
  const ids = [...new Set(rows.map((row) => row.createdById).filter((id): id is string => !!id))];

  if (ids.length === 0) return views;

  const users = await prisma.scoped.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true },
  });

  const names = new Map(users.map((user) => [user.id, user.fullName]));

  // Positional: `views[i]` is the mapping of `rows[i]`, which every caller
  // builds with a single `.map()` over the same array.
  return views.map((view, index) => ({
    ...view,
    createdBy: names.get(rows[index]?.createdById ?? '') ?? null,
  }));
}

/**
 * Fills in `approvedBy` the same way, for records that carry an approver.
 *
 * SEPARATE FROM `withCreatedBy` rather than folded into it: a BOM needs both
 * names resolved and they come from different columns, so the two run in turn
 * over the same list. Each is still one query for the whole page.
 *
 * Same rules as above — soft-deleted users resolve, and an id matching nobody
 * leaves null rather than inventing a placeholder.
 */
export async function withApprovedBy<T extends { approvedBy: string | null }>(
  prisma: PrismaService,
  rows: readonly { approvedById: string | null }[],
  views: T[],
): Promise<T[]> {
  const ids = [...new Set(rows.map((row) => row.approvedById).filter((id): id is string => !!id))];

  if (ids.length === 0) return views;

  const users = await prisma.scoped.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true },
  });

  const names = new Map(users.map((user) => [user.id, user.fullName]));

  return views.map((view, index) => ({
    ...view,
    approvedBy: names.get(rows[index]?.approvedById ?? '') ?? null,
  }));
}
