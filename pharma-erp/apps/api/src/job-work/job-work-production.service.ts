import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  BatchReleaseStatus,
  BillingModel,
  JobWorkMaterialSource,
  JobWorkEligibleReceipt,
  JobWorkMaterialSufficiency,
  JobWorkMaterialSufficiencyLine,
  JobWorkProductionOrderView,
  JobWorkProductionStatus,
} from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../procurement/numbering.service';
import { fromIsoDate, toItemSummary, toIsoDate } from '../production/production.mappers';
import { TenantContextService } from '../tenant/tenant-context.service';

import type {
  CreateJobWorkProductionOrderDto,
  UpdateJobWorkProductionOrderDto,
} from './dto/job-work-production.dto';
import { JobWorkOrdersService, parseQuantity } from './job-work-orders.service';
import { JobWorkReadinessService } from './job-work-readiness.service';
import { toReceiptView, RECEIPT_INCLUDE } from './job-work-receipts.service';
import { materialRequirementFor } from './job-work-requirements';

const ZERO = new Prisma.Decimal(0);

/**
 * Manufacturing a principal's batch — the job-work production order.
 *
 * A SEPARATE RECORD FROM THE INTERNAL PRODUCTION ORDER, at the product owner's
 * instruction. This reverses US-JW-03, which said job work must raise "the SAME
 * production work order own-brand batches use" — and it did, as a
 * ProductionOrder tagged with a job-work order id. The argument that won is
 * that the two are not the same document: job work manufactures on a
 * principal's licence, from a principal's material, released by a
 * consignment-level quality decision internal production has no equivalent of,
 * and every column on a shared table had to be read twice.
 *
 * THE NORMAL PRODUCTION WORKFLOW IS UNTOUCHED. Nothing here reads or writes
 * `production_orders`; existing job-work batches raised under the old design
 * keep working exactly as they did.
 *
 * IT OWNS NO MATERIAL. Everything about what will be consumed is on the receipt
 * it points at, whose lines already carry the drum, the batch marking, the
 * quantity and the expiry. A second copy would be a second answer to the same
 * question, free to drift from the first.
 *
 * RAISED ONLY FROM AN APPROVED RECEIPT. The quality decision on the consignment
 * is what makes the material issuable at all, so an order against anything else
 * is a promise the store cannot keep. Checked here rather than only on the
 * screen — section 20 of the brief.
 */
@Injectable()
export class JobWorkProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly numbering: NumberingService,
    // For the own-procurement material check: the reservation figure the
    // readiness screen already computes, so the two cannot disagree.
    private readonly readiness: JobWorkReadinessService,
    private readonly orders: JobWorkOrdersService,
  ) {}

  async list(jobWorkOrderId?: string): Promise<JobWorkProductionOrderView[]> {
    const rows = await this.prisma.scoped.jobWorkProductionOrder.findMany({
      // ONE QUERY, NOT ONE PER RELATION. This include is six levels deep, and
      // the default strategy fetches each level in its own round trip — twenty
      // of them at ~280ms against this database. 'join' asks PostgreSQL for the
      // lot in a single statement with lateral joins.
      //
      // OPT-IN, HERE ONLY. Nothing else in the codebase generates differently.
      relationLoadStrategy: 'join',
      where: { deletedAt: null, ...(jobWorkOrderId ? { jobWorkOrderId } : {}) },
      include: PRODUCTION_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return rows.map(toProductionView);
  }

  async findOne(id: string): Promise<JobWorkProductionOrderView> {
    return toProductionView(await this.requireOrder(id));
  }

  /**
   * The receipts this order could be manufactured from.
   *
   * APPROVED ONLY, and not already spoken for. A consignment that has had a
   * production order raised against it is offered again — a principal's
   * delivery may well cover two batches — but the screen shows what has
   * already been raised so nobody does it twice by accident.
   */
  /**
   * Has the principal sent enough to make this batch?
   *
   * REQUIRED comes from the masters — the active formulation, and the active
   * pack specification — scaled to the quantity the job-work order asked for.
   * RECEIVED is this consignment's own lines, summed per material. Nothing is
   * stored: both sides are read from the records that already hold them.
   *
   * RAW AND PACKING ARE REPORTED SEPARATELY because they come from different
   * masters and are chased from different people.
   *
   * This is the same computation `create` refuses on, called by the form so a
   * shortage is visible before the button is pressed rather than after.
   */
  async materialSufficiency(
    jobWorkOrderId: string,
    materialReceiptId?: string,
  ): Promise<JobWorkMaterialSufficiency> {
    // ONE TRANSACTION for the reads this makes — see RecipeReader for why the
    // scoped client costs four round trips a query and this costs one.
    return this.prisma.transaction(async (tx) =>
      this.sufficiencyIn(tx, jobWorkOrderId, materialReceiptId),
    );
  }

  private async sufficiencyIn(
    tx: Prisma.TransactionClient,
    jobWorkOrderId: string,
    materialReceiptId?: string,
  ): Promise<JobWorkMaterialSufficiency> {
    const order = await this.orders.requireOrder(jobWorkOrderId);

    const billingModel = order.billingModel as BillingModel;

    // WHICH POOL, decided by the billing model and nothing else. Under own
    // procurement we bought the material through Procure-to-Pay, so there is no
    // consignment to measure and no incoming quality check to wait for.
    const fromConsignment = billingModel === 'PURE_CONVERSION';

    const receipt = fromConsignment
      ? await tx.jobWorkMaterialReceipt.findFirst({
          where: { id: materialReceiptId, deletedAt: null },
          include: RECEIPT_INCLUDE,
        })
      : null;

    if (fromConsignment) {
      if (!materialReceiptId || !receipt) {
        throw new BadRequestException('That material receipt does not exist.');
      }

      if (receipt.jobWorkOrderId !== order.id) {
        throw new ConflictException(
          `${receipt.receiptNumber} was received against a different job-work order.`,
        );
      }
    } else if (materialReceiptId) {
      throw new ConflictException(
        `${order.orderNumber} is an own-procurement order, so its material comes from our own ` +
          'stock rather than from the principal. There is no consignment to raise it against.',
      );
    }

    // THE FULL ITEM, not the narrow selection the order carries: the view
    // returns an ItemSummary, which needs the UOM and the rest of the master.
    const product = await tx.item.findFirstOrThrow({
      where: { id: order.mapping.bom.product.id },
    });

    const base = {
      jobWorkOrderId: order.id,
      jobWorkOrderNumber: order.orderNumber,
      billingModel,
      materialSource: (fromConsignment
        ? 'PRINCIPAL_CONSIGNMENT'
        : 'OWN_INVENTORY') as JobWorkMaterialSource,
      materialReceiptId: receipt?.id ?? null,
      receiptNumber: receipt?.receiptNumber ?? null,
      product: toItemSummary(product),
      // THE JOB-WORK ORDER'S OWN QUANTITY. The production order inherits it and
      // cannot be given another, so that is what the requirement is scaled to.
      plannedQuantity: order.quantity.toString(),
    };

    const required = await materialRequirementFor(tx, product, order.quantity);

    if (typeof required === 'string') {
      return { ...base, raw: [], packing: [], sufficient: false, blockedReason: required, shortages: [] };
    }

    const suppliedByItem = receipt
      ? consignedQuantities(receipt.lines)
      : await this.availableOwnStock(
          tx,
          required.map((requirement) => requirement.item.id),
        );

    const lines: JobWorkMaterialSufficiencyLine[] = required.map((requirement) => {
      const received = suppliedByItem.get(requirement.item.id) ?? ZERO;
      const short = Prisma.Decimal.max(ZERO, requirement.quantity.sub(received));

      return {
        item: requirement.item,
        kind: requirement.kind,
        requiredQuantity: requirement.quantity.toString(),
        suppliedQuantity: received.toString(),
        shortQuantity: short.toString(),
        sufficient: short.isZero(),
      };
    });

    const word = fromConsignment ? 'received' : 'in stock';

    const shortages = lines
      .filter((line) => !line.sufficient)
      .map(
        (line) =>
          `${line.item.code} — required ${line.requiredQuantity} ${line.item.uom}, ${word} ` +
          `${line.suppliedQuantity}, short ${line.shortQuantity}`,
      );

    return {
      ...base,
      raw: lines.filter((line) => line.kind === 'RAW'),
      packing: lines.filter((line) => line.kind === 'PACKING'),
      sufficient: shortages.length === 0,
      blockedReason: null,
      shortages,
    };
  }

  /**
   * Usable company stock per material, less what open work is already using.
   *
   * THE SAME MEASURE THE READINESS CHECK APPLIES, and deliberately so: that
   * service already decides what "available" means for an own-procurement
   * job-work order — company-owned lots, released by incoming QC, in date, less
   * the requirement of open work orders that have not yet drawn theirs. Two
   * answers to "is there enough" is one answer too many, and the one a screen
   * shows must be the one the refusal uses.
   *
   * NOTHING IS RESERVED HERE. This reads; the Material issue step is what
   * actually takes stock off the shelf.
   */
  private async availableOwnStock(
    tx: Prisma.TransactionClient,
    itemIds: string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    if (itemIds.length === 0) return new Map();

    const lots = await tx.stockLot.findMany({
      where: {
        itemId: { in: itemIds },
        // COMPANY-OWNED ONLY. A principal's drums sitting in the same store
        // belong to them and cannot be consumed by an order we bought for.
        ownership: 'COMPANY_OWNED',
        status: 'USABLE',
        quantityAvailable: { gt: 0 },
      },
      select: { itemId: true, quantityAvailable: true, expiryDate: true },
    });

    const available = new Map<string, Prisma.Decimal>();
    const today = new Date();

    for (const lot of lots) {
      // Expired stock is on the shelf but not issuable, so counting it would
      // promise material the dispensing step would then refuse.
      if (lot.expiryDate !== null && lot.expiryDate < today) continue;

      available.set(
        lot.itemId,
        (available.get(lot.itemId) ?? ZERO).add(lot.quantityAvailable),
      );
    }

    const committed = await this.readiness.committedToOpenOrders(itemIds);

    for (const row of committed) {
      const left = (available.get(row.itemId) ?? ZERO).sub(row.quantity);

      available.set(row.itemId, Prisma.Decimal.max(ZERO, left));
    }

    return available;
  }

  async previewOrderNumber(): Promise<{ orderNumber: string }> {
    return {
      orderNumber: await this.numbering.peek(this.tenantContext.requireTenantId(), 'JWPO'),
    };
  }

  /**
   * Every approved consignment, grouped by the order it arrived against.
   *
   * ONE CALL FOR THE WHOLE SCREEN. The Production orders panel used to ask
   * `eligibleReceipts` once per job-work order to decide which orders could
   * have an order raised — seventy-four requests to draw one page, which took
   * twenty-six seconds and is what tripped the thirty-second timeout.
   */
  async eligibleReceiptsByOrder(): Promise<Record<string, JobWorkEligibleReceipt[]>> {
    // WHAT THE LOOKUP SHOWS, AND NOTHING MORE — a number and a count of each
    // kind. Returning the whole receipt made this one call 443 KB and eight
    // seconds to render a dropdown; the lines are read server-side by the
    // material check, which is the thing that actually needs them.
    const receipts = await this.prisma.scoped.jobWorkMaterialReceipt.findMany({
      where: { status: 'APPROVED', deletedAt: null },
      select: {
        id: true,
        jobWorkOrderId: true,
        receiptNumber: true,
        lines: {
          where: { deletedAt: null },
          select: { deliveryChallanNumber: true, item: { select: { type: true } } },
        },
      },
      orderBy: [{ receiptDate: 'desc' }, { receiptNumber: 'desc' }],
    });

    const byOrder: Record<string, JobWorkEligibleReceipt[]> = {};

    for (const receipt of receipts) {
      const view: JobWorkEligibleReceipt = {
        id: receipt.id,
        receiptNumber: receipt.receiptNumber,
        rawMaterialCount: receipt.lines.filter((l) => l.item.type !== 'PACKING_MATERIAL').length,
        packingMaterialCount: receipt.lines.filter((l) => l.item.type === 'PACKING_MATERIAL').length,
        deliveryChallanNumbers: [
          ...new Set(receipt.lines.map((l) => l.deliveryChallanNumber)),
        ],
      };

      byOrder[receipt.jobWorkOrderId] = [...(byOrder[receipt.jobWorkOrderId] ?? []), view];
    }

    return byOrder;
  }

  async eligibleReceipts(jobWorkOrderId: string) {
    await this.orders.requireOrder(jobWorkOrderId);

    const receipts = await this.prisma.scoped.jobWorkMaterialReceipt.findMany({
      where: { jobWorkOrderId, status: 'APPROVED', deletedAt: null },
      include: RECEIPT_INCLUDE,
      orderBy: { receivedAt: 'desc' },
    });

    return receipts.map(toReceiptView);
  }

  /**
   * Raises the order — against an approved consignment, or against our own
   * stock, according to the job-work order's billing model.
   *
   * PURE CONVERSION consumes what the principal sent, so it needs an approved
   * consignment behind it: the quality decision on that consignment is what
   * makes the material issuable at all.
   *
   * OWN PROCUREMENT consumes material we bought ourselves through
   * Procure-to-Pay, which has already been through incoming QC on its own goods
   * receipt. There is no consignment from the principal and no second quality
   * check to wait for — so those two steps do not apply, and requiring them is
   * what made the whole billing model unreachable from this screen.
   *
   * The quantity is the job-work order's under both, because that is the figure
   * somebody has already agreed with the principal.
   */
  async create(dto: CreateJobWorkProductionOrderDto): Promise<JobWorkProductionOrderView> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const order = await this.orders.requireOrder(dto.jobWorkOrderId);

    const fromConsignment = order.billingModel === 'PURE_CONVERSION';

    const receipt = fromConsignment
      ? await this.prisma.scoped.jobWorkMaterialReceipt.findFirst({
          where: { id: dto.materialReceiptId, deletedAt: null },
          include: RECEIPT_INCLUDE,
        })
      : null;

    if (fromConsignment) {
      if (!dto.materialReceiptId) {
        throw new BadRequestException(
          `${order.orderNumber} is a pure-conversion order, so it is made from material the ` +
            'principal sent. Name the approved consignment it will consume.',
        );
      }

      if (!receipt) throw new BadRequestException('That material receipt does not exist.');

      if (receipt.jobWorkOrderId !== order.id) {
        throw new ConflictException(
          `${receipt.receiptNumber} was received against a different job-work order. A production ` +
            'order consumes material delivered for the order it is raised under.',
        );
      }

      // THE GATE. Section 15 of the brief in one condition: an unapproved
      // consignment is quarantined material, and manufacturing against it would
      // be scheduling work the store cannot issue for.
      if (receipt.status !== 'APPROVED') {
        throw new ConflictException(
          `${receipt.receiptNumber} has not been approved — it is ` +
            `${RECEIPT_STATUS_WORDS[receipt.status] ?? receipt.status.toLowerCase()}. A production ` +
            'order can only be raised against material that has passed Quality check.',
        );
      }
    } else if (dto.materialReceiptId) {
      // REFUSED, NOT IGNORED. Ignoring it would let somebody believe an
      // own-procurement batch was tied to a consignment that it is not.
      throw new ConflictException(
        `${order.orderNumber} is an own-procurement order: we buy its material ourselves, so ` +
          'there is no consignment from the principal to raise it against. Remove the material ' +
          'receipt and the batch will draw on our own stock.',
      );
    }

    // THE QUANTITY IS THE JOB-WORK ORDER'S, always. It used to be an optional
    // field on the request that defaulted to this; it is now not accepted at
    // all, so a production order cannot plan a different quantity from the one
    // the principal agreed — and the material check below measures against the
    // same figure rather than against whatever was typed.
    const quantity = parseQuantity(order.quantity.toString(), 'plannedQuantity');

    if (quantity.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException(
        `${order.orderNumber} has no quantity to manufacture. Correct the job-work order first.`,
      );
    }

    // THE MATERIAL GATE. A production order is a commitment to make a batch,
    // and committing to one the principal has not sent the material for is how
    // a line gets scheduled around stock that never arrives.
    //
    // RE-COMPUTED HERE, not trusted from the form: the screen shows this same
    // answer so nobody is surprised, but a request made by hand meets the rule
    // just the same.
    const sufficiency = await this.materialSufficiency(order.id, receipt?.id);

    if (sufficiency.blockedReason) {
      throw new ConflictException(sufficiency.blockedReason);
    }

    if (!sufficiency.sufficient) {
      throw new ConflictException(
        fromConsignment
          ? `${receipt!.receiptNumber} does not carry enough material to make ${quantity.toString()} ` +
              `of ${sufficiency.product.name}: ${sufficiency.shortages.join('; ')}. Record the rest ` +
              "of the principal's delivery and approve it before raising this production order."
          : `There is not enough stock to make ${quantity.toString()} of ${sufficiency.product.name}: ` +
              `${sufficiency.shortages.join('; ')}. Only company-owned stock released by incoming QC ` +
              'counts, less what other open work orders have already spoken for. Buy the shortfall ' +
              'through Procure-to-Pay before raising this production order.',
      );
    }

    assertDatesOrdered(dto.plannedStartOn ?? null, dto.plannedCompletionOn ?? null);

    const created = await this.prisma.transaction(async (tx) => {
      const orderNumber = await this.numbering.next(tx, tenantId, 'JWPO');

      return tx.jobWorkProductionOrder.create({
        data: {
          tenantId,
          orderNumber,
          jobWorkOrderId: order.id,
          materialReceiptId: receipt?.id ?? null,
          plannedQuantity: quantity,
          plannedStartOn: dto.plannedStartOn ? fromIsoDate(dto.plannedStartOn) : null,
          plannedCompletionOn: dto.plannedCompletionOn
            ? fromIsoDate(dto.plannedCompletionOn)
            : null,
          notes: dto.notes?.trim() || null,
          createdById: userId,
        },
        select: { id: true },
      });
    });

    return this.findOne(created.id);
  }

  /**
   * Changes what can still legitimately change.
   *
   * QUANTITY AND DATES ONLY, and only before the batch is under way: once
   * production has started, the figures describe what is happening on the floor
   * rather than what was planned, and editing them would rewrite history. The
   * order, the receipt and the product are never editable — an order against
   * different material is a different order.
   */
  async update(
    id: string,
    dto: UpdateJobWorkProductionOrderDto,
  ): Promise<JobWorkProductionOrderView> {
    const existing = await this.requireOrder(id);

    if (existing.status !== 'DRAFT' && existing.status !== 'READY_FOR_PRODUCTION') {
      throw new ConflictException(
        `${existing.orderNumber} is ${PRODUCTION_STATUS_WORDS[existing.status]}, so its plan can ` +
          'no longer be changed.',
      );
    }

    const data: Prisma.JobWorkProductionOrderUpdateInput = {};

    if (dto.plannedQuantity !== undefined) {
      const quantity = parseQuantity(dto.plannedQuantity, 'plannedQuantity');

      if (quantity.lessThanOrEqualTo(ZERO)) {
        throw new BadRequestException('The planned quantity has to be more than zero.');
      }

      data.plannedQuantity = quantity;
    }

    if (dto.plannedStartOn !== undefined) {
      data.plannedStartOn = dto.plannedStartOn ? fromIsoDate(dto.plannedStartOn) : null;
    }

    if (dto.plannedCompletionOn !== undefined) {
      data.plannedCompletionOn = dto.plannedCompletionOn
        ? fromIsoDate(dto.plannedCompletionOn)
        : null;
    }

    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;

    assertDatesOrdered(
      dto.plannedStartOn ?? (existing.plannedStartOn ? toIsoDate(existing.plannedStartOn) : null),
      dto.plannedCompletionOn ??
        (existing.plannedCompletionOn ? toIsoDate(existing.plannedCompletionOn) : null),
    );

    if (dto.status !== undefined) {
      assertTransition(existing.status as JobWorkProductionStatus, dto.status);
      data.status = dto.status;
    }

    if (Object.keys(data).length === 0) return toProductionView(existing);

    await this.prisma.scoped.jobWorkProductionOrder.update({ where: { id }, data });

    return this.findOne(id);
  }

  private async requireOrder(id: string) {
    const row = await this.prisma.scoped.jobWorkProductionOrder.findFirst({
      where: { id, deletedAt: null },
      include: PRODUCTION_INCLUDE,
    });

    if (!row) throw new BadRequestException('That job-work production order does not exist.');

    return row;
  }
}

// -----------------------------------------------------------------------------
// Shapes and helpers
// -----------------------------------------------------------------------------

const PRODUCTION_INCLUDE = {
  jobWorkOrder: {
    select: {
      id: true,
      orderNumber: true,
      billingModel: true,
      principal: { select: { id: true, name: true } },
      agreement: { select: { id: true, agreementReference: true } },
      mapping: {
        select: {
          principalBrandName: true,
          bom: { select: { product: true } },
        },
      },
    },
  },
  materialReceipt: { include: RECEIPT_INCLUDE },
  createdBy: { select: { fullName: true } },

  // THE BATCH AND THE ISSUE COUNT, read with the order rather than looked up
  // per row on the screen: the register shows both in its columns, and a
  // per-row fetch there is the N+1 this include exists to avoid.
  //
  // One batch is the ordinary case — `take: 1` rather than a unique relation
  // because nothing in the schema forbids a second, and a list that silently
  // showed the older of two would be worse than showing the newer.
  batches: {
    where: { deletedAt: null },
    select: { batchNumber: true, releaseStatus: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  _count: { select: { materialIssues: { where: { deletedAt: null } } } },
} satisfies Prisma.JobWorkProductionOrderInclude;

type ProductionWithRelations = Prisma.JobWorkProductionOrderGetPayload<{
  include: typeof PRODUCTION_INCLUDE;
}>;

/** How a status reads inside a refusal — lower case, mid-sentence. */
const PRODUCTION_STATUS_WORDS: Record<string, string> = {
  DRAFT: 'still a draft',
  READY_FOR_PRODUCTION: 'ready for production',
  IN_PRODUCTION: 'in production',
  PRODUCTION_COMPLETED: 'completed',
  READY_FOR_BATCH_RELEASE: 'ready for batch release',
  BATCH_RELEASED: 'released',
  CANCELLED: 'cancelled',
};

const RECEIPT_STATUS_WORDS: Record<string, string> = {
  DRAFT: 'still a draft',
  PENDING_APPROVAL: 'pending approval',
  ON_HOLD: 'on hold',
  REJECTED: 'rejected',
};

/**
 * Which status may follow which.
 *
 * A LIST RATHER THAN A FREE FIELD. Every stage of manufacturing implies the one
 * before it happened, and a record that can jump from Draft to Batch released
 * is a record nobody can reason about. Cancellation is the one exception: work
 * can be abandoned from any stage that has not already finished.
 */
const NEXT: Record<JobWorkProductionStatus, JobWorkProductionStatus[]> = {
  DRAFT: ['READY_FOR_PRODUCTION', 'CANCELLED'],
  READY_FOR_PRODUCTION: ['IN_PRODUCTION', 'CANCELLED'],
  IN_PRODUCTION: ['PRODUCTION_COMPLETED', 'CANCELLED'],
  PRODUCTION_COMPLETED: ['READY_FOR_BATCH_RELEASE', 'CANCELLED'],
  READY_FOR_BATCH_RELEASE: ['BATCH_RELEASED'],
  BATCH_RELEASED: [],
  CANCELLED: [],
};

function assertTransition(from: JobWorkProductionStatus, to: JobWorkProductionStatus): void {
  if (from === to) return;

  if (!NEXT[from].includes(to)) {
    throw new ConflictException(
      `A production order that is ${PRODUCTION_STATUS_WORDS[from]} cannot become ` +
        `${PRODUCTION_STATUS_WORDS[to]}. ` +
        (NEXT[from].length === 0
          ? 'It has reached the end of its workflow.'
          : `What can follow: ${NEXT[from].map((next) => PRODUCTION_STATUS_WORDS[next]).join(', ')}.`),
    );
  }
}

function assertDatesOrdered(start: string | null, completion: string | null): void {
  if (start && completion && completion < start) {
    throw new BadRequestException(
      'The planned completion date has to be on or after the planned start date.',
    );
  }
}

/** What the principal sent, per material, summed across the consignment's lines. */
function consignedQuantities(
  lines: readonly { itemId: string; receivedQuantity: Prisma.Decimal }[],
): Map<string, Prisma.Decimal> {
  const byItem = new Map<string, Prisma.Decimal>();

  for (const line of lines) {
    byItem.set(line.itemId, (byItem.get(line.itemId) ?? ZERO).add(line.receivedQuantity));
  }

  return byItem;
}

function toProductionView(row: ProductionWithRelations): JobWorkProductionOrderView {
  const order = row.jobWorkOrder;

  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status as JobWorkProductionStatus,

    jobWorkOrderId: order.id,
    jobWorkOrderNumber: order.orderNumber,

    principalId: order.principal.id,
    principalName: order.principal.name,

    agreementId: order.agreement.id,
    agreementReference: order.agreement.agreementReference,
    billingModel: order.billingModel as BillingModel,

    product: toItemSummary(order.mapping.bom.product),
    principalBrandName: order.mapping.principalBrandName,

    plannedQuantity: row.plannedQuantity.toString(),

    plannedStartOn: row.plannedStartOn ? toIsoDate(row.plannedStartOn) : null,
    plannedCompletionOn: row.plannedCompletionOn ? toIsoDate(row.plannedCompletionOn) : null,

    notes: row.notes,

    materialReceipt: row.materialReceipt ? toReceiptView(row.materialReceipt) : null,
    materialSource:
      row.jobWorkOrder.billingModel === 'PURE_CONVERSION'
        ? 'PRINCIPAL_CONSIGNMENT'
        : 'OWN_INVENTORY',

    batchNumber: row.batches[0]?.batchNumber ?? null,
    releaseStatus: (row.batches[0]?.releaseStatus as BatchReleaseStatus | undefined) ?? null,
    issueCount: row._count.materialIssues,

    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy?.fullName ?? null,
  };
}
