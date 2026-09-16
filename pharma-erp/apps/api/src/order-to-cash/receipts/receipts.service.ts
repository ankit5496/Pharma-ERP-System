import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type { PaymentMethod, ReceiptListItem, ReceiptStatus } from '@pharma-erp/types';

import { NumberingService } from '../../procurement/numbering.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../tenant/tenant-context.service';

import type { CreateReceiptDto } from './dto/receipt.dto';

/**
 * Receipts — money collected and applied to an invoice.
 *
 * EVERY MOVEMENT IS A LEDGER ENTRY. Recording a receipt credits the customer;
 * a bounced cheque debits them again. The invoice's `amountPaid` is a
 * convenience for the list screen, but the ledger is the record — which is why
 * it is append-only and the running balance can be explained line by line.
 *
 * A RECEIPT CANNOT EXCEED WHAT IS OUTSTANDING. Over-applying would leave an
 * invoice showing negative debt and quietly hide a misposted payment that
 * belongs somewhere else.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly numbering: NumberingService,
  ) {}

  async list(search?: string): Promise<ReceiptListItem[]> {
    const term = search?.trim();

    const rows = await this.prisma.scoped.receipt.findMany({
      where: term
        ? {
            OR: [
              { receiptNumber: { contains: term, mode: 'insensitive' } },
              { referenceNumber: { contains: term, mode: 'insensitive' } },
              { customer: { name: { contains: term, mode: 'insensitive' } } },
              { salesInvoice: { invoiceNumber: { contains: term, mode: 'insensitive' } } },
            ],
          }
        : {},
      include: { customer: true, salesInvoice: true, createdBy: true },
      orderBy: [{ receiptDate: 'desc' }, { receiptNumber: 'desc' }],
    });

    return rows.map(toListItem);
  }

  async get(id: string): Promise<ReceiptListItem> {
    const row = await this.prisma.scoped.receipt.findFirst({
      where: { id },
      include: { customer: true, salesInvoice: true, createdBy: true },
    });

    if (!row) throw new NotFoundException('Receipt not found.');

    return toListItem(row);
  }

  async create(dto: CreateReceiptDto): Promise<ReceiptListItem> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const invoice = await this.prisma.scoped.salesInvoice.findFirst({
      where: { id: dto.salesInvoiceId, deletedAt: null },
    });

    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (invoice.status === 'CANCELLED') {
      throw new BadRequestException('This invoice has been cancelled.');
    }

    const amount = new Prisma.Decimal(dto.amount);
    const outstanding = invoice.grandTotal.sub(invoice.amountPaid).sub(invoice.amountCredited);

    if (amount.greaterThan(outstanding)) {
      throw new BadRequestException(
        `Only ${outstanding.toFixed(2)} is outstanding on this invoice.`,
      );
    }

    const created = await this.prisma.transaction(async (tx) => {
      const receiptNumber = await this.numbering.next(tx, tenantId, 'RCPT');

      const receipt = await tx.receipt.create({
        data: {
          tenantId,
          receiptNumber,
          customerId: invoice.customerId,
          salesInvoiceId: invoice.id,
          receiptDate: new Date(dto.receiptDate),
          amount,
          paymentMethod: dto.paymentMethod,
          referenceNumber: dto.referenceNumber?.trim() || null,
          status: 'RECORDED',
          notes: dto.notes?.trim() || null,
          createdById: userId,
        },
        select: { id: true },
      });

      const paid = invoice.amountPaid.add(amount);

      await tx.salesInvoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid: paid,
          paymentStatus: paid.add(invoice.amountCredited).greaterThanOrEqualTo(invoice.grandTotal)
            ? 'PAID'
            : 'PARTIALLY_PAID',
        },
      });

      await tx.receivableLedgerEntry.create({
        data: {
          tenantId,
          customerId: invoice.customerId,
          entryType: 'RECEIPT',
          direction: 'CREDIT',
          amount,
          salesInvoiceId: invoice.id,
          receiptId: receipt.id,
          createdById: userId,
        },
      });

      return receipt;
    });

    return this.get(created.id);
  }

  /**
   * A bounced payment.
   *
   * The receipt is NOT deleted and its amount is not subtracted from itself:
   * the money was received and then failed, and both facts belong on the
   * ledger. A reversing DEBIT is written instead.
   */
  async bounce(id: string, reason?: string): Promise<ReceiptListItem> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const receipt = await this.prisma.scoped.receipt.findFirst({
      where: { id },
      include: { salesInvoice: true },
    });

    if (!receipt) throw new NotFoundException('Receipt not found.');
    if (receipt.status === 'BOUNCED') throw new BadRequestException('Already recorded as bounced.');
    if (receipt.status === 'CANCELLED') throw new BadRequestException('This receipt was cancelled.');

    await this.prisma.transaction(async (tx) => {
      await tx.receipt.update({
        where: { id },
        data: {
          status: 'BOUNCED',
          notes: reason?.trim()
            ? `${receipt.notes ?? ''}\nBounced: ${reason.trim()}`.trim()
            : receipt.notes,
        },
      });

      const paid = Prisma.Decimal.max(receipt.salesInvoice.amountPaid.sub(receipt.amount), 0);

      await tx.salesInvoice.update({
        where: { id: receipt.salesInvoiceId },
        data: {
          amountPaid: paid,
          paymentStatus: paid.isZero()
            ? 'UNPAID'
            : paid
                  .add(receipt.salesInvoice.amountCredited)
                  .greaterThanOrEqualTo(receipt.salesInvoice.grandTotal)
              ? 'PAID'
              : 'PARTIALLY_PAID',
        },
      });

      await tx.receivableLedgerEntry.create({
        data: {
          tenantId,
          customerId: receipt.customerId,
          entryType: 'ADJUSTMENT',
          direction: 'DEBIT',
          amount: receipt.amount,
          salesInvoiceId: receipt.salesInvoiceId,
          receiptId: receipt.id,
          notes: reason?.trim() ? `Receipt bounced: ${reason.trim()}` : 'Receipt bounced.',
          createdById: userId,
        },
      });
    });

    return this.get(id);
  }
}

function toListItem(row: {
  id: string;
  receiptNumber: string;
  customerId: string;
  salesInvoiceId: string;
  receiptDate: Date;
  amount: Prisma.Decimal;
  paymentMethod: string;
  referenceNumber: string | null;
  status: string;
  notes: string | null;
  createdAt: Date;
  customer: { name: string };
  salesInvoice: { invoiceNumber: string };
  createdBy: { fullName: string } | null;
}): ReceiptListItem {
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    customerId: row.customerId,
    customerName: row.customer.name,
    salesInvoiceId: row.salesInvoiceId,
    invoiceNumber: row.salesInvoice.invoiceNumber,
    receiptDate: row.receiptDate.toISOString().slice(0, 10),
    amount: row.amount.toFixed(2),
    paymentMethod: row.paymentMethod as PaymentMethod,
    referenceNumber: row.referenceNumber,
    status: row.status as ReceiptStatus,
    notes: row.notes,
    createdByName: row.createdBy?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
