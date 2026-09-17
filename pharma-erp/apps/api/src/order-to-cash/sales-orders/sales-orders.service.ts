import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  CheckResult,
  OrderCheckResult,
  SalesOrderDetail,
  SalesOrderItemView,
  SalesOrderListItem,
  SalesOrderStatus,
  ScheduleCategory,
} from '@pharma-erp/types';

import { PrismaService } from '../../prisma/prisma.service';
import { NumberingService } from '../../procurement/numbering.service';
import { TenantContextService } from '../../tenant/tenant-context.service';

import type { CreateSalesOrderDto } from './dto/sales-order.dto';

/**
 * Sales orders — what a distributor has asked for, priced and gated.
 *
 * ARITHMETIC IS DONE IN `Prisma.Decimal`, NEVER IN JAVASCRIPT NUMBERS. Every
 * money and quantity column is PostgreSQL `numeric`; putting one through a
 * float loses the exactness the ledger is later reconciled against. The values
 * leave this service as strings for the same reason.
 *
 * THE GATE'S VERDICT IS STORED. `runCheck` writes its result and the figures
 * behind it onto the order. Reads return that snapshot rather than re-deciding,
 * so an order approved last week still shows the position it was approved on
 * even after the customer's balance moves. Re-running the check is an explicit
 * act that overwrites it.
 */
@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly numbering: NumberingService,
  ) {}

  async list(search?: string): Promise<SalesOrderListItem[]> {
    const term = search?.trim();

    const orders = await this.prisma.scoped.salesOrder.findMany({
      where: {
        deletedAt: null,
        ...(term
          ? {
              OR: [
                { orderNumber: { contains: term, mode: 'insensitive' } },
                { customer: { name: { contains: term, mode: 'insensitive' } } },
                { customer: { code: { contains: term, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { customer: true, createdBy: true, items: true },
      orderBy: [{ orderDate: 'desc' }, { orderNumber: 'desc' }],
    });

    return orders.map(toListItem);
  }

  async get(id: string): Promise<SalesOrderDetail> {
    const order = await this.prisma.scoped.salesOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        customer: true,
        createdBy: true,
        items: { include: { item: true }, orderBy: { lineNumber: 'asc' } },
      },
    });

    if (!order) throw new NotFoundException('Sales order not found.');

    return toDetail(order);
  }

  async create(dto: CreateSalesOrderDto): Promise<SalesOrderDetail> {
    const tenantId = this.tenantContext.requireTenantId();
    // The acting user comes from the request context, never from the body: a
    // client that could name its own author could forge one.
    const userId = this.tenantContext.getUserId();

    const customer = await this.prisma.scoped.party.findFirst({
      where: { id: dto.customerId, partyType: 'CUSTOMER', deletedAt: null },
    });

    if (!customer) throw new NotFoundException('Customer not found.');

    // Read every item up front, so an unknown id fails before a number is
    // consumed from the sequence rather than halfway through the write.
    const itemIds = [...new Set(dto.items.map((line) => line.itemId))];
    const items = await this.prisma.scoped.item.findMany({
      where: { id: { in: itemIds }, deletedAt: null },
    });

    if (items.length !== itemIds.length) {
      throw new BadRequestException('One or more items on this order do not exist.');
    }

    const byId = new Map(items.map((item) => [item.id, item]));

    const orderDate = new Date(dto.orderDate);
    const deliveryDate = dto.requestedDeliveryDate ? new Date(dto.requestedDeliveryDate) : null;

    if (deliveryDate && deliveryDate < orderDate) {
      throw new BadRequestException('Requested delivery cannot be before the order date.');
    }

    const created = await this.prisma.transaction(async (tx) => {
      const orderNumber = await this.numbering.next(tx, tenantId, 'SO');

      const lines = dto.items.map((line, index) => {
        const item = byId.get(line.itemId)!;

        const quantity = new Prisma.Decimal(line.quantityOrdered);

        // The item's MRP is the default price. Falling back to zero would
        // create an order worth nothing and look deliberate on the invoice, so
        // an item with no MRP and no explicit price is refused instead.
        const unitPrice = line.unitPrice
          ? new Prisma.Decimal(line.unitPrice)
          : (item.mrp ?? null);

        if (unitPrice === null) {
          throw new BadRequestException(
            `${item.code} has no MRP on file, so a unit price must be given for it.`,
          );
        }

        const discountPercent = new Prisma.Decimal(line.discountPercent ?? 0);
        const gstRatePercent = item.gstRate ?? new Prisma.Decimal(0);

        const gross = quantity.mul(unitPrice);
        const discountAmount = gross.mul(discountPercent).div(100).toDecimalPlaces(2);
        const taxableAmount = gross.sub(discountAmount).toDecimalPlaces(2);
        const taxAmount = taxableAmount.mul(gstRatePercent).div(100).toDecimalPlaces(2);
        const lineTotal = taxableAmount.add(taxAmount).toDecimalPlaces(2);

        return {
          tenantId,
          lineNumber: index + 1,
          itemId: item.id,
          quantityOrdered: quantity,
          unitPrice,
          discountPercent,
          discountAmount,
          gstRatePercent,
          taxableAmount,
          taxAmount,
          lineTotal,
        };
      });

      const totals = lines.reduce(
        (acc, line) => ({
          quantity: acc.quantity.add(line.quantityOrdered),
          subtotal: acc.subtotal.add(line.taxableAmount),
          tax: acc.tax.add(line.taxAmount),
          grand: acc.grand.add(line.lineTotal),
        }),
        {
          quantity: new Prisma.Decimal(0),
          subtotal: new Prisma.Decimal(0),
          tax: new Prisma.Decimal(0),
          grand: new Prisma.Decimal(0),
        },
      );

      return tx.salesOrder.create({
        data: {
          tenantId,
          orderNumber,
          customerId: customer.id,
          orderDate,
          requestedDeliveryDate: deliveryDate,
          status: 'DRAFT',
          totalQuantity: totals.quantity,
          subtotal: totals.subtotal,
          taxAmount: totals.tax,
          grandTotal: totals.grand,
          notes: dto.notes?.trim() || null,
          createdById: userId,
          items: { create: lines },
        },
        select: { id: true },
      });
    });

    return this.get(created.id);
  }

  /**
   * Runs the licence and credit gates and RECORDS the verdict.
   *
   * Both gates are decided here, on the API, and re-decided on every call —
   * never trusted from the client. The figures are stored alongside the result
   * because a bare "FAIL" is not actionable: the person needs to see the limit,
   * the balance and the shortfall to know what to do about it.
   */
  async runCheck(id: string): Promise<SalesOrderDetail> {
    const order = await this.prisma.scoped.salesOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        customer: { include: { customerLicences: { where: { deletedAt: null } } } },
      },
    });

    if (!order) throw new NotFoundException('Sales order not found.');

    const reasons: string[] = [];
    const today = startOfUtcDay(new Date());

    // --- Licence gate -------------------------------------------------------
    // A licence has to be BOTH in date and not withdrawn. A suspended licence
    // inside its validity window is still no licence to sell against.
    const licences = order.customer.customerLicences
      .map((licence) => ({
        licence,
        daysToExpiry: Math.round(
          (startOfUtcDay(licence.expiryDate).getTime() - today.getTime()) / 86_400_000,
        ),
      }))
      .filter(({ licence, daysToExpiry }) => licence.status === 'ACTIVE' && daysToExpiry >= 0);

    // Prefer the one marked primary; otherwise whichever runs longest, so the
    // order is tested against the customer's strongest standing.
    const chosen =
      licences.find(({ licence }) => licence.isPrimary) ??
      licences.sort((a, b) => b.daysToExpiry - a.daysToExpiry)[0] ??
      null;

    const licenceCheck: CheckResult = chosen ? 'PASS' : 'FAIL';

    if (!chosen) {
      reasons.push(
        order.customer.customerLicences.length === 0
          ? 'No drug licence is on file for this customer.'
          : 'Every drug licence on file has expired or been withdrawn.',
      );
    }

    // --- Credit gate --------------------------------------------------------
    // Outstanding is zero until invoicing exists; see CustomersService. The
    // arithmetic is written so that only this one value changes when it lands.
    const outstandingAmount = new Prisma.Decimal(0);
    const creditLimit = order.customer.creditLimit ?? new Prisma.Decimal(0);
    const orderAmount = order.grandTotal;
    const availableCredit = Prisma.Decimal.max(creditLimit.sub(outstandingAmount), 0);
    const exposure = outstandingAmount.add(orderAmount);
    const shortfall = exposure.sub(creditLimit);

    // A zero limit means "no limit agreed", not "no credit allowed" — refusing
    // every order for a customer nobody has set a limit on would block the
    // ordinary case of a new account.
    const creditCheck: CheckResult =
      creditLimit.isZero() || shortfall.lessThanOrEqualTo(0) ? 'PASS' : 'FAIL';

    if (creditCheck === 'FAIL') {
      reasons.push(
        `This order would exceed the credit limit by ${shortfall.toFixed(2)}.`,
      );
    }

    const passed = licenceCheck === 'PASS' && creditCheck === 'PASS';

    const updated = await this.prisma.scoped.salesOrder.update({
      where: { id },
      data: {
        licenceCheck,
        creditCheck,
        checkFailureReason: reasons.length ? reasons.join(' ') : null,
        checkedAt: new Date(),
        outstandingAmount,
        creditLimit,
        availableCredit,
        orderAmount,
        creditShortfall: shortfall.greaterThan(0) ? shortfall : null,
        licenceNumber: chosen?.licence.licenceNumber ?? null,
        licenceExpiryDate: chosen?.licence.expiryDate ?? null,
        // Only a DRAFT or a previously BLOCKED order moves on the verdict.
        // An order already being allocated is not re-opened by a re-check.
        ...(order.status === 'DRAFT' ||
        order.status === 'PENDING_CHECK' ||
        order.status === 'BLOCKED'
          ? { status: (passed ? 'APPROVED' : 'BLOCKED') satisfies SalesOrderStatus }
          : {}),
      },
      select: { id: true },
    });

    return this.get(updated.id);
  }

  /** Cancels an order. A status change, never a delete — see the migration. */
  async cancel(id: string, reason?: string): Promise<SalesOrderDetail> {
    const order = await this.prisma.scoped.salesOrder.findFirst({
      where: { id, deletedAt: null },
    });

    if (!order) throw new NotFoundException('Sales order not found.');

    if (order.status === 'DISPATCHED' || order.status === 'COMPLETED') {
      throw new BadRequestException(
        'A dispatched order cannot be cancelled — raise a sales return instead.',
      );
    }

    await this.prisma.scoped.salesOrder.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        notes: reason?.trim() ? `${order.notes ?? ''}\nCancelled: ${reason.trim()}`.trim() : order.notes,
        items: { updateMany: { where: {}, data: { status: 'CANCELLED' } } },
      },
    });

    return this.get(id);
  }
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

type OrderRow = Prisma.SalesOrderGetPayload<{
  include: { customer: true; createdBy: true; items: true };
}>;

type OrderDetailRow = Prisma.SalesOrderGetPayload<{
  include: { customer: true; createdBy: true; items: { include: { item: true } } };
}>;

function toListItem(order: OrderRow): SalesOrderListItem {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    customerCode: order.customer.code,
    customerName: order.customer.name,
    orderDate: toIsoDate(order.orderDate),
    requestedDeliveryDate: order.requestedDeliveryDate
      ? toIsoDate(order.requestedDeliveryDate)
      : null,
    status: order.status as SalesOrderStatus,
    totalQuantity: order.totalQuantity.toFixed(3),
    subtotal: order.subtotal.toFixed(2),
    taxAmount: order.taxAmount.toFixed(2),
    grandTotal: order.grandTotal.toFixed(2),
    licenceCheck: order.licenceCheck as CheckResult,
    creditCheck: order.creditCheck as CheckResult,
    checkFailureReason: order.checkFailureReason,
    itemCount: order.items.length,
    createdByName: order.createdBy?.fullName ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}

function toDetail(order: OrderDetailRow): SalesOrderDetail {
  const items = order.items.map(toItemView);

  return {
    ...toListItem(order as unknown as OrderRow),
    notes: order.notes,
    items,
    check: toCheckResult(order),
    isFullyAllocated:
      items.length > 0 &&
      order.items.every((line: { quantityAllocated: Prisma.Decimal; quantityOrdered: Prisma.Decimal }) =>
        line.quantityAllocated.greaterThanOrEqualTo(line.quantityOrdered),
      ),
    // No invoice tables yet, so this is false rather than unknown — see the
    // note in CustomersService about reporting what is literally true today.
    hasInvoice: false,
    updatedAt: order.updatedAt.toISOString(),
  };
}

function toItemView(
  line: Prisma.SalesOrderItemGetPayload<{ include: { item: true } }>,
): SalesOrderItemView {
  return {
    id: line.id,
    lineNumber: line.lineNumber,
    itemId: line.itemId,
    itemCode: line.item.code,
    itemName: line.item.name,
    // The shared item register has no pack-size column; the O2C contract asks
    // for one. Null is the honest answer rather than inventing a string.
    packSize: null,
    scheduleCategory: toScheduleCategory(line.item.scheduleClassification),
    hsnCode: line.item.hsnCode,
    quantityOrdered: line.quantityOrdered.toFixed(3),
    quantityAllocated: line.quantityAllocated.toFixed(3),
    quantityDispatched: line.quantityDispatched.toFixed(3),
    unitPrice: line.unitPrice.toFixed(2),
    discountPercent: line.discountPercent.toFixed(2),
    discountAmount: line.discountAmount.toFixed(2),
    gstRatePercent: line.gstRatePercent.toFixed(2),
    taxAmount: line.taxAmount.toFixed(2),
    lineTotal: line.lineTotal.toFixed(2),
    status: line.status,
  };
}

function toCheckResult(order: OrderDetailRow): OrderCheckResult {
  return {
    licenceCheck: order.licenceCheck as CheckResult,
    creditCheck: order.creditCheck as CheckResult,
    passed: order.licenceCheck === 'PASS' && order.creditCheck === 'PASS',
    failureReason: order.checkFailureReason,
    checkedAt: order.checkedAt?.toISOString() ?? null,
    outstandingAmount: order.outstandingAmount?.toFixed(2) ?? null,
    creditLimit: order.creditLimit?.toFixed(2) ?? null,
    availableCredit: order.availableCredit?.toFixed(2) ?? null,
    orderAmount: order.orderAmount?.toFixed(2) ?? null,
    creditShortfall: order.creditShortfall?.toFixed(2) ?? null,
    licenceNumber: order.licenceNumber,
    licenceExpiryDate: order.licenceExpiryDate ? toIsoDate(order.licenceExpiryDate) : null,
    licenceDaysToExpiry: order.licenceExpiryDate
      ? Math.round(
          (startOfUtcDay(order.licenceExpiryDate).getTime() - startOfUtcDay(new Date()).getTime()) /
            86_400_000,
        )
      : null,
  };
}

/**
 * The shared item register classifies schedules as NONE | H | H1 | X | G; the
 * Order-to-Cash contract uses the longer statutory spellings. Mapped rather
 * than merged, because the shared register is authoritative and renaming its
 * enum would reach into Procure-to-Pay and Production.
 */
function toScheduleCategory(classification: string): ScheduleCategory {
  switch (classification) {
    case 'H':
      return 'SCHEDULE_H';
    case 'H1':
      return 'SCHEDULE_H1';
    case 'X':
      return 'SCHEDULE_X';
    case 'G':
      return 'SCHEDULE_G';
    default:
      return 'NONE';
  }
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
