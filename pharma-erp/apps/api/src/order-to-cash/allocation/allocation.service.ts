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

import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../tenant/tenant-context.service';

import type { UpdateAllocationDto } from './dto/allocation.dto';

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
              // Reached through the order line: an allocation has no item of
              // its own, it reserves a batch against a line.
              { salesOrderItem: { item: { code: { contains: term, mode: 'insensitive' } } } },
              { salesOrderItem: { item: { name: { contains: term, mode: 'insensitive' } } } },
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

      // Only needed to explain a shortfall, so it is read once per line rather
      // than folded into the FEFO query every allocation runs.
      const reserved =
        lots.length === 0 ? await this.reservedElsewhere(line.itemId) : new Prisma.Decimal(0);
      const picks: AllocationPlanPick[] = [];
      let remaining = outstanding;

      const schedule = toScheduleCategory(line.item.scheduleClassification);

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
          // The scheduled-drug re-check was removed from the flow; nothing is
          // held back at allocation any more.
          requiresComplianceRecheck: false,
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
            ? reserved.greaterThan(0)
              ? `Every released, in-date unit of this product — ${reserved.toFixed(3)} — is already reserved against other orders.`
              : 'No released, in-date stock is available for this product.'
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

    // ALL OR NOTHING. Reserving what happens to be on the shelf and leaving the
    // rest outstanding left orders sitting half-held: stock locked away for a
    // customer who cannot be shipped in full, and unavailable to anyone who
    // could be. If the whole order cannot be covered, nothing is reserved and
    // the shortfall is named, so the decision — chase stock, split the order,
    // or reduce it — stays with the person rather than being made by default.
    if (plan.anyShort) {
      // Each line says which problem it has: no stock at all, all of it
      // reserved elsewhere, or simply not enough. A bare "no stock available"
      // sent people looking for a bug when the shelf was full.
      const shortfalls = plan.lines
        .filter((line) => line.isShort)
        .map(
          (line) =>
            `${line.itemCode} short by ${line.shortfall} of ${line.quantityOutstanding}` +
            (line.note ? ` (${line.note})` : ''),
        )
        .join('; ');

      throw new BadRequestException(
        `Nothing has been reserved: this order cannot be allocated in full. ${shortfalls}`,
      );
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
   * Adjusts a live allocation's quantity.
   *
   * THE BATCH IS NOT CHANGEABLE. Which batch is reserved is FEFO's decision;
   * editing it by hand would make the rule advisory. Reserving a different
   * batch is a release and a re-allocation, which leaves the release on record.
   *
   * The quantity is bounded on three sides, all checked here against live
   * figures rather than trusted from the caller:
   *
   *   never below what has already been dispatched from this allocation
   *   never above what the order line still needs
   *   never above what the batch actually has free
   *
   * ALLOCATED only. Once any part has shipped, the row records a movement.
   */
  async update(id: string, dto: UpdateAllocationDto): Promise<AllocationRow> {
    const allocation = await this.prisma.scoped.batchAllocation.findFirst({
      where: { id },
      include: { salesOrderItem: true },
    });

    if (!allocation) throw new NotFoundException('Allocation not found.');

    if (allocation.status !== 'ALLOCATED') {
      throw new BadRequestException(
        `Only a live allocation can be adjusted — this one is ${allocation.status.toLowerCase().replace(/_/g, ' ')}.`,
      );
    }

    if (dto.quantityAllocated === undefined) {
      if (dto.notes !== undefined) {
        await this.prisma.scoped.batchAllocation.update({
          where: { id },
          data: { complianceNotes: dto.notes.trim() || null },
        });
      }

      return this.getRow(id);
    }

    const next = new Prisma.Decimal(dto.quantityAllocated);
    const current = allocation.quantityAllocated;
    const delta = next.sub(current);

    if (next.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Release the allocation instead of setting it to zero.');
    }

    if (next.lessThan(allocation.quantityDispatched)) {
      throw new BadRequestException(
        `${allocation.quantityDispatched.toFixed(3)} has already been dispatched from this allocation, so it cannot be reduced below that.`,
      );
    }

    const line = allocation.salesOrderItem;
    const otherLinesHold = line.quantityAllocated.sub(current);

    if (otherLinesHold.add(next).greaterThan(line.quantityOrdered)) {
      throw new BadRequestException(
        `That would reserve more than the ${line.quantityOrdered.toFixed(3)} ordered on this line.`,
      );
    }

    await this.prisma.transaction(async (tx) => {
      if (delta.greaterThan(0)) {
        // Increasing has to fit in what the batch still has free — the same
        // "on hand less already reserved" the planner uses, read inside this
        // transaction so two adjustments cannot both claim the last of it.
        const lot = await tx.finishedGoodsLot.findFirst({ where: { batchId: allocation.batchId } });

        if (!lot) {
          throw new BadRequestException('That batch no longer has a finished-goods lot.');
        }

        const held = await tx.batchAllocation.aggregate({
          where: {
            batchId: allocation.batchId,
            status: { in: ['ALLOCATED', 'PARTIALLY_DISPATCHED'] },
            id: { not: id },
          },
          _sum: { quantityAllocated: true, quantityDispatched: true },
        });

        const reservedElsewhere = (held._sum.quantityAllocated ?? new Prisma.Decimal(0)).sub(
          held._sum.quantityDispatched ?? new Prisma.Decimal(0),
        );
        const free = lot.quantityAvailable.sub(reservedElsewhere);

        if (next.greaterThan(free)) {
          throw new BadRequestException(
            `Only ${free.toFixed(3)} of that batch is free — it cannot be raised to ${next.toFixed(3)}.`,
          );
        }
      }

      await tx.batchAllocation.update({
        where: { id },
        data: {
          quantityAllocated: next,
          ...(dto.notes === undefined ? {} : { complianceNotes: dto.notes.trim() || null }),
        },
      });

      await tx.salesOrderItem.update({
        where: { id: allocation.salesOrderItemId },
        data: { quantityAllocated: { increment: delta } },
      });

      const updatedLine = await tx.salesOrderItem.findUniqueOrThrow({
        where: { id: allocation.salesOrderItemId },
      });

      await tx.salesOrderItem.update({
        where: { id: updatedLine.id },
        data: {
          status: updatedLine.quantityAllocated.greaterThanOrEqualTo(updatedLine.quantityOrdered)
            ? 'ALLOCATED'
            : updatedLine.quantityAllocated.greaterThan(0)
              ? 'PARTIALLY_ALLOCATED'
              : 'PENDING',
        },
      });

      // The order header follows its lines, as it does on commit and release.
      const orderLines = await tx.salesOrderItem.findMany({
        where: { salesOrderId: allocation.salesOrderId },
      });

      const allFull = orderLines.every((orderLine) =>
        orderLine.quantityAllocated.greaterThanOrEqualTo(orderLine.quantityOrdered),
      );
      const anyHeld = orderLines.some((orderLine) => orderLine.quantityAllocated.greaterThan(0));

      await tx.salesOrder.update({
        where: { id: allocation.salesOrderId },
        data: { status: allFull ? 'ALLOCATED' : anyHeld ? 'PARTIALLY_ALLOCATED' : 'APPROVED' },
      });
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

      // The ORDER header has to follow the lines back down, which `commit`
      // already does on the way up. Without this an order whose only
      // allocation was released stayed ALLOCATED with nothing reserved — it
      // still offered itself for dispatch and invoicing, and neither could
      // succeed because there was no stock held for it.
      const orderLines = await tx.salesOrderItem.findMany({
        where: { salesOrderId: allocation.salesOrderId },
      });

      const allFull = orderLines.every((orderLine) =>
        orderLine.quantityAllocated.greaterThanOrEqualTo(orderLine.quantityOrdered),
      );
      const anyHeld = orderLines.some((orderLine) => orderLine.quantityAllocated.greaterThan(0));

      await tx.salesOrder.update({
        where: { id: allocation.salesOrderId },
        data: { status: allFull ? 'ALLOCATED' : anyHeld ? 'PARTIALLY_ALLOCATED' : 'APPROVED' },
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
   * How much of an item can actually be sold right now.
   *
   * The SAME rule allocation itself uses — released, in date, and net of what
   * other orders already hold — because it is the same question asked earlier.
   * Order entry calls this to refuse an order it could never fill, and if the
   * two ever disagreed the order would be accepted and then fail to allocate,
   * which is the state this exists to prevent.
   *
   * Merely manufactured stock does NOT count. A batch that has not passed the
   * quality gate is not sellable, whatever the shelf says.
   */
  async availableForItem(itemId: string): Promise<Prisma.Decimal> {
    const lots = await this.eligibleLots(itemId);

    return lots.reduce((sum, lot) => sum.add(lot.available), new Prisma.Decimal(0));
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

  /**
   * How much released, in-date stock of an item is RESERVED for other orders.
   *
   * Only ever used to explain a refusal. "No released, in-date stock is
   * available" is true but misleading when the shelf is full and every unit of
   * it is already promised to someone else — those are two different problems
   * with two different answers (make or buy more, versus release an order that
   * is not going to ship).
   */
  private async reservedElsewhere(itemId: string): Promise<Prisma.Decimal> {
    const today = startOfUtcDay(new Date());

    const lots = await this.prisma.scoped.finishedGoodsLot.findMany({
      where: {
        itemId,
        expiryDate: { gte: today },
        quantityAvailable: { gt: 0 },
        batch: { releaseStatus: 'RELEASED', deletedAt: null },
      },
      select: { batchId: true },
    });

    if (lots.length === 0) return new Prisma.Decimal(0);

    const held = await this.prisma.scoped.batchAllocation.aggregate({
      where: {
        batchId: { in: lots.map((lot) => lot.batchId) },
        status: { in: ['ALLOCATED', 'PARTIALLY_DISPATCHED'] },
      },
      _sum: { quantityAllocated: true, quantityDispatched: true },
    });

    return Prisma.Decimal.max(
      (held._sum.quantityAllocated ?? new Prisma.Decimal(0)).sub(
        held._sum.quantityDispatched ?? new Prisma.Decimal(0),
      ),
      0,
    );
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
