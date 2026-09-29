import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  BatchReleaseStatus,
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
import { effectiveOverage, ProductionService, requiredWithOverage } from './production.service';

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

    /**
     * What each material actually went in — US-PROD-03.
     *
     * SEEDED FROM WHAT WAS ISSUED, then overridden line by line. The story asks
     * for "actual quantities consumed versus planned", and the sheet notes the
     * trap in asking for it plainly: consumed and issued were two independently
     * typed figures with nothing enforcing that they agree, so a batch record
     * could claim material the store never dispensed.
     *
     * Issued is the right default because it is right nearly always — material
     * goes to the floor and goes into the batch. A line is sent only where the
     * two DIFFER: a return to store, a spillage, part of a drum left over. That
     * makes the exception the thing somebody types, which is the only version
     * of this anybody keeps up.
     */
    const issued = await this.prisma.scoped.materialIssueLine.groupBy({
      by: ['itemId', 'lotId'],
      where: { materialIssue: { productionOrderId: order.id } },
      _sum: { quantityIssued: true },
    });

    const overrides = new Map(
      (dto.consumptions ?? []).map((line) => [line.itemId, line] as const),
    );

    const consumptions = issued.map((row) => {
      const override = overrides.get(row.itemId);

      return {
        itemId: row.itemId,
        quantityConsumed: override
          ? new Prisma.Decimal(override.quantityConsumed)
          : (row._sum.quantityIssued ?? ZERO),
        // The lot the issue drew from, unless the correction names another.
        lotId: override?.lotId ?? row.lotId,
        notes: override?.notes?.trim() || null,
      };
    });

    // A material named in a correction that was never issued. Refused rather
    // than silently added: it means the wrong item was picked, or material went
    // in that the store has no record of releasing — and a batch record
    // claiming stock nobody dispensed is exactly what this figure exists to
    // prevent.
    const unissued = [...overrides.keys()].filter(
      (itemId) => !issued.some((row) => row.itemId === itemId),
    );

    if (unissued.length > 0) {
      const names = await this.prisma.scoped.item.findMany({
        where: { id: { in: unissued } },
        select: { code: true, name: true },
      });

      const listed = names.length
        ? names.map((item) => `${item.name} (${item.code})`).join(', ')
        : unissued.join(', ');

      throw new BadRequestException(
        `${listed} ${names.length === 1 ? 'was' : 'were'} not issued against ` +
          `${order.orderNumber}, so there is no consumption to record. Dispense the material ` +
          'first, or correct the line.',
      );
    }

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
          // One row per material per lot, written with the batch rather than
          // after it: a batch record whose consumption failed to save would
          // report a variance against nothing.
          materialConsumptions: { create: consumptions.map((line) => ({ tenantId, ...line })) },
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

    // US-PROD-04: "Finished pack quantities must logically tie back to the bulk
    // batch."
    //
    // Packed PLUS rejected, against what the batch actually yielded. Checking
    // packed alone would always pass — losses would simply go unrecorded, and
    // the reconciliation the criterion asks for is precisely the one that
    // notices them.
    //
    // Against actualQuantity, not plannedQuantity: a batch that yielded less
    // than planned cannot pack more than it made, whatever the work order said.
    // A batch with no recorded yield is not packable at all — there is nothing
    // to tie back to.
    if (batch.actualQuantity === null) {
      throw new BadRequestException(
        'This batch has no recorded yield, so there is nothing to reconcile a packed quantity ' +
          'against. Record the manufacturing output first.',
      );
    }

    const packed = new Prisma.Decimal(dto.packedQuantity);
    const rejected = new Prisma.Decimal(dto.rejectedQuantity ?? 0);
    const accounted = packed.add(rejected);

    if (accounted.greaterThan(batch.actualQuantity)) {
      throw new BadRequestException(
        `Packed (${packed.toString()}) plus rejected (${rejected.toString()}) is ` +
          `${accounted.toString()}, but batch ${batch.batchNumber} only yielded ` +
          `${batch.actualQuantity.toString()}. A pack cannot contain more than was made — ` +
          'check the counts, or correct the yield on the manufacturing record.',
      );
    }

    await this.assertPackingMatchesSpecification(batch.productionOrderId, dto);

    await this.prisma.transaction(async (tx) => {
      const record = await tx.batchPackingRecord.upsert({
        where: { batchId },
        create: {
          tenantId,
          batchId,
          packedQuantity: packed,
          rejectedQuantity: rejected,
          packVariant: dto.packVariant?.trim() || null,
          packedOn,
          recordedById: userId,
          notes: dto.notes ?? null,
        },
        update: {
          packedQuantity: packed,
          rejectedQuantity: rejected,
          packVariant: dto.packVariant?.trim() || null,
          packedOn,
          recordedById: userId,
          notes: dto.notes ?? null,
        },
        select: { id: true },
      });

      // US-PROD-04: what the pack actually consumed.
      //
      // REPLACES the set rather than merging, for the same reason an amended
      // formulation does: re-recording packing restates what was used, and a
      // merge would make removing a component impossible.
      if (dto.consumptions !== undefined) {
        await tx.batchPackagingConsumption.deleteMany({ where: { packingRecordId: record.id } });

        if (dto.consumptions.length > 0) {
          await tx.batchPackagingConsumption.createMany({
            data: dto.consumptions.map((consumption) => ({
              tenantId,
              packingRecordId: record.id,
              itemId: consumption.itemId,
              quantityConsumed: new Prisma.Decimal(consumption.quantityConsumed),
              lotId: consumption.lotId ?? null,
              notes: consumption.notes?.trim() || null,
            })),
          });
        }
      }

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
      include: {
        packingRecord: true,
        // `salesOrderId` for US-PROD-05: the released lot is tagged with the
        // order the batch was made for, and the tag is read from here.
        productionOrder: { select: { productId: true, salesOrderId: true } },
      },
    });

    if (!batch) throw new NotFoundException('That batch does not exist.');

    if (batch.releaseStatus !== 'PENDING') {
      throw new ConflictException(
        `Batch ${batch.batchNumber} was already ${batch.releaseStatus.toLowerCase()}. ` +
          'A release decision is final — reversing one is a deviation, handled outside this screen.',
      );
    }

    // A reason is mandatory for anything but a release. A batch held or
    // refused with no recorded reason is the first thing an inspector asks
    // about, and the answer has to already be in the record.
    if (request.decision !== 'RELEASED' && !request.notes?.trim()) {
      const verb = request.decision === 'ON_HOLD' ? 'holding' : 'rejecting';

      throw new BadRequestException(
        `A reason is required when ${verb} a batch. A batch that did not pass, with no ` +
          'recorded reason, is the first thing an inspector asks about.',
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
            // US-PROD-05: "tagged Reserved to the Work Order's originating
            // Sales Order at the moment of creation" — in the same transaction
            // as the release, which is what "at the moment of creation" means.
            //
            // Copied rather than joined through the work order, for the same
            // reason the expiry above is: this records what the stock was made
            // for, and amending the work order later must not rewrite it.
            //
            // Null on job work, where the counterparty is a principal.
            salesOrderId: batch.productionOrder.salesOrderId,
          },
        });
      }

      // US-PROD-05: "The Work Order cannot be closed until the batch has
      // received a Released status from the Quality Gate."
      //
      // This update used to sit outside the branch, so BLOCKING a batch closed
      // its work order as tidily as releasing one — the order ended in exactly
      // the state that says the job is done, for a batch that may not be sold.
      // A blocked batch leaves the order open, which is the honest state: the
      // work is finished, the outcome is not, and somebody has to decide what
      // happens to it.
      if (request.decision === 'RELEASED') {
        await tx.productionOrder.update({
          where: { id: batch.productionOrderId },
          data: { status: 'CLOSED', closedAt: new Date() },
        });
      }
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
      // The consumption rows come WITH the record: the packing form seeds its
      // component boxes from them on an amendment, and fetching them
      // separately would be a second query per batch on a list of eighteen.
      packingRecord: { include: { consumptions: true } },
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
   * US-PROD-04: "Packing Materials Consumed ... checked against the Packaging
   * Requirement Master."
   *
   * The form already offers only the components on the specification, so this
   * refuses what a form cannot reach: a direct API call, or a stale page whose
   * specification was edited after it loaded. Two things are checked.
   *
   * THE PACK VARIANT MUST BE ONE THIS PRODUCT HAS. `packVariant` is a free
   * string on the DTO — it is the name of a presentation, not an enum, because
   * tenants define their own. That makes a typo ("10x10 cartn") silently
   * recordable, and a batch labelled with a pack that does not exist cannot be
   * reconciled against the specification it was supposedly packed to.
   *
   * EVERY COMPONENT MUST BE ON THAT SPECIFICATION. A carton belonging to a
   * different product's pack is not a packing error to warn about; it is a
   * record that would send an investigator to the wrong material on a recall.
   *
   * WHAT IS DELIBERATELY NOT CHECKED: that every MANDATORY line is present.
   * Packing is recorded in one pass here, but the record is amendable until the
   * quality gate, and refusing a partial entry would make it impossible to save
   * progress. The master's own `requirement` column distinguishes blocking from
   * advisory, and the gate is the place that decides a batch is complete.
   *
   * Outside the transaction: it only reads, and a refusal should happen before
   * anything is written rather than by rolling back.
   */
  private async assertPackingMatchesSpecification(
    productionOrderId: string,
    dto: RecordPackingDto,
  ): Promise<void> {
    const variant = dto.packVariant?.trim();
    const consumptions = dto.consumptions ?? [];

    // Nothing asserted about the pack: no specification to check it against.
    if (!variant && consumptions.length === 0) return;

    const order = await this.prisma.scoped.productionOrder.findFirst({
      where: { id: productionOrderId },
      select: { productId: true },
    });

    if (!order) throw new NotFoundException('That work order does not exist.');

    const specifications = await this.prisma.scoped.packagingRequirement.findMany({
      where: { productId: order.productId, isActive: true, deletedAt: null },
      select: { packVariant: true, lines: { select: { itemId: true } } },
    });

    // A product with no active specification at all. Raising a work order
    // already refuses this, so reaching it means one was deactivated mid-batch
    // — the packing in hand is still a fact worth recording, and the quality
    // gate is where an unspecified pack should be argued about.
    if (specifications.length === 0) return;

    const matched = variant
      ? specifications.find((specification) => specification.packVariant === variant)
      : specifications.length === 1
        ? specifications[0]
        : undefined;

    if (variant && !matched) {
      const known = specifications.map((s) => s.packVariant).join(', ');

      throw new BadRequestException(
        `"${variant}" is not a pack variant on this product's packaging specification. ` +
          `Recorded variants are: ${known}.`,
      );
    }

    // Several specifications and no variant naming which: the components
    // cannot be attributed to one of them, so there is nothing to check
    // against. The variant is optional on the DTO and stays that way.
    if (!matched) return;

    const permitted = new Set(matched.lines.map((line) => line.itemId));
    const unexpected = consumptions.filter((consumption) => !permitted.has(consumption.itemId));

    if (unexpected.length > 0) {
      const names = await this.prisma.scoped.item.findMany({
        where: { id: { in: unexpected.map((consumption) => consumption.itemId) } },
        select: { code: true, name: true },
      });

      const listed = names.length
        ? names.map((item) => `${item.name} (${item.code})`).join(', ')
        : unexpected.map((consumption) => consumption.itemId).join(', ');

      throw new BadRequestException(
        `${listed} ${names.length === 1 ? 'is' : 'are'} not on the packaging specification ` +
          `for ${matched.packVariant}. Record only the components that specification lists, ` +
          'or amend the specification in Master Data first.',
      );
    }
  }

  /**
   * Planned versus actual consumption, per material.
   *
   * "Planned" is the BOM scaled to the order; "issued" is what the FEFO run
   * actually took. They diverge when a lot ran short and a second was opened
   * with a different fill, or when the BOM was scaled to a quantity that does
   * not divide evenly — small variances are normal, which is exactly why a
   * threshold exists rather than an equality check.
   *
   * PLANNED INCLUDES OVERAGE, through the same helper the issue plan uses.
   * Without it the two sides of the comparison are computed on different rules:
   * material is ISSUED at the overage-adjusted figure, so measuring it against
   * the bare BOM quantity reports a variance exactly equal to the overage on
   * every line — normal, intended wastage flagged as a deviation on every
   * batch, which is how a variance flag stops meaning anything.
   */
  private async materialVariances(batch: {
    id: string;
    plannedQuantity: Prisma.Decimal;
    productionOrderId: string;
    productionOrder: {
      plannedQuantity: Prisma.Decimal;
      bom: BomOverageSource & {
        outputQuantity: Prisma.Decimal;
        lines: (BomLineOverageSource & {
          itemId: string;
          quantityPer: Prisma.Decimal;
          item: ItemLike;
        })[];
      };
    };
  }): Promise<BatchMaterialVariance[]> {
    /**
     * WHAT WENT IN, which is not what was dispensed — US-PROD-03.
     *
     * Read from the batch's own consumption rows, summed across lots: a
     * material drawn from two drums is two rows and one figure here.
     *
     * FALLING BACK TO THE ISSUE for a batch recorded before those rows existed.
     * Reporting zero consumed against a real planned figure would flag every
     * historical batch as a total shortfall, which is a screen full of alarms
     * about nothing — and issued was what this grid compared against for the
     * whole of that period, so it is also the honest reading of those records.
     */
    const consumed = await this.prisma.scoped.batchMaterialConsumption.groupBy({
      by: ['itemId'],
      where: { batchId: batch.id },
      _sum: { quantityConsumed: true },
    });

    const consumedByItem = new Map(
      consumed.map((row) => [row.itemId, row._sum.quantityConsumed ?? ZERO]),
    );

    if (consumedByItem.size === 0) {
      const issued = await this.prisma.scoped.materialIssueLine.groupBy({
        by: ['itemId'],
        where: { materialIssue: { productionOrderId: batch.productionOrderId } },
        _sum: { quantityIssued: true },
      });

      for (const row of issued) {
        consumedByItem.set(row.itemId, row._sum.quantityIssued ?? ZERO);
      }
    }

    const scale = new Prisma.Decimal(batch.productionOrder.plannedQuantity).div(
      batch.productionOrder.bom.outputQuantity,
    );

    return batch.productionOrder.bom.lines.map((line) => {
      const planned = requiredWithOverage(
        line.quantityPer,
        scale,
        effectiveOverage(line, batch.productionOrder.bom),
      );
      const actual = new Prisma.Decimal(consumedByItem.get(line.itemId) ?? ZERO);

      // Guard the divide: a planned quantity of zero cannot occur (the CHECK
      // constraint forbids it) but the arithmetic should not depend on that.
      const variance = planned.isZero()
        ? ZERO
        : actual.sub(planned).div(planned).mul(100).toDecimalPlaces(2);

      return {
        item: toItemSummary(line.item),
        quantityPlanned: planned.toString(),
        quantityConsumed: actual.toString(),
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
      // The rest of the packing record. Returned so the form that entered it
      // can show it back on a correction rather than asking for it again.
      rejectedQuantity: batch.packingRecord?.rejectedQuantity.toString() ?? null,
      packVariant: batch.packingRecord?.packVariant ?? null,
      packagingConsumed:
        batch.packingRecord?.consumptions.map((consumption) => ({
          itemId: consumption.itemId,
          quantityConsumed: consumption.quantityConsumed.toString(),
          lotId: consumption.lotId,
        })) ?? [],
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
    const tenantId = this.tenantContext.requireTenantId();

    // US-PROD-03: "the company's configured numbering convention". The prefix
    // is the company's; the rest of the shape is fixed, because a free-form
    // format string is a way to configure two companies into the same number
    // and the other half of the criterion is that it is strictly unique.
    const tenant = await tx.tenant.findFirstOrThrow({
      where: { id: tenantId },
      select: { batchNumberPrefix: true },
    });

    const fullYear = manufacturedOn.getUTCFullYear();
    const year = String(fullYear).slice(2);
    const month = String(manufacturedOn.getUTCMonth() + 1).padStart(2, '0');

    // One atomic statement, the same way purchase documents are numbered.
    //
    // This replaced a read-then-write: find the highest existing number,
    // parse it, add one. Two batches recorded in the same second both read the
    // same highest number and both computed the same next one — the unique
    // index then rejected the loser, so the failure mode was a save that
    // refused for no reason the person could see. An increment inside the
    // transaction has no such window.
    //
    // Counted per MONTH, not per year, because the number carries the month:
    // a year-scoped counter would make B-2610-001 impossible once October
    // arrived.
    const sequence = await tx.documentSequence.upsert({
      where: {
        tenantId_docType_year: { tenantId, docType: `BATCH-${year}${month}`, year: fullYear },
      },
      create: { tenantId, docType: `BATCH-${year}${month}`, year: fullYear, nextValue: 2 },
      update: { nextValue: { increment: 1 } },
      select: { nextValue: true },
    });

    // `create` sets nextValue to 2 and this batch takes 1; `update` returns the
    // already-incremented value, so the number just used is one less.
    const value = sequence.nextValue - 1;

    return `${tenant.batchNumberPrefix.trim()}-${year}${month}-${String(value).padStart(3, '0')}`;
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

/**
 * The overage columns, named by what the helpers in `production.service` need
 * rather than restated at each use. Derived from those helpers' own parameters,
 * so a change to either signature surfaces here as a type error instead of a
 * silently divergent copy.
 */
type BomOverageSource = Parameters<typeof effectiveOverage>[1];
type BomLineOverageSource = Parameters<typeof effectiveOverage>[0];

interface BatchWithIncludes {
  id: string;
  batchNumber: string;
  manufacturedOn: Date;
  expiryDate: Date;
  plannedQuantity: Prisma.Decimal;
  actualQuantity: Prisma.Decimal | null;
  releaseStatus: BatchReleaseStatus;
  releaseDecidedAt: Date | null;
  releaseNotes: string | null;
  productionOrderId: string;
  releaseDecidedBy: { fullName: string } | null;
  packingRecord: {
    packedQuantity: Prisma.Decimal;
    packedOn: Date;
    rejectedQuantity: Prisma.Decimal;
    packVariant: string | null;
    consumptions: { itemId: string; quantityConsumed: Prisma.Decimal; lotId: string | null }[];
  } | null;
  productionOrder: {
    orderNumber: string;
    plannedQuantity: Prisma.Decimal;
    product: ItemLike;
    bom: BomOverageSource & {
      outputQuantity: Prisma.Decimal;
      lines: (BomLineOverageSource & {
        itemId: string;
        quantityPer: Prisma.Decimal;
        item: ItemLike;
      })[];
    };
  };
}
