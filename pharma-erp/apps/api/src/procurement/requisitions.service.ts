import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  ProcurementListQuery,
  RequisitionListItem,
  RequisitionStatus,
} from '@pharma-erp/types';

import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import { parsePositive, positiveDifference, qty } from './decimal.util';
import type { CreateRequisitionDto, UpdateRequisitionDto } from './dto/requisition.dto';
import { dateRange } from './filters.util';
import {
  ITEM_SELECT,
  PRODUCTION_PLAN_INCLUDE,
  collectIds,
  toItemSummary,
  toProductionPlanSummary,
} from './mappers';
import { NumberingService } from './numbering.service';
import { PeopleService } from './people.service';
import { StockService } from './stock.service';

const REQUISITION_INCLUDE = {
  item: { select: ITEM_SELECT },
  preferredVendor: { select: { id: true, name: true } },
  productionPlan: { include: PRODUCTION_PLAN_INCLUDE },
  purchaseOrderLines: {
    select: { purchaseOrder: { select: { id: true, number: true, status: true } } },
  },
} satisfies Prisma.PurchaseRequisitionInclude;

type RequisitionRow = Prisma.PurchaseRequisitionGetPayload<{ include: typeof REQUISITION_INCLUDE }>;

/**
 * Purchase requisitions: the request to buy, raised when stock runs low.
 *
 * The state machine is deliberately explicit rather than "any status can
 * become any other". A requisition that has already produced a purchase order
 * must not quietly return to draft and be edited — the order downstream cites
 * figures that would then no longer match.
 */
const ALLOWED_TRANSITIONS: Record<RequisitionStatus, readonly RequisitionStatus[]> = {
  OPEN: ['APPROVED', 'CANCELLED'],
  APPROVED: ['CONVERTED_TO_PO', 'CANCELLED'],
  CONVERTED_TO_PO: [],
  CANCELLED: [],
};

/**
 * Statuses whose figures may still be edited.
 *
 * Only OPEN. Once approved, the quantity is what somebody signed off; once
 * converted, a purchase order cites it. Editing either would leave a document
 * downstream quoting a figure that no longer exists upstream.
 */
const EDITABLE_STATUSES: readonly RequisitionStatus[] = ['OPEN'];

@Injectable()
export class RequisitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
    private readonly people: PeopleService,
    private readonly numbering: NumberingService,
  ) {}

  async list(query: ProcurementListQuery): Promise<RequisitionListItem[]> {
    const where: Prisma.PurchaseRequisitionWhereInput = { deletedAt: null };

    if (query.status) {
      where.status = query.status as RequisitionStatus;
    }

    if (query.itemId) where.itemId = query.itemId;
    if (query.vendorId) where.preferredVendorId = query.vendorId;

    const requestedBetween = dateRange(query.dateFrom, query.dateTo);

    if (requestedBetween) where.requestDate = requestedBetween;

    if (query.search) {
      const search = query.search.trim();

      // Search spans the document number and the names a user would actually
      // type. `mode: 'insensitive'` because nobody types an item code in the
      // case it was stored in.
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { item: { name: { contains: search, mode: 'insensitive' } } },
        { item: { code: { contains: search, mode: 'insensitive' } } },
        { preferredVendor: { name: { contains: search, mode: 'insensitive' } } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.scoped.purchaseRequisition.findMany({
      where,
      include: REQUISITION_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });

    const people = await this.people.load(
      collectIds(...rows.flatMap((row) => [row.requestedById, row.approvedById])),
    );

    return rows.map((row) => this.toListItem(row, people));
  }

  async findOne(id: string): Promise<RequisitionListItem> {
    const row = await this.requireRequisition(id);
    const people = await this.people.load(collectIds(row.requestedById, row.approvedById));

    return this.toListItem(row, people);
  }

  /**
   * Raises a requisition by hand — always MANUAL, always against a production
   * plan.
   *
   * The plan requirement is conditional on the trigger type and therefore
   * lives here rather than in the DTO: a class-validator rule cannot say
   * "required when this other field has this value" without a custom
   * validator that would then need the same reasoning written twice.
   */
  async create(dto: CreateRequisitionDto): Promise<RequisitionListItem> {
    const tenantId = this.tenantContext.requireTenantId();
    const requestedById = this.requireActingUser();

    const item = await this.prisma.scoped.item.findFirst({
      where: { id: dto.itemId, deletedAt: null },
      select: ITEM_SELECT,
    });

    if (!item) throw new NotFoundException('Item not found.');

    // Defaults to the item's configured reorder quantity, and stays editable.
    const requiredQuantity =
      dto.requiredQuantity === undefined || dto.requiredQuantity === ''
        ? new Prisma.Decimal(item.reorderQuantity ?? 0)
        : parsePositive(dto.requiredQuantity, 'Required quantity');

    if (requiredQuantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        `Enter a quantity: ${item.code} has no reorder quantity configured to default from.`,
      );
    }

    if (!dto.productionPlanId) {
      throw new BadRequestException(
        'A manually raised requisition must name the production plan it is for.',
      );
    }

    await this.requireProductionPlan(dto.productionPlanId);

    if (dto.preferredVendorId) {
      await this.requireVendor(dto.preferredVendorId);
    }

    const stockAtRequest = await this.stock.usableStockForItem(dto.itemId);

    const created = await this.prisma.transaction(async (tx) => {
      const number = await this.numbering.next(tx, tenantId, 'PR');

      return tx.purchaseRequisition.create({
        data: {
          tenantId,
          number,
          itemId: dto.itemId,
          stockAtRequest,
          reorderLevelAtRequest: item.reorderLevel ?? 0,
          requiredQuantity,
          triggerType: 'MANUAL',
          productionPlanId: dto.productionPlanId,
          preferredVendorId: dto.preferredVendorId ?? null,
          requestedById,
          requiredByDate: dto.requiredByDate ? new Date(dto.requiredByDate) : null,
          status: 'OPEN',
          notes: dto.notes ?? null,
        },
        include: REQUISITION_INCLUDE,
      });
    });

    await this.audit.record({
      entityType: 'PurchaseRequisition',
      entityId: created.id,
      action: 'CREATE',
      after: {
        number: created.number,
        item: item.code,
        requiredQuantity: qty(requiredQuantity),
        triggerType: 'MANUAL',
        status: created.status,
      },
    });

    const people = await this.people.load(collectIds(created.requestedById));

    return this.toListItem(created, people);
  }

  private async requireProductionPlan(planId: string): Promise<void> {
    const plan = await this.prisma.scoped.productionPlan.findFirst({
      where: { id: planId, deletedAt: null },
      select: { id: true, status: true, number: true },
    });

    if (!plan) throw new NotFoundException('Production plan not found.');

    if (plan.status === 'CANCELLED' || plan.status === 'COMPLETED') {
      throw new ConflictException(
        `Production plan ${plan.number} is ${plan.status.toLowerCase()} and cannot take new requisitions.`,
      );
    }
  }

  async update(id: string, dto: UpdateRequisitionDto): Promise<RequisitionListItem> {
    const before = await this.requireRequisition(id);

    if (!EDITABLE_STATUSES.includes(before.status)) {
      throw new ConflictException(
        `A ${before.status.toLowerCase().replace(/_/g, ' ')} requisition can no longer be edited.`,
      );
    }

    if (dto.preferredVendorId) await this.requireVendor(dto.preferredVendorId);

    const data: Prisma.PurchaseRequisitionUpdateInput = {};

    if (dto.requiredQuantity !== undefined) {
      data.requiredQuantity = parsePositive(dto.requiredQuantity, 'Required quantity');
    }

    if (dto.preferredVendorId !== undefined) {
      data.preferredVendor = dto.preferredVendorId
        ? { connect: { id: dto.preferredVendorId } }
        : { disconnect: true };
    }

    if (dto.requiredByDate !== undefined) {
      data.requiredByDate = dto.requiredByDate ? new Date(dto.requiredByDate) : null;
    }

    if (dto.notes !== undefined) data.notes = dto.notes || null;

    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to update.');

    const after = await this.prisma.scoped.purchaseRequisition.update({
      where: { id },
      data,
      include: REQUISITION_INCLUDE,
    });

    await this.audit.record({
      entityType: 'PurchaseRequisition',
      entityId: id,
      action: 'UPDATE',
      before: { requiredQuantity: qty(before.requiredQuantity), notes: before.notes },
      after: { requiredQuantity: qty(after.requiredQuantity), notes: after.notes },
    });

    const people = await this.people.load(collectIds(after.requestedById, after.approvedById));

    return this.toListItem(after, people);
  }

  /** Moves a requisition along its state machine. */
  async changeStatus(id: string, target: RequisitionStatus): Promise<RequisitionListItem> {
    const before = await this.requireRequisition(id);

    this.assertTransition(before.status, target);

    const actingUserId = this.requireActingUser();

    const after = await this.prisma.scoped.purchaseRequisition.update({
      where: { id },
      data: {
        status: target,
        // Approval is attributed and timestamped; the pair is what makes the
        // approval evidence rather than a flag.
        ...(target === 'APPROVED' ? { approvedById: actingUserId, approvedAt: new Date() } : {}),
      },
      include: REQUISITION_INCLUDE,
    });

    await this.audit.record({
      entityType: 'PurchaseRequisition',
      entityId: id,
      action: 'UPDATE',
      before: { status: before.status },
      after: { status: after.status },
    });

    const people = await this.people.load(collectIds(after.requestedById, after.approvedById));

    return this.toListItem(after, people);
  }

  async softDelete(id: string): Promise<void> {
    const row = await this.requireRequisition(id);

    if (row.status === 'CONVERTED_TO_PO') {
      throw new ConflictException(
        'This requisition has a purchase order against it and cannot be removed.',
      );
    }

    await this.prisma.scoped.purchaseRequisition.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'CANCELLED' },
    });

    await this.audit.record({
      entityType: 'PurchaseRequisition',
      entityId: id,
      action: 'SOFT_DELETE',
      before: { number: row.number, status: row.status },
    });
  }

  /** Shared by the PO service when it converts a requisition. */
  assertTransition(from: RequisitionStatus, to: RequisitionStatus): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new ConflictException(
        `A requisition cannot go from ${from.replace(/_/g, ' ').toLowerCase()} ` +
          `to ${to.replace(/_/g, ' ').toLowerCase()}.`,
      );
    }
  }

  async requireRequisition(id: string): Promise<RequisitionRow> {
    const row = await this.prisma.scoped.purchaseRequisition.findFirst({
      where: { id, deletedAt: null },
      include: REQUISITION_INCLUDE,
    });

    // Not found and belongs-to-another-tenant are the same 404 here, because
    // RLS already made the second case indistinguishable from the first.
    if (!row) throw new NotFoundException('Requisition not found.');

    return row;
  }

  private async requireVendor(vendorId: string): Promise<void> {
    const vendor = await this.prisma.scoped.party.findFirst({
      where: { id: vendorId, deletedAt: null, partyType: 'VENDOR' },
      select: { id: true },
    });

    if (!vendor) throw new NotFoundException('Vendor not found.');
  }

  private requireActingUser(): string {
    const userId = this.tenantContext.getUserId();

    if (!userId) {
      throw new BadRequestException('This action must be performed by a signed-in user.');
    }

    return userId;
  }

  private toListItem(row: RequisitionRow, people: Map<string, string>): RequisitionListItem {
    return {
      id: row.id,
      number: row.number,
      item: toItemSummary(row.item),
      stockAtRequest: qty(row.stockAtRequest),
      reorderLevelAtRequest: qty(row.reorderLevelAtRequest),
      shortfallAtRequest: qty(
        positiveDifference(
          new Prisma.Decimal(row.reorderLevelAtRequest),
          new Prisma.Decimal(row.stockAtRequest),
        ),
      ),
      requiredQuantity: qty(row.requiredQuantity),
      triggerType: row.triggerType,
      productionPlan: row.productionPlan ? toProductionPlanSummary(row.productionPlan) : null,
      preferredVendor: row.preferredVendor,
      // Null for an auto-reorder: the system raised it and the trail says so.
      requestedBy: row.requestedById ? (people.get(row.requestedById) ?? null) : null,
      approvedBy: row.approvedById ? (people.get(row.approvedById) ?? null) : null,
      requestDate: row.requestDate.toISOString(),
      requiredByDate: row.requiredByDate?.toISOString() ?? null,
      status: row.status,
      notes: row.notes,
      linkedPurchaseOrders: dedupeOrders(row.purchaseOrderLines.map((line) => line.purchaseOrder)),
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/** A requisition can appear on several lines of one order; show it once. */
function dedupeOrders<T extends { id: string }>(orders: T[]): T[] {
  const seen = new Map<string, T>();

  for (const order of orders) seen.set(order.id, order);

  return [...seen.values()];
}


