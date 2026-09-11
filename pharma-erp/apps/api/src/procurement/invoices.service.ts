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
  percentageDrift,
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
    const documentStatuses: readonly string[] = ['BOOKED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'];

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
   * Books a vendor invoice against a goods receipt.
   *
   * Three rules from the brief converge here, and each is enforced rather
   * than assumed:
   *
   *   THE RECEIPT IS MANDATORY. The order is derived from it, so an invoice
   *   can never point at a receipt belonging to a different order.
   *
   *   GST IS NEVER TYPED. Each line's rate comes from the item's tax master
   *   entry. An item with no entry is refused outright rather than silently
   *   billed at 0% — a missing input-tax figure is a filing error, and
   *   guessing zero is the one answer certain to be wrong.
   *
   *   QUANTITY AND RATE ARE MATCHED against what was received and what was
   *   ordered, within the company's configured tolerance. Exceeding it does
   *   not block the booking — a genuine price revision has to be recordable —
   *   but it sets `toleranceExceeded` and records what differed, so the
   *   exception is visible instead of disappearing into a total.
   */
  async create(dto: CreatePurchaseInvoiceDto): Promise<PurchaseInvoiceListItem> {
    const tenantId = this.tenantContext.requireTenantId();
    const recordedById = this.requireActingUser();

    if (dto.lines.length === 0) {
      throw new BadRequestException('An invoice needs at least one line.');
    }

    const receipt = await this.prisma.scoped.goodsReceipt.findFirst({
      where: { id: dto.goodsReceiptId, deletedAt: null },
      include: {
        purchaseOrder: {
          select: {
            id: true,
            number: true,
            vendorId: true,
            status: true,
            paymentTermsDays: true,
            vendor: { select: { name: true, paymentTermsDays: true } },
            lines: { select: { itemId: true, quantity: true, rate: true } },
          },
        },
        lines: {
          select: {
            itemId: true,
            quantityReceived: true,
            quantityRejected: true,
            item: { select: { id: true, code: true, gstRate: true } },
          },
        },
      },
    });

    if (!receipt) throw new NotFoundException('Goods receipt not found.');

    const order = receipt.purchaseOrder;

    // What this receipt actually accepted, per item — the figure the vendor is
    // entitled to bill for. Summed because one receipt may carry the same item
    // on more than one line.
    const receivedByItem = new Map<string, Prisma.Decimal>();

    for (const line of receipt.lines) {
      const accepted = positiveDifference(
        new Prisma.Decimal(line.quantityReceived),
        new Prisma.Decimal(line.quantityRejected),
      );

      receivedByItem.set(
        line.itemId,
        (receivedByItem.get(line.itemId) ?? ZERO).plus(accepted),
      );
    }

    const orderedRateByItem = new Map(
      order.lines.map((line) => [line.itemId, new Prisma.Decimal(line.rate)] as const),
    );

    const tolerance = await this.tolerancePercent();
    const mismatches: string[] = [];

    const lines = await Promise.all(
      dto.lines.map(async (line) => {
        const item = await this.prisma.scoped.item.findFirst({
          where: { id: line.itemId, deletedAt: null },
          select: { id: true, code: true, gstRate: true, hsnCode: true },
        });

        if (!item) throw new NotFoundException('Item not found.');

        // GST comes off the item master, where it sits next to the HSN code.
        // An item with no rate is refused outright rather than billed at 0%:
        // a missing input-tax figure is a filing error, and guessing zero is
        // the one answer certain to be wrong.
        if (item.gstRate === null) {
          throw new BadRequestException(
            `${item.code} has no GST rate on the item master. Set one before invoicing it — ` +
              'GST is read from the item, never entered on the invoice.',
          );
        }

        const quantity = parsePositive(line.quantity, `Quantity for ${item.code}`);
        const rate = parseNonNegative(line.rate, `Rate for ${item.code}`);
        const taxRatePercent = new Prisma.Decimal(item.gstRate);

        // --- three-way match -------------------------------------------------
        const received = receivedByItem.get(item.id);

        if (received === undefined) {
          throw new ConflictException(
            `${item.code} is not on goods receipt ${receipt.number}, so it cannot be invoiced ` +
              'against it.',
          );
        }

        const quantityDrift = percentageDrift(quantity, received);

        if (quantityDrift.greaterThan(tolerance)) {
          mismatches.push(
            `${item.code}: invoiced ${qty(quantity)} against ${qty(received)} received ` +
              `(${percent(quantityDrift)}% over a ${percent(tolerance)}% tolerance).`,
          );
        }

        const orderedRate = orderedRateByItem.get(item.id);

        if (orderedRate !== undefined) {
          const rateDrift = percentageDrift(rate, orderedRate);

          if (rateDrift.greaterThan(tolerance)) {
            mismatches.push(
              `${item.code}: invoiced at ${qty(rate)} against an ordered rate of ` +
                `${qty(orderedRate)} (${percent(rateDrift)}% over a ${percent(tolerance)}% tolerance).`,
            );
          }
        }

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

    // Terms from the vendor's own agreement unless overridden, and the due
    // date derived from them — never typed, so it cannot disagree with the
    // terms printed beside it.
    const paymentTermsDays =
      dto.paymentTermsDays ?? order.paymentTermsDays ?? order.vendor.paymentTermsDays;

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
            goodsReceiptId: receipt.id,
            invoiceDate,
            dueDate,
            paymentTermsDays,
            taxableAmount: totals.taxableAmount,
            taxAmount: totals.taxAmount,
            totalAmount: totals.totalAmount,
            toleranceExceeded: mismatches.length > 0,
            matchNotes: mismatches.length > 0 ? mismatches.join(' ') : null,
            // US-PUR-05: an invoice is Booked on creation. Payment progress
            // moves it from here, and nothing else does.
            status: 'BOOKED',
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
          goodsReceipt: receipt.number,
          totalAmount: money(created.totalAmount),
          taxAmount: money(created.taxAmount),
          toleranceExceeded: created.toleranceExceeded,
          matchNotes: created.matchNotes,
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

  /**
   * The company's configured three-way-match tolerance, as a percentage.
   *
   * Read per invoice rather than cached: it is one small column, and a cached
   * copy would keep applying an old tolerance after somebody changed it.
   */
  private async tolerancePercent(): Promise<Prisma.Decimal> {
    const tenantId = this.tenantContext.requireTenantId();

    const tenant = await this.prisma.scoped.tenant.findFirst({
      where: { id: tenantId },
      select: { invoiceTolerancePercent: true },
    });

    return new Prisma.Decimal(tenant?.invoiceTolerancePercent ?? 0);
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
      toleranceExceeded: row.toleranceExceeded,
      matchNotes: row.matchNotes,
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
