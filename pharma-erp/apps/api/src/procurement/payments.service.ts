import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  AgeingBucket,
  PayablesReport,
  ProcurementListQuery,
  VendorPayableRow,
  VendorPaymentItem,
} from '@pharma-erp/types';

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
   * Cancelled invoices are excluded; everything else is payable, because an
   * invoice is Booked the moment it is recorded.
   */
  async payables(query: ProcurementListQuery): Promise<VendorPayableRow[]> {
    const where: Prisma.PurchaseInvoiceWhereInput = {
      deletedAt: null,
      // Anything not cancelled is payable: an invoice is Booked the moment
      // it is recorded, and there is no separate approval gate.
      status: { not: 'CANCELLED' },
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

    if (invoice.status === 'CANCELLED') {
      throw new ConflictException('A cancelled invoice cannot be paid.');
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

    // The payment and the invoice's new status commit together. Separately,
    // a failure between them would leave money recorded against an invoice
    // still claiming to be unpaid — the kind of discrepancy that only shows up
    // when a vendor is chased for something already settled.
    const created = await this.prisma.transaction(async (tx) => {
      const number = await this.numbering.next(tx, tenantId, 'PAY');

      const payment = await tx.vendorPayment.create({
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

      // US-PUR-05 / US-PUR-06: Booked -> Partially Paid -> Paid, driven by
      // payments and nothing else. Computed from `alreadyPaid + amount` rather
      // than re-summing: both figures are already known here, and the
      // overpayment guard above has already proved the total cannot exceed it.
      const paidAfter = alreadyPaid.plus(amount);

      await tx.purchaseInvoice.update({
        where: { id: invoice.id },
        data: {
          status: paidAfter.greaterThanOrEqualTo(total) ? 'PAID' : 'PARTIALLY_PAID',
        },
      });

      return payment;
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

  /**
   * The outstanding payables report, one row per vendor, aged into buckets.
   *
   * Ageing runs from the DUE date, not the invoice date. Ageing from when an
   * invoice was raised would call a 60-day-terms invoice "60 days old" on the
   * day it falls due, which tells the person paying bills nothing about
   * whether they are late — and lateness is the only question this report
   * exists to answer.
   *
   * Vendors with nothing outstanding are omitted: a payables report listing
   * everyone who has ever invoiced is a report nobody reads.
   */
  async payablesReport(vendorId?: string): Promise<PayablesReport> {
    const rows = await this.prisma.scoped.purchaseInvoice.findMany({
      where: {
        deletedAt: null,
        status: { not: 'CANCELLED' },
        ...(vendorId ? { vendorId } : {}),
      },
      select: {
        totalAmount: true,
        dueDate: true,
        vendor: { select: { id: true, name: true, code: true } },
        payments: { select: { amount: true } },
      },
      orderBy: [{ dueDate: 'asc' }],
    });

    const emptyBuckets = (): Record<AgeingBucket, Prisma.Decimal> => ({
      NOT_DUE: ZERO,
      DUE_0_30: ZERO,
      DUE_31_60: ZERO,
      DUE_61_90: ZERO,
      DUE_90_PLUS: ZERO,
    });

    const byVendor = new Map<
      string,
      {
        vendor: { id: string; name: string; code: string };
        total: Prisma.Decimal;
        buckets: Record<AgeingBucket, Prisma.Decimal>;
        invoiceCount: number;
        oldestOverdueDays: number;
      }
    >();

    const totals = { total: ZERO, buckets: emptyBuckets(), invoiceCount: 0 };

    for (const row of rows) {
      const paid = row.payments.reduce((sum, payment) => sum.plus(payment.amount), ZERO);
      const outstanding = positiveDifference(new Prisma.Decimal(row.totalAmount), paid);

      // A settled invoice is not a payable. Skipped rather than shown at zero,
      // which would pad the report with rows that need no action.
      if (outstanding.isZero()) continue;

      // Negative daysToDue means overdue; the bucket is how far past.
      const overdueBy = -daysUntil(row.dueDate);
      const bucket = bucketFor(overdueBy);

      const existing = byVendor.get(row.vendor.id) ?? {
        vendor: row.vendor,
        total: ZERO,
        buckets: emptyBuckets(),
        invoiceCount: 0,
        oldestOverdueDays: 0,
      };

      existing.total = existing.total.plus(outstanding);
      existing.buckets[bucket] = existing.buckets[bucket].plus(outstanding);
      existing.invoiceCount += 1;
      existing.oldestOverdueDays = Math.max(existing.oldestOverdueDays, Math.max(overdueBy, 0));

      byVendor.set(row.vendor.id, existing);

      totals.total = totals.total.plus(outstanding);
      totals.buckets[bucket] = totals.buckets[bucket].plus(outstanding);
      totals.invoiceCount += 1;
    }

    const serialiseBuckets = (buckets: Record<AgeingBucket, Prisma.Decimal>) =>
      Object.fromEntries(
        Object.entries(buckets).map(([key, value]) => [key, money(value)]),
      ) as Record<AgeingBucket, string>;

    return {
      // Largest exposure first: the order somebody chasing payments works in.
      rows: [...byVendor.values()]
        .sort((a, b) => (a.total.greaterThan(b.total) ? -1 : 1))
        .map((entry) => ({
          vendor: entry.vendor,
          totalOutstanding: money(entry.total),
          buckets: serialiseBuckets(entry.buckets),
          invoiceCount: entry.invoiceCount,
          oldestOverdueDays: entry.oldestOverdueDays,
        })),
      totals: {
        totalOutstanding: money(totals.total),
        buckets: serialiseBuckets(totals.buckets),
        invoiceCount: totals.invoiceCount,
      },
      generatedAt: new Date().toISOString(),
    };
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

/**
 * Which ageing bucket a payable falls into.
 *
 * `overdueBy` is days PAST the due date, so anything zero or negative is not
 * yet due. The boundaries are inclusive at the top of each band, matching how
 * the labels read: "31–60" means 31 through 60.
 */
function bucketFor(overdueBy: number): AgeingBucket {
  if (overdueBy <= 0) return 'NOT_DUE';
  if (overdueBy <= 30) return 'DUE_0_30';
  if (overdueBy <= 60) return 'DUE_31_60';
  if (overdueBy <= 90) return 'DUE_61_90';

  return 'DUE_90_PLUS';
}
