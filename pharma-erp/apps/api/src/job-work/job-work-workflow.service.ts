import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  BatchReleaseStatus,
  ItemSummary,
  JobWorkBatchMaterialVariance,
  JobWorkBatchView,
  JobWorkIssuableMaterial,
  JobWorkIssuePlan,
  JobWorkIssuePlanLine,
  JobWorkMaterialIssueView,
  JobWorkMaterialKind,
} from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../procurement/numbering.service';
import { fromIsoDate, toItemSummary, toIsoDate } from '../production/production.mappers';
import { TenantContextService } from '../tenant/tenant-context.service';

import type {
  DecideJobWorkBatchDto,
  RecordJobWorkBatchDto,
  RecordJobWorkIssueDto,
  RecordJobWorkPackingDto,
} from './dto/job-work-workflow.dto';

const ZERO = new Prisma.Decimal(0);

/**
 * Above this absolute percentage a material variance is flagged for review.
 *
 * The same 2% BatchService applies to own-brand batches. Deliberately the same
 * number: a principal's batch is made on the same line to the same formulation,
 * and two thresholds would mean one supervisor reading two standards.
 */
const VARIANCE_THRESHOLD_PERCENT = 2;

/**
 * The job-work production workflow after the order is raised: issue, batch,
 * release.
 *
 * ITS OWN TABLES THROUGHOUT, and none of the internal ones. Production &
 * Quality Gate keeps `material_issues`, `batches` and `batch_packing_records`
 * exactly as they were; nothing here reads or writes any of them.
 *
 * THE MATERIAL IS THE PRINCIPAL'S, AND IS NEVER COPIED. An issue draws on the
 * stock lots the inward receipt created — the same rows the register shows —
 * and the line records which lot and how much. The drum's batch marking, its
 * expiry and the challan it arrived on are read back through that reference.
 *
 * AN ISSUE MOVES STOCK. It decrements the lot and writes the same stock-ledger
 * entry any other consumption writes, because an issue that leaves the shelf
 * figure untouched is a document that says material was consumed while the
 * system still believes it is there.
 */
@Injectable()
export class JobWorkWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly numbering: NumberingService,
  ) {}

  // ---------------------------------------------------------------------------
  // Material issue
  // ---------------------------------------------------------------------------

  async listIssues(productionOrderId?: string): Promise<JobWorkMaterialIssueView[]> {
    const rows = await this.prisma.scoped.jobWorkMaterialIssue.findMany({
      where: {
        deletedAt: null,
        ...(productionOrderId ? { jobWorkProductionOrderId: productionOrderId } : {}),
      },
      include: ISSUE_INCLUDE,
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
    });

    return rows.map(toIssueView);
  }

  /**
   * What is left to draw on, per drum, for one production order.
   *
   * THE RECEIPT'S OWN LINES, with what has already been issued against each
   * taken off. This is the list the issue form offers, and it comes from the
   * inward record rather than from a copy — so a drum half-consumed by an
   * earlier issue offers only its remainder.
   */
  async issuableMaterial(productionOrderId: string): Promise<JobWorkIssuableMaterial[]> {
    const order = await this.requireProductionOrder(productionOrderId);

    const issued = await this.prisma.scoped.jobWorkMaterialIssueLine.groupBy({
      by: ['lotId'],
      where: { issue: { jobWorkProductionOrderId: order.id, deletedAt: null } },
      _sum: { quantityIssued: true },
    });

    const issuedByLot = new Map(issued.map((row) => [row.lotId, row._sum.quantityIssued ?? ZERO]));

    return order.materialReceipt.lines
      .filter((line) => line.stockLot !== null)
      .map((line) => {
        const lot = line.stockLot!;
        const already = issuedByLot.get(lot.id) ?? ZERO;

        return {
          receiptLineId: line.id,
          lotId: lot.id,
          lotNumber: lot.lotNumber,
          item: toItemSummary(line.item),
          kind: line.item.type === 'PACKING_MATERIAL' ? ('PACKING' as const) : ('RAW' as const),
          batchNumber: line.batchNumber,
          deliveryChallanNumber: line.deliveryChallanNumber,
          manufacturingDate: line.manufacturingDate ? toIsoDate(line.manufacturingDate) : null,
          expiryDate: line.expiryDate ? toIsoDate(line.expiryDate) : null,
          receivedQuantity: line.receivedQuantity.toString(),
          // What the shelf actually holds, which is not the received figure
          // once anything has been drawn.
          quantityAvailable: lot.quantityAvailable.toString(),
          alreadyIssued: already.toString(),
          lotStatus: lot.status,
        };
      });
  }

  /**
   * What issuing this order would consume, and out of which drums.
   *
   * THE SAME ANSWER MaterialIssuePlan GIVES for own-brand work, computed the
   * same way — the formulation scaled to the planned quantity, met from stock
   * nearest to expiry first — with one difference: the only stock it may draw
   * on is the principal's own consignment. Under pure conversion there is no
   * other pool, and a plan that quietly filled a shortfall from company stock
   * would be billing the principal for material they supplied.
   *
   * ADVISORY. `recordIssue` re-derives every figure and refuses on its own
   * account; this exists so a shortage is visible before somebody dispenses
   * rather than after.
   */
  async issuePlan(productionOrderId: string): Promise<JobWorkIssuePlan> {
    const order = await this.requireProductionOrder(productionOrderId);

    const base = {
      productionOrderId: order.id,
      orderNumber: order.orderNumber,
      jobWorkOrderNumber: order.jobWorkOrder.orderNumber,
      principalName: order.jobWorkOrder.principal.name,
      product: toItemSummary(order.jobWorkOrder.mapping.bom.product),
      receiptNumber: order.materialReceipt.receiptNumber,
    };

    const required = await this.requirementFor(order);

    if (typeof required === 'string') {
      return { ...base, canIssue: false, blockedReason: required, lines: [] };
    }

    // WHAT IS LEFT ON EACH DRUM, which is the lot's own balance rather than
    // what arrived: an earlier issue has already taken its share.
    const drums = await this.issuableMaterial(productionOrderId);

    const byItem = new Map<string, JobWorkIssuableMaterial[]>();

    for (const drum of drums) {
      byItem.set(drum.item.id, [...(byItem.get(drum.item.id) ?? []), drum]);
    }

    const lines: JobWorkIssuePlanLine[] = required.map((requirement) => {
      // FEFO, over the principal's drums. A drum with no expiry sorts LAST for
      // the same reason it does internally: something that cannot expire is the
      // safest thing to leave on the shelf.
      const candidates = (byItem.get(requirement.item.id) ?? [])
        .filter((drum) => drum.lotStatus === 'USABLE' && Number(drum.quantityAvailable) > 0)
        .sort((a, b) => {
          if (a.expiryDate === b.expiryDate) return a.lotNumber.localeCompare(b.lotNumber);
          if (a.expiryDate === null) return 1;
          if (b.expiryDate === null) return -1;
          return a.expiryDate.localeCompare(b.expiryDate);
        });

      let outstanding = requirement.quantity;
      const allocations: JobWorkIssuePlanLine['allocations'] = [];

      for (const drum of candidates) {
        if (outstanding.lessThanOrEqualTo(ZERO)) break;

        const available = new Prisma.Decimal(drum.quantityAvailable);
        const take = Prisma.Decimal.min(available, outstanding);

        allocations.push({
          lotId: drum.lotId,
          lotNumber: drum.lotNumber,
          receiptLineId: drum.receiptLineId,
          batchNumber: drum.batchNumber,
          deliveryChallanNumber: drum.deliveryChallanNumber,
          expiryDate: drum.expiryDate,
          quantity: take.toString(),
          quantityAvailable: drum.quantityAvailable,
        });

        outstanding = outstanding.sub(take);
      }

      const allocated = allocations.reduce(
        (total, allocation) => total.add(allocation.quantity),
        ZERO,
      );

      return {
        item: requirement.item,
        kind: requirement.kind,
        quantityRequired: requirement.quantity.toString(),
        quantityAllocated: allocated.toString(),
        quantityShort: Prisma.Decimal.max(ZERO, requirement.quantity.sub(allocated)).toString(),
        allocations,
      };
    });

    return {
      ...base,
      canIssue: lines.length > 0 && lines.every((line) => line.quantityShort === '0'),
      blockedReason: null,
      lines,
    };
  }

  /**
   * The formulation and the pack specification, scaled to the planned quantity.
   *
   * Returns the reason as a STRING when there is nothing to scale, so the
   * caller can put it on screen rather than raising a 400 at a form that was
   * only asking what a batch would need.
   *
   * THE ACTIVE FORMULATION, not the one pinned to the agreement — the same
   * choice the readiness check makes, and for the same reason: measuring one
   * version and manufacturing to another produces a screen that passes and a
   * batch that is short.
   */
  private async requirementFor(order: {
    plannedQuantity: Prisma.Decimal;
    orderNumber: string;
    jobWorkOrder: { mapping: { bom: { product: { id: string; name: string } } } };
  }): Promise<string | { item: ItemSummary; kind: JobWorkMaterialKind; quantity: Prisma.Decimal }[]> {
    const product = order.jobWorkOrder.mapping.bom.product;

    const [bom, packaging] = await Promise.all([
      this.prisma.scoped.bom.findFirst({
        where: { productId: product.id, isActive: true, deletedAt: null },
        include: { lines: { include: { item: true }, orderBy: { item: { code: 'asc' } } } },
      }),
      this.prisma.scoped.packagingRequirement.findFirst({
        where: { productId: product.id, isActive: true, deletedAt: null },
        include: { lines: { include: { item: true }, orderBy: { item: { code: 'asc' } } } },
      }),
    ]);

    if (!bom) {
      return (
        `${product.name} has no active formulation, so there is nothing to work a material ` +
        'requirement out from. Create one under Formulations first.'
      );
    }

    if (bom.lines.length === 0) {
      return `Formulation version ${bom.version} lists no materials, so nothing could be issued.`;
    }

    const scale = order.plannedQuantity.div(bom.outputQuantity);

    const raw = bom.lines
      // A finished product listed as its own input is a data-entry trap; the
      // receipt form filters it for the same reason.
      .filter((line) => line.item.type !== 'FINISHED_GOOD')
      .map((line) => ({
        item: toItemSummary(line.item),
        kind: (line.item.type === 'PACKING_MATERIAL' ? 'PACKING' : 'RAW') as JobWorkMaterialKind,
        quantity: line.quantityPer.mul(scale).toDecimalPlaces(3),
      }));

    const alreadyListed = new Set(raw.map((line) => line.item.id));

    // THE PACK, scaled by its own basis. A per-batch component is needed once
    // however big the batch; a per-pack one is needed once per pack, and how
    // many packs there are depends on how many units go in each.
    const packing = (packaging?.lines ?? [])
      .filter((line) => !alreadyListed.has(line.itemId))
      .map((line) => {
        const packs =
          line.quantityBasis === 'PER_BATCH'
            ? new Prisma.Decimal(1)
            : packaging && !packaging.unitsPerPack.isZero()
              ? order.plannedQuantity.div(packaging.unitsPerPack)
              : new Prisma.Decimal(0);

        return {
          item: toItemSummary(line.item),
          kind: 'PACKING' as JobWorkMaterialKind,
          quantity: line.quantityPer.mul(packs).toDecimalPlaces(3),
        };
      });

    return [...raw, ...packing];
  }

  async previewIssueNumber(): Promise<{ issueNumber: string }> {
    return {
      issueNumber: await this.numbering.peek(this.tenantContext.requireTenantId(), 'JWMI'),
    };
  }

  async previewBatchNumber(): Promise<{ batchNumber: string }> {
    return {
      batchNumber: await this.numbering.peek(this.tenantContext.requireTenantId(), 'JWB'),
    };
  }

  async recordIssue(dto: RecordJobWorkIssueDto): Promise<JobWorkMaterialIssueView> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const order = await this.requireProductionOrder(dto.jobWorkProductionOrderId);

    if (order.status === 'CANCELLED' || order.status === 'BATCH_RELEASED') {
      throw new ConflictException(
        `${order.orderNumber} is ${order.status === 'CANCELLED' ? 'cancelled' : 'released'}, so ` +
          'no more material can be issued against it.',
      );
    }

    // THE DRUMS THIS ORDER MAY DRAW ON, which is its own receipt's and nobody
    // else's. Checked here rather than only on the form: an issue naming a lot
    // from another principal's consignment would put their material in this
    // batch.
    const allowed = new Map(
      order.materialReceipt.lines
        .filter((line) => line.stockLot !== null)
        .map((line) => [line.stockLot!.id, line]),
    );

    const prepared = dto.lines.map((line) => {
      const source = allowed.get(line.lotId);

      if (!source) {
        throw new BadRequestException(
          'That lot was not received on this production order’s material receipt, so it cannot ' +
            'be issued to this batch.',
        );
      }

      const lot = source.stockLot!;

      if (lot.status !== 'USABLE') {
        throw new ConflictException(
          `Lot ${lot.lotNumber} is ${lot.status.toLowerCase().replace('_', ' ')}, so it cannot be ` +
            'issued. Only material released by Quality check may be drawn.',
        );
      }

      const quantity = new Prisma.Decimal(line.quantityIssued);

      if (quantity.lessThanOrEqualTo(ZERO)) {
        throw new BadRequestException(
          `The quantity issued for ${source.item.code} has to be more than zero.`,
        );
      }

      if (quantity.greaterThan(lot.quantityAvailable)) {
        throw new ConflictException(
          `Lot ${lot.lotNumber} has ${lot.quantityAvailable.toString()} ${source.item.uom} left, ` +
            `so ${quantity.toString()} cannot be issued from it.`,
        );
      }

      return { source, lot, quantity };
    });

    if (prepared.length === 0) {
      throw new BadRequestException('Enter a quantity against at least one drum.');
    }

    const issueId = await this.prisma.transaction(async (tx) => {
      const issueNumber = await this.numbering.next(tx, tenantId, 'JWMI');

      const issue = await tx.jobWorkMaterialIssue.create({
        data: {
          tenantId,
          issueNumber,
          jobWorkProductionOrderId: order.id,
          notes: dto.notes?.trim() || null,
          issuedById: userId,
        },
        select: { id: true },
      });

      for (const { source, lot, quantity } of prepared) {
        await tx.jobWorkMaterialIssueLine.create({
          data: {
            tenantId,
            issueId: issue.id,
            itemId: source.itemId,
            lotId: lot.id,
            receiptLineId: source.id,
            quantityIssued: quantity,
          },
        });

        // THE SHELF FIGURE MOVES. A conditional update rather than a read then
        // a write: two issues drawing on one drum at the same moment would
        // otherwise both see the same balance and both succeed.
        const moved = await tx.stockLot.updateMany({
          where: { id: lot.id, quantityAvailable: { gte: quantity } },
          data: { quantityAvailable: { decrement: quantity } },
        });

        if (moved.count === 0) {
          throw new ConflictException(
            `Lot ${lot.lotNumber} no longer has ${quantity.toString()} available — somebody drew ` +
              'on it while this issue was being recorded.',
          );
        }

        await tx.stockLedgerEntry.create({
          data: {
            tenantId,
            itemId: source.itemId,
            stockLotId: lot.id,
            entryType: 'ADJUSTMENT',
            quantityDelta: quantity.negated(),
            affectsUsableStock: true,
            reference: issueNumber,
            notes:
              `Issued to job-work production order ${order.orderNumber} for ` +
              `${order.jobWorkOrder.principal.name}.`,
            createdById: userId,
          },
        });
      }

      // The order is under way the moment material leaves the store.
      if (order.status === 'DRAFT' || order.status === 'READY_FOR_PRODUCTION') {
        await tx.jobWorkProductionOrder.update({
          where: { id: order.id },
          data: { status: 'IN_PRODUCTION' },
        });
      }

      return issue.id;
    });

    return this.findIssue(issueId);
  }

  async findIssue(id: string): Promise<JobWorkMaterialIssueView> {
    const row = await this.prisma.scoped.jobWorkMaterialIssue.findFirst({
      where: { id, deletedAt: null },
      include: ISSUE_INCLUDE,
    });

    if (!row) throw new BadRequestException('That material issue does not exist.');

    return toIssueView(row);
  }

  // ---------------------------------------------------------------------------
  // Batch record
  // ---------------------------------------------------------------------------

  async listBatches(productionOrderId?: string): Promise<JobWorkBatchView[]> {
    const rows = await this.prisma.scoped.jobWorkBatch.findMany({
      where: {
        deletedAt: null,
        ...(productionOrderId ? { jobWorkProductionOrderId: productionOrderId } : {}),
      },
      include: BATCH_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return Promise.all(rows.map((row) => this.withVariances(row)));
  }

  /**
   * What the formulation called for against what was actually drawn.
   *
   * THE SAME FIGURE BatchService COMPUTES for own-brand batches, over this
   * module's own issue lines. Computed rather than stored on the same
   * reasoning: both sides already exist as records, and a third copy is a third
   * thing that can disagree.
   *
   * Small variances are normal — a drum runs out and a second is opened, a
   * formulation scales to a quantity that does not divide evenly — which is
   * why there is a threshold rather than an equality check.
   */
  private async withVariances(batch: BatchWithRelations): Promise<JobWorkBatchView> {
    const [issued, required] = await Promise.all([
      this.prisma.scoped.jobWorkMaterialIssueLine.groupBy({
        by: ['itemId'],
        where: {
          issue: { jobWorkProductionOrderId: batch.jobWorkProductionOrderId, deletedAt: null },
        },
        _sum: { quantityIssued: true },
      }),
      this.requirementFor({
        plannedQuantity: batch.plannedQuantity,
        orderNumber: batch.productionOrder.orderNumber,
        jobWorkOrder: batch.productionOrder.jobWorkOrder,
      }),
    ]);

    const issuedByItem = new Map(
      issued.map((row) => [row.itemId, row._sum.quantityIssued ?? ZERO]),
    );

    // A batch whose product has since lost its formulation still has to render.
    // No requirement means no comparison, not a broken screen.
    const variances: JobWorkBatchMaterialVariance[] =
      typeof required === 'string'
        ? []
        : required.map((line) => {
            const actual = new Prisma.Decimal(issuedByItem.get(line.item.id) ?? ZERO);

            // Guard the divide rather than relying on the CHECK constraint that
            // makes a zero requirement impossible.
            const variance = line.quantity.isZero()
              ? ZERO
              : actual.sub(line.quantity).div(line.quantity).mul(100).toDecimalPlaces(2);

            return {
              item: line.item,
              kind: line.kind,
              quantityPlanned: line.quantity.toString(),
              quantityIssued: actual.toString(),
              variancePercent: variance.toString(),
              flagged: variance.abs().greaterThan(VARIANCE_THRESHOLD_PERCENT),
            };
          });

    return { ...toBatchView(batch), materialVariances: variances };
  }

  /**
   * Records the batch, or its packing figures.
   *
   * ONE RECORD FOR BOTH, created on the first call and filled in by the second.
   * Manufacturing and packing are two events, and the internal flow gives each
   * its own row; job work has no second consumer of the packing figures, so
   * they sit on the batch and the screen shows one growing record rather than
   * two half-empty ones.
   *
   * MATERIAL MUST HAVE BEEN ISSUED FIRST. A batch recorded against an order
   * nothing was drawn for is a batch made of nothing.
   */
  async recordBatch(dto: RecordJobWorkBatchDto): Promise<JobWorkBatchView> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const order = await this.requireProductionOrder(dto.jobWorkProductionOrderId);

    const issues = await this.prisma.scoped.jobWorkMaterialIssue.count({
      where: { jobWorkProductionOrderId: order.id, deletedAt: null },
    });

    if (issues === 0) {
      throw new ConflictException(
        `No material has been issued against ${order.orderNumber} yet, so there is nothing a ` +
          'batch could be made from. Record the issue first.',
      );
    }

    if (dto.expiryDate <= dto.manufacturedOn) {
      throw new BadRequestException(
        'The expiry date has to be after the date of manufacture.',
      );
    }

    const actual = dto.actualQuantity ? new Prisma.Decimal(dto.actualQuantity) : null;

    if (actual && actual.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException('The quantity made has to be more than zero.');
    }

    const batchId = await this.prisma.transaction(async (tx) => {
      const batchNumber = await this.numbering.next(tx, tenantId, 'JWB');

      const batch = await tx.jobWorkBatch.create({
        data: {
          tenantId,
          batchNumber,
          jobWorkProductionOrderId: order.id,
          manufacturedOn: fromIsoDate(dto.manufacturedOn),
          expiryDate: fromIsoDate(dto.expiryDate),
          plannedQuantity: order.plannedQuantity,
          actualQuantity: actual,
          notes: dto.notes?.trim() || null,
          recordedById: userId,
        },
        select: { id: true },
      });

      return batch.id;
    });

    return this.findBatch(batchId);
  }

  /** Adds the packing figures to a batch already recorded. */
  async recordPacking(id: string, dto: RecordJobWorkPackingDto): Promise<JobWorkBatchView> {
    const batch = await this.requireBatch(id);

    if (batch.releaseStatus !== 'PENDING') {
      throw new ConflictException(
        `Batch ${batch.batchNumber} has already been decided, so its packing figures can no ` +
          'longer be changed.',
      );
    }

    const packed = dto.packedQuantity ? new Prisma.Decimal(dto.packedQuantity) : null;
    const rejected = dto.rejectedQuantity ? new Prisma.Decimal(dto.rejectedQuantity) : ZERO;

    if (packed && batch.actualQuantity && packed.greaterThan(batch.actualQuantity)) {
      throw new ConflictException(
        `${packed.toString()} cannot be packed from a batch of ${batch.actualQuantity.toString()}.`,
      );
    }

    await this.prisma.scoped.jobWorkBatch.update({
      where: { id },
      data: {
        packedQuantity: packed,
        rejectedQuantity: rejected,
        packVariant: dto.packVariant?.trim() || null,
        packedOn: dto.packedOn ? fromIsoDate(dto.packedOn) : null,
        ...(dto.actualQuantity ? { actualQuantity: new Prisma.Decimal(dto.actualQuantity) } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
      },
    });

    return this.findBatch(id);
  }

  async findBatch(id: string): Promise<JobWorkBatchView> {
    return this.withVariances(await this.requireBatch(id));
  }

  // ---------------------------------------------------------------------------
  // Batch release
  // ---------------------------------------------------------------------------

  /**
   * The quality gate on the finished batch.
   *
   * SEPARATE FROM THE INCOMING DECISION on the principal's material: that one
   * cleared what arrived, this one clears what was made of it. A release is
   * final — reversing one is a deviation, handled outside this screen — which
   * is the same rule the internal gate applies.
   */
  async decideBatch(id: string, dto: DecideJobWorkBatchDto): Promise<JobWorkBatchView> {
    const userId = this.tenantContext.getUserId();

    if (!userId) {
      throw new BadRequestException('A release decision has to be recorded by a signed-in user.');
    }

    const batch = await this.requireBatch(id);

    if (batch.releaseStatus === 'RELEASED') {
      throw new ConflictException(
        `Batch ${batch.batchNumber} was already released. A release decision is final — ` +
          'reversing one is a deviation, handled outside this screen.',
      );
    }

    if (dto.decision !== 'RELEASED' && !dto.notes?.trim()) {
      throw new BadRequestException('A reason is required when holding or rejecting a batch.');
    }

    if (dto.decision === 'RELEASED' && batch.actualQuantity === null) {
      throw new ConflictException(
        `Batch ${batch.batchNumber} has no recorded quantity, so there is nothing to release. ` +
          'Record what was actually made first.',
      );
    }

    await this.prisma.transaction(async (tx) => {
      await tx.jobWorkBatch.update({
        where: { id },
        data: {
          releaseStatus: dto.decision,
          releaseDecidedAt: new Date(),
          releaseDecidedById: userId,
          releaseNotes: dto.notes?.trim() || null,
        },
      });

      if (dto.decision === 'RELEASED') {
        await tx.jobWorkProductionOrder.update({
          where: { id: batch.jobWorkProductionOrderId },
          data: { status: 'BATCH_RELEASED' },
        });
      }
    });

    return this.findBatch(id);
  }

  // ---------------------------------------------------------------------------

  private async requireProductionOrder(id: string) {
    const order = await this.prisma.scoped.jobWorkProductionOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        jobWorkOrder: {
          select: {
            orderNumber: true,
            principal: { select: { id: true, name: true } },
            mapping: {
              select: { principalBrandName: true, bom: { select: { product: true } } },
            },
          },
        },
        materialReceipt: {
          include: {
            lines: {
              where: { deletedAt: null },
              include: { item: true, stockLot: true },
              orderBy: { item: { code: 'asc' } },
            },
          },
        },
      },
    });

    if (!order) throw new BadRequestException('That production order does not exist.');

    return order;
  }

  private async requireBatch(id: string) {
    const batch = await this.prisma.scoped.jobWorkBatch.findFirst({
      where: { id, deletedAt: null },
      include: BATCH_INCLUDE,
    });

    if (!batch) throw new BadRequestException('That batch does not exist.');

    return batch;
  }
}

// -----------------------------------------------------------------------------
// Shapes and mappers
// -----------------------------------------------------------------------------

const ORDER_SUMMARY = {
  select: {
    id: true,
    orderNumber: true,
    jobWorkOrder: {
      select: {
        orderNumber: true,
        principal: { select: { id: true, name: true } },
        mapping: {
          select: { principalBrandName: true, bom: { select: { product: true } } },
        },
      },
    },
  },
} satisfies Prisma.JobWorkProductionOrderDefaultArgs;

const ISSUE_INCLUDE = {
  productionOrder: ORDER_SUMMARY,
  issuedBy: { select: { fullName: true } },
  lines: {
    include: {
      item: true,
      lot: { select: { id: true, lotNumber: true, vendorBatchNumber: true, expiryDate: true } },
      receiptLine: { select: { deliveryChallanNumber: true } },
    },
    orderBy: { item: { code: 'asc' } },
  },
} satisfies Prisma.JobWorkMaterialIssueInclude;

const BATCH_INCLUDE = {
  productionOrder: ORDER_SUMMARY,
  recordedBy: { select: { fullName: true } },
  releaseDecidedBy: { select: { fullName: true } },
} satisfies Prisma.JobWorkBatchInclude;

type IssueWithRelations = Prisma.JobWorkMaterialIssueGetPayload<{ include: typeof ISSUE_INCLUDE }>;
type BatchWithRelations = Prisma.JobWorkBatchGetPayload<{ include: typeof BATCH_INCLUDE }>;

function toIssueView(issue: IssueWithRelations): JobWorkMaterialIssueView {
  const order = issue.productionOrder;

  return {
    id: issue.id,
    issueNumber: issue.issueNumber,

    productionOrderId: order.id,
    productionOrderNumber: order.orderNumber,
    jobWorkOrderNumber: order.jobWorkOrder.orderNumber,
    principalId: order.jobWorkOrder.principal.id,
    principalName: order.jobWorkOrder.principal.name,
    product: toItemSummary(order.jobWorkOrder.mapping.bom.product),

    issuedAt: issue.issuedAt.toISOString(),
    issuedBy: issue.issuedBy?.fullName ?? null,
    notes: issue.notes,

    lines: issue.lines.map((line) => ({
      id: line.id,
      item: toItemSummary(line.item),
      kind: line.item.type === 'PACKING_MATERIAL' ? 'PACKING' : 'RAW',

      lotId: line.lot.id,
      lotNumber: line.lot.lotNumber,
      batchNumber: line.lot.vendorBatchNumber ?? '—',
      expiryDate: line.lot.expiryDate ? toIsoDate(line.lot.expiryDate) : null,

      quantityIssued: line.quantityIssued.toString(),

      deliveryChallanNumber: line.receiptLine?.deliveryChallanNumber ?? null,
    })),

    totalQuantityIssued: issue.lines
      .reduce((total, line) => total.add(line.quantityIssued), ZERO)
      .toString(),
  };
}

function toBatchView(batch: BatchWithRelations): JobWorkBatchView {
  const order = batch.productionOrder;

  return {
    id: batch.id,
    batchNumber: batch.batchNumber,

    productionOrderId: order.id,
    productionOrderNumber: order.orderNumber,
    jobWorkOrderNumber: order.jobWorkOrder.orderNumber,
    principalId: order.jobWorkOrder.principal.id,
    principalName: order.jobWorkOrder.principal.name,
    product: toItemSummary(order.jobWorkOrder.mapping.bom.product),
    principalBrandName: order.jobWorkOrder.mapping.principalBrandName,

    manufacturedOn: toIsoDate(batch.manufacturedOn),
    expiryDate: toIsoDate(batch.expiryDate),

    plannedQuantity: batch.plannedQuantity.toString(),
    actualQuantity: batch.actualQuantity?.toString() ?? null,

    packedQuantity: batch.packedQuantity?.toString() ?? null,
    rejectedQuantity: batch.rejectedQuantity.toString(),
    packVariant: batch.packVariant,
    packedOn: batch.packedOn ? toIsoDate(batch.packedOn) : null,

    releaseStatus: batch.releaseStatus as BatchReleaseStatus,
    releaseDecidedAt: batch.releaseDecidedAt?.toISOString() ?? null,
    releaseDecidedBy: batch.releaseDecidedBy?.fullName ?? null,
    releaseNotes: batch.releaseNotes,

    notes: batch.notes,

    // Replaced by `withVariances`, which is the only caller that can afford
    // the query. Empty rather than optional so the type stays total.
    materialVariances: [],
    varianceThresholdPercent: VARIANCE_THRESHOLD_PERCENT,

    recordedBy: batch.recordedBy?.fullName ?? null,
    createdAt: batch.createdAt.toISOString(),
  };
}
