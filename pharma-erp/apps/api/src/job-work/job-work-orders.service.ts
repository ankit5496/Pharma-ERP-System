import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import {
  INVOICE_BASIS_FOR_BILLING_MODEL,
  STOCK_BUCKET_FOR_BILLING_MODEL,
  type BillingModel,
  type JobWorkOrderablePrincipal,
  type JobWorkOrderableProduct,
  type JobWorkOrderSummary,
} from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../procurement/numbering.service';
import { fromIsoDate, toIsoDate } from '../production/production.mappers';
import { TenantContextService } from '../tenant/tenant-context.service';

import type { CreateJobWorkOrderDto, UpdateJobWorkOrderDto } from './dto/job-work-order.dto';

const ZERO = new Prisma.Decimal(0);

/**
 * Job-work orders — US-JW-01.
 *
 * THE BILLING MODEL IS NEVER AN INPUT. `CreateJobWorkOrderDto` has no field for
 * it, the DTO rejects unknown properties, and this service reads it off the
 * agreement that owns the chosen mapping. Control 3 — "user cannot change it" —
 * is therefore not a check that could be forgotten; there is nothing to check.
 *
 * NEITHER IS THE AGREEMENT. The request names a principal and a mapping; the
 * agreement is whichever one owns that mapping. That is what makes US-JW-01's
 * validations 2 and 3 structural: a product not covered by the agreement has no
 * mapping row to name, and a valid product carrying a different principal's
 * brand belongs to a different agreement, which the principal check then
 * rejects.
 *
 * NO STATUS COLUMN. US-JW-01 lists no status among its fields and US-JW-06 says
 * the register is derived from actual transactions, so progress is counted from
 * receipts, issues and dispatches rather than stored on a flag someone has to
 * remember to advance.
 */
@Injectable()
export class JobWorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly numbering: NumberingService,
  ) {}

  /**
   * Principals that can be ordered against today, with their orderable products.
   *
   * CONTROL 1 AT THE POINT OF CHOOSING. Only agreements in force appear, so the
   * form cannot offer a combination the API will refuse. The refusal still
   * exists in `create` — this is the courtesy, that is the control.
   *
   * An agreement with no mappings is dropped rather than shown empty: there is
   * nothing orderable under it, and a principal whose product list is blank
   * reads as a loading failure.
   */
  async orderable(): Promise<JobWorkOrderablePrincipal[]> {
    const today = new Date().toISOString().slice(0, 10);

    const agreements = await this.prisma.scoped.jobWorkAgreement.findMany({
      where: {
        deletedAt: null,
        // In force, expressed in SQL rather than filtered in memory: an
        // open-ended agreement (no dates at all) is in force, which is why both
        // halves admit null.
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: fromIsoDate(today) } }] },
          { OR: [{ validTo: null }, { validTo: { gte: fromIsoDate(today) } }] },
        ],
      },
      include: {
        principal: { select: { id: true, code: true, name: true, status: true } },
        mappings: {
          include: {
            bom: {
              select: {
                id: true,
                version: true,
                product: { select: { id: true, code: true, name: true, uom: true } },
              },
            },
          },
          orderBy: { principalBrandName: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return agreements
      .filter((agreement) => agreement.mappings.length > 0)
      // A blocked or inactive principal is not someone to take new work from.
      // The party register already makes that distinction; this honours it
      // rather than inventing a second notion of "active".
      .filter((agreement) => agreement.principal.status === 'ACTIVE')
      .map((agreement) => ({
        principalId: agreement.principal.id,
        principalCode: agreement.principal.code,
        principalName: agreement.principal.name,
        agreementId: agreement.id,
        agreementReference: agreement.agreementReference,
        billingModel: agreement.billingModel as BillingModel,
        conversionChargeRate: agreement.conversionChargeRate?.toString() ?? null,
        conversionRateBasis: agreement.conversionRateBasis,
        validFrom: agreement.validFrom ? toIsoDate(agreement.validFrom) : null,
        validTo: agreement.validTo ? toIsoDate(agreement.validTo) : null,
        products: agreement.mappings.map(toOrderableProduct),
      }));
  }

  async list(): Promise<JobWorkOrderSummary[]> {
    const orders = await this.prisma.scoped.jobWorkOrder.findMany({
      where: { deletedAt: null },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(orders.map((order) => this.toSummary(order)));
  }

  async findOne(id: string): Promise<JobWorkOrderSummary> {
    return this.toSummary(await this.requireOrder(id));
  }

  /**
   * Raises an order against an in-force agreement.
   *
   * The whole of US-JW-01's "Important behavior" section happens here rather
   * than on the screen: the agreement is found, the mapping is checked to
   * belong to it, and the billing model is copied off it. The form mirrors all
   * three, but the form is not what makes them true.
   */
  async create(dto: CreateJobWorkOrderDto): Promise<JobWorkOrderSummary> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const quantity = parseQuantity(dto.quantity, 'quantity');

    if (quantity.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException('The quantity ordered has to be more than zero.');
    }

    // CONTROL 2: the mapping has to exist, and has to belong to an agreement
    // held by the principal named. Loaded together so one query answers both.
    const mapping = await this.prisma.scoped.jobWorkProductMapping.findFirst({
      where: { id: dto.mappingId },
      include: {
        agreement: {
          include: { principal: { select: { id: true, code: true, name: true, status: true } } },
        },
        bom: {
          select: {
            id: true,
            version: true,
            isActive: true,
            product: { select: { id: true, code: true, name: true, uom: true } },
          },
        },
      },
    });

    if (!mapping) {
      throw new BadRequestException(
        'That product and brand are not on any job-work agreement. A job-work order can only ' +
          "name a product covered by the principal's agreement.",
      );
    }

    if (mapping.agreement.deletedAt) {
      throw new ConflictException('The agreement covering that product has been retired.');
    }

    // CONTROL 2 again, the half that matters: the mapping exists, but under
    // SOMEONE ELSE'S agreement. Without this, principal A could order principal
    // B's brand by quoting its mapping id.
    if (mapping.agreement.principalId !== dto.principalId) {
      throw new BadRequestException(
        `That product and brand belong to ${mapping.agreement.principal.name}'s agreement, ` +
          'not to the principal named on this order.',
      );
    }

    // CONTROL 1: an agreement out of its validity window is not one to raise
    // new work under. Computed against the server's today so two browsers in
    // different timezones cannot disagree.
    assertAgreementInForce(mapping.agreement.validFrom, mapping.agreement.validTo);

    if (mapping.agreement.principal.status !== 'ACTIVE') {
      throw new ConflictException(
        `${mapping.agreement.principal.name} is ${mapping.agreement.principal.status.toLowerCase()} ` +
          'in the party register, so new job work cannot be accepted from them.',
      );
    }

    const created = await this.prisma.transaction(async (tx) => {
      const orderNumber = await this.numbering.next(tx, tenantId, 'JW');

      const order = await tx.jobWorkOrder.create({
        data: {
          tenantId,
          orderNumber,
          // Read off the agreement, never off the request.
          principalId: mapping.agreement.principalId,
          agreementId: mapping.agreementId,
          mappingId: mapping.id,
          // AUTO-INHERITED. The copy, not a join — see the model comment.
          billingModel: mapping.agreement.billingModel,
          quantity,
          deliveryDate: fromIsoDate(dto.deliveryDate),
          notes: dto.notes?.trim() || null,
          createdById: userId,
        },
      });

      return tx.jobWorkOrder.findFirstOrThrow({
        where: { id: order.id },
        include: ORDER_INCLUDE,
      });
    });

    return this.toSummary(created);
  }

  /**
   * Changes what was asked for — never the terms it was asked on.
   *
   * `quantity`, `deliveryDate` and `notes` are the whole editable surface. The
   * principal, agreement, mapping and billing model are absent from the DTO, so
   * an amendment that changes who is being manufactured for, or on what basis,
   * is a new order rather than an edit of this one.
   */
  async update(id: string, dto: UpdateJobWorkOrderDto): Promise<JobWorkOrderSummary> {
    const order = await this.requireOrder(id);

    const data: Prisma.JobWorkOrderUpdateInput = {};

    if (dto.quantity !== undefined) {
      const quantity = parseQuantity(dto.quantity, 'quantity');

      if (quantity.lessThanOrEqualTo(ZERO)) {
        throw new BadRequestException('The quantity ordered has to be more than zero.');
      }

      // Cutting an order below what has already been sent back would make the
      // register read as over-delivery against an order nobody placed.
      const dispatched = await this.dispatchedQuantity(order.id);

      if (quantity.lessThan(dispatched)) {
        throw new ConflictException(
          `${dispatched.toString()} has already been dispatched against ${order.orderNumber}, ` +
            `so the order cannot be cut to ${quantity.toString()}.`,
        );
      }

      data.quantity = quantity;
    }

    if (dto.deliveryDate !== undefined) data.deliveryDate = fromIsoDate(dto.deliveryDate);
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;

    if (Object.keys(data).length === 0) return this.toSummary(order);

    const updated = await this.prisma.transaction(async (tx) => {
      await tx.jobWorkOrder.update({ where: { id: order.id }, data });

      return tx.jobWorkOrder.findFirstOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
    });

    return this.toSummary(updated);
  }

  /**
   * Withdraws an order that nothing has happened against yet.
   *
   * Soft delete, like every other commercial record here. Refused once material
   * has been received, production raised or goods dispatched: those records
   * point at this order, and a withdrawn order they still reference is a
   * dangling commercial trail rather than a tidy register.
   */
  async remove(id: string): Promise<void> {
    const order = await this.requireOrder(id);

    const [receipts, productions, invoices] = await Promise.all([
      this.prisma.scoped.jobWorkMaterialReceipt.count({
        where: { jobWorkOrderId: order.id, deletedAt: null },
      }),
      this.prisma.scoped.productionOrder.count({
        where: { jobWorkOrderId: order.id, deletedAt: null },
      }),
      this.prisma.scoped.jobWorkInvoice.count({
        where: { jobWorkOrderId: order.id, deletedAt: null },
      }),
    ]);

    if (receipts > 0 || productions > 0 || invoices > 0) {
      const parts = [
        receipts > 0 ? `${receipts} material receipt(s)` : null,
        productions > 0 ? `${productions} work order(s)` : null,
        invoices > 0 ? `${invoices} dispatch(es)` : null,
      ].filter(Boolean);

      throw new ConflictException(
        `${order.orderNumber} cannot be withdrawn: ${parts.join(', ')} already reference it.`,
      );
    }

    await this.prisma.scoped.jobWorkOrder.update({
      where: { id: order.id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * The order, or a 404. Shared with the receipt and dispatch services, which
   * both have to resolve one before they may write.
   */
  async requireOrder(id: string) {
    const order = await this.prisma.scoped.jobWorkOrder.findFirst({
      where: { id, deletedAt: null },
      include: ORDER_INCLUDE,
    });

    if (!order) throw new NotFoundException('That job-work order does not exist.');

    return order;
  }

  /** What has been dispatched against an order so far. */
  private async dispatchedQuantity(jobWorkOrderId: string): Promise<Prisma.Decimal> {
    const sum = await this.prisma.scoped.jobWorkInvoice.aggregate({
      where: { jobWorkOrderId, deletedAt: null },
      _sum: { dispatchedQuantity: true },
    });

    return sum._sum.dispatchedQuantity ?? ZERO;
  }

  /**
   * The order plus its derived progress.
   *
   * Four aggregates rather than four stored counters, for US-JW-06's reason:
   * a figure that is computed cannot drift from the transactions it describes.
   */
  private async toSummary(order: OrderWithRelations): Promise<JobWorkOrderSummary> {
    const [received, consumed, dispatched, productionOrderCount] = await Promise.all([
      this.prisma.scoped.jobWorkMaterialReceipt.aggregate({
        where: { jobWorkOrderId: order.id, deletedAt: null },
        _sum: { receivedQuantity: true },
      }),
      // Consumption is counted off the ISSUE LINES that drew from this order's
      // principal-owned lots — the same rows that answer a recall — rather than
      // off anything stored on the order.
      this.prisma.scoped.materialIssueLine.aggregate({
        where: { lot: { jobWorkMaterialReceipt: { jobWorkOrderId: order.id } } },
        _sum: { quantityIssued: true },
      }),
      this.prisma.scoped.jobWorkInvoice.aggregate({
        where: { jobWorkOrderId: order.id, deletedAt: null },
        _sum: { dispatchedQuantity: true },
      }),
      this.prisma.scoped.productionOrder.count({
        where: { jobWorkOrderId: order.id, deletedAt: null },
      }),
    ]);

    const billingModel = order.billingModel as BillingModel;

    return {
      id: order.id,
      orderNumber: order.orderNumber,

      principalId: order.principalId,
      principalCode: order.principal.code,
      principalName: order.principal.name,

      agreementId: order.agreementId,
      agreementReference: order.agreement.agreementReference,

      billingModel,
      // Both derived from the one value above, and sent so the screen can show
      // the derivation without repeating the rule.
      stockBucket: STOCK_BUCKET_FOR_BILLING_MODEL[billingModel],
      invoiceBasis: INVOICE_BASIS_FOR_BILLING_MODEL[billingModel],

      product: toOrderableProduct(order.mapping),

      quantity: order.quantity.toString(),
      deliveryDate: toIsoDate(order.deliveryDate),
      notes: order.notes,

      createdAt: order.createdAt.toISOString(),
      createdBy: order.createdBy?.fullName ?? null,

      materialReceivedQuantity: (received._sum.receivedQuantity ?? ZERO).toString(),
      materialConsumedQuantity: (consumed._sum.quantityIssued ?? ZERO).toString(),
      dispatchedQuantity: (dispatched._sum.dispatchedQuantity ?? ZERO).toString(),
      productionOrderCount,
    };
  }
}

// -----------------------------------------------------------------------------
// Shapes and helpers
// -----------------------------------------------------------------------------

const MAPPING_INCLUDE = {
  bom: {
    select: {
      id: true,
      version: true,
      product: { select: { id: true, code: true, name: true, uom: true } },
    },
  },
} satisfies Prisma.JobWorkProductMappingInclude;

export const ORDER_INCLUDE = {
  principal: { select: { id: true, code: true, name: true } },
  agreement: {
    select: {
      id: true,
      agreementReference: true,
      billingModel: true,
      conversionChargeRate: true,
      conversionRateBasis: true,
    },
  },
  mapping: { include: MAPPING_INCLUDE },
  createdBy: { select: { fullName: true } },
} satisfies Prisma.JobWorkOrderInclude;

export type OrderWithRelations = Prisma.JobWorkOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

type MappingWithBom = Prisma.JobWorkProductMappingGetPayload<{ include: typeof MAPPING_INCLUDE }>;

function toOrderableProduct(mapping: MappingWithBom): JobWorkOrderableProduct {
  return {
    mappingId: mapping.id,
    bomId: mapping.bomId,
    bomVersion: mapping.bom.version,
    productId: mapping.bom.product.id,
    productCode: mapping.bom.product.code,
    productName: mapping.bom.product.name,
    principalBrandName: mapping.principalBrandName,
    packDesignRef: mapping.packDesignRef,
    uom: mapping.bom.product.uom,
  };
}

/**
 * CONTROL 1, stated once.
 *
 * "An ACTIVE Job-Work Agreement" is read as one inside its validity window —
 * the same definition `agreementStatus` in job-work.service.ts uses for the
 * register's IN_FORCE badge, so the badge and the refusal cannot disagree.
 * No dates at all is in force: an open-ended arrangement is a real thing.
 */
export function assertAgreementInForce(validFrom: Date | null, validTo: Date | null): void {
  const today = new Date().toISOString().slice(0, 10);

  if (validFrom && toIsoDate(validFrom) > today) {
    throw new ConflictException(
      `That agreement does not start until ${toIsoDate(validFrom)}, so no job-work order can be ` +
        'raised under it yet.',
    );
  }

  if (validTo && toIsoDate(validTo) < today) {
    throw new ConflictException(
      `That agreement expired on ${toIsoDate(validTo)}. Renew it before raising further job-work ` +
        'orders against it.',
    );
  }
}

/** A decimal from the wire, or a message naming the field that was wrong. */
export function parseQuantity(value: string, field: string): Prisma.Decimal {
  try {
    const decimal = new Prisma.Decimal(value);

    if (!decimal.isFinite()) throw new Error('not finite');

    return decimal;
  } catch {
    throw new BadRequestException(`${field} is not a number.`);
  }
}
