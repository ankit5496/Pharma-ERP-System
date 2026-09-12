import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  BatchMaterialVariance,
  BatchView,
  FinishedGoodsLotView,
  ReleaseDecisionRequest,
} from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import type { RecordBatchDto, RecordPackingDto } from './dto/production.dto';
import {
  addMonths,
  fromIsoDate,
  toIsoDate,
  toItemSummary,
  todayUtc,
  type ItemRow,
} from './production.mappers';
import { ProductionService } from './production.service';

const ZERO = new Prisma.Decimal(0);

/**
 * The Batch Manufacturing Record, the Batch Packing Record, and the quality
 * gate that decides whether any of it may be sold.
 */
@Injectable()
export class BatchService {
  /**
   * Consumption more than this far from plan is flagged for review.
   *
   * Two percent. Held here, on the server, rather than in the UI: the flag is
   * recorded reasoning, and a browser computing its own threshold could show a
   * different answer from the one the batch record stands behind.
   */
  static readonly VARIANCE_THRESHOLD_PERCENT = 2;

  /** Used when a product has no shelf life on file, so a batch can still be dated. */
  private static readonly DEFAULT_SHELF_LIFE_MONTHS = 24;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly production: ProductionService,
  ) {}

  async list(): Promise<BatchView[]> {
    const batches = await this.prisma.scoped.batch.findMany({
      where: { deletedAt: null },
      include: this.include(),
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(batches.map((batch) => this.toView(batch)));
  }

  async findOne(id: string): Promise<BatchView> {
    const batch = await this.prisma.scoped.batch.findFirst({
      where: { id, deletedAt: null },
      include: this.include(),
    });

    if (!batch) throw new NotFoundException('That batch does not exist.');

    return this.toView(batch);
  }

  /**
   * Opens the batch record for a work order: assigns the batch number, dates
   * it, and records the yield actually manufactured.
   *
   * Requires material to have been issued. Recording a yield for a batch that
   * consumed nothing would produce a batch record with no traceable inputs —
   * the one thing a batch record exists to provide.
   */
  async record(dto: RecordBatchDto): Promise<BatchView> {
    const tenantId = this.tenantContext.requireTenantId();
    const order = await this.production.requireOrder(dto.productionOrderId);

    if (order.status === 'PLANNED') {
      throw new BadRequestException(
        `No material has been issued against ${order.orderNumber}. Issue material first — ` +
          'a batch record without traceable inputs is not a batch record.',
      );
    }

    if (order.batches.length > 0) {
      throw new ConflictException(
        `${order.orderNumber} already has batch ${order.batches[0]?.batchNumber}. ` +
          'One work order produces one batch.',
      );
    }

    const manufacturedOn = dto.manufacturedOn ? fromIsoDate(dto.manufacturedOn) : todayUtc();

    if (manufacturedOn.getTime() > todayUtc().getTime()) {
      throw new BadRequestException('A batch cannot be recorded as manufactured in the future.');
    }

    const shelfLifeMonths = order.product.shelfLifeMonths ?? BatchService.DEFAULT_SHELF_LIFE_MONTHS;

    const batchId = await this.prisma.transaction(async (tx) => {
      const batchNumber = await this.nextBatchNumber(tx, manufacturedOn);

      const created = await tx.batch.create({
        data: {
          tenantId,
          productionOrderId: order.id,
          batchNumber,
          manufacturedOn,
          // Fixed at creation, deliberately. It is printed on the carton, so a
          // later correction to the product's shelf life must not silently
          // re-date stock already in the market.
          expiryDate: addMonths(manufacturedOn, shelfLifeMonths),
          plannedQuantity: order.plannedQuantity,
          actualQuantity: new Prisma.Decimal(dto.actualQuantity),
        },
      });

      await tx.productionOrder.update({
        where: { id: order.id },
        data: { status: 'IN_PROGRESS' },
      });

      return created.id;
    });

    // Read back after the commit rather than inside it. The variance figures
    // aggregate rows written by an earlier transaction, so there is nothing to
    // gain from reading them uncommitted — and threading the transaction client
    // through the view builder would mean every read there accepting a union of
    // two client types.
    return this.findOne(batchId);
  }

  /** Records the Batch Packing Record: how much was actually packed, and when. */
  async recordPacking(batchId: string, dto: RecordPackingDto): Promise<BatchView> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const batch = await this.prisma.scoped.batch.findFirst({
      where: { id: batchId, deletedAt: null },
      include: { packingRecord: true },
    });

    if (!batch) throw new NotFoundException('That batch does not exist.');

    if (batch.releaseStatus !== 'PENDING') {
      throw new ConflictException(
        'This batch has already been through the quality gate. Packing cannot be ' +
          'recorded or amended afterwards.',
      );
    }

    const packedOn = dto.packedOn ? fromIsoDate(dto.packedOn) : todayUtc();

    if (packedOn.getTime() < batch.manufacturedOn.getTime()) {
      throw new BadRequestException('A batch cannot be packed before it was manufactured.');
    }

    await this.prisma.transaction(async (tx) => {
      await tx.batchPackingRecord.upsert({
        where: { batchId },
        create: {
          tenantId,
          batchId,
          packedQuantity: new Prisma.Decimal(dto.packedQuantity),
          packedOn,
          recordedById: userId,
          notes: dto.notes ?? null,
        },
        update: {
          packedQuantity: new Prisma.Decimal(dto.packedQuantity),
          packedOn,
          recordedById: userId,
          notes: dto.notes ?? null,
        },
      });

      await tx.productionOrder.update({
        where: { id: batch.productionOrderId },
        data: { status: 'UNDER_TEST' },
      });
    });

    return this.findOne(batchId);
  }

  /**
   * The quality gate.
   *
   * The single most consequential operation in this workflow, and the reason
   * finished-goods stock is modelled as its own table: RELEASED creates the
   * `FinishedGoodsLot` row that makes the batch sellable, and BLOCKED creates
   * nothing at all. A downstream sales query cannot accidentally pick up a
   * blocked batch by forgetting a status filter, because there is no row for it
   * to find.
   *
   * One-way by design. There is no endpoint to reverse a decision: reversing a
   * quality verdict is a deviation with its own paperwork, not a button.
   */
  async decideRelease(batchId: string, request: ReleaseDecisionRequest): Promise<BatchView> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const batch = await this.prisma.scoped.batch.findFirst({
      where: { id: batchId, deletedAt: null },
      include: { packingRecord: true, productionOrder: { select: { productId: true } } },
    });

    if (!batch) throw new NotFoundException('That batch does not exist.');

    if (batch.releaseStatus !== 'PENDING') {
      throw new ConflictException(
        `Batch ${batch.batchNumber} was already ${batch.releaseStatus.toLowerCase()}. ` +
          'A release decision is final — reversing one is a deviation, handled outside this screen.',
      );
    }

    if (request.decision === 'BLOCKED' && !request.notes?.trim()) {
      throw new BadRequestException(
        'A reason is required when blocking a batch. A rejected batch with no recorded ' +
          'reason is the first thing an inspector asks about.',
      );
    }

    if (request.decision === 'RELEASED' && !batch.packingRecord) {
      throw new BadRequestException(
        'This batch has no packing record, so there is no packed quantity to release into ' +
          'stock. Record packing first.',
      );
    }

    await this.prisma.transaction(async (tx) => {
      await tx.batch.update({
        where: { id: batchId },
        data: {
          releaseStatus: request.decision,
          releaseDecidedAt: new Date(),
          releaseDecidedById: userId,
          releaseNotes: request.notes?.trim() || null,
        },
      });

      if (request.decision === 'RELEASED' && batch.packingRecord) {
        await tx.finishedGoodsLot.create({
          data: {
            tenantId,
            batchId,
            itemId: batch.productionOrder.productId,
            quantityAvailable: batch.packingRecord.packedQuantity,
            // Copied so the FEFO index for despatch lives on this table alone.
            expiryDate: batch.expiryDate,
          },
        });
      }

      await tx.productionOrder.update({
        where: { id: batch.productionOrderId },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    });

    return this.findOne(batchId);
  }

  /**
   * Sellable stock, soonest expiry first.
   *
   * Every row here is a released batch — that is the only way one is created —
   * so this listing doubles as the answer to "what has passed the gate".
   */
  async listFinishedGoods(): Promise<FinishedGoodsLotView[]> {
    const lots = await this.prisma.scoped.finishedGoodsLot.findMany({
      include: { item: true, batch: { select: { batchNumber: true } } },
      orderBy: [{ expiryDate: 'asc' }],
    });

    return lots.map((lot) => ({
      id: lot.id,
      batchNumber: lot.batch.batchNumber,
      expiryDate: toIsoDate(lot.expiryDate),
      quantityAvailable: lot.quantityAvailable.toString(),
      item: toItemSummary(lot.item),
    }));
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private include() {
    return {
      packingRecord: true,
      releaseDecidedBy: { select: { fullName: true } },
      productionOrder: {
        include: {
          product: true,
          bom: { include: { lines: { include: { item: true } } } },
        },
      },
    } as const;
  }

  /**
   * Planned versus actual consumption, per material.
   *
   * "Planned" is the BOM scaled to the order; "issued" is what the FEFO run
   * actually took. They diverge when a lot ran short and a second was opened
   * with a different fill, or when the BOM was scaled to a quantity that does
   * not divide evenly — small variances are normal, which is exactly why a
   * threshold exists rather than an equality check.
   */
  private async materialVariances(batch: {
    plannedQuantity: Prisma.Decimal;
    productionOrderId: string;
    productionOrder: {
      plannedQuantity: Prisma.Decimal;
      bom: {
        outputQuantity: Prisma.Decimal;
        lines: { itemId: string; quantityPer: Prisma.Decimal; item: ItemLike }[];
      };
    };
  }): Promise<BatchMaterialVariance[]> {
    const issued = await this.prisma.scoped.materialIssueLine.groupBy({
      by: ['itemId'],
      where: { materialIssue: { productionOrderId: batch.productionOrderId } },
      _sum: { quantityIssued: true },
    });

    const issuedByItem = new Map(
      issued.map((row) => [row.itemId, row._sum.quantityIssued ?? ZERO]),
    );

    const scale = new Prisma.Decimal(batch.productionOrder.plannedQuantity).div(
      batch.productionOrder.bom.outputQuantity,
    );

    return batch.productionOrder.bom.lines.map((line) => {
      const planned = new Prisma.Decimal(line.quantityPer).mul(scale).toDecimalPlaces(3);
      const actual = new Prisma.Decimal(issuedByItem.get(line.itemId) ?? ZERO);

      // Guard the divide: a planned quantity of zero cannot occur (the CHECK
      // constraint forbids it) but the arithmetic should not depend on that.
      const variance = planned.isZero()
        ? ZERO
        : actual.sub(planned).div(planned).mul(100).toDecimalPlaces(2);

      return {
        item: toItemSummary(line.item),
        quantityPlanned: planned.toString(),
        quantityIssued: actual.toString(),
        variancePercent: variance.toString(),
        flagged: variance.abs().greaterThan(BatchService.VARIANCE_THRESHOLD_PERCENT),
      };
    });
  }

  private async toView(batch: BatchWithIncludes): Promise<BatchView> {
    return {
      id: batch.id,
      batchNumber: batch.batchNumber,
      manufacturedOn: toIsoDate(batch.manufacturedOn),
      expiryDate: toIsoDate(batch.expiryDate),
      plannedQuantity: batch.plannedQuantity.toString(),
      actualQuantity: batch.actualQuantity?.toString() ?? null,
      releaseStatus: batch.releaseStatus,
      releaseDecidedAt: batch.releaseDecidedAt?.toISOString() ?? null,
      releaseDecidedBy: batch.releaseDecidedBy?.fullName ?? null,
      releaseNotes: batch.releaseNotes,
      product: toItemSummary(batch.productionOrder.product),
      orderNumber: batch.productionOrder.orderNumber,
      productionOrderId: batch.productionOrderId,
      packedQuantity: batch.packingRecord?.packedQuantity.toString() ?? null,
      packedOn: batch.packingRecord ? toIsoDate(batch.packingRecord.packedOn) : null,
      materialVariances: await this.materialVariances(batch),
      varianceThresholdPercent: BatchService.VARIANCE_THRESHOLD_PERCENT,
    };
  }

  /**
   * Next batch number, as B-YYMM-NNN.
   *
   * Encodes the manufacturing month because that is how a batch is referred to
   * on the shop floor and in a recall notice. Sequence derived per tenant
   * inside the caller's transaction, with the unique index as the backstop —
   * the same reasoning as work-order numbering.
   */
  private async nextBatchNumber(tx: Prisma.TransactionClient, manufacturedOn: Date) {
    const year = String(manufacturedOn.getUTCFullYear()).slice(2);
    const month = String(manufacturedOn.getUTCMonth() + 1).padStart(2, '0');
    const prefix = `B-${year}${month}-`;

    const latest = await tx.batch.findFirst({
      where: { batchNumber: { startsWith: prefix } },
      orderBy: { batchNumber: 'desc' },
      select: { batchNumber: true },
    });

    const previous = latest ? Number.parseInt(latest.batchNumber.slice(prefix.length), 10) : 0;

    return `${prefix}${String(previous + 1).padStart(3, '0')}`;
  }
}

/**
 * An item row, as the queries below actually fetch it.
 *
 * Was a hand-written six-field shape with the item type spelled out as a
 * literal union. Both halves of that went stale the moment the model grew:
 * the union rejected a new ItemType, and the missing columns meant
 * `toItemSummary` could no longer be handed one of these. Aliased to the
 * generated row so there is one definition to keep current.
 */
type ItemLike = ItemRow;

interface BatchWithIncludes {
  id: string;
  batchNumber: string;
  manufacturedOn: Date;
  expiryDate: Date;
  plannedQuantity: Prisma.Decimal;
  actualQuantity: Prisma.Decimal | null;
  releaseStatus: 'PENDING' | 'RELEASED' | 'BLOCKED';
  releaseDecidedAt: Date | null;
  releaseNotes: string | null;
  productionOrderId: string;
  releaseDecidedBy: { fullName: string } | null;
  packingRecord: { packedQuantity: Prisma.Decimal; packedOn: Date } | null;
  productionOrder: {
    orderNumber: string;
    plannedQuantity: Prisma.Decimal;
    product: ItemLike;
    bom: {
      outputQuantity: Prisma.Decimal;
      lines: { itemId: string; quantityPer: Prisma.Decimal; item: ItemLike }[];
    };
  };
}
