import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  InvoiceStatus,
  O2cPaymentStatus,
  SalesInvoiceDetail,
  SalesInvoiceItemView,
  SalesInvoiceListItem,
} from '@pharma-erp/types';

import { PrismaService } from '../../prisma/prisma.service';
import { NumberingService } from '../../procurement/numbering.service';
import { TenantContextService } from '../../tenant/tenant-context.service';

import type { CreateSalesInvoiceDto, UpdateSalesInvoiceDto } from './dto/sales-invoice.dto';

/**
 * Tax invoices raised against a despatch.
 *
 * PLACE OF SUPPLY DECIDES THE TAX SPLIT. Same state as the seller means
 * CGST + SGST, each half the rate; a different state means IGST at the full
 * rate. Getting this wrong misfiles the GST return, so the invoice records the
 * two state codes it compared and the database refuses a row carrying both
 * kinds of tax.
 *
 * EVERYTHING PRINTED IS COPIED AT ISSUE — the addresses, both GSTINs, the
 * batch number, the expiry, the MRP. A tax invoice is a statutory document and
 * has to keep saying what it said even after the customer moves premises or
 * the item master is corrected.
 *
 * TAX IS SUMMED FROM THE LINES, never recomputed on the header. Rounding each
 * line and then the total separately is how an invoice ends up a paisa out from
 * its own rows.
 */
@Injectable()
export class SalesInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly numbering: NumberingService,
  ) {}

  async list(paymentStatus?: string, search?: string): Promise<SalesInvoiceListItem[]> {
    const term = search?.trim();

    const rows = await this.prisma.scoped.salesInvoice.findMany({
      where: {
        deletedAt: null,
        ...(isPaymentStatus(paymentStatus) ? { paymentStatus } : {}),
        ...(term
          ? {
              OR: [
                { invoiceNumber: { contains: term, mode: 'insensitive' } },
                { customer: { name: { contains: term, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { customer: true, salesOrder: true, createdBy: true },
      orderBy: [{ invoiceDate: 'desc' }, { invoiceNumber: 'desc' }],
    });

    return rows.map(toListItem);
  }

  async get(id: string): Promise<SalesInvoiceDetail> {
    const row = await this.prisma.scoped.salesInvoice.findFirst({
      where: { id, deletedAt: null },
      include: {
        customer: true,
        salesOrder: true,
        createdBy: true,
        items: { orderBy: { lineNumber: 'asc' } },
      },
    });

    if (!row) throw new NotFoundException('Invoice not found.');

    return {
      ...toListItem(row),
      billingName: row.billingName,
      billingAddress: row.billingAddress,
      shippingName: row.shippingName,
      shippingAddress: row.shippingAddress,
      customerGstin: row.customerGstin,
      sellerGstin: row.sellerGstin,
      placeOfSupplyStateCode: row.placeOfSupplyStateCode,
      sellerStateCode: row.sellerStateCode,
      cgstAmount: row.cgstAmount.toFixed(2),
      sgstAmount: row.sgstAmount.toFixed(2),
      igstAmount: row.igstAmount.toFixed(2),
      discountAmount: row.discountAmount.toFixed(2),
      notes: row.notes,
      items: row.items.map(toItemView),
    };
  }

  /** Raises the invoice for a confirmed despatch, line by line from what shipped. */
  async createFromDispatch(dto: CreateSalesInvoiceDto): Promise<SalesInvoiceDetail> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const dispatch = await this.prisma.scoped.dispatch.findFirst({
      where: { id: dto.dispatchId, deletedAt: null },
      include: {
        customer: true,
        salesOrder: true,
        items: {
          include: {
            batchAllocation: {
              include: { batch: true, salesOrderItem: { include: { item: true } } },
            },
          },
        },
      },
    });

    if (!dispatch) throw new NotFoundException('Dispatch not found.');

    if (dispatch.status === 'DRAFT') {
      throw new BadRequestException('Confirm the dispatch before invoicing it.');
    }

    if (dispatch.salesInvoiceId) {
      throw new BadRequestException('This dispatch has already been invoiced.');
    }

    const tenant = await this.prisma.scoped.tenant.findFirstOrThrow({ where: { id: tenantId } });

    // Place of supply: the customer's state, falling back to the first two
    // digits of their GSTIN when no separate code was recorded.
    const sellerStateCode = tenant.gstin?.slice(0, 2) ?? null;
    const placeOfSupply =
      dispatch.customer.stateCode ?? dispatch.customer.gstin?.slice(0, 2) ?? null;

    // Unknown on either side is treated as INTRA-state. Defaulting to IGST
    // would overstate a local sale and be harder to spot on the return than a
    // missing state code, which the invoice screen shows plainly.
    const isInterState =
      sellerStateCode !== null && placeOfSupply !== null && sellerStateCode !== placeOfSupply;

    const invoiceDate = new Date(dto.invoiceDate);
    const creditDays = dispatch.customer.creditPeriodDays ?? dispatch.customer.paymentTermsDays;
    const dueDate = new Date(invoiceDate);
    dueDate.setUTCDate(dueDate.getUTCDate() + creditDays);

    const created = await this.prisma.transaction(async (tx) => {
      const invoiceNumber = await this.numbering.next(tx, tenantId, 'SINV');

      const lines = dispatch.items.map((line, index) => {
        const allocation = line.batchAllocation;
        const orderLine = allocation.salesOrderItem;
        const item = orderLine.item;

        const quantity = line.quantityDispatched;
        const unitPrice = orderLine.unitPrice;
        const gstRate = orderLine.gstRatePercent;

        const gross = quantity.mul(unitPrice);
        // The order line's discount, applied pro-rata to what actually shipped.
        const discountAmount = orderLine.quantityOrdered.isZero()
          ? new Prisma.Decimal(0)
          : orderLine.discountAmount
              .mul(quantity)
              .div(orderLine.quantityOrdered)
              .toDecimalPlaces(2);

        const taxableValue = gross.sub(discountAmount).toDecimalPlaces(2);
        const taxAmount = taxableValue.mul(gstRate).div(100).toDecimalPlaces(2);

        // Split, not recomputed: halving the already-rounded total keeps CGST
        // and SGST summing exactly to it.
        const cgst = isInterState ? new Prisma.Decimal(0) : taxAmount.div(2).toDecimalPlaces(2);
        const sgst = isInterState ? new Prisma.Decimal(0) : taxAmount.sub(cgst);
        const igst = isInterState ? taxAmount : new Prisma.Decimal(0);

        return {
          tenantId,
          lineNumber: index + 1,
          itemId: orderLine.itemId,
          batchId: allocation.batchId,
          description: item.brandName ? `${item.name} (${item.brandName})` : item.name,
          hsnCode: item.hsnCode,
          batchNumber: allocation.batch.batchNumber,
          expiryDate: allocation.batch.expiryDate,
          mrp: item.mrp,
          quantity,
          unitPrice,
          discountAmount,
          taxableValue,
          gstRatePercent: gstRate,
          cgstAmount: cgst,
          sgstAmount: sgst,
          igstAmount: igst,
          taxAmount,
          lineTotal: taxableValue.add(taxAmount),
          // The DPCO ceiling as at issue. The shared register records control
          // as a boolean only, so the MRP is the ceiling it can evidence.
          ceilingPriceAtInvoice: item.dpcoCeiling ? item.mrp : null,
        };
      });

      const totals = lines.reduce(
        (acc, line) => ({
          subtotal: acc.subtotal.add(line.taxableValue),
          discount: acc.discount.add(line.discountAmount),
          cgst: acc.cgst.add(line.cgstAmount),
          sgst: acc.sgst.add(line.sgstAmount),
          igst: acc.igst.add(line.igstAmount),
          tax: acc.tax.add(line.taxAmount),
          grand: acc.grand.add(line.lineTotal),
        }),
        {
          subtotal: new Prisma.Decimal(0),
          discount: new Prisma.Decimal(0),
          cgst: new Prisma.Decimal(0),
          sgst: new Prisma.Decimal(0),
          igst: new Prisma.Decimal(0),
          tax: new Prisma.Decimal(0),
          grand: new Prisma.Decimal(0),
        },
      );

      const invoice = await tx.salesInvoice.create({
        data: {
          tenantId,
          invoiceNumber,
          customerId: dispatch.customerId,
          salesOrderId: dispatch.salesOrderId,
          dispatchId: dispatch.id,
          invoiceDate,
          dueDate,
          status: 'ISSUED',
          paymentStatus: 'UNPAID',
          billingName: dispatch.customer.name,
          billingAddress: joinAddress(
            dispatch.customer.billingLine1,
            dispatch.customer.billingLine2,
            dispatch.customer.billingCity,
            dispatch.customer.billingState,
            dispatch.customer.billingPin,
          ),
          shippingName: dispatch.customer.name,
          shippingAddress: joinAddress(
            dispatch.customer.shippingLine1,
            dispatch.customer.shippingLine2,
            dispatch.customer.shippingCity,
            dispatch.customer.shippingState,
            dispatch.customer.shippingPin,
          ),
          customerGstin: dispatch.customer.gstin,
          sellerGstin: tenant.gstin,
          placeOfSupplyStateCode: placeOfSupply,
          sellerStateCode,
          isInterState,
          subtotal: totals.subtotal,
          discountAmount: totals.discount,
          cgstAmount: totals.cgst,
          sgstAmount: totals.sgst,
          igstAmount: totals.igst,
          taxAmount: totals.tax,
          grandTotal: totals.grand,
          notes: dto.notes?.trim() || null,
          createdById: userId,
          items: { create: lines },
        },
        select: { id: true, grandTotal: true },
      });

      await tx.dispatch.update({
        where: { id: dispatch.id },
        data: { salesInvoiceId: invoice.id },
      });

      // The invoice DEBITS the customer — this is what they now owe.
      await tx.receivableLedgerEntry.create({
        data: {
          tenantId,
          customerId: dispatch.customerId,
          entryType: 'INVOICE',
          direction: 'DEBIT',
          amount: invoice.grandTotal,
          salesInvoiceId: invoice.id,
          createdById: userId,
        },
      });

      return invoice;
    });

    return this.get(created.id);
  }

  /**
   * Amends the commercial terms on an issued invoice. NOT the tax record.
   *
   * Nothing that appears on the filed document can be changed here — no
   * amounts, lines, batch numbers, addresses, GSTIN, invoice date or tax split.
   * Those are snapshotted at issue precisely so a later correction to master
   * data cannot rewrite a filed document, and correcting one is a cancellation
   * and a reissue, which leaves both copies and the reversing ledger entry on
   * the record.
   *
   * The due date is a payment arrangement rather than part of the tax record,
   * so it is editable — until money has been received, after which the terms it
   * was paid under are part of the settlement.
   */
  async update(id: string, dto: UpdateSalesInvoiceDto): Promise<SalesInvoiceDetail> {
    const invoice = await this.prisma.scoped.salesInvoice.findFirst({
      where: { id, deletedAt: null },
    });

    if (!invoice) throw new NotFoundException('Invoice not found.');

    if (invoice.status === 'CANCELLED') {
      throw new BadRequestException('A cancelled invoice cannot be amended.');
    }

    if (dto.dueDate !== undefined) {
      if (invoice.amountPaid.greaterThan(0)) {
        throw new BadRequestException(
          'Money has been received against this invoice, so its due date can no longer be changed.',
        );
      }

      const dueDate = new Date(dto.dueDate);

      if (dueDate < invoice.invoiceDate) {
        throw new BadRequestException('The due date cannot be before the invoice date.');
      }
    }

    await this.prisma.scoped.salesInvoice.update({
      where: { id },
      data: {
        ...(dto.dueDate === undefined ? {} : { dueDate: new Date(dto.dueDate) }),
        ...(dto.notes === undefined ? {} : { notes: dto.notes.trim() || null }),
      },
    });

    return this.get(id);
  }

  /**
   * Cancels an issued invoice and reverses its ledger entry.
   *
   * Refused once money has been taken against it: a paid invoice is unwound by
   * a credit note, which leaves both sides of the story on the ledger.
   */
  async cancel(id: string, reason?: string): Promise<SalesInvoiceDetail> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const invoice = await this.prisma.scoped.salesInvoice.findFirst({
      where: { id, deletedAt: null },
    });

    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (invoice.status === 'CANCELLED') throw new BadRequestException('Already cancelled.');

    if (invoice.amountPaid.greaterThan(0)) {
      throw new BadRequestException(
        'Money has been received against this invoice — raise a credit note instead of cancelling it.',
      );
    }

    await this.prisma.transaction(async (tx) => {
      await tx.salesInvoice.update({
        where: { id },
        data: { status: 'CANCELLED', notes: reason?.trim() || invoice.notes },
      });

      await tx.receivableLedgerEntry.create({
        data: {
          tenantId,
          customerId: invoice.customerId,
          entryType: 'ADJUSTMENT',
          direction: 'CREDIT',
          amount: invoice.grandTotal,
          salesInvoiceId: invoice.id,
          notes: reason?.trim() ? `Invoice cancelled: ${reason.trim()}` : 'Invoice cancelled.',
          createdById: userId,
        },
      });
    });

    return this.get(id);
  }
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function isPaymentStatus(value?: string): value is O2cPaymentStatus {
  return value === 'UNPAID' || value === 'PARTIALLY_PAID' || value === 'PAID';
}

function joinAddress(...parts: (string | null)[]): string | null {
  const joined = parts.filter((part) => part && part.trim()).join(', ');
  return joined || null;
}

function toListItem(row: {
  id: string;
  invoiceNumber: string;
  customerId: string;
  salesOrderId: string | null;
  invoiceDate: Date;
  dueDate: Date | null;
  status: string;
  paymentStatus: string;
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  amountCredited: Prisma.Decimal;
  isInterState: boolean;
  createdAt: Date;
  customer: { name: string };
  salesOrder: { orderNumber: string } | null;
  createdBy: { fullName: string } | null;
}): SalesInvoiceListItem {
  const outstanding = Prisma.Decimal.max(
    row.grandTotal.sub(row.amountPaid).sub(row.amountCredited),
    0,
  );

  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    customerId: row.customerId,
    customerName: row.customer.name,
    salesOrderId: row.salesOrderId,
    orderNumber: row.salesOrder?.orderNumber ?? null,
    invoiceDate: toIsoDate(row.invoiceDate),
    dueDate: row.dueDate ? toIsoDate(row.dueDate) : null,
    status: row.status as InvoiceStatus,
    paymentStatus: row.paymentStatus as O2cPaymentStatus,
    subtotal: row.subtotal.toFixed(2),
    taxAmount: row.taxAmount.toFixed(2),
    grandTotal: row.grandTotal.toFixed(2),
    amountPaid: row.amountPaid.toFixed(2),
    amountCredited: row.amountCredited.toFixed(2),
    amountOutstanding: outstanding.toFixed(2),
    isInterState: row.isInterState,
    createdByName: row.createdBy?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toItemView(line: {
  id: string;
  lineNumber: number;
  itemId: string;
  description: string;
  hsnCode: string | null;
  batchId: string;
  batchNumber: string;
  expiryDate: Date;
  mrp: Prisma.Decimal | null;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxableValue: Prisma.Decimal;
  gstRatePercent: Prisma.Decimal;
  cgstAmount: Prisma.Decimal;
  sgstAmount: Prisma.Decimal;
  igstAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  ceilingPriceAtInvoice: Prisma.Decimal | null;
  quantityReturned: Prisma.Decimal;
}): SalesInvoiceItemView {
  return {
    id: line.id,
    lineNumber: line.lineNumber,
    itemId: line.itemId,
    description: line.description,
    hsnCode: line.hsnCode,
    batchId: line.batchId,
    batchNumber: line.batchNumber,
    expiryDate: toIsoDate(line.expiryDate),
    mrp: line.mrp?.toFixed(2) ?? null,
    quantity: line.quantity.toFixed(3),
    unitPrice: line.unitPrice.toFixed(2),
    discountAmount: line.discountAmount.toFixed(2),
    taxableValue: line.taxableValue.toFixed(2),
    gstRatePercent: line.gstRatePercent.toFixed(2),
    cgstAmount: line.cgstAmount.toFixed(2),
    sgstAmount: line.sgstAmount.toFixed(2),
    igstAmount: line.igstAmount.toFixed(2),
    taxAmount: line.taxAmount.toFixed(2),
    lineTotal: line.lineTotal.toFixed(2),
    ceilingPriceAtInvoice: line.ceilingPriceAtInvoice?.toFixed(2) ?? null,
    quantityReturned: line.quantityReturned.toFixed(3),
  };
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
