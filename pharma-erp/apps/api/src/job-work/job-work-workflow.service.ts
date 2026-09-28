import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  BatchReleaseStatus,
  JobWorkBatchMaterialVariance,
  JobWorkBatchView,
  JobWorkIssuableMaterial,
  JobWorkIssuePlan,
  JobWorkIssuePlanLine,
  JobWorkMaterialIssueView,
} from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../procurement/numbering.service';
import { fromIsoDate, todayUtc, toItemSummary, toIsoDate } from '../production/production.mappers';
import { TenantContextService } from '../tenant/tenant-context.service';

import type {
  DecideJobWorkBatchDto,
  RecordJobWorkBatchDto,
  RecordJobWorkIssueDto,
  RecordJobWorkPackingDto,
} from './dto/job-work-workflow.dto';
import { loadRecipes, materialRequirementFor, scaleRecipe } from './job-work-requirements';


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

  /** One transaction, for the reason given on `listBatches`. */
  async listIssues(productionOrderId?: string): Promise<JobWorkMaterialIssueView[]> {
    const rows = await this.prisma.scoped.jobWorkMaterialIssue.findMany({
      // ONE QUERY, NOT ONE PER RELATION. This include is six levels deep, and
      // the default strategy fetches each level in its own round trip — twenty
      // of them at ~280ms against this database. 'join' asks PostgreSQL for the
      // lot in a single statement with lateral joins.
      //
      // OPT-IN, HERE ONLY. Nothing else in the codebase generates differently.
      relationLoadStrategy: 'join',
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

    // OWN PROCUREMENT DRAWS ON OUR OWN SHELF. There is no consignment, so the
    // drums are the company-owned lots of whatever the formulation calls for —
    // the same stock an own-brand batch would take, chosen the same way.
    if (order.materialReceipt === null) {
      return this.ownStockDrums(order, issuedByLot);
    }

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
   * Company-owned lots of everything this order's formulation calls for.
   *
   * A "drum" here is a stock lot we bought, released by incoming QC on its own
   * goods receipt — which is why own procurement needs no second quality check
   * and no inward receipt from the principal.
   *
   * PRINCIPAL-OWNED STOCK IS EXCLUDED. Another order's consignment may be
   * sitting in the same store; it belongs to them, and an order we bought the
   * material for must not quietly consume it.
   */
  private async ownStockDrums(
    order: { jobWorkOrder: { mapping: { bom: { product: { id: string; name: string } } } }; plannedQuantity: Prisma.Decimal },
    issuedByLot: Map<string, Prisma.Decimal>,
  ): Promise<JobWorkIssuableMaterial[]> {
    const required = await this.prisma.transaction(async (tx) =>
      materialRequirementFor(tx, order.jobWorkOrder.mapping.bom.product, order.plannedQuantity),
    );

    if (typeof required === 'string') return [];

    const kindByItem = new Map(required.map((line) => [line.item.id, line.kind]));

    const lots = await this.prisma.scoped.stockLot.findMany({
      where: {
        itemId: { in: required.map((line) => line.item.id) },
        ownership: 'COMPANY_OWNED',
        quantityAvailable: { gt: 0 },
      },
      include: { item: true },
      orderBy: [{ expiryDate: 'asc' }, { lotNumber: 'asc' }],
    });

    return lots.map((lot) => ({
      // NO RECEIPT LINE. This lot came from a purchase, not from a challan.
      receiptLineId: null,
      lotId: lot.id,
      lotNumber: lot.lotNumber,
      item: toItemSummary(lot.item),
      kind: kindByItem.get(lot.itemId) ?? (lot.item.type === 'PACKING_MATERIAL' ? 'PACKING' : 'RAW'),
      // The supplier's marking, which is what "batch" means on a bought lot.
      batchNumber: lot.vendorBatchNumber ?? lot.lotNumber,
      deliveryChallanNumber: null,
      manufacturingDate: lot.manufacturingDate ? toIsoDate(lot.manufacturingDate) : null,
      expiryDate: lot.expiryDate ? toIsoDate(lot.expiryDate) : null,
      receivedQuantity: lot.quantityReceived.toString(),
      quantityAvailable: lot.quantityAvailable.toString(),
      alreadyIssued: (issuedByLot.get(lot.id) ?? ZERO).toString(),
      lotStatus: lot.status,
    }));
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
      // Own procurement has no consignment; the plan says so with a dash
      // rather than inventing a document number.
      receiptNumber: order.materialReceipt?.receiptNumber ?? '—',
    };

    const required = await this.prisma.transaction(async (tx) =>
      materialRequirementFor(tx, order.jobWorkOrder.mapping.bom.product, order.plannedQuantity),
    );

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

    // THE DRUMS THIS ORDER MAY DRAW ON.
    //
    // PURE CONVERSION: its own consignment's, and nobody else's — an issue
    // naming a lot from another principal's delivery would put their material
    // in this batch.
    //
    // OWN PROCUREMENT: any company-owned lot of a material the formulation
    // calls for. Principal-owned stock is excluded for the mirror-image reason.
    //
    // Checked here rather than only on the form, either way.
    const allowed = new Map(
      (await this.issuableMaterial(order.id)).map((drum) => [drum.lotId, drum]),
    );

    const lotsById = new Map(
      (
        await this.prisma.scoped.stockLot.findMany({
          where: { id: { in: dto.lines.map((line) => line.lotId) } },
          include: { item: true },
        })
      ).map((lot) => [lot.id, lot]),
    );

    const prepared = dto.lines.map((line) => {
      const source = allowed.get(line.lotId);
      const lot = lotsById.get(line.lotId);

      if (!source || !lot) {
        throw new BadRequestException(
          order.materialReceipt === null
            ? 'That lot is not company-owned stock of a material this order’s formulation calls ' +
                'for, so it cannot be issued to this batch.'
            : 'That lot was not received on this production order’s material receipt, so it ' +
                'cannot be issued to this batch.',
        );
      }

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
            itemId: source.item.id,
            lotId: lot.id,
            // Null where the lot came from a purchase rather than a challan.
            receiptLineId: source.receiptLineId,
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
            itemId: source.item.id,
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

  /**
   * ONE TRANSACTION FOR THE WHOLE READ.
   *
   * Every operation on `prisma.scoped` opens a transaction of its own — BEGIN,
   * set_config, the query, COMMIT — which measures at about 1,160ms against
   * this database where the query alone costs 277ms. Reading a register through
   * it therefore cost four round trips per query, and this screen's reads
   * together were pushing the workflow past the thirty-second client timeout.
   *
   * Opening one transaction pays for the tenant scope once and leaves each
   * query at a single round trip. It is a READ: nothing here writes, so holding
   * the transaction costs no lock contention.
   */
  async listBatches(productionOrderId?: string): Promise<JobWorkBatchView[]> {
    return this.prisma.transaction(async (tx) => {
      const rows = await tx.jobWorkBatch.findMany({
        // ONE QUERY, NOT ONE PER RELATION. This include is six levels deep, and
        // the default strategy fetches each level in its own round trip — twenty
        // of them at ~280ms against this database. 'join' asks PostgreSQL for the
        // lot in a single statement with lateral joins.
        //
        // OPT-IN, HERE ONLY. Nothing else in the codebase generates differently.
        relationLoadStrategy: 'join',
        where: {
          deletedAt: null,
          ...(productionOrderId ? { jobWorkProductionOrderId: productionOrderId } : {}),
        },
        include: BATCH_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });

      return this.withVariances(rows, tx);
    });
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
  private async withVariances(
    batches: BatchWithRelations[],
    client: Prisma.TransactionClient,
  ): Promise<JobWorkBatchView[]> {
    if (batches.length === 0) return [];

    // ONE GROUPBY FOR THE WHOLE PAGE, not one per batch. The sum is per
    // production order AND item, so the rows separate cleanly afterwards.
    const orderIds = [...new Set(batches.map((batch) => batch.jobWorkProductionOrderId))];

    // ONE READ FOR THE WHOLE PAGE, not one per batch. Prisma's groupBy cannot
    // group by a relation's column, and the split has to be per production
    // order as well as per item — so the lines come back raw and are summed
    // here. Still one query rather than one per batch, which is the point.
    const lines = await client.jobWorkMaterialIssueLine.findMany({
      where: { issue: { jobWorkProductionOrderId: { in: orderIds }, deletedAt: null } },
      select: {
        itemId: true,
        quantityIssued: true,
        issue: { select: { jobWorkProductionOrderId: true } },
      },
    });
    const issuedByOrder = new Map<string, Map<string, Prisma.Decimal>>();

    for (const line of lines) {
      const orderId = line.issue.jobWorkProductionOrderId;
      const byItem = issuedByOrder.get(orderId) ?? new Map<string, Prisma.Decimal>();

      byItem.set(line.itemId, (byItem.get(line.itemId) ?? ZERO).add(line.quantityIssued));
      issuedByOrder.set(orderId, byItem);
    }

    // THE MASTERS ONCE FOR EVERY PRODUCT ON THE PAGE, in two queries. Scaling
    // them to each batch size afterwards is arithmetic, so a register of twenty
    // batches costs the same two reads as a register of one.
    const recipes = await loadRecipes(
      client,
      batches.map((batch) => batch.productionOrder.jobWorkOrder.mapping.bom.product),
    );

    return batches.map((batch) => {
      const product = batch.productionOrder.jobWorkOrder.mapping.bom.product;
      const required = scaleRecipe(recipes.get(product.id), batch.plannedQuantity);
      const issuedByItem = issuedByOrder.get(batch.jobWorkProductionOrderId) ?? new Map();

      // A batch whose product has since lost its formulation still has to
      // render. No requirement means no comparison, not a broken screen.
      const variances: JobWorkBatchMaterialVariance[] =
        typeof required === 'string'
          ? []
          : required.map((line) => {
              const actual = new Prisma.Decimal(issuedByItem.get(line.item.id) ?? ZERO);

              // Guard the divide rather than relying on the CHECK constraint
              // that makes a zero requirement impossible.
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
    });
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

    /**
     * WHEN THE PACK HAPPENED, defaulted to today exactly as the internal
     * packing record defaults it.
     *
     * This field is not decoration: it is what separates a batch that is
     * FINISHED from one merely opened, and the release gate lists only the
     * former. Left null when the form did not ask for a date, a packed batch
     * would never reach the quality officer at all.
     *
     * NOT BEFORE THE BATCH WAS MADE, which is the same check the internal
     * record applies — a pack dated before its own manufacture is a typo, and
     * one that would survive into the dispatch paperwork.
     */
    const packedOn = packed ? (dto.packedOn ? fromIsoDate(dto.packedOn) : todayUtc()) : null;

    if (packedOn && packedOn.getTime() < batch.manufacturedOn.getTime()) {
      throw new ConflictException(
        `Batch ${batch.batchNumber} cannot be packed on ${toIsoDate(packedOn)}: it was made on ` +
          `${toIsoDate(batch.manufacturedOn)}.`,
      );
    }

    const tenantId = this.tenantContext.requireTenantId();

    await this.prisma.transaction(async (tx) => {
      await tx.jobWorkBatch.update({
        where: { id },
        data: {
          // PARTIAL, as a PATCH is. Every field below is written only when the
          // caller sent it: a save that amends the yield alone used to blank
          // the packed quantity, the variant and the packing date on its way
          // past, which is a record being destroyed by an unrelated edit.
          ...(dto.packedQuantity !== undefined ? { packedQuantity: packed, packedOn } : {}),
          ...(dto.rejectedQuantity !== undefined ? { rejectedQuantity: rejected } : {}),
          ...(dto.packVariant !== undefined
            ? { packVariant: dto.packVariant?.trim() || null }
            : {}),
          ...(dto.packedOn !== undefined ? { packedOn } : {}),
          ...(dto.actualQuantity ? { actualQuantity: new Prisma.Decimal(dto.actualQuantity) } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
        },
      });

      // What the pack actually consumed, component by component — the same
      // record the internal batch keeps, in job work's own table.
      //
      // REPLACES the set rather than merging: re-recording packing restates
      // what was used, and a merge would make removing a component
      // impossible. An ABSENT array leaves what is there alone; an empty one
      // clears it.
      if (dto.consumptions !== undefined) {
        await tx.jobWorkBatchPackagingConsumption.deleteMany({ where: { jobWorkBatchId: id } });

        if (dto.consumptions.length > 0) {
          await tx.jobWorkBatchPackagingConsumption.createMany({
            data: dto.consumptions.map((consumption) => ({
              tenantId,
              jobWorkBatchId: id,
              itemId: consumption.itemId,
              quantityConsumed: new Prisma.Decimal(consumption.quantityConsumed),
              lotId: consumption.lotId ?? null,
              notes: consumption.notes?.trim() || null,
            })),
          });
        }
      }
    });

    return this.findBatch(id);
  }

  async findBatch(id: string): Promise<JobWorkBatchView> {
    const [view] = await this.prisma.transaction(async (tx) =>
      this.withVariances([await this.requireBatch(id)], tx),
    );

    // `withVariances` returns one view per batch and it was given exactly one.
    return view!;
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
  // The consumption rows come WITH the batch: the packing form seeds its
  // component boxes from them on a correction rather than asking again.
  packagingConsumptions: { select: { itemId: true, quantityConsumed: true } },
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
    packagingConsumed: batch.packagingConsumptions.map((consumption) => ({
      itemId: consumption.itemId,
      quantityConsumed: consumption.quantityConsumed.toString(),
    })),

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
