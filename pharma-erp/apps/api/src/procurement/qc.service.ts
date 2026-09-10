import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type { ProcurementListQuery, QcDecision, QcQueueItem, StockLotStatus } from '@pharma-erp/types';

import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import { daysUntil } from './decimal.util';
import type { RecordQcDecisionDto } from './dto/qc.dto';
import { dateRange } from './filters.util';
import {
  ITEM_SELECT,
  collectIds,
  toItemSummary,
  toQcResultItem,
  toStockLotSummary,
} from './mappers';
import { PeopleService } from './people.service';

const LOT_INCLUDE = {
  item: { select: ITEM_SELECT },
  qcResults: { orderBy: { createdAt: 'desc' } },
  goodsReceiptLine: {
    select: {
      goodsReceipt: {
        select: {
          id: true,
          number: true,
          receiptDate: true,
          vendor: { select: { id: true, name: true } },
          purchaseOrder: { select: { id: true, number: true } },
        },
      },
    },
  },
} satisfies Prisma.StockLotInclude;

type LotRow = Prisma.StockLotGetPayload<{ include: typeof LOT_INCLUDE }>;

/**
 * Incoming quality control: the gate between quarantine and usable inventory.
 *
 * This service is the only thing in the system that can make received material
 * usable, which is what makes business rules 7 and 8 enforceable rather than
 * aspirational:
 *
 *   ACCEPTED  -> lot becomes USABLE, a positive ledger entry is posted with
 *                affectsUsableStock = true, and the batch joins the FEFO pool
 *                with its number, manufacturing date and expiry intact.
 *
 *   REJECTED  -> lot becomes REJECTED and stays out of every usable-stock
 *   / ON_HOLD    figure. The ledger entry posted is NEGATIVE against quarantine
 *                and never touches usable stock, so a rejection cannot increase
 *                inventory by any path. The row is never deleted: rejected
 *                material must remain traceable for a vendor return or a debit
 *                note.
 *
 * A decision is never overwritten. Re-inspecting a held lot appends a second
 * QcResult, and the lot's status follows the latest one.
 */
@Injectable()
export class QcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly people: PeopleService,
  ) {}

  /**
   * Lots awaiting or having had a QC decision.
   *
   * Defaults to the pending queue, because that is the Quality Officer's
   * actual worklist; the status filter widens it to the history.
   */
  async queue(query: ProcurementListQuery): Promise<QcQueueItem[]> {
    const where: Prisma.StockLotWhereInput = {};

    if (query.status) {
      where.status = query.status as StockLotStatus;
    } else {
      // Everything QC has a view on. CONSUMED lots are excluded: they have
      // left inventory and are no longer a quality decision.
      where.status = { in: ['QUARANTINE', 'USABLE', 'REJECTED', 'ON_HOLD'] };
    }

    if (query.itemId) where.itemId = query.itemId;

    // Vendor and receipt date both live two levels up, on the goods receipt.
    // Assembled as one object and assigned once — merging into a partially
    // built nested filter is how a clause silently overwrites its neighbour.
    const between = dateRange(query.dateFrom, query.dateTo);
    const receiptFilter: Prisma.GoodsReceiptWhereInput = {
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(between ? { receiptDate: between } : {}),
    };

    if (Object.keys(receiptFilter).length > 0) {
      where.goodsReceiptLine = { goodsReceipt: receiptFilter };
    }

    if (query.search) {
      const search = query.search.trim();

      where.OR = [
        { lotNumber: { contains: search, mode: 'insensitive' } },
        { vendorBatchNumber: { contains: search, mode: 'insensitive' } },
        { item: { name: { contains: search, mode: 'insensitive' } } },
        { item: { code: { contains: search, mode: 'insensitive' } } },
        { goodsReceiptLine: { goodsReceipt: { number: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const rows = await this.prisma.scoped.stockLot.findMany({
      where,
      include: LOT_INCLUDE,
      // Pending first, then soonest expiry: the two things that decide what a
      // Quality Officer should look at next.
      orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 500,
    });

    const people = await this.people.load(
      collectIds(...rows.flatMap((row) => row.qcResults.map((result) => result.inspectedById))),
    );

    return rows.map((row) => this.toQueueItem(row, people));
  }

  async findLot(id: string): Promise<QcQueueItem> {
    const row = await this.requireLot(id);
    const people = await this.people.load(
      collectIds(...row.qcResults.map((result) => result.inspectedById)),
    );

    return this.toQueueItem(row, people);
  }

  /**
   * Records a QC decision and moves the lot accordingly.
   *
   * Decision, lot status and ledger entry are written in one transaction. A
   * lot marked usable without the ledger entry would be invisible to stock
   * reporting; a ledger entry without the status change would let production
   * pick material that had not actually been released. Neither half is
   * meaningful alone.
   */
  async recordDecision(lotId: string, dto: RecordQcDecisionDto): Promise<QcQueueItem> {
    const tenantId = this.tenantContext.requireTenantId();
    const inspectedById = this.requireActingUser();

    const lot = await this.requireLot(lotId);

    this.assertDecidable(lot.status, dto.decision);

    if (dto.decision !== 'ACCEPTED' && !dto.remarks?.trim()) {
      // A rejection or a hold has consequences for the vendor and may end in a
      // debit note. Requiring the reason at the point of decision is the only
      // time anyone reliably remembers it.
      throw new BadRequestException(
        'A reason is required when rejecting or holding a batch.',
      );
    }

    const quantity = new Prisma.Decimal(lot.quantityAvailable);
    const wasUsable = lot.status === 'USABLE';
    const willBeUsable = dto.decision === 'ACCEPTED';

    await this.prisma.transaction(async (tx) => {
      await tx.qcResult.create({
        data: {
          tenantId,
          stockLotId: lot.id,
          decision: dto.decision,
          testReference: dto.testReference?.trim() || null,
          remarks: dto.remarks?.trim() || null,
          inspectedById,
        },
      });

      await tx.stockLot.update({
        where: { id: lot.id },
        data: { status: statusFor(dto.decision) },
      });

      const reference = lot.goodsReceiptLine.goodsReceipt.number;

      if (willBeUsable && !wasUsable) {
        // Quarantine empties, usable stock gains. Two entries rather than one,
        // because the ledger's job is to show where material moved from as
        // well as to.
        await tx.stockLedgerEntry.createMany({
          data: [
            {
              tenantId,
              itemId: lot.itemId,
              stockLotId: lot.id,
              entryType: 'QC_ACCEPTED',
              quantityDelta: quantity.negated(),
              affectsUsableStock: false,
              reference,
              notes: 'Released from quarantine by incoming QC.',
              createdById: inspectedById,
            },
            {
              tenantId,
              itemId: lot.itemId,
              stockLotId: lot.id,
              entryType: 'QC_ACCEPTED',
              quantityDelta: quantity,
              affectsUsableStock: true,
              reference,
              notes: 'Accepted into usable stock, available for FEFO picking.',
              createdById: inspectedById,
            },
          ],
        });
      } else if (!willBeUsable && wasUsable) {
        // A previously accepted lot pulled back. Usable stock must fall, or
        // production would keep seeing material that is no longer releasable.
        await tx.stockLedgerEntry.create({
          data: {
            tenantId,
            itemId: lot.itemId,
            stockLotId: lot.id,
            entryType: dto.decision === 'REJECTED' ? 'QC_REJECTED' : 'QC_HOLD',
            quantityDelta: quantity.negated(),
            affectsUsableStock: true,
            reference,
            notes: `Withdrawn from usable stock: ${dto.remarks?.trim() ?? 'no reason recorded'}.`,
            createdById: inspectedById,
          },
        });
      } else if (!willBeUsable) {
        // Quarantine -> rejected/hold. Quarantine falls; usable stock is not
        // touched at all, which is rule 8 expressed as arithmetic.
        await tx.stockLedgerEntry.create({
          data: {
            tenantId,
            itemId: lot.itemId,
            stockLotId: lot.id,
            entryType: dto.decision === 'REJECTED' ? 'QC_REJECTED' : 'QC_HOLD',
            quantityDelta: quantity.negated(),
            affectsUsableStock: false,
            reference,
            notes: `${dto.decision === 'REJECTED' ? 'Rejected' : 'Held'} at incoming QC: ${
              dto.remarks?.trim() ?? 'no reason recorded'
            }.`,
            createdById: inspectedById,
          },
        });
      }
    });

    await this.audit.record({
      entityType: 'StockLot',
      entityId: lot.id,
      action: 'UPDATE',
      before: { status: lot.status },
      after: {
        status: statusFor(dto.decision),
        decision: dto.decision,
        lotNumber: lot.lotNumber,
        testReference: dto.testReference ?? null,
        remarks: dto.remarks ?? null,
      },
    });

    return this.findLot(lot.id);
  }

  private assertDecidable(current: StockLotStatus, decision: QcDecision): void {
    if (current === 'CONSUMED') {
      throw new ConflictException(
        'This batch has been consumed and can no longer be re-inspected.',
      );
    }

    // A rejection is final. Releasing rejected material would defeat the point
    // of rejecting it; the correct route is a vendor return and a fresh receipt.
    if (current === 'REJECTED') {
      throw new ConflictException(
        'This batch was rejected. Rejected material cannot be released — return it to the ' +
          'vendor and receive a replacement against the purchase order.',
      );
    }

    if (current === 'USABLE' && decision === 'ACCEPTED') {
      throw new ConflictException('This batch has already been accepted.');
    }
  }

  private async requireLot(id: string): Promise<LotRow> {
    const row = await this.prisma.scoped.stockLot.findFirst({
      where: { id },
      include: LOT_INCLUDE,
    });

    if (!row) throw new NotFoundException('Batch not found.');

    return row;
  }

  private requireActingUser(): string {
    const userId = this.tenantContext.getUserId();

    if (!userId) {
      throw new BadRequestException('This action must be performed by a signed-in user.');
    }

    return userId;
  }

  private toQueueItem(row: LotRow, people: Map<string, string>): QcQueueItem {
    const receipt = row.goodsReceiptLine.goodsReceipt;

    return {
      lot: toStockLotSummary(row),
      item: toItemSummary(row.item),
      vendor: receipt.vendor,
      goodsReceipt: {
        id: receipt.id,
        number: receipt.number,
        receiptDate: receipt.receiptDate.toISOString(),
      },
      purchaseOrder: receipt.purchaseOrder,
      history: row.qcResults.map((result) => toQcResultItem(result, people)),
      daysToExpiry: row.expiryDate ? daysUntil(row.expiryDate) : null,
    };
  }
}

function statusFor(decision: QcDecision): StockLotStatus {
  return decision === 'ACCEPTED' ? 'USABLE' : decision === 'REJECTED' ? 'REJECTED' : 'ON_HOLD';
}

