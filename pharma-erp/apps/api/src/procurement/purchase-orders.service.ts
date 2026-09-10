import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  ProcurementListQuery,
  PurchaseOrderListItem,
  PurchaseOrderLineItem,
  PurchaseOrderStatus,
} from '@pharma-erp/types';

import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import {
  computeLineAmounts,
  money,
  parseNonNegative,
  parsePositive,
  percent,
  positiveDifference,
  qty,
  sumLineAmounts,
} from './decimal.util';
import type {
  ConvertRequisitionDto,
  CreatePurchaseOrderDto,
  UpdatePurchaseOrderDto,
} from './dto/purchase-order.dto';
import { dateRange } from './filters.util';
import { ITEM_SELECT, PARTY_SELECT, collectIds, toItemSummary, toPartySummary } from './mappers';
import { NumberingService } from './numbering.service';
import { PeopleService } from './people.service';

const PO_INCLUDE = {
  vendor: { select: PARTY_SELECT },
  lines: {
    include: {
      item: { select: ITEM_SELECT },
      requisition: { select: { id: true, number: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
  goodsReceipts: {
    where: { deletedAt: null },
    select: { id: true, number: true, receiptDate: true },
    orderBy: { receiptDate: 'asc' },
  },
  purchaseInvoices: {
    where: { deletedAt: null },
    select: { id: true, number: true, vendorInvoiceNumber: true },
  },
} satisfies Prisma.PurchaseOrderInclude;

type PurchaseOrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof PO_INCLUDE }>;

/**
 * Statuses a purchase order may move between.
 *
 * PARTIALLY_RECEIVED and FULLY_RECEIVED are absent from every list: they are
 * not chosen by anyone, they are computed by the GRN service from what has
 * actually been received. Letting a user set them by hand would let an order
 * claim to be received when nothing arrived.
 */
const ALLOWED_TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  DRAFT: ['ISSUED', 'CANCELLED'],
  ISSUED: ['CLOSED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['CLOSED', 'CANCELLED'],
  FULLY_RECEIVED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly people: PeopleService,
    private readonly numbering: NumberingService,
  ) {}

  async list(query: ProcurementListQuery): Promise<PurchaseOrderListItem[]> {
    const where: Prisma.PurchaseOrderWhereInput = { deletedAt: null };

    if (query.status) where.status = query.status as PurchaseOrderStatus;
    if (query.vendorId) where.vendorId = query.vendorId;
    if (query.itemId) where.lines = { some: { itemId: query.itemId } };

    const between = dateRange(query.dateFrom, query.dateTo);

    if (between) where.poDate = between;

    if (query.search) {
      const search = query.search.trim();

      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { vendor: { name: { contains: search, mode: 'insensitive' } } },
        { lines: { some: { item: { name: { contains: search, mode: 'insensitive' } } } } },
        { lines: { some: { item: { code: { contains: search, mode: 'insensitive' } } } } },
      ];
    }

    const rows = await this.prisma.scoped.purchaseOrder.findMany({
      where,
      include: PO_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });

    const people = await this.people.load(collectIds(...rows.map((row) => row.createdById)));

    return rows.map((row) => this.toListItem(row, people));
  }

  async findOne(id: string): Promise<PurchaseOrderListItem> {
    const row = await this.requireOrder(id);
    const people = await this.people.load(collectIds(row.createdById));

    return this.toListItem(row, people);
  }

  /** Creates an order directly, with one or more lines. */
  async create(dto: CreatePurchaseOrderDto): Promise<PurchaseOrderListItem> {
    const tenantId = this.tenantContext.requireTenantId();
    const createdById = this.requireActingUser();

    if (dto.lines.length === 0) {
      throw new BadRequestException('A purchase order needs at least one line.');
    }

    const vendor = await this.requireVendor(dto.vendorId);

    // Every item and requisition is resolved before anything is written, so a
    // bad id fails the whole request rather than leaving a half-built order.
    const lines = await Promise.all(
      dto.lines.map(async (line) => {
        const item = await this.requireItem(line.itemId);
        const quantity = parsePositive(line.quantity, `Quantity for ${item.code}`);
        const rate = parseNonNegative(line.rate, `Rate for ${item.code}`);
        const taxRatePercent = parseNonNegative(line.taxRatePercent, `Tax rate for ${item.code}`);

        if (line.requisitionId) {
          await this.assertRequisitionConvertible(line.requisitionId);
        }

        return {
          itemId: item.id,
          requisitionId: line.requisitionId ?? null,
          quantity,
          rate,
          taxRatePercent,
          ...computeLineAmounts(quantity, rate, taxRatePercent),
        };
      }),
    );

    const totals = sumLineAmounts(lines);

    const created = await this.prisma.transaction(async (tx) => {
      const number = await this.numbering.next(tx, tenantId, 'PO');

      const order = await tx.purchaseOrder.create({
        data: {
          tenantId,
          number,
          vendorId: vendor.id,
          expectedDeliveryDate: dto.expectedDeliveryDate
            ? new Date(dto.expectedDeliveryDate)
            : null,
          paymentTermsDays: dto.paymentTermsDays ?? vendor.paymentTermsDays,
          notes: dto.notes ?? null,
          createdById,
          status: 'DRAFT',
          taxableAmount: totals.taxableAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          lines: { create: lines.map((line) => ({ ...line, tenantId })) },
        },
        include: PO_INCLUDE,
      });

      // Requisitions that fed this order are marked converted in the same
      // transaction, so the two can never disagree about whether the order
      // exists.
      const requisitionIds = collectIds(...lines.map((line) => line.requisitionId));

      if (requisitionIds.length > 0) {
        await tx.purchaseRequisition.updateMany({
          where: { id: { in: requisitionIds } },
          data: { status: 'CONVERTED_TO_PO' },
        });
      }

      return order;
    });

    await this.audit.record({
      entityType: 'PurchaseOrder',
      entityId: created.id,
      action: 'CREATE',
      after: {
        number: created.number,
        vendor: vendor.name,
        lines: created.lines.length,
        totalAmount: money(created.totalAmount),
      },
    });

    const people = await this.people.load(collectIds(created.createdById));

    return this.toListItem(created, people);
  }

  /**
   * Turns one approved requisition into a single-line purchase order.
   *
   * The convenience path for the common case, and the one that guarantees
   * business rule 2: the line carries `requisitionId`, so the order is
   * traceable back to the request that caused it.
   */
  async convertRequisition(
    requisitionId: string,
    dto: ConvertRequisitionDto,
  ): Promise<PurchaseOrderListItem> {
    const requisition = await this.assertRequisitionConvertible(requisitionId);

    return this.create({
      vendorId: dto.vendorId,
      expectedDeliveryDate: dto.expectedDeliveryDate,
      paymentTermsDays: dto.paymentTermsDays,
      notes: `Raised from requisition ${requisition.number}.`,
      lines: [
        {
          itemId: requisition.itemId,
          requisitionId,
          quantity: requisition.requiredQuantity.toString(),
          rate: dto.rate,
          taxRatePercent: dto.taxRatePercent,
        },
      ],
    });
  }

  /** Edits a draft order's header. Lines are replaced wholesale, not patched. */
  async update(id: string, dto: UpdatePurchaseOrderDto): Promise<PurchaseOrderListItem> {
    const before = await this.requireOrder(id);

    if (before.status !== 'DRAFT') {
      throw new ConflictException('Only a draft purchase order can be edited.');
    }

    const data: Prisma.PurchaseOrderUpdateInput = {};

    if (dto.expectedDeliveryDate !== undefined) {
      data.expectedDeliveryDate = dto.expectedDeliveryDate
        ? new Date(dto.expectedDeliveryDate)
        : null;
    }

    if (dto.paymentTermsDays !== undefined) data.paymentTermsDays = dto.paymentTermsDays;
    if (dto.notes !== undefined) data.notes = dto.notes || null;

    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to update.');

    const after = await this.prisma.scoped.purchaseOrder.update({
      where: { id },
      data,
      include: PO_INCLUDE,
    });

    await this.audit.record({
      entityType: 'PurchaseOrder',
      entityId: id,
      action: 'UPDATE',
      before: { notes: before.notes, paymentTermsDays: before.paymentTermsDays },
      after: { notes: after.notes, paymentTermsDays: after.paymentTermsDays },
    });

    const people = await this.people.load(collectIds(after.createdById));

    return this.toListItem(after, people);
  }

  async changeStatus(id: string, target: PurchaseOrderStatus): Promise<PurchaseOrderListItem> {
    const before = await this.requireOrder(id);

    if (!ALLOWED_TRANSITIONS[before.status].includes(target)) {
      throw new ConflictException(
        `A ${label(before.status)} purchase order cannot become ${label(target)}.`,
      );
    }

    if (target === 'ISSUED' && before.lines.length === 0) {
      throw new ConflictException('A purchase order needs at least one line before it is issued.');
    }

    const after = await this.prisma.scoped.purchaseOrder.update({
      where: { id },
      data: {
        status: target,
        ...(target === 'ISSUED' ? { issuedAt: new Date() } : {}),
      },
      include: PO_INCLUDE,
    });

    await this.audit.record({
      entityType: 'PurchaseOrder',
      entityId: id,
      action: 'UPDATE',
      before: { status: before.status },
      after: { status: after.status },
    });

    const people = await this.people.load(collectIds(after.createdById));

    return this.toListItem(after, people);
  }

  /** Orders open for receiving, for the GRN form's picker. */
  async receivable(): Promise<PurchaseOrderListItem[]> {
    const rows = await this.prisma.scoped.purchaseOrder.findMany({
      where: { deletedAt: null, status: { in: ['ISSUED', 'PARTIALLY_RECEIVED'] } },
      include: PO_INCLUDE,
      orderBy: [{ poDate: 'asc' }],
    });

    const people = await this.people.load(collectIds(...rows.map((row) => row.createdById)));

    return rows.map((row) => this.toListItem(row, people));
  }

  /** Orders that may be invoiced: anything received, wholly or in part. */
  async invoiceable(): Promise<PurchaseOrderListItem[]> {
    const rows = await this.prisma.scoped.purchaseOrder.findMany({
      where: {
        deletedAt: null,
        status: { in: ['PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED'] },
      },
      include: PO_INCLUDE,
      orderBy: [{ poDate: 'desc' }],
    });

    const people = await this.people.load(collectIds(...rows.map((row) => row.createdById)));

    return rows.map((row) => this.toListItem(row, people));
  }

  async requireOrder(id: string): Promise<PurchaseOrderRow> {
    const row = await this.prisma.scoped.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: PO_INCLUDE,
    });

    if (!row) throw new NotFoundException('Purchase order not found.');

    return row;
  }

  private async assertRequisitionConvertible(requisitionId: string) {
    const requisition = await this.prisma.scoped.purchaseRequisition.findFirst({
      where: { id: requisitionId, deletedAt: null },
      select: { id: true, number: true, itemId: true, requiredQuantity: true, status: true },
    });

    if (!requisition) throw new NotFoundException('Requisition not found.');

    if (requisition.status !== 'APPROVED') {
      throw new ConflictException(
        `Requisition ${requisition.number} is ${label(requisition.status)}. ` +
          'Only an approved requisition can be converted to a purchase order.',
      );
    }

    return requisition;
  }

  private async requireVendor(vendorId: string) {
    const vendor = await this.prisma.scoped.party.findFirst({
      where: { id: vendorId, deletedAt: null, partyType: 'VENDOR' },
      select: { id: true, name: true, paymentTermsDays: true },
    });

    if (!vendor) throw new NotFoundException('Vendor not found.');

    return vendor;
  }

  private async requireItem(itemId: string) {
    const item = await this.prisma.scoped.item.findFirst({
      where: { id: itemId, deletedAt: null },
      select: { id: true, code: true },
    });

    if (!item) throw new NotFoundException('Item not found.');

    return item;
  }

  private requireActingUser(): string {
    const userId = this.tenantContext.getUserId();

    if (!userId) {
      throw new BadRequestException('This action must be performed by a signed-in user.');
    }

    return userId;
  }

  private toListItem(row: PurchaseOrderRow, people: Map<string, string>): PurchaseOrderListItem {
    return {
      id: row.id,
      number: row.number,
      vendor: toPartySummary(row.vendor),
      poDate: row.poDate.toISOString(),
      expectedDeliveryDate: row.expectedDeliveryDate?.toISOString() ?? null,
      paymentTermsDays: row.paymentTermsDays,
      status: row.status,
      taxableAmount: money(row.taxableAmount),
      taxAmount: money(row.taxAmount),
      totalAmount: money(row.totalAmount),
      createdBy: people.get(row.createdById) ?? null,
      issuedAt: row.issuedAt?.toISOString() ?? null,
      notes: row.notes,
      lines: row.lines.map((line): PurchaseOrderLineItem => {
        const quantity = new Prisma.Decimal(line.quantity);
        const received = new Prisma.Decimal(line.quantityReceived);

        return {
          id: line.id,
          item: toItemSummary(line.item),
          requisition: line.requisition,
          quantity: qty(quantity),
          rate: qty(line.rate),
          taxRatePercent: percent(line.taxRatePercent),
          taxableAmount: money(line.taxableAmount),
          taxAmount: money(line.taxAmount),
          totalAmount: money(line.totalAmount),
          quantityReceived: qty(received),
          quantityPending: qty(positiveDifference(quantity, received)),
        };
      }),
      goodsReceipts: row.goodsReceipts.map((grn) => ({
        id: grn.id,
        number: grn.number,
        receiptDate: grn.receiptDate.toISOString(),
      })),
      invoices: row.purchaseInvoices,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function label(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase();
}
