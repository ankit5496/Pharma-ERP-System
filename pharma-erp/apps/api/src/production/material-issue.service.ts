import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type { MaterialIssuePlan, MaterialIssuePlanLine, MaterialIssueView } from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import { toIsoDate, toItemSummary } from './production.mappers';
import { ProductionService } from './production.service';

const ZERO = new Prisma.Decimal(0);

/**
 * Dispensing raw and packing material to the shop floor, FEFO.
 *
 * FEFO — First Expiry, First Out — rather than FIFO. In pharma the risk being
 * managed is stock expiring on the shelf, and the lot that arrived first is not
 * necessarily the one that expires first: a supplier may ship older stock, or a
 * later delivery may carry a shorter remaining life. Ordering by receipt date
 * would leave short-dated material to expire while newer stock is consumed.
 */
@Injectable()
export class MaterialIssueService {
  /**
   * Beyond this the earliest-expiring lot is skipped rather than issued.
   *
   * Zero: any unexpired usable lot may be consumed. Kept as a named constant
   * because a real plant usually wants a margin here — material that expires
   * mid-campaign is no use — and the place to put it should be obvious.
   */
  private static readonly MINIMUM_SHELF_LIFE_DAYS = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly production: ProductionService,
  ) {}

  /**
   * What issuing would consume, without writing anything.
   *
   * Separate from the act of issuing because dispensing is hard to reverse:
   * once material is weighed out against a batch, correcting a mistake means a
   * deviation report. Showing the plan — and any shortfall — first costs one
   * read.
   */
  async plan(productionOrderId: string): Promise<MaterialIssuePlan> {
    const order = await this.production.requireOrder(productionOrderId);

    // Scale the recipe to the order: a BOM states quantities per its own
    // output quantity, not per unit, so this is a ratio rather than a
    // multiplication by the order size.
    const scale = new Prisma.Decimal(order.plannedQuantity).div(order.bom.outputQuantity);

    const lines: MaterialIssuePlanLine[] = [];

    for (const bomLine of order.bom.lines) {
      const required = new Prisma.Decimal(bomLine.quantityPer).mul(scale);
      const allocations = await this.allocate(bomLine.itemId, required);

      const allocated = allocations.reduce(
        (total, allocation) => total.add(allocation.quantity),
        ZERO,
      );

      lines.push({
        item: toItemSummary(bomLine.item),
        quantityRequired: this.round(required).toString(),
        quantityAllocated: this.round(allocated).toString(),
        quantityShort: this.round(Prisma.Decimal.max(required.sub(allocated), ZERO)).toString(),
        allocations: allocations.map((allocation) => ({
          lotId: allocation.lot.id,
          lotNumber: allocation.lot.lotNumber,
          expiryDate: toIsoDate(allocation.lot.expiryDate),
          quantity: this.round(allocation.quantity).toString(),
          quantityAvailable: allocation.lot.quantityAvailable.toString(),
        })),
      });
    }

    return {
      productionOrderId: order.id,
      orderNumber: order.orderNumber,
      canIssue:
        order.status === 'PLANNED' && lines.every((line) => line.quantityShort === ZERO.toString()),
      lines,
    };
  }

  /**
   * Dispenses against the order, consuming lots in expiry order.
   *
   * Everything happens in one transaction, and the lot decrements are
   * conditional: `updateMany` with a `quantityAvailable: { gte }` guard writes
   * nothing if another dispensing run took the stock first, and a count of 0
   * aborts the whole issue. Without that guard two concurrent issues would both
   * read the same availability and both succeed, leaving negative stock — which
   * the CHECK constraint would then reject with a message nobody can act on.
   */
  async issue(productionOrderId: string): Promise<MaterialIssueView> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const order = await this.production.requireOrder(productionOrderId);

    if (order.status !== 'PLANNED') {
      throw new ConflictException(
        `Material has already been issued against ${order.orderNumber} — its status is ` +
          `${order.status.toLowerCase().replace('_', ' ')}. Issuing twice would double-count ` +
          'consumption and corrupt the variance on the batch record.',
      );
    }

    const plan = await this.plan(productionOrderId);
    const short = plan.lines.filter((line) => line.quantityShort !== ZERO.toString());

    if (short.length > 0) {
      const detail = short
        .map((line) => `${line.item.code} (short ${line.quantityShort} ${line.item.uom})`)
        .join(', ');

      throw new BadRequestException(
        `Not enough usable stock to issue ${order.orderNumber}: ${detail}. ` +
          'Only lots marked usable and not yet expired can be dispensed.',
      );
    }

    return this.prisma.transaction(async (tx) => {
      const issue = await tx.materialIssue.create({
        data: { tenantId, productionOrderId: order.id, issuedById: userId },
      });

      for (const line of plan.lines) {
        for (const allocation of line.allocations) {
          const claimed = await tx.materialLot.updateMany({
            where: {
              id: allocation.lotId,
              status: 'USABLE',
              deletedAt: null,
              // The guard: only decrement if the stock is still there.
              quantityAvailable: { gte: new Prisma.Decimal(allocation.quantity) },
            },
            data: { quantityAvailable: { decrement: new Prisma.Decimal(allocation.quantity) } },
          });

          if (claimed.count === 0) {
            throw new ConflictException(
              `Lot ${allocation.lotNumber} of ${line.item.code} no longer has ` +
                `${allocation.quantity} ${line.item.uom} available — it was consumed while this ` +
                'issue was being prepared. Nothing has been dispensed; review the plan and retry.',
            );
          }

          await tx.materialIssueLine.create({
            data: {
              tenantId,
              materialIssueId: issue.id,
              itemId: line.item.id,
              lotId: allocation.lotId,
              quantityIssued: new Prisma.Decimal(allocation.quantity),
            },
          });
        }
      }

      await tx.productionOrder.update({
        where: { id: order.id },
        data: { status: 'MATERIAL_ISSUED' },
      });

      const saved = await tx.materialIssue.findUniqueOrThrow({
        where: { id: issue.id },
        include: {
          issuedBy: { select: { fullName: true } },
          lines: { include: { item: true, lot: true } },
        },
      });

      return this.toView(saved);
    });
  }

  async listForOrder(productionOrderId: string): Promise<MaterialIssueView[]> {
    const issues = await this.prisma.scoped.materialIssue.findMany({
      where: { productionOrderId },
      include: {
        issuedBy: { select: { fullName: true } },
        lines: { include: { item: true, lot: true } },
      },
      orderBy: { issuedAt: 'desc' },
    });

    return issues.map((issue) => this.toView(issue));
  }

  /**
   * Chooses lots for one material, earliest expiry first.
   *
   * Stops as soon as the requirement is met, and returns a partial allocation
   * rather than throwing when it cannot be — the caller decides whether a
   * shortfall is an error (issuing) or information (previewing).
   */
  private async allocate(itemId: string, required: Prisma.Decimal) {
    const earliestUsableExpiry = new Date();
    earliestUsableExpiry.setUTCDate(
      earliestUsableExpiry.getUTCDate() + MaterialIssueService.MINIMUM_SHELF_LIFE_DAYS,
    );

    const lots = await this.prisma.scoped.materialLot.findMany({
      where: {
        itemId,
        // Only released stock. Quarantined material has not passed incoming QC
        // and rejected material never will; both stay visible in the register
        // and unpickable here.
        status: 'USABLE',
        deletedAt: null,
        quantityAvailable: { gt: 0 },
        expiryDate: { gte: earliestUsableExpiry },
      },
      // FEFO. `lotNumber` breaks ties so the order is deterministic — two lots
      // sharing an expiry date must not be picked in whatever order the planner
      // happens to return, or the same plan would issue differently twice.
      orderBy: [{ expiryDate: 'asc' }, { lotNumber: 'asc' }],
    });

    const allocations: { lot: (typeof lots)[number]; quantity: Prisma.Decimal }[] = [];
    let outstanding = required;

    for (const lot of lots) {
      if (outstanding.lessThanOrEqualTo(ZERO)) break;

      const take = Prisma.Decimal.min(outstanding, lot.quantityAvailable);

      allocations.push({ lot, quantity: this.round(take) });
      outstanding = outstanding.sub(take);
    }

    return allocations;
  }

  /** Decimal(14,3) is what the column holds; rounding here keeps the arithmetic honest. */
  private round(value: Prisma.Decimal): Prisma.Decimal {
    return value.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  }

  private toView(issue: {
    id: string;
    issuedAt: Date;
    notes: string | null;
    issuedBy: { fullName: string } | null;
    lines: {
      id: string;
      quantityIssued: Prisma.Decimal;
      item: Parameters<typeof toItemSummary>[0];
      lot: { lotNumber: string; expiryDate: Date };
    }[];
  }): MaterialIssueView {
    return {
      id: issue.id,
      issuedAt: issue.issuedAt.toISOString(),
      issuedBy: issue.issuedBy?.fullName ?? null,
      notes: issue.notes,
      lines: issue.lines.map((line) => ({
        id: line.id,
        item: toItemSummary(line.item),
        lotNumber: line.lot.lotNumber,
        expiryDate: toIsoDate(line.lot.expiryDate),
        quantityIssued: line.quantityIssued.toString(),
      })),
    };
  }
}
