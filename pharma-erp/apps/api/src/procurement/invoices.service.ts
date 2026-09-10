import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  PaymentStatus,
  ProcurementListQuery,
  PurchaseInvoiceListItem,
  PurchaseInvoiceStatus,
} from '@pharma-erp/types';

import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import {
  ZERO,
  computeLineAmounts,
  money,
  parseNonNegative,
  parsePositive,
  percent,
  positiveDifference,
  qty,
  sumLineAmounts,
} from './decimal.util';
import type { CreatePurchaseInvoiceDto } from './dto/invoice.dto';
import { dateRange } from './filters.util';
import { ITEM_SELECT, PARTY_SELECT, collectIds, toItemSummary, toPartySummary } from './mappers';
import { NumberingService } from './numbering.service';
import { PeopleService } from './people.service';

const INVOICE_INCLUDE = {
  vendor: { select: PARTY_SELECT },
  purchaseOrder: { select: { id: true, number: true } },
  goodsReceipt: { select: { id: true, number: true } },
  lines: { include: { item: { select: ITEM_SELECT } }, orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { paymentDate: 'asc' } },
} satisfies Prisma.PurchaseInvoiceInclude;

type InvoiceRow = Prisma.PurchaseInvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

/**
 * Purchase invoices: what the vendor is billing, matched to what was ordered
 * and what was received.
 *
 * GST is captured per line and totalled separately from the taxable value,
 * because input tax is reclaimable and has to be reportable on its own rather
 * than inferred by subtracting one gross figure from another.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly people: PeopleService,
    private readonly numbering: NumberingService,
  ) {}

  async list(query: ProcurementListQuery): Promise<PurchaseInvoiceListItem[]> {
    const where: Prisma.PurchaseInvoiceWhereInput = { deletedAt: null };

    if (query.vendorId) where.vendorId = query.vendorId;
    if (query.itemId) where.lines = { some: { itemId: query.itemId } };

    const between = dateRange(query.dateFrom, query.dateTo);

    if (between) where.invoiceDate = between;

    // The status filter accepts both the document status and the payment
    // status, because to a user "overdue" and "draft" are the same kind of
    // question about an invoice even though only one is a stored column.
    const documentStatuses: readonly string[] = ['DRAFT', 'APPROVED', 'CANCELLED'];

    if (query.status && documentStatuses.includes(query.status)) {
      where.status = query.status as PurchaseInvoiceStatus;
    }

    if (query.search) {
      const search = query.search.trim();

      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { vendorInvoiceNumber: { contains: search, mode: 'insensitive' } },
        { vendor: { name: { contains: search, mode: 'insensitive' } } },
        { purchaseOrder: { number: { contains: search, mode: 'insensitive' } } },
        { goodsReceipt: { number: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const rows = await this.prisma.scoped.purchaseInvoice.findMany({
      where,
      include: INVOICE_INCLUDE,
      orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });

    const people = await this.people.load(
      collectIds(
        ...rows.map((row) => row.recordedById),
        ...rows.flatMap((row) => row.payments.map((payment) => payment.recordedById)),
      ),
    );

    const mapped = rows.map((row) => this.toListItem(row, people));

    // Payment-status filtering happens after mapping because the status is
    // derived, not stored — there is no column to put in the WHERE clause.
    if (query.status && !documentStatuses.includes(query.status)) {
      return mapped.filter((invoice) => invoice.paymentStatus === query.status);
    }

    return mapped;
  }

  async findOne(id: string): Promise<PurchaseInvoiceListItem> {
    const row = await this.requireInvoice(id);
    const people = await this.people.load(
      collectIds(row.recordedById, ...row.payments.map((payment) => payment.recordedById)),
    );

    return this.toListItem(row, people);
  }

  /**
   * Records a vendor invoice against a purchase order, optionally matched to
   * the receipt it bills for.
   *
   * The order must have received something. Invoicing an order that has not
   * been delivered is how a company pays for goods it never got, and the
   * three-way match exists precisely to make that impossible by accident.
   */
  async create(dto: CreatePurchaseInvoiceDto): Promise<PurchaseInvoiceListItem> {
    const tenantId = this.tenantContext.requireTenantId();
    const recordedById = this.requireActingUser();

    if (dto.lines.length === 0) {
      throw new BadRequestException('An invoice needs at least one line.');
    }

    const order = await this.prisma.scoped.purchaseOrder.findFirst({
      where: { id: dto.purchaseOrderId, deletedAt: null },
      select: {
        id: true,
        number: true,
        vendorId: true,
        status: true,
        paymentTermsDays: true,
        vendor: { select: { name: true, paymentTermsDays: true } },
      },
    });

    if (!order) throw new NotFoundException('Purchase order not found.');

    if (!['PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED'].includes(order.status)) {
      throw new ConflictException(
        'Nothing has been received against this purchase order yet, so it cannot be invoiced.',
      );
    }

    if (dto.goodsReceiptId) {
      const receipt = await this.prisma.scoped.goodsReceipt.findFirst({
        where: { id: dto.goodsReceiptId, deletedAt: null },
        select: { id: true, purchaseOrderId: true, number: true },
      });

      if (!receipt) throw new NotFoundException('Goods receipt not found.');

      if (receipt.purchaseOrderId !== order.id) {
        throw new BadRequestException(
          `Goods receipt ${receipt.number} does not belong to purchase order ${order.number}.`,
        );
      }
    }

    const lines = await Promise.all(
      dto.lines.map(async (line) => {
        const item = await this.prisma.scoped.item.findFirst({
          where: { id: line.itemId, deletedAt: null },
          select: { id: true, code: true },
        });

        if (!item) throw new NotFoundException('Item not found.');

        const quantity = parsePositive(line.quantity, `Quantity for ${item.code}`);
        const rate = parseNonNegative(line.rate, `Rate for ${item.code}`);
        const taxRatePercent = parseNonNegative(line.taxRatePercent, `Tax rate for ${item.code}`);

        return {
          itemId: item.id,
          quantity,
          rate,
          taxRatePercent,
          ...computeLineAmounts(quantity, rate, taxRatePercent),
        };
      }),
    );

    const totals = sumLineAmounts(lines);

    const invoiceDate = new Date(dto.invoiceDate);

    if (Number.isNaN(invoiceDate.getTime())) {
      throw new BadRequestException('Enter a valid invoice date.');
    }

    const paymentTermsDays = dto.paymentTermsDays ?? order.paymentTermsDays;

    // Due date derived from the agreed terms rather than typed, so it cannot
    // silently disagree with the payment terms shown next to it.
    const dueDate = new Date(invoiceDate);
    dueDate.setUTCDate(dueDate.getUTCDate() + paymentTermsDays);

    try {
      const created = await this.prisma.transaction(async (tx) => {
        const number = await this.numbering.next(tx, tenantId, 'PINV');

        return tx.purchaseInvoice.create({
          data: {
            tenantId,
            number,
            vendorInvoiceNumber: dto.vendorInvoiceNumber.trim(),
            vendorId: order.vendorId,
            purchaseOrderId: order.id,
            goodsReceiptId: dto.goodsReceiptId ?? null,
            invoiceDate,
            dueDate,
            paymentTermsDays,
            taxableAmount: totals.taxableAmount,
            taxAmount: totals.taxAmount,
            totalAmount: totals.totalAmount,
            status: 'DRAFT',
            notes: dto.notes?.trim() || null,
            recordedById,
            lines: { create: lines.map((line) => ({ ...line, tenantId })) },
          },
          include: INVOICE_INCLUDE,
        });
      });

      await this.audit.record({
        entityType: 'PurchaseInvoice',
        entityId: created.id,
        action: 'CREATE',
        after: {
          number: created.number,
          vendorInvoiceNumber: created.vendorInvoiceNumber,
          purchaseOrder: order.number,
          totalAmount: money(created.totalAmount),
          taxAmount: money(created.taxAmount),
        },
      });

      const people = await this.people.load(collectIds(created.recordedById));

      return this.toListItem(created, people);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          `Invoice ${dto.vendorInvoiceNumber} has already been recorded for ${order.vendor.name}.`,
        );
      }

      throw error;
    }
  }

  async changeStatus(id: string, target: PurchaseInvoiceStatus): Promise<PurchaseInvoiceListItem> {
    const before = await this.requireInvoice(id);

    if (before.status === target) {
      throw new ConflictException(`This invoice is already ${target.toLowerCase()}.`);
    }

    if (before.status === 'CANCELLED') {
      throw new ConflictException('A cancelled invoice cannot be reinstated.');
    }

    if (target === 'CANCELLED' && before.payments.length > 0) {
      // Cancelling an invoice that has been paid would orphan the payment and
      // leave the vendor ledger claiming money went somewhere it did not.
      throw new ConflictException(
        'This invoice has payments recorded against it and cannot be cancelled.',
      );
    }

    const after = await this.prisma.scoped.purchaseInvoice.update({
      where: { id },
      data: { status: target },
      include: INVOICE_INCLUDE,
    });

    await this.audit.record({
      entityType: 'PurchaseInvoice',
      entityId: id,
      action: 'UPDATE',
      before: { status: before.status },
      after: { status: after.status },
    });

    const people = await this.people.load(
      collectIds(after.recordedById, ...after.payments.map((payment) => payment.recordedById)),
    );

    return this.toListItem(after, people);
  }

  async requireInvoice(id: string): Promise<InvoiceRow> {
    const row = await this.prisma.scoped.purchaseInvoice.findFirst({
      where: { id, deletedAt: null },
      include: INVOICE_INCLUDE,
    });

    if (!row) throw new NotFoundException('Invoice not found.');

    return row;
  }

  private requireActingUser(): string {
    const userId = this.tenantContext.getUserId();

    if (!userId) {
      throw new BadRequestException('This action must be performed by a signed-in user.');
    }

    return userId;
  }

  toListItem(row: InvoiceRow, people: Map<string, string>): PurchaseInvoiceListItem {
    const total = new Prisma.Decimal(row.totalAmount);
    const paid = row.payments.reduce((sum, payment) => sum.plus(payment.amount), ZERO);
    const outstanding = positiveDifference(total, paid);

    return {
      id: row.id,
      number: row.number,
      vendorInvoiceNumber: row.vendorInvoiceNumber,
      vendor: toPartySummary(row.vendor),
      purchaseOrder: row.purchaseOrder,
      goodsReceipt: row.goodsReceipt,
      invoiceDate: row.invoiceDate.toISOString(),
      dueDate: row.dueDate.toISOString(),
      paymentTermsDays: row.paymentTermsDays,
      taxableAmount: money(row.taxableAmount),
      taxAmount: money(row.taxAmount),
      totalAmount: money(total),
      status: row.status,
      notes: row.notes,
      recordedBy: people.get(row.recordedById) ?? null,
      lines: row.lines.map((line) => ({
        id: line.id,
        item: toItemSummary(line.item),
        quantity: qty(line.quantity),
        rate: qty(line.rate),
        taxRatePercent: percent(line.taxRatePercent),
        taxableAmount: money(line.taxableAmount),
        taxAmount: money(line.taxAmount),
        totalAmount: money(line.totalAmount),
      })),
      amountPaid: money(paid),
      outstandingAmount: money(outstanding),
      paymentStatus: derivePaymentStatus(row.status, total, paid, row.dueDate),
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/**
 * Payment standing of an invoice, computed rather than stored.
 *
 * OVERDUE outranks UNPAID and PARTIALLY_PAID because it is the state that
 * needs acting on; a stored flag would be stale from the moment the due date
 * passed until something bothered to rewrite it.
 *
 * A cancelled invoice reports PAID — nothing is owed on it — rather than
 * appearing forever in the overdue list.
 */
export function derivePaymentStatus(
  status: PurchaseInvoiceStatus,
  total: Prisma.Decimal,
  paid: Prisma.Decimal,
  dueDate: Date,
  now: Date = new Date(),
): PaymentStatus {
  if (status === 'CANCELLED') return 'PAID';

  if (paid.greaterThanOrEqualTo(total)) return 'PAID';

  if (dueDate.getTime() < now.getTime()) return 'OVERDUE';

  return paid.isZero() ? 'UNPAID' : 'PARTIALLY_PAID';
}
