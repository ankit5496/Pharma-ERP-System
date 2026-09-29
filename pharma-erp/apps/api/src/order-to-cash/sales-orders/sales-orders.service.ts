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
import { AllocationService } from '../allocation/allocation.service';
import { licencesOnFile } from '../customers/licences-on-file';

import type { CreateSalesOrderDto, UpdateSalesOrderDto } from './dto/sales-order.dto';

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
    // Reused, never reimplemented: the sellable-stock rule and FEFO both live
    // in AllocationService, and a second copy here would be a second answer.
    private readonly allocation: AllocationService,
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
                // The line items, so an order can be found by what is on it.
                { items: { some: { item: { code: { contains: term, mode: 'insensitive' } } } } },
                { items: { some: { item: { name: { contains: term, mode: 'insensitive' } } } } },
                { notes: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { customer: true, createdBy: true, items: { include: { item: true } } },
      orderBy: [{ orderDate: 'desc' }, { orderNumber: 'desc' }],
    });

    const sellerStateCode = await this.sellerStateCode();

    return orders.map((order) => toListItem(order, sellerStateCode));
  }

  /**
   * The tenant's own state, from its GSTIN.
   *
   * Read once per listing rather than per row: it is the same answer for every
   * order, and the register is read over a period.
   */
  private async sellerStateCode(): Promise<string | null> {
    const tenantId = this.tenantContext.requireTenantId();
    const tenant = await this.prisma.scoped.tenant.findFirst({
      where: { id: tenantId },
      select: { gstin: true },
    });

    return tenant?.gstin?.slice(0, 2) ?? null;
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

    return toDetail(order, await this.sellerStateCode());
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

    // ------------------------------------------------------------------
    // Sellable-stock gate, BEFORE anything is written.
    // ------------------------------------------------------------------
    // Refusing here rather than after creating means a rejected order leaves no
    // trace and no number consumed from the sequence. Demand is summed PER ITEM
    // first: two lines for the same product compete for the same batches, and
    // checking them separately would pass a pair that together cannot be filled.
    const demandByItem = new Map<string, Prisma.Decimal>();

    for (const line of dto.items) {
      demandByItem.set(
        line.itemId,
        (demandByItem.get(line.itemId) ?? new Prisma.Decimal(0)).add(
          new Prisma.Decimal(line.quantityOrdered),
        ),
      );
    }

    // Checked CONCURRENTLY. Each item is an independent question, and the
    // database is remote — a sequential loop pays the round trip once per line,
    // which on a ten-line order is most of a second of pure waiting.
    const availability = await Promise.all(
      [...demandByItem].map(async ([itemId, requested]) => ({
        itemId,
        requested,
        available: await this.allocation.availableForItem(itemId),
      })),
    );

    for (const { itemId, requested, available } of availability) {
      if (requested.greaterThan(available)) {
        const item = byId.get(itemId)!;

        throw new BadRequestException(
          `Cannot create order: ${trimQuantity(requested)} units of ${item.code} requested, ` +
            `but only ${trimQuantity(available)} units are currently available from released batches.`,
        );
      }
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

      // Goods value + processing charges = taxable amount, and the charge is
      // taxed with the goods. `subtotal` stays the GOODS value so the figure
      // keeps the meaning every other screen reads it with.
      const processingCharges = new Prisma.Decimal(dto.processingCharges ?? 0);
      const chargeTax = taxOnProcessingCharges(lines, processingCharges);

      return tx.salesOrder.create({
        data: {
          tenantId,
          orderNumber,
          customerId: customer.id,
          orderDate,
          requestedDeliveryDate: deliveryDate,
          customerPoNumber: dto.customerPoNumber?.trim() || null,
          shippingTerms: dto.shippingTerms?.trim() || null,
          insurance: dto.insurance?.trim() || null,
          transportName: dto.transportName?.trim() || null,
          processingCharges,
          status: 'DRAFT',
          totalQuantity: totals.quantity,
          subtotal: totals.subtotal,
          taxAmount: totals.tax.add(chargeTax),
          grandTotal: totals.grand.add(processingCharges).add(chargeTax),
          notes: dto.notes?.trim() || null,
          createdById: userId,
          items: { create: lines },
        },
        select: { id: true },
      });
    });

    // ------------------------------------------------------------------
    // Gate, then allocate. Both reuse the existing services.
    // ------------------------------------------------------------------
    // The licence and credit rules are UNCHANGED and still decide whether the
    // order may proceed — `runCheck` records its verdict exactly as before. An
    // order the gate blocks is left BLOCKED and unallocated, which is the
    // correct outcome rather than a failure to report.
    await this.runCheck(created.id);

    // STOCK IS NOT RESERVED HERE. Creating an order and reserving batches
    // against it are two decisions, and this one is the first: the order lands
    // APPROVED with nothing allocated, appears on the Allocation tab, and the
    // batches are chosen when somebody presses Allocate (FEFO) there.
    //
    // The availability pre-check above still runs, so an order nobody could
    // ever fill is still refused at the point of entry rather than discovered
    // later. What is deferred is the reservation, not the check.

    return this.get(created.id);
  }

  /**
   * Amends a DRAFT order.
   *
   * DRAFT ONLY. An order that has been through the gate carries a recorded
   * verdict, and one that has been allocated has stock reserved against it;
   * editing the lines under either would leave the verdict, or the reservation,
   * describing an order that no longer exists.
   *
   * Replacing the lines RESETS THE GATE to NOT_RUN. The credit check compared a
   * total that has just changed, so keeping its PASS would be asserting
   * something nobody checked.
   */
  async update(id: string, dto: UpdateSalesOrderDto): Promise<SalesOrderDetail> {
    const tenantId = this.tenantContext.requireTenantId();

    const order = await this.prisma.scoped.salesOrder.findFirst({
      where: { id, deletedAt: null },
    });

    if (!order) throw new NotFoundException('Sales order not found.');

    // WHAT MAY BE CHANGED DEPENDS ON WHAT HAS HAPPENED TO THE ORDER.
    //
    // Replacing the LINES is refused once any batch is reserved against them:
    // the reservations point at order lines, and rewriting the lines under
    // live reservations would leave stock held for quantities nobody ordered.
    //
    // Correcting the HEADER — the dates and the note — stays available while
    // the order is still in play, because none of it is what stock was
    // reserved against. A completed or cancelled order is closed to both.
    const settled: SalesOrderStatus[] = ['COMPLETED', 'CANCELLED'];

    if (settled.includes(order.status as SalesOrderStatus)) {
      throw new BadRequestException(
        `This order is ${order.status.toLowerCase()}, so it can no longer be edited.`,
      );
    }

    if (dto.items) {
      const reserved = await this.prisma.scoped.batchAllocation.count({
        where: { salesOrderId: id, status: { not: 'RELEASED_BACK' } },
      });

      if (reserved > 0) {
        throw new BadRequestException(
          'Stock is already reserved against this order, so its lines cannot be replaced. Release the allocation first, or cancel the order and raise a new one.',
        );
      }
    }

    const orderDate = dto.orderDate ? new Date(dto.orderDate) : order.orderDate;
    const deliveryDate = dto.requestedDeliveryDate
      ? new Date(dto.requestedDeliveryDate)
      : order.requestedDeliveryDate;

    if (deliveryDate && deliveryDate < orderDate) {
      throw new BadRequestException('Requested delivery cannot be before the order date.');
    }

    if (!dto.items) {
      await this.prisma.scoped.salesOrder.update({
        where: { id },
        data: {
          orderDate,
          requestedDeliveryDate: deliveryDate,
          ...(dto.notes === undefined ? {} : { notes: dto.notes.trim() || null }),
        },
      });

      return this.get(id);
    }

    const itemIds = [...new Set(dto.items.map((line) => line.itemId))];
    const items = await this.prisma.scoped.item.findMany({
      where: { id: { in: itemIds }, deletedAt: null },
    });

    if (items.length !== itemIds.length) {
      throw new BadRequestException('One or more items on this order do not exist.');
    }

    const byId = new Map(items.map((item) => [item.id, item]));

    await this.prisma.transaction(async (tx) => {
      const lines = dto.items!.map((line, index) => {
        const item = byId.get(line.itemId)!;
        const quantity = new Prisma.Decimal(line.quantityOrdered);
        const unitPrice = line.unitPrice ? new Prisma.Decimal(line.unitPrice) : (item.mrp ?? null);

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
          lineTotal: taxableAmount.add(taxAmount),
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

      // Safe because the order is DRAFT: nothing has been allocated against
      // these lines, so no reservation is orphaned by replacing them.
      await tx.salesOrderItem.deleteMany({ where: { salesOrderId: id } });

      // Unchanged when the caller does not mention it, so amending a date
      // cannot silently drop a charge already agreed.
      const processingCharges =
        dto.processingCharges === undefined
          ? order.processingCharges
          : new Prisma.Decimal(dto.processingCharges);

      const chargeTax = taxOnProcessingCharges(lines, processingCharges);

      await tx.salesOrder.update({
        where: { id },
        data: {
          orderDate,
          requestedDeliveryDate: deliveryDate,
          ...(dto.customerPoNumber === undefined
            ? {}
            : { customerPoNumber: dto.customerPoNumber.trim() || null }),
          ...(dto.shippingTerms === undefined
            ? {}
            : { shippingTerms: dto.shippingTerms.trim() || null }),
          ...(dto.insurance === undefined ? {} : { insurance: dto.insurance.trim() || null }),
          ...(dto.transportName === undefined
            ? {}
            : { transportName: dto.transportName.trim() || null }),
          processingCharges,
          ...(dto.notes === undefined ? {} : { notes: dto.notes.trim() || null }),
          totalQuantity: totals.quantity,
          subtotal: totals.subtotal,
          taxAmount: totals.tax.add(chargeTax),
          grandTotal: totals.grand.add(processingCharges).add(chargeTax),
          // The gate compared a total that has just changed.
          licenceCheck: 'NOT_RUN',
          creditCheck: 'NOT_RUN',
          checkFailureReason: null,
          checkedAt: null,
          outstandingAmount: null,
          creditLimit: null,
          availableCredit: null,
          orderAmount: null,
          creditShortfall: null,
          licenceNumber: null,
          licenceExpiryDate: null,
          items: { create: lines },
        },
      });
    });

    return this.get(id);
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
    // Read through licencesOnFile, so this agrees with the Customers tab: a
    // customer added on the Master Data screen holds their licence on the party
    // record and has no row in the Order-to-Cash register at all.
    const onFile = licencesOnFile(order.customer, order.customer.customerLicences);

    const licences = onFile
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
        onFile.length === 0
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

  /**
   * The number the next order would take, for the form to display.
   *
   * A PEEK, NOT AN ALLOCATION. It reads the sequence without incrementing it,
   * so opening the form does not burn a number — abandoning a half-filled order
   * would otherwise leave a gap in a numbering series that auditors read as a
   * deleted document.
   *
   * It is therefore a PREVIEW: two people with the form open see the same
   * number, and whoever saves first takes it. The real number is allocated
   * inside the create transaction, as it always was.
   */
  async nextNumberPreview(): Promise<{ number: string }> {
    const tenantId = this.tenantContext.requireTenantId();
    const year = new Date().getUTCFullYear();

    const sequence = await this.prisma.scoped.documentSequence.findUnique({
      where: { tenantId_docType_year: { tenantId, docType: 'SO', year } },
      select: { nextValue: true },
    });

    // No row yet means nothing has been numbered this year, and the first
    // document will take 1.
    const value = sequence?.nextValue ?? 1;

    return { number: `SO-${year}-${String(value).padStart(4, '0')}` };
  }
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

type OrderRow = Prisma.SalesOrderGetPayload<{
  include: { customer: true; createdBy: true; items: { include: { item: true } } };
}>;

type OrderDetailRow = Prisma.SalesOrderGetPayload<{
  include: { customer: true; createdBy: true; items: { include: { item: true } } };
}>;

/**
 * @param sellerStateCode The tenant's own state, from its GSTIN. Null when the
 * tenant has no GSTIN recorded, which is treated as intra-state — the same
 * fallback the invoice applies.
 */
function toListItem(order: OrderRow, sellerStateCode: string | null): SalesOrderListItem {
  // Place of supply: the customer's state, falling back to their GSTIN's first
  // two digits. Unknown on either side is intra-state, as at invoicing.
  const placeOfSupply = order.customer.stateCode ?? order.customer.gstin?.slice(0, 2) ?? null;
  const isInterState =
    sellerStateCode !== null && placeOfSupply !== null && sellerStateCode !== placeOfSupply;

  // Split, not recomputed: halving the already-rounded total keeps CGST and
  // SGST summing exactly to it, which is what the invoice does too.
  const cgst = isInterState ? new Prisma.Decimal(0) : order.taxAmount.div(2).toDecimalPlaces(2);
  const sgst = isInterState ? new Prisma.Decimal(0) : order.taxAmount.sub(cgst);
  const igst = isInterState ? order.taxAmount : new Prisma.Decimal(0);

  // Rounding to the rupee, for display. Not stored: the order's grandTotal is
  // the figure of record and is left exactly as it was computed.
  const rounded = order.grandTotal.toDecimalPlaces(0);
  const roundOff = rounded.sub(order.grandTotal);

  const products = order.items.map((line) => line.item.name);
  const productSummary =
    products.length === 0
      ? ''
      : products.length === 1
        ? products[0]!
        : `${products[0]} +${products.length - 1}`;

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
    customerPoNumber: order.customerPoNumber,
    shippingTerms: order.shippingTerms,
    insurance: order.insurance,
    transportName: order.transportName,
    status: order.status as SalesOrderStatus,
    totalQuantity: order.totalQuantity.toFixed(3),
    subtotal: order.subtotal.toFixed(2),
    productSummary,
    cgstAmount: cgst.toFixed(2),
    sgstAmount: sgst.toFixed(2),
    igstAmount: igst.toFixed(2),
    roundOff: roundOff.toFixed(2),
    processingCharges: order.processingCharges.toFixed(2),
    taxAmount: order.taxAmount.toFixed(2),
    grandTotal: order.grandTotal.toFixed(2),
    licenceCheck: order.licenceCheck as CheckResult,
    creditCheck: order.creditCheck as CheckResult,
    checkFailureReason: order.checkFailureReason,
    itemCount: order.items.length,
    notes: order.notes,
    createdByName: order.createdBy?.fullName ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}

function toDetail(order: OrderDetailRow, sellerStateCode: string | null): SalesOrderDetail {
  const items = order.items.map(toItemView);

  return {
    ...toListItem(order as unknown as OrderRow, sellerStateCode),
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

/**
 * Quantities for a human: "20" rather than "20.000", "2.5" kept as "2.5".
 * Formatting for the refusal message only; the stored value is untouched.
 */
function trimQuantity(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(3).toString();
}

/**
 * The tax on an order-level processing charge.
 *
 * WHICH RATE APPLIES IS NOT A NEW DECISION. The charge is spread across the
 * order's lines in proportion to their taxable value and each share is taxed at
 * THAT LINE'S rate — the rate the item master already gave. So an order of 12%
 * and 18% goods taxes the charge partly at each, which is what makes the GST
 * summary add up rather than needing a rate nobody chose.
 *
 * The last share absorbs the rounding remainder, so the shares sum to the
 * charge exactly rather than to a paisa either side of it.
 *
 * A charge on an order whose goods are worth nothing cannot be apportioned at
 * all, and is refused rather than silently untaxed.
 */
function taxOnProcessingCharges(
  lines: readonly { taxableAmount: Prisma.Decimal; gstRatePercent: Prisma.Decimal }[],
  charge: Prisma.Decimal,
): Prisma.Decimal {
  if (charge.isZero()) return new Prisma.Decimal(0);

  const goods = lines.reduce((sum, line) => sum.add(line.taxableAmount), new Prisma.Decimal(0));

  if (goods.isZero()) {
    throw new BadRequestException(
      'Processing charges cannot be taxed on an order whose lines have no value: there is no ' +
        'line to take the GST rate from. Price the lines, or remove the charge.',
    );
  }

  let apportioned = new Prisma.Decimal(0);
  let tax = new Prisma.Decimal(0);

  lines.forEach((line, index) => {
    const last = index === lines.length - 1;
    const share = last
      ? charge.sub(apportioned)
      : charge.mul(line.taxableAmount).div(goods).toDecimalPlaces(2);

    apportioned = apportioned.add(share);
    tax = tax.add(share.mul(line.gstRatePercent).div(100).toDecimalPlaces(2));
  });

  return tax;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
