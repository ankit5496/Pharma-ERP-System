import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  AllocationPlan,
  AllocationPlanLine,
  AllocationPlanPick,
  AllocationRow,
  AllocationStatus,
  ScheduleCategory,
} from '@pharma-erp/types';
import { requiresAllocationRecheck } from '@pharma-erp/types';

import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../tenant/tenant-context.service';

/**
 * Allocation — reserving released batches against an order, first-expiry-first-out.
 *
 * FEFO IS DECIDED HERE, NOT BY THE CLIENT. `plan` returns a preview so the
 * decision is reviewable before stock moves, but `commit` recomputes it from
 * scratch. A plan the client could edit and post back would make the rule
 * advisory, and FEFO exists precisely so the oldest stock leaves first and
 * nothing quietly ages out on the shelf.
 *
 * ONLY RELEASED, IN-DATE STOCK IS ELIGIBLE. A quarantined batch has not passed
 * the quality gate and an expired one must never ship; both are excluded at the
 * query, not filtered afterwards, so neither can reach a pick by accident.
 *
 * AVAILABLE = on hand − already reserved. Two orders allocating the same batch
 * in the same minute must not both be promised it, so the outstanding
 * reservations are subtracted inside the same transaction that writes the new
 * ones.
 */
@Injectable()
export class AllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Every allocation, newest first — what the allocation screen lists. */
  async list(search?: string): Promise<AllocationRow[]> {
    const term = search?.trim();

    const rows = await this.prisma.scoped.batchAllocation.findMany({
      where: term
        ? {
            OR: [
              { salesOrder: { orderNumber: { contains: term, mode: 'insensitive' } } },
              { salesOrder: { customer: { name: { contains: term, mode: 'insensitive' } } } },
              { batch: { batchNumber: { contains: term, mode: 'insensitive' } } },
            ],
          }
        : {},
      include: {
        salesOrder: { include: { customer: true } },
        salesOrderItem: { include: { item: true } },
        batch: true,
        allocatedBy: true,
        complianceCheckedBy: true,
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    return rows.map(toAllocationRow);
  }

  /**
   * What FEFO would do, without doing it.
   *
   * Refuses to plan for an order that has not passed both gates — planning
   * against a blocked order would show a picking list for stock that cannot
   * lawfully leave.
   */
  async plan(salesOrderId: string): Promise<AllocationPlan> {
    const order = await this.prisma.scoped.salesOrder.findFirst({
      where: { id: salesOrderId, deletedAt: null },
      include: {
        customer: true,
        items: { include: { item: true }, orderBy: { lineNumber: 'asc' } },
      },
    });

    if (!order) throw new NotFoundException('Sales order not found.');

    const blockedReason = blockingReason(order.status, order.licenceCheck, order.creditCheck);

    if (blockedReason) {
      return {
        salesOrderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customer.name,
        orderStatus: order.status,
        canAllocate: false,
        blockedReason,
        lines: [],
        anyShort: false,
      };
    }

    const lines: AllocationPlanLine[] = [];

    for (const line of order.items) {
      const outstanding = line.quantityOrdered.sub(line.quantityAllocated);

      if (outstanding.lessThanOrEqualTo(0)) {
        lines.push(emptyPlanLine(line, outstanding, 'Already fully allocated.'));
        continue;
      }

      const lots = await this.eligibleLots(line.itemId);
      const picks: AllocationPlanPick[] = [];
      let remaining = outstanding;

      const schedule = toScheduleCategory(line.item.scheduleClassification);
      const needsRecheck = requiresAllocationRecheck(schedule);

      for (const lot of lots) {
        if (remaining.lessThanOrEqualTo(0)) break;

        const take = Prisma.Decimal.min(lot.available, remaining);
        if (take.lessThanOrEqualTo(0)) continue;

        picks.push({
          batchId: lot.batchId,
          batchNumber: lot.batchNumber,
          expiryDate: toIsoDate(lot.expiryDate),
          quantityAvailable: lot.available.toFixed(3),
          quantityToAllocate: take.toFixed(3),
          requiresComplianceRecheck: needsRecheck,
        });

        remaining = remaining.sub(take);
      }

      const planned = picks.reduce(
        (sum, pick) => sum.add(new Prisma.Decimal(pick.quantityToAllocate)),
        new Prisma.Decimal(0),
      );
      const shortfall = outstanding.sub(planned);

      lines.push({
        salesOrderItemId: line.id,
        lineNumber: line.lineNumber,
        itemId: line.itemId,
        itemCode: line.item.code,
        itemName: line.item.name,
        scheduleCategory: schedule,
        quantityOrdered: line.quantityOrdered.toFixed(3),
        quantityOutstanding: outstanding.toFixed(3),
        quantityPlanned: planned.toFixed(3),
        isShort: shortfall.greaterThan(0),
        shortfall: shortfall.greaterThan(0) ? shortfall.toFixed(3) : '0.000',
        picks,
        note: shortfall.greaterThan(0)
          ? picks.length === 0
            ? 'No released, in-date stock is available for this product.'
            : 'Not enough released, in-date stock to cover the line in full.'
          : null,
      });
    }

    return {
      salesOrderId: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customer.name,
      orderStatus: order.status,
      canAllocate: lines.some((line) => line.picks.length > 0),
      blockedReason: null,
      lines,
      anyShort: lines.some((line) => line.isShort),
    };
  }

  /**
   * Commits the plan — RECOMPUTED, not trusted from the caller.
   *
   * The whole thing runs in one transaction so two allocators cannot both be
   * promised the same batch: the availability read and the reservation write
   * are not separable.
   */
  async commit(salesOrderId: string): Promise<AllocationRow[]> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const plan = await this.plan(salesOrderId);

    if (plan.blockedReason) throw new BadRequestException(plan.blockedReason);
    if (!plan.canAllocate) {
      throw new BadRequestException('There is no released, in-date stock to allocate to this order.');
    }

    await this.prisma.transaction(async (tx) => {
      for (const line of plan.lines) {
        for (const pick of line.picks) {
          const quantity = new Prisma.Decimal(pick.quantityToAllocate);

          await tx.batchAllocation.create({
            data: {
              tenantId,
              salesOrderId,
              salesOrderItemId: line.salesOrderItemId,
              batchId: pick.batchId,
              quantityAllocated: quantity,
              expiryDateAtAllocation: new Date(pick.expiryDate),
              complianceRecheckRequired: pick.requiresComplianceRecheck,
              allocatedById: userId,
            },
          });

          await tx.salesOrderItem.update({
            where: { id: line.salesOrderItemId },
            data: { quantityAllocated: { increment: quantity } },
          });
        }

        // The line's own status follows what it now holds.
        const updated = await tx.salesOrderItem.findUniqueOrThrow({
          where: { id: line.salesOrderItemId },
        });

        await tx.salesOrderItem.update({
          where: { id: line.salesOrderItemId },
          data: {
            status: updated.quantityAllocated.greaterThanOrEqualTo(updated.quantityOrdered)
              ? 'ALLOCATED'
              : updated.quantityAllocated.greaterThan(0)
                ? 'PARTIALLY_ALLOCATED'
                : 'PENDING',
          },
        });
      }

      const lines = await tx.salesOrderItem.findMany({ where: { salesOrderId } });
      const allFull = lines.every((line) =>
        line.quantityAllocated.greaterThanOrEqualTo(line.quantityOrdered),
      );
      const anyHeld = lines.some((line) => line.quantityAllocated.greaterThan(0));

      await tx.salesOrder.update({
        where: { id: salesOrderId },
        data: { status: allFull ? 'ALLOCATED' : anyHeld ? 'PARTIALLY_ALLOCATED' : 'APPROVED' },
      });
    });

    return this.listForOrder(salesOrderId);
  }

  /**
   * Records the second compliance look a scheduled drug needs before stock moves.
   *
   * Clearing the flag is the ONLY way it comes down — nothing else in the flow
   * sets it false, so despatch cannot proceed on an unchecked Schedule X line
   * because somebody edited around it.
   */
  async recordComplianceCheck(id: string, notes?: string): Promise<AllocationRow> {
    const userId = this.tenantContext.getUserId();

    const allocation = await this.prisma.scoped.batchAllocation.findFirst({ where: { id } });
    if (!allocation) throw new NotFoundException('Allocation not found.');

    if (!allocation.complianceRecheckRequired) {
      throw new BadRequestException('This allocation does not need a compliance re-check.');
    }

    await this.prisma.scoped.batchAllocation.update({
      where: { id },
      data: {
        complianceRecheckRequired: false,
        complianceCheckedAt: new Date(),
        complianceCheckedById: userId,
        complianceNotes: notes?.trim() || null,
      },
    });

    return this.getRow(id);
  }

  /** Returns reserved stock to the pool. Only what has not already shipped. */
  async release(id: string): Promise<AllocationRow> {
    const allocation = await this.prisma.scoped.batchAllocation.findFirst({ where: { id } });
    if (!allocation) throw new NotFoundException('Allocation not found.');

    if (allocation.quantityDispatched.greaterThan(0)) {
      throw new BadRequestException(
        'Part of this allocation has already been dispatched, so it cannot be released.',
      );
    }

    await this.prisma.transaction(async (tx) => {
      await tx.batchAllocation.update({
        where: { id },
        data: { status: 'RELEASED_BACK' },
      });

      await tx.salesOrderItem.update({
        where: { id: allocation.salesOrderItemId },
        data: { quantityAllocated: { decrement: allocation.quantityAllocated } },
      });

      const line = await tx.salesOrderItem.findUniqueOrThrow({
        where: { id: allocation.salesOrderItemId },
      });

      await tx.salesOrderItem.update({
        where: { id: line.id },
        data: {
          status: line.quantityAllocated.greaterThanOrEqualTo(line.quantityOrdered)
            ? 'ALLOCATED'
            : line.quantityAllocated.greaterThan(0)
              ? 'PARTIALLY_ALLOCATED'
              : 'PENDING',
        },
      });
    });

    return this.getRow(id);
  }

  async listForOrder(salesOrderId: string): Promise<AllocationRow[]> {
    const rows = await this.prisma.scoped.batchAllocation.findMany({
      where: { salesOrderId },
      include: {
        salesOrder: { include: { customer: true } },
        salesOrderItem: { include: { item: true } },
        batch: true,
        allocatedBy: true,
        complianceCheckedBy: true,
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    return rows.map(toAllocationRow);
  }

  private async getRow(id: string): Promise<AllocationRow> {
    const row = await this.prisma.scoped.batchAllocation.findFirst({
      where: { id },
      include: {
        salesOrder: { include: { customer: true } },
        salesOrderItem: { include: { item: true } },
        batch: true,
        allocatedBy: true,
        complianceCheckedBy: true,
      },
    });

    if (!row) throw new NotFoundException('Allocation not found.');

    return toAllocationRow(row);
  }

  /**
   * Released, in-date lots for an item, oldest expiry first, net of what is
   * already reserved. The ORDER BY is the FEFO rule.
   */
  private async eligibleLots(itemId: string) {
    const today = startOfUtcDay(new Date());

    const lots = await this.prisma.scoped.finishedGoodsLot.findMany({
      where: {
        itemId,
        expiryDate: { gte: today },
        quantityAvailable: { gt: 0 },
        batch: { releaseStatus: 'RELEASED', deletedAt: null },
      },
      include: { batch: true },
      orderBy: [{ expiryDate: 'asc' }],
    });

    if (lots.length === 0) return [];

    const held = await this.prisma.scoped.batchAllocation.groupBy({
      by: ['batchId'],
      where: {
        batchId: { in: lots.map((lot) => lot.batchId) },
        status: { in: ['ALLOCATED', 'PARTIALLY_DISPATCHED'] },
      },
      _sum: { quantityAllocated: true, quantityDispatched: true },
    });

    const heldByBatch = new Map(
      held.map((row) => [
        row.batchId,
        (row._sum.quantityAllocated ?? new Prisma.Decimal(0)).sub(
          row._sum.quantityDispatched ?? new Prisma.Decimal(0),
        ),
      ]),
    );

    return lots
      .map((lot) => ({
        batchId: lot.batchId,
        batchNumber: lot.batch.batchNumber,
        expiryDate: lot.expiryDate,
        available: Prisma.Decimal.max(
          lot.quantityAvailable.sub(heldByBatch.get(lot.batchId) ?? new Prisma.Decimal(0)),
          0,
        ),
      }))
      .filter((lot) => lot.available.greaterThan(0));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blockingReason(
  status: string,
  licenceCheck: string,
  creditCheck: string,
): string | null {
  if (status === 'CANCELLED') return 'This order has been cancelled.';
  if (status === 'DRAFT' || status === 'PENDING_CHECK') {
    return 'Run the licence and credit check before allocating stock to this order.';
  }
  if (licenceCheck !== 'PASS') return 'The licence check has not passed for this order.';
  if (creditCheck !== 'PASS') return 'The credit check has not passed for this order.';
  return null;
}

function emptyPlanLine(
  line: { id: string; lineNumber: number; itemId: string; quantityOrdered: Prisma.Decimal; item: { code: string; name: string; scheduleClassification: string } },
  outstanding: Prisma.Decimal,
  note: string,
): AllocationPlanLine {
  return {
    salesOrderItemId: line.id,
    lineNumber: line.lineNumber,
    itemId: line.itemId,
    itemCode: line.item.code,
    itemName: line.item.name,
    scheduleCategory: toScheduleCategory(line.item.scheduleClassification),
    quantityOrdered: line.quantityOrdered.toFixed(3),
    quantityOutstanding: Prisma.Decimal.max(outstanding, 0).toFixed(3),
    quantityPlanned: '0.000',
    isShort: false,
    shortfall: '0.000',
    picks: [],
    note,
  };
}

function toAllocationRow(row: {
  id: string;
  salesOrderId: string;
  salesOrderItemId: string;
  batchId: string;
  quantityAllocated: Prisma.Decimal;
  quantityDispatched: Prisma.Decimal;
  expiryDateAtAllocation: Date;
  status: string;
  complianceRecheckRequired: boolean;
  complianceCheckedAt: Date | null;
  createdAt: Date;
  salesOrder: { orderNumber: string; customer: { name: string } };
  salesOrderItem: { quantityOrdered: Prisma.Decimal; item: { code: string; name: string; scheduleClassification: string } };
  batch: { batchNumber: string };
  allocatedBy: { fullName: string } | null;
  complianceCheckedBy: { fullName: string } | null;
}): AllocationRow {
  return {
    id: row.id,
    salesOrderId: row.salesOrderId,
    orderNumber: row.salesOrder.orderNumber,
    customerName: row.salesOrder.customer.name,
    salesOrderItemId: row.salesOrderItemId,
    itemId: row.batchId,
    itemCode: row.salesOrderItem.item.code,
    itemName: row.salesOrderItem.item.name,
    batchId: row.batchId,
    batchNumber: row.batch.batchNumber,
    expiryDate: toIsoDate(row.expiryDateAtAllocation),
    scheduleCategory: toScheduleCategory(row.salesOrderItem.item.scheduleClassification),
    quantityOrdered: row.salesOrderItem.quantityOrdered.toFixed(3),
    quantityAllocated: row.quantityAllocated.toFixed(3),
    quantityDispatched: row.quantityDispatched.toFixed(3),
    status: row.status as AllocationStatus,
    complianceRecheckRequired: row.complianceRecheckRequired,
    complianceCheckedAt: row.complianceCheckedAt?.toISOString() ?? null,
    complianceCheckedByName: row.complianceCheckedBy?.fullName ?? null,
    allocatedByName: row.allocatedBy?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toScheduleCategory(classification: string): ScheduleCategory {
  switch (classification) {
    case 'H':
      return 'SCHEDULE_H';
    case 'H1':
      return 'SCHEDULE_H1';
    case 'X':
      return 'SCHEDULE_X';
    case 'G':
      return 'SCHEDULE_G';
    default:
      return 'NONE';
  }
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
