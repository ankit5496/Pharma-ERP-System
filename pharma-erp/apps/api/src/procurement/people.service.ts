import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import type { PeopleMap } from './mappers';

/**
 * Resolves acting-user ids to display names.
 *
 * The procurement documents store `requestedById`, `createdById` and the like
 * as plain UUID columns rather than Prisma relations (see the schema note on
 * why). This does the lookup in one batched query per list instead of a join
 * per row, and returns a map so callers stay synchronous once it has run.
 *
 * Soft-deleted users still resolve, deliberately: a purchase order approved
 * last year by someone who has since left must still say who approved it.
 * Attribution is not something a departure erases.
 */
@Injectable()
export class PeopleService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Who matches this search term.
   *
   * THE OTHER HALF OF THE SAME PROBLEM `load` SOLVES. Because the documents
   * hold acting users as bare UUIDs, a list query cannot reach through to a
   * name to search it — so the name is resolved to ids here and the caller
   * matches on `...ById IN (...)`, which is the same answer a join would have
   * given.
   *
   * Matches any part of the name, so "Ankit", "Goyal" and "kit go" all find
   * Ankit Goyal. The email is searched too: it is how people are invited and
   * often the only spelling a colleague is sure of.
   *
   * Returns an empty array when nothing matches, and callers must treat that
   * as "no record matches this term by person" rather than as "no filter" —
   * an `IN ()` of nothing matches nothing, which is correct.
   */
  async idsMatching(term: string): Promise<string[]> {
    const search = term.trim();

    if (!search) return [];

    const users = await this.prisma.scoped.user.findMany({
      where: {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
      // Enough to cover any real company; a term matching more people than
      // this is not a search anybody meant to run.
      take: 500,
    });

    return users.map((user) => user.id);
  }

  async load(userIds: readonly string[]): Promise<PeopleMap> {
    if (userIds.length === 0) return new Map();

    const users = await this.prisma.scoped.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, fullName: true },
    });

    return new Map(users.map((user) => [user.id, user.fullName]));
  }
}
