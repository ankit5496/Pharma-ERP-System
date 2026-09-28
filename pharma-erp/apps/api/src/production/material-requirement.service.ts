import { Injectable, Logger } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  MaterialRequirementRegisterRow,
  MaterialRequirementSummary,
} from '@pharma-erp/types';

import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../procurement/numbering.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import { issuableStockWhere } from './production.mappers';
import { effectiveOverage, requiredWithOverage } from './production.service';

/**
 * Material Requirement Determination — US-MD-07.
 *
 * WHAT A CONFIRMED ORDER NEEDS, what exists, and what has to be bought. It runs
 * when a sales order is confirmed: the revised US-PROD-01 speaks of "the Sales
 * Order that caused it", and this is the thing that causes it.
 *
 * WHY IT IS PERSISTED, when `materialShortages()` already computes the same
 * arithmetic on demand. A figure that is computed and discarded cannot answer
 * the three questions actually asked of it: whether a shortfall has since been
 * satisfied (US-PROD-06's readiness gate), why the system ordered 200kg (the
 * requisition has to point back at something), and what was known about stock
 * when the order was taken (an auditor's question, where recomputing gives
 * today's answer to a question about last month).
 *
 * IT REPLACES A REFUSAL WITH A PLAN. Raising a work order today fails outright
 * when stock is short. Under the order-driven model the shortage is the normal
 * case rather than the error — nothing is stocked speculatively, so a confirmed
 * order is expected to need buying. This records that need instead of refusing
 * it.
 *
 * WHAT IT DOES NOT DO YET: reserve anything. `quantityAvailable` here is total
 * usable stock, with no notion of another order having a claim on it, which is
 * how the rest of the system currently reads stock too. Two orders confirmed
 * on the same day will each be told the same lot is available. Raw-material
 * reservation is the next step and this figure becomes net of it; until then
 * the shortfall is an optimistic floor, not a promise.
 */
@Injectable()
export class MaterialRequirementService {
  private readonly logger = new Logger(MaterialRequirementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Determines what a confirmed order requires, and raises requisitions for
   * whatever is short.
   *
   * NEVER THROWS. This is called from sales-order confirmation, and a failure
   * to determine requirements must not un-confirm an order that passed its
   * credit and licence checks — those are the decisions that confirmation is
   * actually about. A determination that could not be made is logged and
   * reported as a count of zero; the order stands, and the requirement can be
   * re-run.
   *
   * IDEMPOTENT PER ORDER. Re-confirming replaces the previous determination
   * rather than adding to it, so a corrected order does not accumulate stale
   * figures. Requisitions already raised are left alone — they may already be
   * on a purchase order, and withdrawing one silently would be a worse error
   * than leaving a covered shortfall covered.
   */
  async determineForSalesOrder(salesOrderId: string): Promise<{
    requirements: number;
    shortfalls: number;
    requisitionsRaised: number;
  }> {
    const empty = { requirements: 0, shortfalls: 0, requisitionsRaised: 0 };

    try {
      const tenantId = this.tenantContext.requireTenantId();
      const userId = this.tenantContext.getUserId();

      const order = await this.prisma.scoped.salesOrder.findFirst({
        where: { id: salesOrderId, deletedAt: null },
        select: {
          id: true,
          orderNumber: true,
          requestedDeliveryDate: true,
          items: { select: { itemId: true, quantityOrdered: true } },
        },
      });

      if (!order || order.items.length === 0) return empty;

      const required = await this.explode(order.items);

      if (required.size === 0) {
        this.logger.warn(
          `${order.orderNumber}: no active formulation behind any line, so nothing was ` +
            'determined. The products may be bought-in rather than manufactured.',
        );
        return empty;
      }

      const available = await this.availableByItem([...required.keys()]);

      const rows = [...required.values()].map((entry) => {
        const stock = available.get(entry.itemId) ?? new Prisma.Decimal(0);
        const short = Prisma.Decimal.max(entry.quantity.sub(stock), 0).toDecimalPlaces(3);

        return { ...entry, available: stock.toDecimalPlaces(3), short };
      });

      const shortfalls = rows.filter((row) => row.short.greaterThan(0));

      const raised = await this.prisma.transaction(async (tx) => {
        // COVERED SHORTFALLS SURVIVE. Everything else is replaced, so a
        // re-confirmed order reads as one determination rather than two.
        await tx.materialRequirement.deleteMany({
          where: { salesOrderId, requisitionId: null },
        });

        const covered = await tx.materialRequirement.findMany({
          where: { salesOrderId, requisitionId: { not: null } },
          select: { itemId: true, requisitionId: true },
        });

        const coveredBy = new Map(covered.map((row) => [row.itemId, row.requisitionId]));
        const createdIds: string[] = [];

        for (const row of rows) {
          // Already covered: the figures are refreshed, the requisition kept.
          const existing = coveredBy.get(row.itemId);

          let requisitionId = existing ?? null;

          if (!existing && row.short.greaterThan(0)) {
            const number = await this.numbering.next(tx, tenantId, 'PR');

            const requisition = await tx.purchaseRequisition.create({
              data: {
                tenantId,
                number,
                itemId: row.itemId,
                // THE SHORTFALL, not a reorder quantity: this is demand for a
                // specific order, and rounding it up to a reorder batch would
                // buy stock nobody asked for. The reorder sweep, which does
                // order in batches, answers a different question.
                requiredQuantity: row.short,
                stockAtRequest: row.available,
                // Not a reorder-level decision, so there is no level to record.
                reorderLevelAtRequest: new Prisma.Decimal(0),
                triggerType: 'PRODUCTION_SHORTFALL',
                // No author: the system raised it, on the order's confirmation.
                requestedById: null,
                status: 'OPEN',
                requiredByDate: order.requestedDeliveryDate ?? null,
                notes:
                  `Raised automatically for ${order.orderNumber}: needs ` +
                  `${row.quantity.toString()}, ${row.available.toString()} in stock.`,
              },
              select: { id: true },
            });

            requisitionId = requisition.id;
            createdIds.push(requisition.id);
          }

          await tx.materialRequirement.upsert({
            where: {
              tenantId_salesOrderId_itemId: { tenantId, salesOrderId, itemId: row.itemId },
            },
            create: {
              tenantId,
              salesOrderId,
              itemId: row.itemId,
              bomId: row.bomId,
              quantityRequired: row.quantity,
              quantityAvailable: row.available,
              quantityShort: row.short,
              requisitionId,
              determinedById: userId,
            },
            update: {
              bomId: row.bomId,
              quantityRequired: row.quantity,
              quantityAvailable: row.available,
              quantityShort: row.short,
              requisitionId,
              determinedAt: new Date(),
              determinedById: userId,
            },
          });
        }

        return createdIds;
      });

      // Outside the transaction: AuditService never throws, and a failure to
      // record must not roll back requisitions that were correctly raised.
      for (const id of raised) {
        await this.audit.record({
          entityType: 'PurchaseRequisition',
          entityId: id,
          action: 'CREATE',
          after: { trigger: 'PRODUCTION_SHORTFALL', raisedBy: 'system', salesOrderId },
        });
      }

      this.logger.log(
        `${order.orderNumber}: ${rows.length} material(s) determined, ` +
          `${shortfalls.length} short, ${raised.length} requisition(s) raised.`,
      );

      return {
        requirements: rows.length,
        shortfalls: shortfalls.length,
        requisitionsRaised: raised.length,
      };
    } catch (error) {
      // Deliberately swallowed — see the doc comment. The order is confirmed
      // either way, and a determination is re-runnable.
      this.logger.error(
        `Material requirement determination failed for sales order ${salesOrderId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );

      return empty;
    }
  }

  /**
   * What has been determined for an order.
   *
   * SHORTFALLS FIRST, then by material. What is missing is the reason anybody
   * opens this, and a list sorted by item code buries two shortfalls among
   * thirty satisfied lines.
   *
   * An empty result with `determinedAt: null` means no determination has run —
   * an order confirmed before US-MD-07, or one whose products are bought in
   * rather than manufactured. That is a different statement from a run that
   * found everything in stock, which returns rows with every shortfall at zero.
   */
  async findForSalesOrder(salesOrderId: string): Promise<MaterialRequirementSummary> {
    const rows = await this.prisma.scoped.materialRequirement.findMany({
      where: { salesOrderId },
      include: {
        item: { select: { id: true, code: true, name: true, uom: true } },
        requisition: { select: { id: true, number: true, status: true } },
      },
      orderBy: [{ quantityShort: 'desc' }, { item: { code: 'asc' } }],
    });

    return {
      salesOrderId,
      rows: rows.map((row) => ({
        id: row.id,
        item: row.item,
        quantityRequired: row.quantityRequired.toString(),
        quantityAvailable: row.quantityAvailable.toString(),
        quantityShort: row.quantityShort.toString(),
        requisition: row.requisition,
        determinedAt: row.determinedAt.toISOString(),
      })),
      shortfallCount: rows.filter((row) => row.quantityShort.greaterThan(0)).length,
      // The most recent run across the set: re-confirming refreshes every row,
      // so they normally share a timestamp, but a covered shortfall keeps its
      // own and the newest is the one that answers "when was this last done".
      //
      // Seeded from null rather than from rows[0], so the empty case falls out
      // of the same fold instead of needing a length check the compiler cannot
      // tie back to the indexed access.
      determinedAt:
        rows
          .reduce<Date | null>(
            (latest, row) => (latest === null || row.determinedAt > latest ? row.determinedAt : latest),
            null,
          )
          ?.toISOString() ?? null,
    };
  }

  /**
   * Every determination on file, across every order — the register.
   *
   * WHY THIS EXISTS BESIDE `findForSalesOrder`, which answers the same question
   * for one order: the two are read by different people for different reasons.
   * On a sales order the question is "can this one be made". Here it is "what
   * have we committed to across every order that we cannot currently cover",
   * which is a purchasing question and cannot be asked one order at a time.
   *
   * SHORTFALLS FIRST, then newest. A register sorted by date buries the four
   * rows somebody has to act on beneath three hundred that are covered.
   *
   * EVERY ROW, not only the shortfalls. A material that WAS short and has since
   * been covered by a requisition is the thing somebody checking on a purchase
   * comes here to find, and filtering it out would leave them with no way to
   * see that the order they chased is now on a PO.
   */
  async listRegister(): Promise<MaterialRequirementRegisterRow[]> {
    const rows = await this.prisma.scoped.materialRequirement.findMany({
      include: {
        item: { select: { id: true, code: true, name: true, uom: true } },
        requisition: { select: { id: true, number: true, status: true } },
        salesOrder: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            customer: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: [{ quantityShort: 'desc' }, { determinedAt: 'desc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      salesOrder: {
        id: row.salesOrder.id,
        orderNumber: row.salesOrder.orderNumber,
        status: row.salesOrder.status,
        customerCode: row.salesOrder.customer.code,
        customerName: row.salesOrder.customer.name,
      },
      item: row.item,
      quantityRequired: row.quantityRequired.toString(),
      quantityAvailable: row.quantityAvailable.toString(),
      quantityShort: row.quantityShort.toString(),
      requisition: row.requisition,
      determinedAt: row.determinedAt.toISOString(),
    }));
  }

  /**
   * Every raw material behind the order's lines, summed across them.
   *
   * SUMMED, because two lines of the same order can share an excipient: asking
   * for lactose twice and treating each in isolation buys half of what the
   * order needs. The map is keyed by material, not by order line.
   *
   * A line whose product has no active formulation is SKIPPED rather than
   * refused — a bought-in finished good is sold without being manufactured, and
   * its absence from this list is correct rather than an error.
   */
  private async explode(
    lines: readonly { itemId: string; quantityOrdered: Prisma.Decimal }[],
  ): Promise<Map<string, { itemId: string; bomId: string | null; quantity: Prisma.Decimal }>> {
    const required = new Map<
      string,
      { itemId: string; bomId: string | null; quantity: Prisma.Decimal }
    >();

    for (const line of lines) {
      const bom = await this.prisma.scoped.bom.findFirst({
        where: { productId: line.itemId, isActive: true, deletedAt: null },
        select: {
          id: true,
          outputQuantity: true,
          defaultOveragePercent: true,
          lines: { select: { itemId: true, quantityPer: true, overagePercent: true } },
        },
      });

      if (!bom || bom.lines.length === 0) continue;

      // Guard the divide: outputQuantity is CHECK-constrained above zero, but
      // the arithmetic should not depend on a constraint in another file.
      if (bom.outputQuantity.isZero()) continue;

      const scale = new Prisma.Decimal(line.quantityOrdered).div(bom.outputQuantity);

      for (const bomLine of bom.lines) {
        // OVERAGE-ADJUSTED per US-MD-03, through the same helper the issue plan
        // uses. Procuring against the bare BOM quantity buys short by exactly
        // the wastage the formulation says to expect.
        const quantity = requiredWithOverage(
          bomLine.quantityPer,
          scale,
          effectiveOverage(bomLine, bom),
        );

        const seen = required.get(bomLine.itemId);

        required.set(bomLine.itemId, {
          itemId: bomLine.itemId,
          // The first formulation that called for this material. Recorded to
          // explain the figure; where two products share an excipient the sum
          // spans both, and one BOM cannot account for all of it.
          bomId: seen?.bomId ?? bom.id,
          quantity: seen ? seen.quantity.add(quantity) : quantity,
        });
      }
    }

    return required;
  }

  /**
   * Usable stock per material.
   *
   * THE SAME DEFINITION THE FEFO ALLOCATOR DISPENSES AGAINST — `issuableStockWhere`
   * — because a determination computed on a different rule from the one the
   * store can actually draw on is a plan for stock that does not exist. These
   * two have disagreed about expired lots before.
   *
   * Company-owned only. A principal's material arrives under a job-work
   * agreement and is not something a sales order can buy.
   */
  private async availableByItem(itemIds: readonly string[]): Promise<Map<string, Prisma.Decimal>> {
    if (itemIds.length === 0) return new Map();

    const grouped = await this.prisma.scoped.stockLot.groupBy({
      by: ['itemId'],
      where: {
        itemId: { in: [...itemIds] },
        ...issuableStockWhere(),
        ownership: 'COMPANY_OWNED',
      },
      _sum: { quantityAvailable: true },
    });

    return new Map(
      grouped.map((row) => [row.itemId, row._sum.quantityAvailable ?? new Prisma.Decimal(0)]),
    );
  }
}
