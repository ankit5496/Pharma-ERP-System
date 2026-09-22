import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  BatchReleaseStatus,
  BillingModel,
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
import { toReceiptView, RECEIPT_INCLUDE } from './job-work-receipts.service';

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
    private readonly orders: JobWorkOrdersService,
  ) {}

  async list(jobWorkOrderId?: string): Promise<JobWorkProductionOrderView[]> {
    const rows = await this.prisma.scoped.jobWorkProductionOrder.findMany({
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
  async previewOrderNumber(): Promise<{ orderNumber: string }> {
    return {
      orderNumber: await this.numbering.peek(this.tenantContext.requireTenantId(), 'JWPO'),
    };
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
   * Raises the order, against an approved consignment.
   *
   * The quantity defaults to what the job-work order asked for, because that is
   * the figure somebody has already agreed; a planner who wants two batches of
   * half says so explicitly rather than having a default guess at it.
   */
  async create(dto: CreateJobWorkProductionOrderDto): Promise<JobWorkProductionOrderView> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const order = await this.orders.requireOrder(dto.jobWorkOrderId);

    const receipt = await this.prisma.scoped.jobWorkMaterialReceipt.findFirst({
      where: { id: dto.materialReceiptId, deletedAt: null },
      include: RECEIPT_INCLUDE,
    });

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

    const quantity = parseQuantity(dto.plannedQuantity ?? order.quantity.toString(), 'plannedQuantity');

    if (quantity.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException('The planned quantity has to be more than zero.');
    }

    assertDatesOrdered(dto.plannedStartOn ?? null, dto.plannedCompletionOn ?? null);

    const created = await this.prisma.transaction(async (tx) => {
      const orderNumber = await this.numbering.next(tx, tenantId, 'JWPO');

      return tx.jobWorkProductionOrder.create({
        data: {
          tenantId,
          orderNumber,
          jobWorkOrderId: order.id,
          materialReceiptId: receipt.id,
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

    materialReceipt: toReceiptView(row.materialReceipt),

    batchNumber: row.batches[0]?.batchNumber ?? null,
    releaseStatus: (row.batches[0]?.releaseStatus as BatchReleaseStatus | undefined) ?? null,
    issueCount: row._count.materialIssues,

    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy?.fullName ?? null,
  };
}
