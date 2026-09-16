import { Injectable } from '@nestjs/common';

import type { Prisma } from '@pharma-erp/database';

/** Document prefixes. The set is closed so a typo cannot invent a new series. */
export type DocumentType = 'PR' | 'PO' | 'GRN' | 'PINV' | 'PAY' | 'LOT' | 'PLAN';

/**
 * Allocates human-readable document numbers: PR-2026-0001, GRN-2026-0014.
 *
 * Why a counter table rather than `count(*) + 1`: two requisitions created in
 * the same instant would compute the same number, and the unique index would
 * turn that into a failed save for whichever transaction committed second. An
 * UPDATE ... RETURNING takes a row lock, so the second caller waits and gets
 * the next value instead.
 *
 * Every method takes the transaction client, deliberately. A number allocated
 * outside the transaction that creates the document would be consumed even if
 * that document then failed to save, leaving gaps in a sequence that an auditor
 * expects to be contiguous.
 */
@Injectable()
export class NumberingService {
  /**
   * Reserves the next number for a document type in the current year.
   *
   * Sequences restart each year, which is what "PR-2026-0001" implies to
   * everyone who reads it. The year comes from the server clock; a tenant in a
   * different timezone may see the roll-over a few hours early or late, which
   * is acceptable for a document number and not worth a per-tenant clock.
   */
  async next(tx: Prisma.TransactionClient, tenantId: string, docType: DocumentType): Promise<string> {
    const year = new Date().getUTCFullYear();

    // upsert then read would race; this is one statement. `update` on a
    // non-existent row throws P2025, so the first document of the year takes
    // the create path.
    const sequence = await tx.documentSequence.upsert({
      where: { tenantId_docType_year: { tenantId, docType, year } },
      create: { tenantId, docType, year, nextValue: 2 },
      update: { nextValue: { increment: 1 } },
      select: { nextValue: true },
    });

    // `create` sets nextValue to 2 and this document takes 1; `update` returns
    // the already-incremented value, so the number just used is one less.
    const value = sequence.nextValue - 1;

    return `${docType}-${year}-${String(value).padStart(4, '0')}`;
  }
}
