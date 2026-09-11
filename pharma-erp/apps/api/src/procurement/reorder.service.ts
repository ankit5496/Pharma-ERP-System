import { Injectable, Logger } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';

import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import { ZERO, qty } from './decimal.util';
import { NumberingService } from './numbering.service';

/** What one pass of the reorder check did. */
export interface ReorderOutcome {
  createdIds: string[];
  skipped: { itemCode: string; itemName: string; reason: string }[];
}

/**
 * The automatic half of the procurement trigger.
 *
 * The brief asks the system to RAISE a requisition when stock falls below the
 * reorder level, not merely to show the item on a list. That distinction is
 * the whole point: a flag on a screen is only seen by someone who opens the
 * screen, whereas a raised requisition enters the approval queue and gets
 * chased.
 *
 * WHERE IT RUNS FROM. This is called after any operation that can lower usable
 * stock — today, a stock adjustment or a QC decision that withdraws material
 * already accepted — and is also exposed as an endpoint so it can be run on
 * demand or from a scheduler. It is deliberately NOT a background timer inside
 * the API: a timer in a process that may be running on several instances
 * raises the same requisition several times.
 *
 * IDEMPOTENCE is what makes that safe. An item that already has an OPEN or
 * APPROVED requisition is skipped, so running the check twice in a row creates
 * nothing the second time. Without that, every stock movement below the level
 * would raise another duplicate.
 */
@Injectable()
export class ReorderService {
  private readonly logger = new Logger(ReorderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  /**
   * Raises requisitions for every raw material below its reorder level that
   * does not already have one open.
   *
   * The whole pass runs in one transaction: the sequence numbers it consumes
   * and the rows it writes have to commit together, or a failure halfway
   * leaves gaps in a numbering series an auditor expects to be contiguous.
   */
  async run(): Promise<ReorderOutcome> {
    const tenantId = this.tenantContext.requireTenantId();

    const outcome = await this.prisma.transaction(async (tx) => {
      const items = await tx.item.findMany({
        where: { deletedAt: null, type: { in: ['RAW_MATERIAL', 'PACKING_MATERIAL', 'SEMI_FINISHED'] } },
        select: {
          id: true,
          code: true,
          name: true,
          reorderLevel: true,
          reorderQuantity: true,
        },
        orderBy: { code: 'asc' },
      });

      if (items.length === 0) return { createdIds: [], skipped: [] };

      const itemIds = items.map((item) => item.id);

      // Usable stock per item, and which items already have something open.
      // Both as single grouped queries rather than per item: a company with a
      // few hundred materials would otherwise issue a few hundred round trips
      // every time anything moved.
      const [usable, open] = await Promise.all([
        tx.stockLot.groupBy({
          by: ['itemId'],
          where: { itemId: { in: itemIds }, status: 'USABLE' },
          _sum: { quantityAvailable: true },
        }),
        tx.purchaseRequisition.findMany({
          where: {
            itemId: { in: itemIds },
            deletedAt: null,
            status: { in: ['OPEN', 'APPROVED'] },
          },
          select: { itemId: true, number: true },
          distinct: ['itemId'],
        }),
      ]);

      const stockByItem = new Map(
        usable.map((row) => [row.itemId, row._sum.quantityAvailable ?? ZERO] as const),
      );
      const openByItem = new Map(open.map((row) => [row.itemId, row.number] as const));

      const createdIds: string[] = [];
      const skipped: { itemCode: string; itemName: string; reason: string }[] = [];

      for (const item of items) {
        const available = stockByItem.get(item.id) ?? ZERO;
        const level = new Prisma.Decimal(item.reorderLevel ?? 0);

        // Strictly below. An item sitting exactly ON its reorder level has not
        // breached it — ordering there would fire on every item whose level is
        // zero, which is the default for anything not yet configured.
        if (!available.lessThan(level)) continue;

        const existing = openByItem.get(item.id);

        if (existing) {
          skipped.push({
            itemCode: item.code,
            itemName: item.name,
            reason: `Requisition ${existing} is already open for this item.`,
          });
          continue;
        }

        const reorderQuantity = new Prisma.Decimal(item.reorderQuantity ?? 0);

        // Nothing sensible to order. Reported rather than silently ignored:
        // an item below its level with no reorder quantity configured is a
        // gap in the master data that someone has to fix.
        if (reorderQuantity.lessThanOrEqualTo(0)) {
          skipped.push({
            itemCode: item.code,
            itemName: item.name,
            reason: 'Below reorder level but no reorder quantity is configured.',
          });
          continue;
        }

        const number = await this.numbering.next(tx, tenantId, 'PR');

        const created = await tx.purchaseRequisition.create({
          data: {
            tenantId,
            number,
            itemId: item.id,
            stockAtRequest: available,
            reorderLevelAtRequest: level,
            // The configured reorder quantity, NOT the shortfall. Ordering
            // exactly the shortfall puts stock back on the threshold, so the
            // next issue trips the reorder again immediately.
            requiredQuantity: reorderQuantity,
            triggerType: 'AUTO_REORDER',
            // No author: the system raised it. Attributing it to whoever's
            // request happened to trip the check would be a lie in the trail.
            requestedById: null,
            status: 'OPEN',
            notes:
              `Raised automatically: usable stock ${qty(available)} fell below ` +
              `the reorder level of ${qty(level)}.`,
          },
          select: { id: true, number: true },
        });

        createdIds.push(created.id);

        this.logger.log(
          `Auto-raised ${created.number} for ${item.code}: stock ${qty(available)} < level ${qty(level)}`,
        );
      }

      return { createdIds, skipped };
    });

    // Audited outside the transaction: AuditService never throws, and a
    // failure to record must not roll back requisitions that were correctly
    // raised. Recorded per requisition so each one is traceable on its own.
    for (const id of outcome.createdIds) {
      await this.audit.record({
        entityType: 'PurchaseRequisition',
        entityId: id,
        action: 'CREATE',
        after: { trigger: 'AUTO_REORDER', raisedBy: 'system' },
      });
    }

    return outcome;
  }
}
