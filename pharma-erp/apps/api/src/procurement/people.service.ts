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

  async load(userIds: readonly string[]): Promise<PeopleMap> {
    if (userIds.length === 0) return new Map();

    const users = await this.prisma.scoped.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, fullName: true },
    });

    return new Map(users.map((user) => [user.id, user.fullName]));
  }
}
