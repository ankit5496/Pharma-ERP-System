import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

// A value import, not `import type`: Prisma.Decimal is constructed below.
import { Prisma } from '@pharma-erp/database';
import type {
  BomView,
  ItemSummary,
  ProductionStockLot,
  ProductionOrderSummary,
  WorkOrderFeasibility,
} from '@pharma-erp/types';

import { fieldBadRequest, fieldConflict } from '../common/field-error';
import { JobWorkOrdersService } from '../job-work/job-work-orders.service';
import { PackagingService } from '../packaging/packaging.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import type {
  CreateBomDto,
  CreateItemDto,
  CreateProductionOrderDto,
  UpdateBomDto,
  UpdateItemDto,
} from './dto/production.dto';
import {
  describeBucket,
  stockBucketFor,
  stockBucketWhere,
  type StockBucketRule,
} from './job-work-tagging';
import {
  issuableStockWhere,
  toItemSummary,
  toIsoDate,
  type ItemRow,
} from './production.mappers';

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
    /** US-MD-06's work-order gate; see createProductionOrder. */
    private readonly packaging: PackagingService,
    /** US-JW-03: resolving the job-work order a batch is being made against. */
    private readonly jobWorkOrders: JobWorkOrdersService,
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
        throw fieldConflict('code', `An item with code "${dto.code.trim()}" already exists.`);
      }

      // The database also enforces `dpco_ceiling` requiring an MRP. The DTO
      // cannot check that — it is a relationship between two fields — so the
      // constraint is the enforcement and this turns it into a usable message
      // rather than a 500.
      if (isCheckViolation(error, 'items_dpco_ceiling_needs_a_price')) {
        // Against `mrp`, not `dpcoCeiling`: the ceiling is the thing being
        // asserted and the price is the thing missing, so the price is what
        // the person has to go and type.
        throw fieldBadRequest('mrp', 'An item under a DPCO ceiling must have an MRP.');
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
        throw fieldBadRequest(
          'mrp',
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
   * Stock on hand, soonest expiry first — the same order FEFO consumes it in,
   * so the list reads as the queue it actually is.
   *
   * Reads `stock_lots`: the lots Procure-to-Pay received and incoming QC
   * ruled on. Production has no stock table of its own, which is the point —
   * a second one would let the shop floor issue material the goods-in gate
   * never passed.
   *
   * Nulls last, because a lot with no expiry never becomes urgent and sorting
   * it to the top would put cartons above an API three weeks from expiring.
   * CONSUMED lots are left out: they are drawn fully down and issuing against
   * one is impossible, so they are history rather than stock.
   */
  async listStockLots(): Promise<ProductionStockLot[]> {
    const lots = await this.prisma.scoped.stockLot.findMany({
      where: { status: { not: 'CONSUMED' } },
      include: { item: true },
      orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { lotNumber: 'asc' }],
    });

    return lots.map((lot) => ({
      id: lot.id,
      lotNumber: lot.lotNumber,
      expiryDate: lot.expiryDate ? toIsoDate(lot.expiryDate) : null,
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
  /**
   * A formulation's output quantity is the DENOMINATOR of every scaling ratio
   * in this module, so zero is not merely invalid — it is a division by zero.
   *
   * Decimal.js does not throw on that; it returns Infinity, which then travels
   * as the string "Infinity" into a shortage message and onto the screen. The
   * order is refused either way, so this fails safe, but it fails safe with a
   * message nobody can act on. The QUANTITY regex cannot catch it: it bounds
   * the shape of a decimal, not its value.
   */
  private requirePositiveOutput(outputQuantity: string): void {
    if (new Prisma.Decimal(outputQuantity).lessThanOrEqualTo(0)) {
      throw fieldBadRequest(
        'outputQuantity',
        'A formulation must state how much it makes, as a quantity greater than zero. ' +
          'Every material requirement is scaled against it.',
      );
    }
  }

  async createBom(dto: CreateBomDto): Promise<BomView> {
    this.requirePositiveOutput(dto.outputQuantity);

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

  /**
   * Rewrites a formulation in place — US-MD-03's edit path.
   *
   * WHY THIS IS NARROW. Superseding with a new version is the normal way to
   * change a recipe, and it is what `createBom` does: v1 stays exactly as it
   * was, v2 carries the change, and a batch made in March still names the
   * recipe it was actually made from. An in-place edit throws that away — the
   * row a past batch points at simply becomes different.
   *
   * So this refuses as soon as the formulation has been USED. A work order
   * against it, a job-work brand mapping citing it, or a production plan built
   * on it all mean something downstream has already been decided on these
   * numbers, and quietly changing them underneath would make those documents
   * describe a recipe that never existed. Before any of that, a formulation is
   * still a draft and correcting a typo in it loses nothing.
   *
   * Lines are replaced wholesale rather than diffed. A BOM line has no identity
   * anyone refers to — no document cites "line 3" — so matching them up would
   * be effort spent producing the same result.
   */
  async updateBom(id: string, dto: UpdateBomDto): Promise<BomView> {
    const tenantId = this.tenantContext.requireTenantId();

    this.requirePositiveOutput(dto.outputQuantity);

    const existing = await this.prisma.scoped.bom.findFirst({
      where: { id, deletedAt: null },
      include: { product: true },
    });

    if (!existing) throw new NotFoundException('That formulation does not exist.');

    const [orders, mappings, plans] = await Promise.all([
      this.prisma.scoped.productionOrder.count({ where: { bomId: id, deletedAt: null } }),
      this.prisma.scoped.jobWorkProductMapping.count({ where: { bomId: id } }),
      this.prisma.scoped.productionPlan.count({ where: { bomId: id, deletedAt: null } }),
    ]);

    if (orders > 0 || mappings > 0 || plans > 0) {
      const used = [
        orders > 0 ? `${orders} work order${orders === 1 ? '' : 's'}` : null,
        mappings > 0 ? `${mappings} brand mapping${mappings === 1 ? '' : 's'}` : null,
        plans > 0 ? `${plans} production plan${plans === 1 ? '' : 's'}` : null,
      ]
        .filter(Boolean)
        .join(', ');

      throw new ConflictException(
        `Formulation v${existing.version} of ${existing.product.code} cannot be edited: ` +
          `${used} already reference it. Changing it now would alter the recipe those ` +
          'documents were built on. Save a new version instead — the old one stays on record.',
      );
    }

    await this.assertBomLinesAreUsable(existing.productId, dto.lines);

    return this.prisma.transaction(async (tx) => {
      await tx.bom.update({
        where: { id },
        data: {
          outputQuantity: dto.outputQuantity,
          instructions: dto.instructions?.trim() || null,
        },
      });

      // Replaced, not diffed; see the note above. Deleting first keeps the
      // unique (bom_id, item_id) index satisfied when lines are reordered.
      await tx.bomLine.deleteMany({ where: { bomId: id } });

      await tx.bomLine.createMany({
        data: dto.lines.map((line) => ({
          tenantId,
          bomId: id,
          itemId: line.itemId,
          quantityPer: line.quantityPer,
          notes: line.notes?.trim() || null,
        })),
      });

      const saved = await tx.bom.findUniqueOrThrow({
        where: { id },
        include: {
          product: true,
          lines: { include: { item: true }, orderBy: { item: { code: 'asc' } } },
        },
      });

      return {
        id: saved.id,
        version: saved.version,
        isActive: saved.isActive,
        outputQuantity: saved.outputQuantity.toString(),
        effectiveFrom: toIsoDate(saved.effectiveFrom),
        instructions: saved.instructions,
        product: toItemSummary(saved.product),
        lines: saved.lines.map((line) => ({
          id: line.id,
          item: toItemSummary(line.item),
          quantityPer: line.quantityPer.toString(),
          notes: line.notes,
        })),
      };
    });
  }

  /**
   * The line rules `createBom` applies, shared so an edit cannot accept a
   * formulation that could never have been created.
   */
  private async assertBomLinesAreUsable(
    productId: string,
    lines: readonly { itemId: string }[],
  ): Promise<void> {
    const lineItemIds = lines.map((line) => line.itemId);

    if (new Set(lineItemIds).size !== lineItemIds.length) {
      throw new BadRequestException(
        'A material appears more than once. Combine the quantities into a single line — ' +
          'two lines for the same item would make the planned quantity ambiguous.',
      );
    }

    if (lineItemIds.includes(productId)) {
      throw new BadRequestException('A formulation cannot use its own product as an ingredient.');
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
  }

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
  /**
   * Whether a batch could be raised, and what it would consume — US-PROD-01.
   *
   * The same three gates `createProductionOrder` applies, asked without writing
   * anything: an active formulation, an active pack specification, and enough
   * usable stock. Deliberately the same code path for the stock arithmetic, so
   * the grid on the form and the refusal on the save cannot disagree.
   */
  async workOrderFeasibility(
    productId: string,
    batchQuantity: string,
  ): Promise<WorkOrderFeasibility> {
    const product = await this.prisma.scoped.item.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, code: true, name: true },
    });

    if (!product) throw new NotFoundException('That product does not exist.');

    const quantity = new Prisma.Decimal(batchQuantity);

    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('A batch quantity must be greater than zero.');
    }

    const base = {
      productId: product.id,
      productCode: product.code,
      productName: product.name,
      batchQuantity: quantity.toDecimalPlaces(3).toString(),
    };

    const bom = await this.prisma.scoped.bom.findFirst({
      where: { productId, isActive: true, deletedAt: null },
      include: { lines: true },
    });

    if (!bom || bom.lines.length === 0) {
      return {
        ...base,
        bomVersion: bom?.version ?? 0,
        canRaise: false,
        lines: [],
        blockedReason: bom
          ? `Formulation version ${bom.version} has no materials, so nothing could be issued.`
          : 'This product has no active formulation. Create one under Formulations first.',
      };
    }

    if (!(await this.packaging.hasActiveRequirement(productId))) {
      return {
        ...base,
        bomVersion: bom.version,
        canRaise: false,
        lines: [],
        blockedReason:
          'This product has no active packaging requirement. Add one under Packaging ' +
          'Requirement first — the batch would reach the packing line with no pack ' +
          'specification to work to.',
      };
    }

    const scale = quantity.div(bom.outputQuantity);
    const itemIds = bom.lines.map((line) => line.itemId);

    const [items, grouped] = await Promise.all([
      this.prisma.scoped.item.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, code: true, name: true, uom: true },
      }),
      this.prisma.scoped.stockLot.groupBy({
        by: ['itemId'],
        // Same definition as the gate and the allocator; see issuableStockWhere.
        where: { itemId: { in: itemIds }, ...issuableStockWhere() },
        _sum: { quantityAvailable: true },
      }),
    ]);

    const detailsById = new Map(items.map((item) => [item.id, item]));
    const availableById = new Map(
      grouped.map((row) => [row.itemId, row._sum.quantityAvailable ?? new Prisma.Decimal(0)]),
    );

    const lines = bom.lines.map((line) => {
      const details = detailsById.get(line.itemId);
      const required = new Prisma.Decimal(line.quantityPer).mul(scale).toDecimalPlaces(3);
      const available = new Prisma.Decimal(availableById.get(line.itemId) ?? 0).toDecimalPlaces(3);
      const short = Prisma.Decimal.max(required.sub(available), new Prisma.Decimal(0));

      return {
        itemId: line.itemId,
        code: details?.code ?? line.itemId,
        name: details?.name ?? '',
        uom: details?.uom ?? '',
        required: required.toString(),
        available: available.toString(),
        short: short.toDecimalPlaces(3).toString(),
        isShort: short.greaterThan(0),
      };
    });

    return {
      ...base,
      bomVersion: bom.version,
      canRaise: !lines.some((line) => line.isShort),
      lines,
      blockedReason: null,
    };
  }

  /**
   * Which materials a batch of `plannedQuantity` would be short of — US-PROD-01.
   *
   * Scaled by the same ratio MaterialIssueService uses: a BOM states quantities
   * against its own output quantity, so this is a ratio rather than a
   * multiplication by the order size.
   *
   * Availability is the sum of USABLE stock per item — one grouped aggregate
   * for every material at once, not a query per line. Quarantined and rejected
   * lots are excluded, which is the whole point: material that has not passed
   * incoming QC is not available to production however much of it is on the
   * floor.
   *
   * Returns the shortfalls, empty when there are none, so the caller decides
   * whether that is a refusal or something to render.
   */
  async materialShortages(
    bom: {
      outputQuantity: Prisma.Decimal;
      lines: { itemId: string; quantityPer: Prisma.Decimal }[];
    },
    plannedQuantity: string,
    /**
     * Which bucket counts — US-JW-03.
     *
     * Defaults to company-owned, so every existing caller keeps its meaning.
     * Under PURE_CONVERSION the question "is there enough" has to be asked of
     * the PRINCIPAL'S material: counting our own stock here would pass a work
     * order that the material issue then refuses, which is the worst of both.
     */
    bucket: StockBucketRule = { ownership: 'COMPANY_OWNED', jobWorkOrderId: null },
  ): Promise<
    {
      itemId: string;
      code: string;
      uom: string;
      required: string;
      available: string;
      short: string;
    }[]
  > {
    if (bom.lines.length === 0) return [];

    const scale = new Prisma.Decimal(plannedQuantity).div(bom.outputQuantity);
    const itemIds = bom.lines.map((line) => line.itemId);

    const [items, grouped] = await Promise.all([
      this.prisma.scoped.item.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, code: true, uom: true },
      }),
      this.prisma.scoped.stockLot.groupBy({
        by: ['itemId'],
        // WHAT counts: the SAME definition the FEFO allocator dispenses
        // against. See issuableStockWhere — these two used to disagree about
        // expired lots, and the gate was refusing and permitting on different
        // numbers from the ones the store could actually draw.
        //
        // WHOSE counts: the job-work bucket. Under PURE_CONVERSION the question
        // "is there enough" has to be asked of the PRINCIPAL'S material, or a
        // work order passes here and the material issue then refuses it — which
        // is the same class of mismatch the comment above describes.
        where: {
          itemId: { in: itemIds },
          ...issuableStockWhere(),
          ...stockBucketWhere(bucket),
        },
        _sum: { quantityAvailable: true },
      }),
    ]);

    const detailsById = new Map(items.map((item) => [item.id, item]));
    const availableById = new Map(
      grouped.map((row) => [row.itemId, row._sum.quantityAvailable ?? new Prisma.Decimal(0)]),
    );

    const shortages = [];

    for (const line of bom.lines) {
      const required = new Prisma.Decimal(line.quantityPer).mul(scale).toDecimalPlaces(3);
      const available = new Prisma.Decimal(availableById.get(line.itemId) ?? 0).toDecimalPlaces(3);

      if (available.greaterThanOrEqualTo(required)) continue;

      const details = detailsById.get(line.itemId);

      shortages.push({
        itemId: line.itemId,
        code: details?.code ?? line.itemId,
        uom: details?.uom ?? '',
        required: required.toString(),
        available: available.toString(),
        short: required.sub(available).toDecimalPlaces(3).toString(),
      });
    }

    return shortages;
  }

  async createProductionOrder(dto: CreateProductionOrderDto): Promise<ProductionOrderSummary> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    // The QUANTITY regex on the DTO accepts "0" — it bounds the SHAPE of a
    // decimal, not its value — and zero has to be refused here for the same
    // reason `workOrderFeasibility` refuses it. A zero-quantity order scales
    // every requirement to nothing, so the shortage check below finds nothing
    // short and the order saves: a work order to make none of something, which
    // then blocks the real one, because one order produces one batch.
    //
    // First, because it costs no database round trip to say no.
    if (new Prisma.Decimal(dto.plannedQuantity).lessThanOrEqualTo(0)) {
      throw fieldBadRequest('plannedQuantity', 'A batch quantity must be greater than zero.');
    }

    // US-JW-03. Resolved before the BOM lookup, because it decides which stock
    // the shortage check below is allowed to count. Null on every own-brand
    // work order, and nothing downstream changes for those.
    const jobWork = dto.jobWorkOrderId
      ? await this.jobWorkOrders.requireOrder(dto.jobWorkOrderId)
      : null;

    if (jobWork && jobWork.mapping.bom.product.id !== dto.productId) {
      // The job-work order names a mapping, the mapping names a BOM, and that
      // BOM has a product. Making anything else against the order would put
      // the wrong goods on the principal's challan.
      throw fieldBadRequest(
        'productId',
        `${jobWork.orderNumber} is for ${jobWork.mapping.bom.product.name}, so a work ` +
          'order against it has to be for that product.',
      );
    }

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

    // US-MD-06: "A finished product cannot go into a Work Order until it has at
    // least one active Packaging Requirement Master entry."
    //
    // Deliberately beside the active-BOM check above, which is US-MD-03's
    // identical rule: a product needs both a recipe and a pack before anyone
    // starts making it. Asked as a question of PackagingService so this method
    // does not need to know how packaging records are shaped.
    //
    // Checked BEFORE the transaction opens — refusing costs one read, and there
    // is no reason to hold a connection to find out the answer is no.
    if (!(await this.packaging.hasActiveRequirement(dto.productId))) {
      throw new BadRequestException(
        'That product has no active packaging requirement. Add one under Packaging Requirement ' +
          'before raising a work order — the batch would reach the packing line with no pack ' +
          'specification to work to.',
      );
    }

    // US-PROD-01: "The system must block work-order confirmation if any
    // required raw material is insufficient in stock."
    //
    // The same arithmetic the issue plan uses, asked one step earlier. A work
    // order raised against stock that does not exist is a promise the store
    // cannot keep: it sits in the queue looking schedulable until the day
    // someone tries to dispense it.
    //
    // A CHECK, a preview and this all read the same numbers, so the answer
    // cannot differ between the screen and the save.
    // CONTROLS 4 and 5, at the earliest point they can be asked. Under
    // PURE_CONVERSION this counts the principal's material and nothing else, so
    // a work order our own stock could cover is still refused when theirs
    // cannot — which is the point.
    const bucket = stockBucketFor({
      jobWorkOrderId: jobWork?.id ?? null,
      jobWorkBillingModel: jobWork?.billingModel ?? null,
    });

    const shortages = await this.materialShortages(bom, dto.plannedQuantity, bucket);

    if (shortages.length > 0) {
      const detail = shortages
        .map((line) => `${line.code} — short ${line.short} ${line.uom} of ${line.required}`)
        .join('; ');

      throw new BadRequestException(
        `Not enough ${describeBucket(bucket)} to make ${dto.plannedQuantity} of that ` +
          `product: ${detail}. ` +
          (bucket.ownership === 'PRINCIPAL_OWNED'
            ? 'This is a pure-conversion job-work order, so only material received against ' +
              `${jobWork?.orderNumber} counts — company-owned stock cannot be used. Record ` +
              "the principal's delivery challan, or reduce the batch size."
            : 'Only stock released by incoming QC counts — quarantined and rejected lots are ' +
              'not available to production. Raise a purchase requisition, or reduce the ' +
              'batch size.'),
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
          // US-JW-03's "additional tagging", and the second half of US-MD-05:
          // the billing model is COPIED here rather than joined, and a database
          // trigger refuses to change either once the order leaves PLANNED.
          jobWorkOrderId: jobWork?.id ?? null,
          jobWorkBillingModel: jobWork?.billingModel ?? null,
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
  private async nextOrderNumber(tx: OrderNumberReader): Promise<string> {
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

  /**
   * The number the next work order would be given — US-PROD-01's "Work Order
   * No. (auto-generated)", shown on the form before anything is saved.
   *
   * A PREDICTION, not a reservation, and the distinction is real: the number is
   * allocated inside the create transaction, so if somebody else saves first
   * theirs takes this value and the next one moves on. Nothing is held.
   *
   * It is still worth serving from here rather than computing it in the
   * browser. The form would otherwise derive the number from whatever orders
   * happened to be on the page — a filtered or paged list gives a wrong answer
   * with no way to tell — while this reads the same rows, through the same
   * tenant scoping, as the allocation it is predicting.
   */
  async previewOrderNumber(): Promise<{ orderNumber: string }> {
    return { orderNumber: await this.nextOrderNumber(this.prisma.scoped) };
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
/**
 * Just enough of a Prisma client to read the highest existing order number.
 *
 * Narrowed to the one call because the two callers hand in different clients:
 * `createProductionOrder` passes its transaction, so the read and the insert
 * cannot be separated by another writer, while `previewOrderNumber` passes the
 * tenant-scoped client, having nothing to write. `Prisma.TransactionClient`
 * would exclude the second — the extended client is not assignable to it — and
 * widening to a union would name two long generated types to no purpose.
 */
interface OrderNumberReader {
  productionOrder: {
    findFirst(args: {
      where: { orderNumber: { startsWith: string } };
      orderBy: { orderNumber: 'desc' };
      select: { orderNumber: true };
    }): Promise<{ orderNumber: string } | null>;
  };
}

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
