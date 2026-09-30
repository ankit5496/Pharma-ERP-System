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
 * Allocation — reserving the batch that was MADE FOR this order.
 *
 * THERE IS NO BATCH SELECTION HERE, AND NO FEFO. Which batch fills an order is
 * decided long before this point: a work order names the sales order it fills
 * (`production_orders.sales_order_id`), and when the quality gate releases the
 * batch it tags the finished-goods lot with that same order
 * (`finished_goods_lots.sales_order_id`). Allocation only CHECKS that tag. It
 * does not rank batches, does not read expiry to choose between them, and never
 * falls back to stock made for somebody else — a batch carrying another
 * customer's order is not a substitute, it is a different promise.
 *
 * WHAT IS VERIFIED, per order line:
 *
 *   the lot is tagged with THIS sales order
 *   its batch is RELEASED — on-hold and rejected batches have no lot to find
 *   it has not expired
 *   the released quantity covers the line
 *
 * ALL OR NOTHING. The released quantity is expected to meet or exceed what was
 * ordered, so a line that falls short is a fault upstream rather than a partial
 * despatch to plan around: nothing is reserved and the shortage is named.
 *
 * AVAILABLE = on hand − already reserved. Allocating twice against the same lot
 * must not promise the same units twice, so outstanding reservations are
 * subtracted before anything is picked.
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
   * The match check, without committing it.
   *
   * Reports per line whether a batch released FOR THIS ORDER exists and covers
   * it. Refuses to plan for an order that has not passed both gates — planning
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

      // Only what was released FOR THIS ORDER. Not "what is on the shelf" —
      // the sales order is part of the query, so a batch made for another
      // customer is not in the result at all and cannot be reached by an
      // oversight further down this method.
      const lots = await this.releasedLotsForOrder(salesOrderId, line.itemId);

      const released = lots.reduce((sum, lot) => sum.add(lot.available), new Prisma.Decimal(0));
      const picks: AllocationPlanPick[] = [];

      const schedule = toScheduleCategory(line.item.scheduleClassification);

      // Nothing is picked unless the line is covered in full. Reserving part of
      // it would lock stock away for a despatch that cannot go, and the release
      // is expected to meet the order — a short one is a fault to fix upstream,
      // not a plan to work around.
      if (released.greaterThanOrEqualTo(outstanding)) {
        let remaining = outstanding;

        // Taken in the order the lots were released. NOT by expiry: when a work
        // order yields more than one batch they are all this order's, so no
        // choice is being made here — only a deterministic walk through stock
        // that is already spoken for.
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
        // Two different problems with two different answers: nothing has been
        // made for this order yet, or what was made does not cover it. Naming
        // which one saves a hunt through production for a batch that was never
        // raised.
        note: shortfall.greaterThan(0)
          ? lots.length === 0
            ? `No batch has been released for ${order.orderNumber}. ${line.item.code} has to be made on a work order raised for this order and passed by the quality gate before it can be allocated.`
            : `Insufficient released quantity for ${line.item.name}. Ordered: ${quantity(outstanding)}. Released: ${quantity(released)}. Short: ${quantity(shortfall)}.`
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
   * The caller sends an order id and nothing else. There is no batch in the
   * payload to nominate, which is what keeps "the batch released for this
   * order" from being negotiable at the edge.
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
      // The per-line note already says which problem it is — no batch released
      // for this order, or one that does not cover the line — so it is quoted
      // rather than restated. A bare "no stock available" sent people looking
      // for a bug when the shelf was full of somebody else's batch.
      const shortfalls = plan.lines
        .filter((line) => line.isShort)
        .map((line) => line.note ?? `${line.itemCode} is short by ${line.shortfall}.`)
        .join(' ');

      throw new BadRequestException(`Nothing has been reserved. ${shortfalls}`);
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
   * THE BATCH IS NOT CHANGEABLE. Which batch is reserved was settled when the
   * quality gate released it for this order; editing it by hand would put stock
   * made for one customer against another's order. Reserving a different batch
   * is a release and a re-allocation, which leaves the release on record.
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
   * The lots released FOR ONE ORDER, of one product.
   *
   * THE SALES ORDER IS IN THE QUERY, not applied afterwards. `sales_order_id`
   * is written onto the lot by the quality gate at release, from the work order
   * that named the order it was making for; matching on it here is the whole of
   * the allocation decision. A lot tagged with a different order — or with none
   * at all, as job-work stock and anything released before that column existed
   * are — is not returned, so it cannot be allocated by accident.
   *
   * RELEASED ONLY, AND IN DATE. `release_status` is checked even though a lot
   * exists only for a released batch: a batch can be put on hold after the
   * fact, and the tag alone must not outlive the quality verdict. Expiry is a
   * SAFETY FILTER, not a ranking — expired stock cannot ship whoever it was
   * made for. Nothing here orders by expiry.
   *
   * Net of live reservations, so allocating twice against the same lot cannot
   * promise the same units twice.
   */
  private async releasedLotsForOrder(salesOrderId: string, itemId: string) {
    const today = startOfUtcDay(new Date());

    const lots = await this.prisma.scoped.finishedGoodsLot.findMany({
      where: {
        salesOrderId,
        itemId,
        expiryDate: { gte: today },
        quantityAvailable: { gt: 0 },
        batch: { releaseStatus: 'RELEASED', deletedAt: null },
      },
      include: { batch: true },
      // Oldest release first, and the id to break a tie. A stable order so two
      // runs of the same plan pick the same lots — not a selection rule, since
      // every lot here belongs to this order and all of them are used if the
      // line needs them.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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

/**
 * A quantity for a person: "5000" rather than "5000.000", "2.5" kept as "2.5".
 * For the refusal messages only — stored values are untouched.
 */
function quantity(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(3).toString();
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
