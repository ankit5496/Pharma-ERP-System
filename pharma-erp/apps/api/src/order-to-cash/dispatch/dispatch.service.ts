import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type { DispatchDetail, DispatchListItem, DispatchItemView } from '@pharma-erp/types';

import { NumberingService } from '../../procurement/numbering.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../tenant/tenant-context.service';

import type { CreateDispatchDto } from './dto/dispatch.dto';

/**
 * Despatch — picking, packing and shipping what allocation reserved.
 *
 * THE COMPLIANCE GATE IS ENFORCED HERE, not only shown. An allocation whose
 * `complianceRecheckRequired` is still set cannot be despatched: Schedule H1,
 * H1X and X need a second look before the stock physically leaves, and this is
 * the last point at which refusing it is still cheap.
 *
 * STOCK LEAVES THE LOT WHEN THE VAN DOES. Confirming a despatch decrements
 * `finished_goods_lots.quantityAvailable` inside the same transaction that
 * records the movement, so on-hand and shipped cannot disagree.
 */
@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly numbering: NumberingService,
  ) {}

  async list(search?: string): Promise<DispatchListItem[]> {
    const term = search?.trim();

    const rows = await this.prisma.scoped.dispatch.findMany({
      where: {
        deletedAt: null,
        ...(term
          ? {
              OR: [
                { dispatchNumber: { contains: term, mode: 'insensitive' } },
                { salesOrder: { orderNumber: { contains: term, mode: 'insensitive' } } },
                { customer: { name: { contains: term, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { salesOrder: true, customer: true, salesInvoice: true, createdBy: true, items: true },
      orderBy: [{ dispatchDate: 'desc' }, { dispatchNumber: 'desc' }],
    });

    return rows.map(toListItem);
  }

  async get(id: string): Promise<DispatchDetail> {
    const row = await this.prisma.scoped.dispatch.findFirst({
      where: { id, deletedAt: null },
      include: {
        salesOrder: true,
        customer: true,
        salesInvoice: true,
        createdBy: true,
        items: {
          include: {
            batchAllocation: {
              include: { batch: true, salesOrderItem: { include: { item: true } } },
            },
          },
        },
      },
    });

    if (!row) throw new NotFoundException('Dispatch not found.');

    return {
      ...toListItem(row),
      notes: row.notes,
      items: row.items.map(toItemView),
    };
  }

  async create(dto: CreateDispatchDto): Promise<DispatchDetail> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const allocations = await this.prisma.scoped.batchAllocation.findMany({
      where: { id: { in: dto.lines.map((line) => line.batchAllocationId) } },
      include: { salesOrderItem: { include: { item: true } }, batch: true },
    });

    if (allocations.length !== dto.lines.length) {
      throw new BadRequestException('One or more allocations on this dispatch do not exist.');
    }

    const orderIds = new Set(allocations.map((a) => a.salesOrderId));
    if (orderIds.size !== 1) {
      throw new BadRequestException('A dispatch covers one sales order; these allocations span several.');
    }

    // Non-null: the size check above proves exactly one id is present.
    const salesOrderId = [...orderIds][0]!;
    const byId = new Map(allocations.map((a) => [a.id, a]));

    // Refuse the whole despatch if any line is unchecked or over-shipped. A
    // partial save would leave a picking list nobody can reconcile.
    for (const line of dto.lines) {
      const allocation = byId.get(line.batchAllocationId)!;
      const quantity = new Prisma.Decimal(line.quantityDispatched);

      if (allocation.complianceRecheckRequired) {
        throw new BadRequestException(
          `Batch ${allocation.batch.batchNumber} needs its compliance re-check recorded before it can be dispatched.`,
        );
      }

      if (allocation.status === 'RELEASED_BACK' || allocation.status === 'CANCELLED') {
        throw new BadRequestException(
          `Batch ${allocation.batch.batchNumber} is no longer reserved for this order.`,
        );
      }

      const remaining = allocation.quantityAllocated.sub(allocation.quantityDispatched);
      if (quantity.greaterThan(remaining)) {
        throw new BadRequestException(
          `Only ${remaining.toFixed(3)} remains allocated on batch ${allocation.batch.batchNumber}.`,
        );
      }
    }

    const order = await this.prisma.scoped.salesOrder.findFirstOrThrow({
      where: { id: salesOrderId },
    });

    const created = await this.prisma.transaction(async (tx) => {
      const dispatchNumber = await this.numbering.next(tx, tenantId, 'DSP');

      const total = dto.lines.reduce(
        (sum, line) => sum.add(new Prisma.Decimal(line.quantityDispatched)),
        new Prisma.Decimal(0),
      );

      const dispatch = await tx.dispatch.create({
        data: {
          tenantId,
          dispatchNumber,
          salesOrderId,
          customerId: order.customerId,
          dispatchDate: new Date(dto.dispatchDate),
          status: 'DRAFT',
          transporterName: dto.transporterName?.trim() || null,
          vehicleNumber: dto.vehicleNumber?.trim() || null,
          lrNumber: dto.lrNumber?.trim() || null,
          ewayBillNumber: dto.ewayBillNumber?.trim() || null,
          totalQuantity: total,
          notes: dto.notes?.trim() || null,
          createdById: userId,
          items: {
            create: dto.lines.map((line) => ({
              tenantId,
              batchAllocationId: line.batchAllocationId,
              quantityDispatched: new Prisma.Decimal(line.quantityDispatched),
            })),
          },
        },
        select: { id: true },
      });

      return dispatch;
    });

    return this.get(created.id);
  }

  /**
   * Confirms the despatch: stock leaves, allocations advance, the order moves on.
   *
   * One transaction, because a lot decremented without the matching allocation
   * update would show stock as gone and still reserved.
   */
  async confirm(id: string): Promise<DispatchDetail> {
    const dispatch = await this.prisma.scoped.dispatch.findFirst({
      where: { id, deletedAt: null },
      include: { items: { include: { batchAllocation: true } } },
    });

    if (!dispatch) throw new NotFoundException('Dispatch not found.');
    if (dispatch.status !== 'DRAFT') {
      throw new BadRequestException('Only a draft dispatch can be confirmed.');
    }

    await this.prisma.transaction(async (tx) => {
      for (const line of dispatch.items) {
        const allocation = line.batchAllocation;

        await tx.batchAllocation.update({
          where: { id: allocation.id },
          data: { quantityDispatched: { increment: line.quantityDispatched } },
        });

        const updated = await tx.batchAllocation.findUniqueOrThrow({ where: { id: allocation.id } });

        await tx.batchAllocation.update({
          where: { id: allocation.id },
          data: {
            status: updated.quantityDispatched.greaterThanOrEqualTo(updated.quantityAllocated)
              ? 'DISPATCHED'
              : 'PARTIALLY_DISPATCHED',
          },
        });

        await tx.salesOrderItem.update({
          where: { id: allocation.salesOrderItemId },
          data: { quantityDispatched: { increment: line.quantityDispatched } },
        });

        // The stock physically leaves here.
        await tx.finishedGoodsLot.updateMany({
          where: { batchId: allocation.batchId },
          data: { quantityAvailable: { decrement: line.quantityDispatched } },
        });
      }

      await tx.dispatch.update({ where: { id }, data: { status: 'DISPATCHED' } });

      const lines = await tx.salesOrderItem.findMany({ where: { salesOrderId: dispatch.salesOrderId } });
      const allShipped = lines.every((line) =>
        line.quantityDispatched.greaterThanOrEqualTo(line.quantityOrdered),
      );

      await tx.salesOrder.update({
        where: { id: dispatch.salesOrderId },
        data: { status: allShipped ? 'DISPATCHED' : 'PARTIALLY_ALLOCATED' },
      });
    });

    return this.get(id);
  }

  async markDelivered(id: string): Promise<DispatchDetail> {
    const dispatch = await this.prisma.scoped.dispatch.findFirst({ where: { id, deletedAt: null } });
    if (!dispatch) throw new NotFoundException('Dispatch not found.');

    if (dispatch.status !== 'DISPATCHED') {
      throw new BadRequestException('Only a dispatched consignment can be marked delivered.');
    }

    await this.prisma.scoped.dispatch.update({ where: { id }, data: { status: 'DELIVERED' } });

    return this.get(id);
  }
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toListItem(row: {
  id: string;
  dispatchNumber: string;
  salesOrderId: string;
  salesInvoiceId: string | null;
  customerId: string;
  dispatchDate: Date;
  status: string;
  transporterName: string | null;
  vehicleNumber: string | null;
  lrNumber: string | null;
  ewayBillNumber: string | null;
  totalQuantity: Prisma.Decimal;
  createdAt: Date;
  salesOrder: { orderNumber: string };
  customer: { name: string };
  salesInvoice: { invoiceNumber: string } | null;
  createdBy: { fullName: string } | null;
  items: unknown[];
}): DispatchListItem {
  return {
    id: row.id,
    dispatchNumber: row.dispatchNumber,
    salesOrderId: row.salesOrderId,
    orderNumber: row.salesOrder.orderNumber,
    salesInvoiceId: row.salesInvoiceId,
    invoiceNumber: row.salesInvoice?.invoiceNumber ?? null,
    customerId: row.customerId,
    customerName: row.customer.name,
    dispatchDate: toIsoDate(row.dispatchDate),
    status: row.status as DispatchListItem['status'],
    transporterName: row.transporterName,
    vehicleNumber: row.vehicleNumber,
    lrNumber: row.lrNumber,
    ewayBillNumber: row.ewayBillNumber,
    totalQuantity: row.totalQuantity.toFixed(3),
    itemCount: row.items.length,
    createdByName: row.createdBy?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toItemView(line: {
  id: string;
  batchAllocationId: string;
  quantityDispatched: Prisma.Decimal;
  batchAllocation: {
    batchId: string;
    expiryDateAtAllocation: Date;
    batch: { batchNumber: string };
    salesOrderItem: { itemId: string; item: { code: string; name: string } };
  };
}): DispatchItemView {
  return {
    id: line.id,
    batchAllocationId: line.batchAllocationId,
    itemId: line.batchAllocation.salesOrderItem.itemId,
    itemCode: line.batchAllocation.salesOrderItem.item.code,
    itemName: line.batchAllocation.salesOrderItem.item.name,
    batchId: line.batchAllocation.batchId,
    batchNumber: line.batchAllocation.batch.batchNumber,
    expiryDate: toIsoDate(line.batchAllocation.expiryDateAtAllocation),
    quantityDispatched: line.quantityDispatched.toFixed(3),
  };
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
