import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  GoodsReceiptListItem,
  GoodsReceiptLineItem,
  ProcurementListQuery,
} from '@pharma-erp/types';

import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import { parseNonNegative, parsePositive, positiveDifference, qty } from './decimal.util';
import type { CreateGoodsReceiptDto } from './dto/goods-receipt.dto';
import { dateRange } from './filters.util';
import {
  ITEM_SELECT,
  LOT_SELECT,
  PARTY_SELECT,
  collectIds,
  toItemSummary,
  toPartySummary,
  toStockLotSummary,
} from './mappers';
import { NumberingService } from './numbering.service';
import { PeopleService } from './people.service';

const GRN_INCLUDE = {
  vendor: { select: PARTY_SELECT },
  purchaseOrder: { select: { id: true, number: true, status: true } },
  purchaseInvoices: {
    where: { deletedAt: null },
    select: { id: true, number: true, vendorInvoiceNumber: true },
  },
  lines: {
    include: {
      item: { select: ITEM_SELECT },
      purchaseOrderLine: { select: { id: true, quantity: true } },
      stockLot: { select: LOT_SELECT },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.GoodsReceiptInclude;

type GrnRow = Prisma.GoodsReceiptGetPayload<{ include: typeof GRN_INCLUDE }>;

/**
 * Goods receipt: material physically arriving against a purchase order.
 *
 * Two rules are enforced here and nowhere else, because this is the only place
 * material enters the system:
 *
 *   Rule 4/5 — every received line is BATCH TRACKED. For an item marked
 *   `requiresBatchTracking` the vendor's batch number and expiry date are
 *   mandatory, and the receipt is refused without them. Anonymous raw material
 *   cannot be recalled, cannot be picked FEFO, and cannot be defended in an
 *   inspection.
 *
 *   Rule 6 — a receipt NEVER produces usable stock. Every lot is created
 *   QUARANTINE and the ledger entry that accompanies it is explicitly marked
 *   as not affecting usable stock. Only the QC service can change that.
 */
@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly people: PeopleService,
    private readonly numbering: NumberingService,
  ) {}

  async list(query: ProcurementListQuery): Promise<GoodsReceiptListItem[]> {
    const where: Prisma.GoodsReceiptWhereInput = { deletedAt: null };

    if (query.vendorId) where.vendorId = query.vendorId;
    if (query.itemId) where.lines = { some: { itemId: query.itemId } };

    const between = dateRange(query.dateFrom, query.dateTo);

    if (between) where.receiptDate = between;

    // A GRN has no status column of its own — its meaningful state is how far
    // QC has got with the lots it created, so the filter reads through them.
    if (query.status === 'QC_PENDING') {
      where.lines = { ...(where.lines ?? {}), some: { stockLot: { status: 'QUARANTINE' } } };
    } else if (query.status === 'QC_COMPLETE') {
      where.lines = { ...(where.lines ?? {}), every: { stockLot: { status: { not: 'QUARANTINE' } } } };
    }

    if (query.search) {
      const search = query.search.trim();

      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { vendorDocumentNumber: { contains: search, mode: 'insensitive' } },
        { vendor: { name: { contains: search, mode: 'insensitive' } } },
        { purchaseOrder: { number: { contains: search, mode: 'insensitive' } } },
        { lines: { some: { vendorBatchNumber: { contains: search, mode: 'insensitive' } } } },
        { lines: { some: { item: { name: { contains: search, mode: 'insensitive' } } } } },
      ];
    }

    const rows = await this.prisma.scoped.goodsReceipt.findMany({
      where,
      include: GRN_INCLUDE,
      orderBy: [{ receiptDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });

    const people = await this.people.load(collectIds(...rows.map((row) => row.receivedById)));

    return rows.map((row) => this.toListItem(row, people));
  }

  async findOne(id: string): Promise<GoodsReceiptListItem> {
    const row = await this.requireReceipt(id);
    const people = await this.people.load(collectIds(row.receivedById));

    return this.toListItem(row, people);
  }

  /**
   * Books a receipt, creating one quarantined lot per line and posting the
   * matching ledger entries.
   *
   * All of it in one transaction: a lot without its ledger entry, or a receipt
   * that updated the order's fulfilment but created no lot, would each be a
   * silent inventory discrepancy that only a stock count would ever surface.
   */
  async create(dto: CreateGoodsReceiptDto): Promise<GoodsReceiptListItem> {
    const tenantId = this.tenantContext.requireTenantId();
    const receivedById = this.requireActingUser();

    if (dto.lines.length === 0) {
      throw new BadRequestException('A goods receipt needs at least one line.');
    }

    const order = await this.prisma.scoped.purchaseOrder.findFirst({
      where: { id: dto.purchaseOrderId, deletedAt: null },
      include: {
        vendor: { select: { id: true, name: true } },
        lines: { include: { item: { select: { ...ITEM_SELECT, requiresBatchTracking: true } } } },
      },
    });

    if (!order) throw new NotFoundException('Purchase order not found.');

    if (!['ISSUED', 'PARTIALLY_RECEIVED'].includes(order.status)) {
      throw new ConflictException(
        `Material cannot be received against a ${order.status.replace(/_/g, ' ').toLowerCase()} ` +
          'purchase order. Issue the order first.',
      );
    }

    const linesByLineId = new Map(order.lines.map((line) => [line.id, line]));

    // Validate every line before writing anything.
    const prepared = dto.lines.map((line) => {
      const orderLine = linesByLineId.get(line.purchaseOrderLineId);

      if (!orderLine) {
        throw new BadRequestException(
          'A receipt line refers to a purchase order line that is not on this order.',
        );
      }

      const quantityReceived = parsePositive(
        line.quantityReceived,
        `Quantity received for ${orderLine.item.code}`,
      );
      const quantityRejected = parseNonNegative(
        line.quantityRejected ?? '0',
        `Quantity rejected for ${orderLine.item.code}`,
      );

      if (quantityRejected.greaterThan(quantityReceived)) {
        throw new BadRequestException(
          `Rejected quantity cannot exceed received quantity for ${orderLine.item.code}.`,
        );
      }

      // Over-receipt is refused rather than silently accepted: it usually means
      // the wrong line was picked, and a quantity that exceeds the order also
      // exceeds what the vendor may invoice for.
      const alreadyReceived = new Prisma.Decimal(orderLine.quantityReceived);
      const outstanding = positiveDifference(
        new Prisma.Decimal(orderLine.quantity),
        alreadyReceived,
      );

      if (quantityReceived.greaterThan(outstanding)) {
        throw new ConflictException(
          `${orderLine.item.code}: receiving ${qty(quantityReceived)} would exceed the ` +
            `${qty(outstanding)} still outstanding on this order line.`,
        );
      }

      if (orderLine.item.requiresBatchTracking) {
        if (!line.vendorBatchNumber?.trim()) {
          throw new BadRequestException(
            `${orderLine.item.code} is batch tracked: the vendor batch number is required.`,
          );
        }

        if (!line.expiryDate) {
          throw new BadRequestException(
            `${orderLine.item.code} is batch tracked: the expiry date is required.`,
          );
        }
      }

      const manufacturingDate = line.manufacturingDate ? new Date(line.manufacturingDate) : null;
      const expiryDate = line.expiryDate ? new Date(line.expiryDate) : null;

      if (manufacturingDate && expiryDate && expiryDate <= manufacturingDate) {
        throw new BadRequestException(
          `${orderLine.item.code}: the expiry date must be after the manufacturing date.`,
        );
      }

      return {
        orderLine,
        quantityReceived,
        quantityRejected,
        // What actually enters quarantine: everything not refused at the gate.
        quantityToQuarantine: quantityReceived.minus(quantityRejected),
        vendorBatchNumber: line.vendorBatchNumber?.trim() || null,
        manufacturingDate,
        expiryDate,
        storageLocation: line.storageLocation?.trim() || null,
        remarks: line.remarks?.trim() || null,
      };
    });

    const created = await this.prisma.transaction(async (tx) => {
      const number = await this.numbering.next(tx, tenantId, 'GRN');

      const receipt = await tx.goodsReceipt.create({
        data: {
          tenantId,
          number,
          purchaseOrderId: order.id,
          // From the order, never from the request body — the same rule the
          // rest of this codebase applies to tenant ids.
          vendorId: order.vendorId,
          receiptDate: dto.receiptDate ? new Date(dto.receiptDate) : new Date(),
          vendorDocumentNumber: dto.vendorDocumentNumber?.trim() || null,
          remarks: dto.remarks?.trim() || null,
          receivedById,
        },
      });

      for (const line of prepared) {
        const receiptLine = await tx.goodsReceiptLine.create({
          data: {
            tenantId,
            goodsReceiptId: receipt.id,
            purchaseOrderLineId: line.orderLine.id,
            itemId: line.orderLine.itemId,
            vendorBatchNumber: line.vendorBatchNumber,
            manufacturingDate: line.manufacturingDate,
            expiryDate: line.expiryDate,
            quantityReceived: line.quantityReceived,
            quantityRejected: line.quantityRejected,
            storageLocation: line.storageLocation,
            remarks: line.remarks,
          },
        });

        const lotNumber = await this.numbering.next(tx, tenantId, 'LOT');

        const lot = await tx.stockLot.create({
          data: {
            tenantId,
            lotNumber,
            itemId: line.orderLine.itemId,
            goodsReceiptLineId: receiptLine.id,
            vendorBatchNumber: line.vendorBatchNumber,
            manufacturingDate: line.manufacturingDate,
            expiryDate: line.expiryDate,
            quantityReceived: line.quantityToQuarantine,
            quantityAvailable: line.quantityToQuarantine,
            // Rule 6, in one word.
            status: 'QUARANTINE',
            storageLocation: line.storageLocation,
          },
        });

        await tx.stockLedgerEntry.create({
          data: {
            tenantId,
            itemId: line.orderLine.itemId,
            stockLotId: lot.id,
            entryType: 'GRN_QUARANTINE',
            quantityDelta: line.quantityToQuarantine,
            // The flag that keeps this out of every usable-stock figure.
            affectsUsableStock: false,
            reference: receipt.number,
            notes: `Received against ${order.number}, awaiting incoming QC.`,
            createdById: receivedById,
          },
        });

        await tx.purchaseOrderLine.update({
          where: { id: line.orderLine.id },
          data: { quantityReceived: { increment: line.quantityReceived } },
        });
      }

      // Recompute the order's status from what is now on its lines, rather
      // than inferring it from this receipt alone — several receipts may have
      // contributed and only the totals know the answer.
      const refreshedLines = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: order.id },
        select: { quantity: true, quantityReceived: true },
      });

      const fullyReceived = refreshedLines.every((line) =>
        new Prisma.Decimal(line.quantityReceived).greaterThanOrEqualTo(line.quantity),
      );

      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { status: fullyReceived ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED' },
      });

      return tx.goodsReceipt.findFirstOrThrow({
        where: { id: receipt.id },
        include: GRN_INCLUDE,
      });
    });

    await this.audit.record({
      entityType: 'GoodsReceipt',
      entityId: created.id,
      action: 'CREATE',
      after: {
        number: created.number,
        purchaseOrder: order.number,
        vendor: order.vendor.name,
        lines: created.lines.length,
        lots: created.lines.map((line) => line.stockLot?.lotNumber).filter(Boolean),
      },
    });

    const people = await this.people.load(collectIds(created.receivedById));

    return this.toListItem(created, people);
  }

  async requireReceipt(id: string): Promise<GrnRow> {
    const row = await this.prisma.scoped.goodsReceipt.findFirst({
      where: { id, deletedAt: null },
      include: GRN_INCLUDE,
    });

    if (!row) throw new NotFoundException('Goods receipt not found.');

    return row;
  }

  private requireActingUser(): string {
    const userId = this.tenantContext.getUserId();

    if (!userId) {
      throw new BadRequestException('This action must be performed by a signed-in user.');
    }

    return userId;
  }

  private toListItem(row: GrnRow, people: Map<string, string>): GoodsReceiptListItem {
    const lines = row.lines.map((line): GoodsReceiptLineItem => {
      const received = new Prisma.Decimal(line.quantityReceived);
      const rejected = new Prisma.Decimal(line.quantityRejected);

      return {
        id: line.id,
        item: toItemSummary(line.item),
        purchaseOrderLineId: line.purchaseOrderLineId,
        vendorBatchNumber: line.vendorBatchNumber,
        manufacturingDate: line.manufacturingDate?.toISOString().slice(0, 10) ?? null,
        expiryDate: line.expiryDate?.toISOString().slice(0, 10) ?? null,
        quantityOrdered: qty(line.purchaseOrderLine.quantity),
        quantityReceived: qty(received),
        quantityRejected: qty(rejected),
        quantityAccepted: qty(positiveDifference(received, rejected)),
        storageLocation: line.storageLocation,
        remarks: line.remarks,
        lot: line.stockLot ? toStockLotSummary(line.stockLot) : null,
      };
    });

    const countLots = (predicate: (status: string) => boolean) =>
      row.lines.filter((line) => line.stockLot && predicate(line.stockLot.status)).length;

    return {
      id: row.id,
      number: row.number,
      purchaseOrder: row.purchaseOrder,
      vendor: toPartySummary(row.vendor),
      receiptDate: row.receiptDate.toISOString(),
      vendorDocumentNumber: row.vendorDocumentNumber,
      receivedBy: people.get(row.receivedById) ?? null,
      remarks: row.remarks,
      lines,
      qcPendingCount: countLots((status) => status === 'QUARANTINE'),
      qcAcceptedCount: countLots((status) => status === 'USABLE'),
      qcRejectedCount: countLots((status) => status === 'REJECTED' || status === 'ON_HOLD'),
      invoices: row.purchaseInvoices,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

