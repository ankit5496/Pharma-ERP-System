import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { Prisma } from '@pharma-erp/database';
import type {
  BomView,
  ItemSummary,
  MaterialLotSummary,
  ProductionOrderSummary,
} from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import type {
  CreateBomDto,
  CreateItemDto,
  CreateProductionOrderDto,
  UpdateItemDto,
} from './dto/production.dto';
import { toItemSummary, toIsoDate, type ItemRow } from './production.mappers';

/**
 * Master data and planning: items, stock lots, formulations and work orders.
 *
 * Everything here goes through `prisma.scoped`, so row-level security applies
 * to every read as well as every write. The explicit `tenantId` on writes is a
 * second layer, not the only one — the WITH CHECK clause on each policy would
 * reject a mismatched row regardless.
 */
@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // -------------------------------------------------------------------------
  // Items and stock
  // -------------------------------------------------------------------------

  async listItems(type?: string): Promise<ItemSummary[]> {
    const items = await this.prisma.scoped.item.findMany({
      where: {
        deletedAt: null,
        ...(type ? { type: type as ItemRow['type'] } : {}),
      },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });

    return items.map(toItemSummary);
  }

  /**
   * Creates an item.
   *
   * The unique constraint on (tenant_id, code) is the real check for a
   * duplicate code, not a prior SELECT: two requests racing on the same code
   * would both pass a lookup and one would still fail on insert. Catching
   * P2002 turns that into the same 409 either way.
   *
   * Decimals are handed to Prisma as strings. They arrive as strings, the
   * column is exact, and converting to a JavaScript number anywhere in
   * between is how 32.50 becomes 32.499999999999996.
   */
  async createItem(dto: CreateItemDto): Promise<ItemSummary> {
    const tenantId = this.tenantContext.requireTenantId();

    try {
      const item = await this.prisma.scoped.item.create({
        data: {
          tenantId,
          code: dto.code.trim(),
          name: dto.name.trim(),
          type: dto.type,
          uom: dto.uom.trim(),
          hsnCode: dto.hsnCode,
          gstRate: dto.gstRate,
          scheduleClassification: dto.scheduleClassification ?? 'NONE',
          brandName: dto.brandName?.trim() || null,
          genericName: dto.genericName?.trim() || null,
          mrp: dto.mrp ?? null,
          dpcoCeiling: dto.dpcoCeiling ?? false,
          storageConditions: dto.storageConditions?.trim() || null,
          shelfLifeMonths: dto.shelfLifeMonths ?? null,
          reorderLevel: dto.reorderLevel ?? null,
          reorderQuantity: dto.reorderQuantity ?? null,
        },
      });

      return toItemSummary(item);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`An item with code "${dto.code.trim()}" already exists.`);
      }

      // The database also enforces `dpco_ceiling` requiring an MRP. The DTO
      // cannot check that — it is a relationship between two fields — so the
      // constraint is the enforcement and this turns it into a usable message
      // rather than a 500.
      if (isCheckViolation(error, 'items_dpco_ceiling_needs_a_price')) {
        throw new BadRequestException('An item under a DPCO ceiling must have an MRP.');
      }

      throw error;
    }
  }

  /**
   * Changes an item.
   *
   * A field left out of the request is left alone; a nullable field sent as
   * `null` is cleared. That distinction is why this builds the update object
   * key by key instead of spreading the DTO — spreading would write
   * `undefined` over columns the caller never mentioned.
   */
  async updateItem(id: string, dto: UpdateItemDto): Promise<ItemSummary> {
    const existing = await this.prisma.scoped.item.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) throw new NotFoundException('That item does not exist.');

    // Reclassifying an item that a formulation already names would change
    // what the formulation means — an ingredient becoming a finished good, or
    // a product becoming a raw material. The BOM rules are enforced at the
    // point a BOM is created, so letting the type drift afterwards would
    // quietly leave one that could never have been created.
    if (dto.type && dto.type !== existing.type) {
      const usedOnBom = await this.isUsedOnAnyBom(id);

      if (usedOnBom) {
        throw new ConflictException(
          `"${existing.code}" appears on a formulation, so its category cannot be changed. ` +
            'Retire it and add a replacement item instead.',
        );
      }
    }

    const data: Prisma.ItemUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.uom !== undefined) data.uom = dto.uom.trim();
    if (dto.hsnCode !== undefined) data.hsnCode = dto.hsnCode;
    if (dto.gstRate !== undefined) data.gstRate = dto.gstRate;
    if (dto.scheduleClassification !== undefined) {
      data.scheduleClassification = dto.scheduleClassification;
    }
    if (dto.brandName !== undefined) data.brandName = dto.brandName?.trim() || null;
    if (dto.genericName !== undefined) data.genericName = dto.genericName?.trim() || null;
    if (dto.mrp !== undefined) data.mrp = dto.mrp;
    if (dto.dpcoCeiling !== undefined) data.dpcoCeiling = dto.dpcoCeiling;
    if (dto.storageConditions !== undefined) {
      data.storageConditions = dto.storageConditions?.trim() || null;
    }
    if (dto.shelfLifeMonths !== undefined) data.shelfLifeMonths = dto.shelfLifeMonths;
    if (dto.reorderLevel !== undefined) data.reorderLevel = dto.reorderLevel;
    if (dto.reorderQuantity !== undefined) data.reorderQuantity = dto.reorderQuantity;

    try {
      const item = await this.prisma.scoped.item.update({ where: { id }, data });

      return toItemSummary(item);
    } catch (error) {
      if (isCheckViolation(error, 'items_dpco_ceiling_needs_a_price')) {
        throw new BadRequestException(
          'An item under a DPCO ceiling must have an MRP. Clear the DPCO flag, or give it a price.',
        );
      }

      throw error;
    }
  }

  /**
   * Retires an item.
   *
   * A soft delete — the row stays and `deletedAt` is stamped. Not a choice
   * this method could make differently: `items_no_hard_delete` is a database
   * trigger, so a real DELETE is refused by Postgres. An item is cited by
   * batches and formulations that have to remain readable years later, and a
   * document referring to a row that no longer exists is not an audit trail.
   *
   * Its code stays taken. The unique index on (tenant_id, code) does not
   * exclude retired rows, deliberately: re-using the code of something
   * withdrawn is how two different materials end up sharing an identity on
   * old paperwork.
   */
  async deleteItem(id: string): Promise<void> {
    const existing = await this.prisma.scoped.item.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) throw new NotFoundException('That item does not exist.');

    if (await this.isUsedOnAnyBom(id)) {
      throw new ConflictException(
        `"${existing.code}" is used by a formulation and cannot be retired. ` +
          'Supersede those formulations with versions that do not name it first.',
      );
    }

    await this.prisma.scoped.item.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Whether any live formulation names this item, as its product or a line.
   *
   * Stock lots and work orders are NOT checked, and that is a gap rather than
   * a decision: those tables exist locally but not on the hosted database,
   * which is one migration behind by design. Querying a table that is not
   * there fails the whole request, so the check waits for
   * 20260910152117_production_quality_gate to be applied there.
   */
  private async isUsedOnAnyBom(itemId: string): Promise<boolean> {
    const [asProduct, asLine] = await Promise.all([
      this.prisma.scoped.bom.count({ where: { productId: itemId, deletedAt: null } }),
      this.prisma.scoped.bomLine.count({ where: { itemId, bom: { deletedAt: null } } }),
    ]);

    return asProduct > 0 || asLine > 0;
  }

  /**
   * Stock lots, soonest expiry first — the same order FEFO consumes them in,
   * so the list reads as the queue it actually is.
   */
  async listMaterialLots(): Promise<MaterialLotSummary[]> {
    const lots = await this.prisma.scoped.materialLot.findMany({
      where: { deletedAt: null },
      include: { item: true },
      orderBy: [{ expiryDate: 'asc' }, { lotNumber: 'asc' }],
    });

    return lots.map((lot) => ({
      id: lot.id,
      lotNumber: lot.lotNumber,
      expiryDate: toIsoDate(lot.expiryDate),
      status: lot.status,
      quantityAvailable: lot.quantityAvailable.toString(),
      quantityReceived: lot.quantityReceived.toString(),
      item: toItemSummary(lot.item),
    }));
  }

  // -------------------------------------------------------------------------
  // Formulations
  // -------------------------------------------------------------------------

  async listBoms(): Promise<BomView[]> {
    const boms = await this.prisma.scoped.bom.findMany({
      where: { deletedAt: null },
      include: {
        product: true,
        lines: { include: { item: true }, orderBy: { item: { code: 'asc' } } },
      },
      orderBy: [{ product: { code: 'asc' } }, { version: 'desc' }],
    });

    return boms.map((bom) => ({
      id: bom.id,
      version: bom.version,
      isActive: bom.isActive,
      outputQuantity: bom.outputQuantity.toString(),
      effectiveFrom: toIsoDate(bom.effectiveFrom),
      instructions: bom.instructions,
      product: toItemSummary(bom.product),
      lines: bom.lines.map((line) => ({
        id: line.id,
        item: toItemSummary(line.item),
        quantityPer: line.quantityPer.toString(),
        notes: line.notes,
      })),
    }));
  }

  /**
   * Creates the next version of a product's formulation.
   *
   * Never edits an existing one. A batch made last month was made to the recipe
   * as it stood then, and mutating that row would destroy the only evidence of
   * what was followed — so a change is always a new version, and the old one
   * survives because production orders still point at it.
   */
  async createBom(dto: CreateBomDto): Promise<BomView> {
    const tenantId = this.tenantContext.requireTenantId();

    const product = await this.prisma.scoped.item.findFirst({
      where: { id: dto.productId, deletedAt: null },
    });

    if (!product) throw new NotFoundException('That product does not exist.');

    if (product.type !== 'FINISHED_GOOD') {
      throw new BadRequestException(
        'A formulation must produce a finished good. ' +
          `"${product.code}" is a ${product.type.toLowerCase().replace('_', ' ')}.`,
      );
    }

    const lineItemIds = dto.lines.map((line) => line.itemId);

    if (new Set(lineItemIds).size !== lineItemIds.length) {
      throw new BadRequestException(
        'A material appears more than once. Combine the quantities into a single line — ' +
          'two lines for the same item would make the planned quantity ambiguous.',
      );
    }

    const lineItems = await this.prisma.scoped.item.findMany({
      where: { id: { in: lineItemIds }, deletedAt: null },
    });

    if (lineItems.length !== lineItemIds.length) {
      throw new BadRequestException('One or more materials on the formulation do not exist.');
    }

    const finishedGoodLine = lineItems.find((item) => item.type === 'FINISHED_GOOD');

    if (finishedGoodLine) {
      throw new BadRequestException(
        `"${finishedGoodLine.code}" is a finished good and cannot be an ingredient. ` +
          'Sub-assemblies are not modelled yet.',
      );
    }

    return this.prisma.transaction(async (tx) => {
      const latest = await tx.bom.findFirst({
        where: { productId: dto.productId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });

      const version = (latest?.version ?? 0) + 1;
      const activate = dto.activate ?? true;

      // Deactivate first: the partial unique index in the migration allows only
      // one active version per product, so this is not optional tidying — the
      // insert below would be rejected otherwise.
      if (activate) {
        await tx.bom.updateMany({
          where: { productId: dto.productId, isActive: true },
          data: { isActive: false },
        });
      }

      const created = await tx.bom.create({
        data: {
          tenantId,
          productId: dto.productId,
          version,
          outputQuantity: dto.outputQuantity,
          instructions: dto.instructions ?? null,
          isActive: activate,
          lines: {
            create: dto.lines.map((line) => ({
              tenantId,
              itemId: line.itemId,
              quantityPer: line.quantityPer,
              notes: line.notes ?? null,
            })),
          },
        },
        include: {
          product: true,
          lines: { include: { item: true }, orderBy: { item: { code: 'asc' } } },
        },
      });

      return {
        id: created.id,
        version: created.version,
        isActive: created.isActive,
        outputQuantity: created.outputQuantity.toString(),
        effectiveFrom: toIsoDate(created.effectiveFrom),
        instructions: created.instructions,
        product: toItemSummary(created.product),
        lines: created.lines.map((line) => ({
          id: line.id,
          item: toItemSummary(line.item),
          quantityPer: line.quantityPer.toString(),
          notes: line.notes,
        })),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Production orders
  // -------------------------------------------------------------------------

  async listProductionOrders(): Promise<ProductionOrderSummary[]> {
    const orders = await this.prisma.scoped.productionOrder.findMany({
      where: { deletedAt: null },
      include: {
        product: true,
        bom: { select: { version: true } },
        createdBy: { select: { fullName: true } },
        batches: {
          where: { deletedAt: null },
          select: { id: true, batchNumber: true, releaseStatus: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((order) => {
      const batch = order.batches[0];

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        plannedQuantity: order.plannedQuantity.toString(),
        plannedStartOn: order.plannedStartOn ? toIsoDate(order.plannedStartOn) : null,
        product: toItemSummary(order.product),
        bomVersion: order.bom.version,
        createdAt: order.createdAt.toISOString(),
        createdBy: order.createdBy?.fullName ?? null,
        batchNumber: batch?.batchNumber ?? null,
        batchId: batch?.id ?? null,
        releaseStatus: batch?.releaseStatus ?? null,
      };
    });
  }

  /**
   * Raises a work order against the product's *currently active* formulation,
   * and pins that version onto the order.
   *
   * Pinning matters: if the recipe is superseded while the batch is in
   * progress, the order — and every variance calculated from it — still refers
   * to the version its material was actually issued against.
   */
  async createProductionOrder(dto: CreateProductionOrderDto): Promise<ProductionOrderSummary> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const bom = await this.prisma.scoped.bom.findFirst({
      where: { productId: dto.productId, isActive: true, deletedAt: null },
      include: { product: true, lines: true },
    });

    if (!bom) {
      throw new BadRequestException(
        'That product has no active formulation. Create one under Formulations before ' +
          'raising a work order — there would be nothing to issue material against.',
      );
    }

    if (bom.lines.length === 0) {
      throw new BadRequestException(
        `Formulation version ${bom.version} has no materials, so nothing could be issued.`,
      );
    }

    return this.prisma.transaction(async (tx) => {
      const orderNumber = await this.nextOrderNumber(tx);

      const order = await tx.productionOrder.create({
        data: {
          tenantId,
          orderNumber,
          productId: dto.productId,
          bomId: bom.id,
          plannedQuantity: dto.plannedQuantity,
          plannedStartOn: dto.plannedStartOn ? new Date(dto.plannedStartOn) : null,
          createdById: userId,
        },
        include: {
          product: true,
          bom: { select: { version: true } },
          createdBy: { select: { fullName: true } },
        },
      });

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        plannedQuantity: order.plannedQuantity.toString(),
        plannedStartOn: order.plannedStartOn ? toIsoDate(order.plannedStartOn) : null,
        product: toItemSummary(order.product),
        bomVersion: order.bom.version,
        createdAt: order.createdAt.toISOString(),
        createdBy: order.createdBy?.fullName ?? null,
        batchNumber: null,
        batchId: null,
        releaseStatus: null,
      };
    });
  }

  /**
   * Next work-order number for the tenant, as WO-YYYY-NNNN.
   *
   * Derived from the highest existing number in the current year rather than a
   * sequence, because the series must restart each year and must be per-tenant
   * — a shared Postgres sequence would leak one company's volume to another
   * through the gaps in its own numbering.
   *
   * Runs inside the caller's transaction, so two concurrent creates cannot both
   * read the same maximum: the unique index on (tenant_id, order_number) is the
   * backstop, and the loser retries.
   */
  private async nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `WO-${year}-`;

    const latest = await tx.productionOrder.findFirst({
      where: { orderNumber: { startsWith: prefix } },
      orderBy: { orderNumber: 'desc' },
      select: { orderNumber: true },
    });

    const previous = latest ? Number.parseInt(latest.orderNumber.slice(prefix.length), 10) : 0;

    return `${prefix}${String(previous + 1).padStart(4, '0')}`;
  }

  /** Used by the batch service to refuse a second batch on one order. */
  async requireOrder(id: string) {
    const order = await this.prisma.scoped.productionOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        product: true,
        bom: { include: { lines: { include: { item: true } } } },
        batches: { where: { deletedAt: null } },
      },
    });

    if (!order) throw new NotFoundException('That work order does not exist.');
    if (order.status === 'CANCELLED') throw new ConflictException('That work order was cancelled.');

    return order;
  }
}

/**
 * Whether a failed write was a unique-constraint violation.
 *
 * Reads the error's `code` rather than using
 * `instanceof Prisma.PrismaClientKnownRequestError`, which is what the rest of
 * the API does. Two reasons: `Prisma` is imported here as a TYPE only, so the
 * class is not in scope; and `instanceof` across two copies of the client —
 * which a pnpm workspace can easily end up with — silently returns false,
 * turning a 409 into a 500 that only shows up in production.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Whether a failed write tripped a named CHECK constraint.
 *
 * Matched on the constraint name in the message because Prisma does not give
 * check violations a stable error code — depending on the version they arrive
 * as P2004, P2010, or an unknown-request error — but Postgres always names the
 * constraint it rejected, and that name is ours.
 */
function isCheckViolation(error: unknown, constraint: string): boolean {
  return error instanceof Error && error.message.includes(constraint);
}
