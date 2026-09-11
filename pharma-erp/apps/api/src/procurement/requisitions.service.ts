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
import { ITEM_SELECT, collectIds, toItemSummary } from './mappers';
import { NumberingService } from './numbering.service';
import { PeopleService } from './people.service';
import { StockService } from './stock.service';

const REQUISITION_INCLUDE = {
  item: { select: ITEM_SELECT },
  preferredVendor: { select: { id: true, name: true } },
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
  DRAFT: ['PENDING', 'CANCELLED'],
  PENDING: ['APPROVED', 'CANCELLED'],
  APPROVED: ['CONVERTED_TO_PO', 'CANCELLED'],
  CONVERTED_TO_PO: [],
  CANCELLED: [],
};

/** Statuses whose figures may still be edited. */
const EDITABLE_STATUSES: readonly RequisitionStatus[] = ['DRAFT', 'PENDING'];

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
   * Raises a requisition for an item.
   *
   * The stock figure is read here and stored on the row, not read again later:
   * the requisition's job is to record why it was raised, and "stock was 20
   * against a reorder level of 50" has to stay true after the next receipt.
   */
  async create(dto: CreateRequisitionDto): Promise<RequisitionListItem> {
    const tenantId = this.tenantContext.requireTenantId();
    const requestedById = this.requireActingUser();

    const requiredQuantity = parsePositive(dto.requiredQuantity, 'Required quantity');

    const item = await this.prisma.scoped.item.findFirst({
      where: { id: dto.itemId, deletedAt: null },
      select: { ...ITEM_SELECT, reorderLevel: true },
    });

    if (!item) throw new NotFoundException('Item not found.');

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
          // Null means no reorder level is configured, which is not the
          // same as a level of zero — but the requisition has to record the
          // figure it was raised against, and that figure is zero.
          reorderLevelAtRequest: item.reorderLevel ?? 0,
          requiredQuantity,
          preferredVendorId: dto.preferredVendorId ?? null,
          requestedById,
          requiredByDate: dto.requiredByDate ? new Date(dto.requiredByDate) : null,
          // A draft is a private working copy; anything else enters the
          // approval queue immediately.
          status: dto.asDraft ? 'DRAFT' : 'PENDING',
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
        status: created.status,
      },
    });

    const people = await this.people.load(collectIds(created.requestedById));

    return this.toListItem(created, people);
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
      preferredVendor: row.preferredVendor,
      requestedBy: people.get(row.requestedById) ?? null,
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


