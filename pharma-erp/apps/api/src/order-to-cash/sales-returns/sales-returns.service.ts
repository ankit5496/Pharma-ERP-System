import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  ReturnReason,
  ReturnedStockDisposition,
  SalesReturnDetail,
  SalesReturnItemView,
  SalesReturnListItem,
  SalesReturnStatus,
} from '@pharma-erp/types';

import { PrismaService } from '../../prisma/prisma.service';
import { NumberingService } from '../../procurement/numbering.service';
import { TenantContextService } from '../../tenant/tenant-context.service';

import type { CreateSalesReturnDto, UpdateSalesReturnDto } from './dto/sales-return.dto';

/**
 * Sales returns — goods coming back, traced to the batch that shipped.
 *
 * RETURNED STOCK DOES NOT GO BACK ON THE SHELF BY DEFAULT. Medicine that has
 * left the company's custody has an unknown storage history, so the disposition
 * defaults to QUARANTINE and only an explicit RESTOCK puts it back into
 * saleable stock. Expired and recalled goods cannot be restocked at all — the
 * service refuses it rather than trusting the caller.
 *
 * THE CREDIT IS A LEDGER ENTRY, not a subtraction. Crediting a return writes a
 * CREDIT_NOTE against the customer and raises the invoice's `amountCredited`,
 * so the invoice still shows what was billed and what was given back.
 */
@Injectable()
export class SalesReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly numbering: NumberingService,
  ) {}

  async list(search?: string): Promise<SalesReturnListItem[]> {
    const term = search?.trim();

    const rows = await this.prisma.scoped.salesReturn.findMany({
      where: {
        deletedAt: null,
        ...(term
          ? {
              OR: [
                { returnNumber: { contains: term, mode: 'insensitive' } },
                { customer: { name: { contains: term, mode: 'insensitive' } } },
                { salesInvoice: { invoiceNumber: { contains: term, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { customer: true, salesInvoice: true, salesOrder: true, createdBy: true, items: true },
      orderBy: [{ returnDate: 'desc' }, { returnNumber: 'desc' }],
    });

    return rows.map(toListItem);
  }

  async get(id: string): Promise<SalesReturnDetail> {
    const row = await this.prisma.scoped.salesReturn.findFirst({
      where: { id, deletedAt: null },
      include: {
        customer: true,
        salesInvoice: true,
        salesOrder: true,
        createdBy: true,
        items: { include: { item: true, batch: true } },
      },
    });

    if (!row) throw new NotFoundException('Sales return not found.');

    return {
      ...toListItem(row),
      reasonNotes: row.reasonNotes,
      notes: row.notes,
      items: row.items.map(toItemView),
    };
  }

  async create(dto: CreateSalesReturnDto): Promise<SalesReturnDetail> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const invoice = await this.prisma.scoped.salesInvoice.findFirst({
      where: { id: dto.salesInvoiceId, deletedAt: null },
      include: { items: true },
    });

    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (invoice.status === 'CANCELLED') {
      throw new BadRequestException('This invoice has been cancelled.');
    }

    const byId = new Map(invoice.items.map((line) => [line.id, line]));

    for (const line of dto.items) {
      const invoiceLine = byId.get(line.salesInvoiceItemId);
      if (!invoiceLine) {
        throw new BadRequestException('A line on this return does not belong to that invoice.');
      }

      const quantity = new Prisma.Decimal(line.quantity);
      const returnable = invoiceLine.quantity.sub(invoiceLine.quantityReturned);

      if (quantity.greaterThan(returnable)) {
        throw new BadRequestException(
          `Only ${returnable.toFixed(3)} of ${invoiceLine.description} remains returnable.`,
        );
      }

      // Expired or recalled stock can never go back into saleable inventory.
      const disposition = line.disposition ?? 'QUARANTINE';
      const reason = line.reason ?? dto.reason;

      if (
        disposition === 'RESTOCK' &&
        (reason === 'EXPIRED' || reason === 'RECALL' || reason === 'QUALITY_COMPLAINT')
      ) {
        throw new BadRequestException(
          'Stock returned as expired, recalled or quality-complained cannot be restocked.',
        );
      }
    }

    const created = await this.prisma.transaction(async (tx) => {
      const returnNumber = await this.numbering.next(tx, tenantId, 'SRTN');

      const lines = dto.items.map((line) => {
        const invoiceLine = byId.get(line.salesInvoiceItemId)!;
        const quantity = new Prisma.Decimal(line.quantity);

        // Priced at what it was invoiced at — a return credits what was
        // charged, not today's price.
        const unitPrice = invoiceLine.unitPrice;
        const gstRate = invoiceLine.gstRatePercent;
        const taxableValue = quantity.mul(unitPrice).toDecimalPlaces(2);
        const taxAmount = taxableValue.mul(gstRate).div(100).toDecimalPlaces(2);

        return {
          tenantId,
          salesInvoiceItemId: invoiceLine.id,
          itemId: invoiceLine.itemId,
          batchId: invoiceLine.batchId,
          quantity,
          unitPrice,
          gstRatePercent: gstRate,
          taxableValue,
          taxAmount,
          amount: taxableValue.add(taxAmount),
          reason: line.reason ?? dto.reason,
          disposition: line.disposition ?? 'QUARANTINE',
          notes: line.notes?.trim() || null,
        };
      });

      const totals = lines.reduce(
        (acc, line) => ({
          subtotal: acc.subtotal.add(line.taxableValue),
          tax: acc.tax.add(line.taxAmount),
          total: acc.total.add(line.amount),
        }),
        {
          subtotal: new Prisma.Decimal(0),
          tax: new Prisma.Decimal(0),
          total: new Prisma.Decimal(0),
        },
      );

      const salesReturn = await tx.salesReturn.create({
        data: {
          tenantId,
          returnNumber,
          customerId: invoice.customerId,
          salesInvoiceId: invoice.id,
          salesOrderId: invoice.salesOrderId,
          returnDate: new Date(dto.returnDate),
          reason: dto.reason,
          reasonNotes: dto.reasonNotes?.trim() || null,
          status: 'DRAFT',
          subtotal: totals.subtotal,
          taxAmount: totals.tax,
          totalAmount: totals.total,
          notes: dto.notes?.trim() || null,
          createdById: userId,
          items: { create: lines },
        },
        select: { id: true },
      });

      for (const line of lines) {
        await tx.salesInvoiceItem.update({
          where: { id: line.salesInvoiceItemId },
          data: { quantityReturned: { increment: line.quantity } },
        });
      }

      return salesReturn;
    });

    return this.get(created.id);
  }

  /**
   * Amends a DRAFT return.
   *
   * DRAFT ONLY: once received the stock has been put somewhere — quarantined,
   * destroyed or restocked — and once credited the customer's ledger has moved.
   * Neither is undone by editing a form.
   *
   * Header fields only. Changing a returned quantity would have to unwind the
   * `quantityReturned` it already added to the invoice line, so a wrong line is
   * cancelled and re-raised rather than edited underneath the invoice.
   */
  async update(id: string, dto: UpdateSalesReturnDto): Promise<SalesReturnDetail> {
    const salesReturn = await this.prisma.scoped.salesReturn.findFirst({
      where: { id, deletedAt: null },
    });

    if (!salesReturn) throw new NotFoundException('Sales return not found.');

    if (salesReturn.status !== 'DRAFT') {
      throw new BadRequestException(
        `Only a draft return can be edited — this one is ${salesReturn.status.toLowerCase()}.`,
      );
    }

    await this.prisma.scoped.salesReturn.update({
      where: { id },
      data: {
        ...(dto.returnDate ? { returnDate: new Date(dto.returnDate) } : {}),
        ...(dto.reason ? { reason: dto.reason } : {}),
        ...(dto.reasonNotes === undefined ? {} : { reasonNotes: dto.reasonNotes.trim() || null }),
        ...(dto.notes === undefined ? {} : { notes: dto.notes.trim() || null }),
      },
    });

    return this.get(id);
  }

  /**
   * Records the goods as physically received and puts the stock where its
   * disposition says — back into saleable stock only when RESTOCK was chosen.
   */
  async receive(id: string): Promise<SalesReturnDetail> {
    const salesReturn = await this.prisma.scoped.salesReturn.findFirst({
      where: { id, deletedAt: null },
      include: { items: true },
    });

    if (!salesReturn) throw new NotFoundException('Sales return not found.');
    if (salesReturn.status !== 'DRAFT') {
      throw new BadRequestException('Only a draft return can be received.');
    }

    await this.prisma.transaction(async (tx) => {
      for (const line of salesReturn.items) {
        if (line.disposition !== 'RESTOCK') continue;

        await tx.finishedGoodsLot.updateMany({
          where: { batchId: line.batchId },
          data: { quantityAvailable: { increment: line.quantity } },
        });
      }

      const anyQuarantined = salesReturn.items.some((line) => line.disposition !== 'RESTOCK');

      await tx.salesReturn.update({
        where: { id },
        data: { status: anyQuarantined ? 'QUARANTINED' : 'RECEIVED' },
      });
    });

    return this.get(id);
  }

  /** Issues the credit note: the customer stops owing for what came back. */
  async credit(id: string): Promise<SalesReturnDetail> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const salesReturn = await this.prisma.scoped.salesReturn.findFirst({
      where: { id, deletedAt: null },
      include: { salesInvoice: true },
    });

    if (!salesReturn) throw new NotFoundException('Sales return not found.');
    if (salesReturn.status === 'CREDITED') {
      throw new BadRequestException('This return has already been credited.');
    }
    if (salesReturn.status === 'DRAFT') {
      throw new BadRequestException('Record the goods as received before crediting them.');
    }

    await this.prisma.transaction(async (tx) => {
      const credited = salesReturn.salesInvoice.amountCredited.add(salesReturn.totalAmount);

      await tx.salesInvoice.update({
        where: { id: salesReturn.salesInvoiceId },
        data: {
          amountCredited: credited,
          paymentStatus: salesReturn.salesInvoice.amountPaid
            .add(credited)
            .greaterThanOrEqualTo(salesReturn.salesInvoice.grandTotal)
            ? 'PAID'
            : salesReturn.salesInvoice.amountPaid.greaterThan(0)
              ? 'PARTIALLY_PAID'
              : 'UNPAID',
        },
      });

      await tx.receivableLedgerEntry.create({
        data: {
          tenantId,
          customerId: salesReturn.customerId,
          entryType: 'CREDIT_NOTE',
          direction: 'CREDIT',
          amount: salesReturn.totalAmount,
          salesInvoiceId: salesReturn.salesInvoiceId,
          salesReturnId: salesReturn.id,
          createdById: userId,
        },
      });

      await tx.salesReturn.update({ where: { id }, data: { status: 'CREDITED' } });
    });

    return this.get(id);
  }
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toListItem(row: {
  id: string;
  returnNumber: string;
  customerId: string;
  salesInvoiceId: string;
  salesOrderId: string | null;
  returnDate: Date;
  reason: string;
  status: string;
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  createdAt: Date;
  customer: { name: string };
  salesInvoice: { invoiceNumber: string };
  salesOrder: { orderNumber: string } | null;
  createdBy: { fullName: string } | null;
  items: unknown[];
}): SalesReturnListItem {
  return {
    id: row.id,
    returnNumber: row.returnNumber,
    customerId: row.customerId,
    customerName: row.customer.name,
    salesInvoiceId: row.salesInvoiceId,
    invoiceNumber: row.salesInvoice.invoiceNumber,
    salesOrderId: row.salesOrderId,
    orderNumber: row.salesOrder?.orderNumber ?? null,
    returnDate: row.returnDate.toISOString().slice(0, 10),
    reason: row.reason as ReturnReason,
    status: row.status as SalesReturnStatus,
    subtotal: row.subtotal.toFixed(2),
    taxAmount: row.taxAmount.toFixed(2),
    totalAmount: row.totalAmount.toFixed(2),
    itemCount: row.items.length,
    createdByName: row.createdBy?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toItemView(line: {
  id: string;
  salesInvoiceItemId: string;
  itemId: string;
  batchId: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  gstRatePercent: Prisma.Decimal;
  taxableValue: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  amount: Prisma.Decimal;
  reason: string;
  disposition: string;
  notes: string | null;
  item: { code: string; name: string };
  batch: { batchNumber: string; expiryDate: Date };
}): SalesReturnItemView {
  return {
    id: line.id,
    salesInvoiceItemId: line.salesInvoiceItemId,
    itemId: line.itemId,
    itemCode: line.item.code,
    itemName: line.item.name,
    batchId: line.batchId,
    batchNumber: line.batch.batchNumber,
    expiryDate: line.batch.expiryDate.toISOString().slice(0, 10),
    quantity: line.quantity.toFixed(3),
    unitPrice: line.unitPrice.toFixed(2),
    gstRatePercent: line.gstRatePercent.toFixed(2),
    taxableValue: line.taxableValue.toFixed(2),
    taxAmount: line.taxAmount.toFixed(2),
    amount: line.amount.toFixed(2),
    reason: line.reason as ReturnReason,
    disposition: line.disposition as ReturnedStockDisposition,
    notes: line.notes,
  };
}
