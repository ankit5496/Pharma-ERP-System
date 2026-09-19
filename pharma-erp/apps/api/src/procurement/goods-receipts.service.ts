import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  GoodsReceiptListItem,
  GoodsReceiptLineItem,
  Paginated,
  ProcurementListQuery,
} from '@pharma-erp/types';

import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import { fulfilmentStatus, parsePositive, pendingOn, qty } from './decimal.util';
import type { CreateGoodsReceiptDto, UpdateGoodsReceiptDto } from './dto/goods-receipt.dto';
import { dateRange, paginate } from './filters.util';
import {
  ITEM_SELECT,
  LOT_SELECT,
  PARTY_SELECT,
  collectIds,
  toItemSummary,
  toPartySummary,
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
 *   Rule 4/5 — every received line is BATCH TRACKED. The vendor's batch
 *   number and expiry date are mandatory and the receipt is refused without
 *   them. Anonymous raw material cannot be recalled, cannot be picked FEFO,
 *   and cannot be defended in an inspection.
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

  async list(query: ProcurementListQuery): Promise<Paginated<GoodsReceiptListItem>> {
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
      where.lines = {
        ...(where.lines ?? {}),
        every: { stockLot: { status: { not: 'QUARANTINE' } } },
      };
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

    const { skip, take, page, pageSize } = paginate(query);

    const rows = await this.prisma.scoped.goodsReceipt.findMany({
      where,
      include: GRN_INCLUDE,
      orderBy: [{ receiptDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    });

    const total = await this.prisma.scoped.goodsReceipt.count({ where });

    const people = await this.people.load(collectIds(...rows.map((row) => row.receivedById)));

    return { rows: rows.map((row) => this.toListItem(row, people)), total, page, pageSize };
  }

  /**
   * Corrects a booked receipt.
   *
   * WHAT MOVED STOCK CANNOT BE RE-TYPED. The received quantity created the lot
   * and the ledger entry beside it, and the ledger is append-only — changing the
   * number here would leave the stock record describing a delivery that never
   * happened. A wrong quantity is corrected by receiving the difference against
   * the order, or by rejecting the batch at incoming QC.
   *
   * WHAT CAN BE CORRECTED IS THE BATCH IDENTITY: the vendor's batch number and
   * the two dates. Those are transcribed by hand from a delivery note, and are
   * where a typo actually lands. Every correction is written to the STOCK LOT as
   * well as to the receipt line, in one transaction — a lot whose expiry
   * disagreed with the receipt it came from would be picked FEFO on one date and
   * recalled on another.
   *
   * The same rules that refuse a bad booking are applied again here, so a
   * correction cannot do what the original receipt was not allowed to do.
   */
  async update(id: string, dto: UpdateGoodsReceiptDto): Promise<GoodsReceiptListItem> {
    const before = await this.requireReceipt(id);

    const data: Prisma.GoodsReceiptUpdateInput = {};

    if (dto.receiptDate !== undefined) data.receiptDate = new Date(dto.receiptDate);
    if (dto.vendorDocumentNumber !== undefined) {
      data.vendorDocumentNumber = dto.vendorDocumentNumber || null;
    }
    if (dto.remarks !== undefined) data.remarks = dto.remarks || null;

    const corrections = this.prepareCorrections(before, dto.lines ?? []);

    if (Object.keys(data).length === 0 && corrections.length === 0) {
      throw new BadRequestException('Nothing to update.');
    }

    const after = await this.prisma.transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.goodsReceipt.update({ where: { id }, data });
      }

      for (const correction of corrections) {
        const batch = {
          vendorBatchNumber: correction.vendorBatchNumber,
          manufacturingDate: correction.manufacturingDate,
          expiryDate: correction.expiryDate,
        };

        await tx.goodsReceiptLine.update({ where: { id: correction.lineId }, data: batch });

        // The lot carries the same identity. Guarded rather than asserted: a
        // line without a lot would be a broken receipt, but a correction is not
        // the place to discover it by throwing.
        if (correction.lotId) {
          await tx.stockLot.update({ where: { id: correction.lotId }, data: batch });
        }
      }

      return tx.goodsReceipt.findFirstOrThrow({ where: { id }, include: GRN_INCLUDE });
    });

    const batchesOf = (row: GrnRow) =>
      row.lines.map((line) => ({
        id: line.id,
        vendorBatchNumber: line.vendorBatchNumber,
        manufacturingDate: line.manufacturingDate,
        expiryDate: line.expiryDate,
      }));

    await this.audit.record({
      entityType: 'GoodsReceipt',
      entityId: id,
      action: 'UPDATE',
      before: {
        receiptDate: before.receiptDate,
        vendorDocumentNumber: before.vendorDocumentNumber,
        remarks: before.remarks,
        lines: batchesOf(before),
      },
      after: {
        receiptDate: after.receiptDate,
        vendorDocumentNumber: after.vendorDocumentNumber,
        remarks: after.remarks,
        lines: batchesOf(after),
      },
    });

    const people = await this.people.load(collectIds(after.receivedById));

    return this.toListItem(after, people);
  }

  /**
   * Validates batch corrections against the receipt they belong to.
   *
   * A field left out of the request keeps what the line already holds, so
   * correcting one date cannot blank the other two by omission. What comes back
   * is resolved and checked — ready to write, or already thrown.
   */
  private prepareCorrections(
    receipt: GrnRow,
    edits: NonNullable<UpdateGoodsReceiptDto['lines']>,
  ): {
    lineId: string;
    lotId: string | null;
    vendorBatchNumber: string;
    manufacturingDate: Date;
    expiryDate: Date;
  }[] {
    const linesById = new Map(receipt.lines.map((line) => [line.id, line]));

    return edits.map((edit) => {
      const line = linesById.get(edit.id);

      if (!line) {
        throw new BadRequestException(
          'A correction refers to a line that is not on this goods receipt.',
        );
      }

      const code = line.item.code;

      const vendorBatchNumber =
        edit.vendorBatchNumber !== undefined
          ? edit.vendorBatchNumber.trim()
          : (line.vendorBatchNumber ?? '');

      const manufacturingDate =
        edit.manufacturingDate !== undefined
          ? new Date(edit.manufacturingDate)
          : line.manufacturingDate;

      const expiryDate = edit.expiryDate !== undefined ? new Date(edit.expiryDate) : line.expiryDate;

      // The same three that are mandatory at booking. A correction that emptied
      // one of them would leave a lot that cannot be recalled or picked FEFO —
      // exactly what the booking rule exists to prevent.
      if (!vendorBatchNumber) {
        throw new BadRequestException(
          `${code} requires a vendor batch number: Batch Number is required.`,
        );
      }

      if (!manufacturingDate) {
        throw new BadRequestException(
          `${code} requires a manufacturing date: Manufacturing Date is required.`,
        );
      }

      if (!expiryDate) {
        throw new BadRequestException(`${code} requires an expiry date: Expiry Date is required.`);
      }

      if (expiryDate <= manufacturingDate) {
        throw new BadRequestException(
          `${code}: the expiry date must be after the manufacturing date.`,
        );
      }

      // And the shelf-life ceiling, read exactly as booking reads it: a batch
      // may not outlive its own manufacturing date plus the product's total
      // shelf life. That catches the mistyped year, which is the realistic
      // error. An item with no shelf life has no rule — an absent rule must not
      // silently become a rule of zero.
      if (line.item.shelfLifeMonths !== null) {
        const latestPlausibleExpiry = new Date(manufacturingDate);

        latestPlausibleExpiry.setUTCMonth(
          latestPlausibleExpiry.getUTCMonth() + line.item.shelfLifeMonths,
        );

        if (expiryDate > latestPlausibleExpiry) {
          throw new BadRequestException(
            `${code}: an expiry of ${expiryDate.toISOString().slice(0, 10)} is later than this ` +
              `material's ${line.item.shelfLifeMonths}-month shelf life allows from a ` +
              `manufacturing date of ${manufacturingDate.toISOString().slice(0, 10)} ` +
              `(no later than ${latestPlausibleExpiry.toISOString().slice(0, 10)}). ` +
              'Check the dates on the delivery note.',
          );
        }
      }

      return {
        lineId: line.id,
        lotId: line.stockLot?.id ?? null,
        vendorBatchNumber,
        manufacturingDate,
        expiryDate,
      };
    });
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
        lines: { include: { item: { select: ITEM_SELECT } } },
      },
    });

    if (!order) throw new NotFoundException('Purchase order not found.');

    // A CANCELLED order is the only one that refuses material outright: it says
    // nothing is expected at all. Every other order is judged on whether it
    // still has a pending quantity, which is checked per line below — an order
    // closed by hand while short must still be able to receive what turns up.
    if (order.status === 'CANCELLED') {
      throw new ConflictException(
        `${order.number} is cancelled, so no material can be received against it.`,
      );
    }

    // A draft is not an order yet — it has not been placed with the vendor, so
    // nothing can have arrived against it.
    if (order.status === 'DRAFT') {
      throw new ConflictException(
        `${order.number} is still a draft. Place the order before receiving against it.`,
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

      // Over-receipt is refused rather than silently accepted: it usually means
      // the wrong line was picked, and a quantity that exceeds the order also
      // exceeds what the vendor may invoice for.
      //
      // The ceiling is the PENDING quantity — ordered, less everything received
      // by earlier receipts, less anything short-closed. Read from the line
      // itself rather than recomputed from the GRNs: the running total is
      // maintained in the same transaction as every receipt, so the two cannot
      // drift, and this way a second GRN cannot re-receive what the first took.
      const outstanding = pendingOn(orderLine);

      if (outstanding.lessThanOrEqualTo(0)) {
        throw new ConflictException(
          `${orderLine.item.code}: nothing is outstanding on this order line — it has been ` +
            'received in full or short closed.',
        );
      }

      if (quantityReceived.greaterThan(outstanding)) {
        throw new ConflictException(
          `${orderLine.item.code}: receiving ${qty(quantityReceived)} would exceed the ` +
            `${qty(outstanding)} still outstanding on this order line.`,
        );
      }

      // ALL FOUR OF THE RECEIVING FIELDS ARE MANDATORY, unconditionally: the
      // quantity (checked by parsePositive above), the vendor batch number,
      // the manufacturing date and the expiry. They are the whole of what a
      // receipt now captures per line.
      //
      // This used to be conditional on `orderLine.item.requiresBatchTracking`.
      // That column defaults true and no form exposes it, so in practice the
      // rule already applied to every line — but "in practice" is not a rule,
      // and one item with the flag off would have admitted a receipt carrying
      // no batch identity at all. In a plant that has to answer a recall, a
      // lot with no vendor batch and no dates is stock that cannot be traced
      // to what it came from.
      //
      // The browser checks the same four before sending, per line being
      // received. This is the one that cannot be skipped.
      if (!line.vendorBatchNumber?.trim()) {
        throw new BadRequestException(
          `${orderLine.item.code} requires a vendor batch number: Batch Number is required.`,
        );
      }

      // US-PUR-03 makes all three mandatory. A batch number without the
      // dates is only half an identity: recall works from the number, but
      // shelf-life and FEFO both need the dates, and they cannot be
      // reconstructed later from a delivery note nobody kept.
      if (!line.manufacturingDate) {
        throw new BadRequestException(
          `${orderLine.item.code} requires a manufacturing date: Manufacturing Date is required.`,
        );
      }

      if (!line.expiryDate) {
        throw new BadRequestException(
          `${orderLine.item.code} requires an expiry date: Expiry Date is required.`,
        );
      }

      const manufacturingDate = line.manufacturingDate ? new Date(line.manufacturingDate) : null;
      const expiryDate = line.expiryDate ? new Date(line.expiryDate) : null;

      if (manufacturingDate && expiryDate && expiryDate <= manufacturingDate) {
        throw new BadRequestException(
          `${orderLine.item.code}: the expiry date must be after the manufacturing date.`,
        );
      }

      // The batch's dates must be consistent with the product's shelf life.
      //
      // `shelfLifeMonths` is the TOTAL life of the material, not the life
      // demanded on arrival — the shared item master says so explicitly. So the
      // check it supports is that a batch cannot outlive the product: expiry
      // may not be later than its own manufacturing date plus that total. That
      // catches the realistic data-entry error, which is a mistyped year on the
      // expiry date.
      //
      // WHAT THIS DELIBERATELY NO LONGER DOES is demand the full shelf life be
      // REMAINING at receipt. That rule read the field as "minimum residual
      // life", and against the field's real meaning it is impossible to satisfy
      // — a 36-month material would need to expire 36 months from today, which
      // only a batch manufactured today can do. Every real delivery was
      // refused. A genuine minimum-residual-life rule is a commercial policy
      // ("at least 75% of shelf life remaining") and needs its own configurable
      // figure; it must not be improvised from a field that means something
      // else.
      //
      // Calendar arithmetic, not 30-day months: a 24-month life is 24 calendar
      // months, and the approximation drifts by nearly a fortnight over that
      // span.
      //
      // Only applied when the item has a shelf life and the batch has both
      // dates. An absent rule means no rule; it must not silently become a
      // rule of zero.
      if (expiryDate && manufacturingDate && orderLine.item.shelfLifeMonths !== null) {
        const latestPlausibleExpiry = new Date(manufacturingDate);
        latestPlausibleExpiry.setUTCMonth(
          latestPlausibleExpiry.getUTCMonth() + orderLine.item.shelfLifeMonths,
        );

        if (expiryDate > latestPlausibleExpiry) {
          throw new ConflictException(
            `${orderLine.item.code}: an expiry of ${expiryDate.toISOString().slice(0, 10)} is ` +
              `later than this material's ${orderLine.item.shelfLifeMonths}-month shelf life ` +
              `allows from a manufacturing date of ` +
              `${manufacturingDate.toISOString().slice(0, 10)} ` +
              `(no later than ${latestPlausibleExpiry.toISOString().slice(0, 10)}). ` +
              'Check the dates on the delivery note.',
          );
        }
      }

      return {
        orderLine,
        // EVERYTHING RECEIVED ENTERS QUARANTINE. There is no gate rejection any
        // more, so the quantity that arrived is the quantity that becomes a
        // lot; incoming QC's decision on that lot is the only rejection the
        // flow has.
        quantityReceived,
        vendorBatchNumber: line.vendorBatchNumber?.trim() || null,
        manufacturingDate,
        expiryDate,
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
            quantityReceived: line.quantityReceived,
            quantityAvailable: line.quantityReceived,
            // Rule 6, in one word.
            status: 'QUARANTINE',
          },
        });

        await tx.stockLedgerEntry.create({
          data: {
            tenantId,
            itemId: line.orderLine.itemId,
            stockLotId: lot.id,
            entryType: 'GRN_QUARANTINE',
            quantityDelta: line.quantityReceived,
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
        select: { quantity: true, quantityReceived: true, quantityCancelled: true },
      });

      await tx.purchaseOrder.update({
        where: { id: order.id },
        // Computed from the TOTALS on the order's lines, never from this
        // receipt alone: several receipts contribute and only the sum knows the
        // answer. `fulfilmentStatus` is the single definition of that mapping,
        // shared with the order service so the two cannot disagree about what
        // a set of quantities means.
        data: { status: fulfilmentStatus(refreshedLines, order.status) },
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
    const lines = row.lines.map(
      (line): GoodsReceiptLineItem => ({
        id: line.id,
        item: toItemSummary(line.item),
        purchaseOrderLineId: line.purchaseOrderLineId,
        vendorBatchNumber: line.vendorBatchNumber,
        manufacturingDate: line.manufacturingDate?.toISOString().slice(0, 10) ?? null,
        expiryDate: line.expiryDate?.toISOString().slice(0, 10) ?? null,
        quantityOrdered: qty(line.purchaseOrderLine.quantity),
        quantityReceived: qty(line.quantityReceived),
      }),
    );

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
      invoices: row.purchaseInvoices,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
