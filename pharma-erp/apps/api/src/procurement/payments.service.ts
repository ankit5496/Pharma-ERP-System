import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type { ProcurementListQuery, VendorPayableRow, VendorPaymentItem } from '@pharma-erp/types';

import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import { ZERO, daysUntil, money, parsePositive, positiveDifference } from './decimal.util';
import type { RecordPaymentDto } from './dto/payment.dto';
import { dateRange } from './filters.util';
import { derivePaymentStatus } from './invoices.service';
import { collectIds } from './mappers';
import { NumberingService } from './numbering.service';
import { PeopleService } from './people.service';

const PAYABLE_INCLUDE = {
  vendor: { select: { id: true, name: true } },
  purchaseOrder: { select: { id: true, number: true } },
  payments: { orderBy: { paymentDate: 'asc' } },
} satisfies Prisma.PurchaseInvoiceInclude;

type PayableRow = Prisma.PurchaseInvoiceGetPayload<{ include: typeof PAYABLE_INCLUDE }>;

/**
 * The vendor payables ledger and the payments that settle it.
 *
 * There is no stored outstanding balance anywhere in this module. A payable is
 * `invoice.totalAmount - sum(payments)`, computed on every read. A stored
 * balance is one failed update away from a vendor being chased for money
 * already sent, and the failure is invisible until someone complains.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly people: PeopleService,
    private readonly numbering: NumberingService,
  ) {}

  /**
   * The payables ledger: one row per invoice, with what is owed on it.
   *
   * Draft invoices are excluded — nothing is payable until the invoice has
   * been approved — and so are cancelled ones.
   */
  async payables(query: ProcurementListQuery): Promise<VendorPayableRow[]> {
    const where: Prisma.PurchaseInvoiceWhereInput = {
      deletedAt: null,
      status: 'APPROVED',
    };

    if (query.vendorId) where.vendorId = query.vendorId;

    const between = dateRange(query.dateFrom, query.dateTo);

    if (between) where.dueDate = between;

    if (query.search) {
      const search = query.search.trim();

      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { vendorInvoiceNumber: { contains: search, mode: 'insensitive' } },
        { vendor: { name: { contains: search, mode: 'insensitive' } } },
        { purchaseOrder: { number: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const rows = await this.prisma.scoped.purchaseInvoice.findMany({
      where,
      include: PAYABLE_INCLUDE,
      // Soonest due first: the order the person paying bills works in.
      orderBy: [{ dueDate: 'asc' }],
      take: 500,
    });

    const people = await this.people.load(
      collectIds(...rows.flatMap((row) => row.payments.map((payment) => payment.recordedById))),
    );

    const mapped = rows.map((row) => this.toPayableRow(row, people));

    // Payment status is derived, so it cannot be a WHERE clause.
    return query.status ? mapped.filter((row) => row.paymentStatus === query.status) : mapped;
  }

  /**
   * Records a payment against an invoice.
   *
   * Overpayment is refused. It is almost always a typo or a duplicate entry,
   * and a vendor ledger that can go negative stops being a statement of what
   * is owed.
   */
  async record(dto: RecordPaymentDto): Promise<VendorPayableRow> {
    const tenantId = this.tenantContext.requireTenantId();
    const recordedById = this.requireActingUser();

    const amount = parsePositive(dto.amount, 'Payment amount');

    const invoice = await this.prisma.scoped.purchaseInvoice.findFirst({
      where: { id: dto.purchaseInvoiceId, deletedAt: null },
      include: PAYABLE_INCLUDE,
    });

    if (!invoice) throw new ConflictException('Invoice not found.');

    if (invoice.status !== 'APPROVED') {
      throw new ConflictException(
        `Only an approved invoice can be paid. This one is ${invoice.status.toLowerCase()}.`,
      );
    }

    const total = new Prisma.Decimal(invoice.totalAmount);
    const alreadyPaid = invoice.payments.reduce((sum, payment) => sum.plus(payment.amount), ZERO);
    const outstanding = positiveDifference(total, alreadyPaid);

    if (outstanding.isZero()) {
      throw new ConflictException('This invoice is already settled in full.');
    }

    if (amount.greaterThan(outstanding)) {
      throw new ConflictException(
        `Payment of ${money(amount)} exceeds the ${money(outstanding)} outstanding on this invoice.`,
      );
    }

    const paymentDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();

    if (Number.isNaN(paymentDate.getTime())) {
      throw new BadRequestException('Enter a valid payment date.');
    }

    const created = await this.prisma.transaction(async (tx) => {
      const number = await this.numbering.next(tx, tenantId, 'PAY');

      return tx.vendorPayment.create({
        data: {
          tenantId,
          number,
          purchaseInvoiceId: invoice.id,
          paymentDate,
          amount,
          reference: dto.reference?.trim() || null,
          method: dto.method?.trim() || null,
          notes: dto.notes?.trim() || null,
          recordedById,
        },
      });
    });

    await this.audit.record({
      entityType: 'VendorPayment',
      entityId: created.id,
      action: 'CREATE',
      after: {
        number: created.number,
        invoice: invoice.number,
        vendorInvoiceNumber: invoice.vendorInvoiceNumber,
        amount: money(amount),
        outstandingAfter: money(positiveDifference(outstanding, amount)),
        reference: created.reference,
      },
    });

    const refreshed = await this.prisma.scoped.purchaseInvoice.findFirstOrThrow({
      where: { id: invoice.id },
      include: PAYABLE_INCLUDE,
    });

    const people = await this.people.load(
      collectIds(...refreshed.payments.map((payment) => payment.recordedById)),
    );

    return this.toPayableRow(refreshed, people);
  }

  private requireActingUser(): string {
    const userId = this.tenantContext.getUserId();

    if (!userId) {
      throw new BadRequestException('This action must be performed by a signed-in user.');
    }

    return userId;
  }

  private toPayableRow(row: PayableRow, people: Map<string, string>): VendorPayableRow {
    const total = new Prisma.Decimal(row.totalAmount);
    const paid = row.payments.reduce((sum, payment) => sum.plus(payment.amount), ZERO);

    return {
      invoiceId: row.id,
      invoiceNumber: row.number,
      vendorInvoiceNumber: row.vendorInvoiceNumber,
      vendor: row.vendor,
      purchaseOrder: row.purchaseOrder,
      invoiceDate: row.invoiceDate.toISOString(),
      dueDate: row.dueDate.toISOString(),
      invoiceAmount: money(total),
      amountPaid: money(paid),
      outstandingAmount: money(positiveDifference(total, paid)),
      paymentStatus: derivePaymentStatus(row.status, total, paid, row.dueDate),
      daysToDue: daysUntil(row.dueDate),
      payments: row.payments.map(
        (payment): VendorPaymentItem => ({
          id: payment.id,
          number: payment.number,
          paymentDate: payment.paymentDate.toISOString(),
          amount: money(payment.amount),
          reference: payment.reference,
          method: payment.method,
          notes: payment.notes,
          recordedBy: people.get(payment.recordedById) ?? null,
        }),
      ),
    };
  }
}
