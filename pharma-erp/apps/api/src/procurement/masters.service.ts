import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  ItemSummary,
  PartySummary,
  PartyType,
  BomSummary,
  ProductionPlanSummary,
} from '@pharma-erp/types';

import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import { parseNonNegative, parsePositive, qty } from './decimal.util';
import type {
  CreateItemDto,
  CreatePartyDto,
  CreateProductionPlanDto,
} from './dto/masters.dto';
import {
  ITEM_SELECT,
  PARTY_SELECT,
  BOM_INCLUDE,
  PRODUCTION_PLAN_INCLUDE,
  toItemSummary,
  toPartySummary,
  toBomSummary,
  toProductionPlanSummary,
} from './mappers';
import { NumberingService } from './numbering.service';

/**
 * Items and parties — the master data every Procure-to-Pay document points at.
 *
 * Minimal on purpose: list, create, and nothing else. A full master-data
 * screen with editing, merging and deactivation belongs with the Masters
 * module when it is built; what is here is what the procurement flow needs in
 * order to function, and no more.
 */
@Injectable()
export class MastersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async listItems(itemType?: string): Promise<ItemSummary[]> {
    const rows = await this.prisma.scoped.item.findMany({
      where: {
        deletedAt: null,
        ...(itemType ? { itemType: itemType as 'RAW_MATERIAL' } : {}),
      },
      select: ITEM_SELECT,
      orderBy: [{ name: 'asc' }],
    });

    return rows.map(toItemSummary);
  }

  async createItem(dto: CreateItemDto): Promise<ItemSummary> {
    const tenantId = this.tenantContext.requireTenantId();
    const reorderLevel = parseNonNegative(dto.reorderLevel ?? '0', 'Reorder level');

    try {
      const created = await this.prisma.scoped.item.create({
        data: {
          tenantId,
          code: dto.code,
          name: dto.name,
          type: dto.itemType ?? 'RAW_MATERIAL',
          uom: dto.uom ?? 'kg',
          reorderLevel,
          reorderQuantity: parseNonNegative(dto.reorderQuantity ?? '0', 'Reorder quantity'),
          shelfLifeMonths: dto.shelfLifeMonths ?? null,
          // GST lives on the item; there is no separate tax master.
          gstRate: dto.gstRate === undefined ? null : parseNonNegative(dto.gstRate, 'GST rate'),
          scheduleClassification: dto.scheduleClassification ?? 'NONE',
          brandName: dto.brandName ?? null,
          genericName: dto.genericName ?? null,
          storageConditions: dto.storageConditions ?? null,
          hsnCode: dto.hsnCode ?? null,
        },
        select: ITEM_SELECT,
      });

      await this.audit.record({
        entityType: 'Item',
        entityId: created.id,
        action: 'CREATE',
        after: { code: created.code, name: created.name, reorderLevel: qty(reorderLevel) },
      });

      return toItemSummary(created);
    } catch (error) {
      throw this.asConflict(error, `Item code ${dto.code} is already in use.`);
    }
  }

  async listParties(partyType?: PartyType): Promise<PartySummary[]> {
    const rows = await this.prisma.scoped.party.findMany({
      where: { deletedAt: null, ...(partyType ? { partyType } : {}) },
      select: PARTY_SELECT,
      orderBy: [{ name: 'asc' }],
    });

    return rows.map(toPartySummary);
  }

  async createParty(dto: CreatePartyDto): Promise<PartySummary> {
    const tenantId = this.tenantContext.requireTenantId();

    try {
      const created = await this.prisma.scoped.party.create({
        data: {
          tenantId,
          code: dto.code,
          name: dto.name,
          partyType: dto.partyType ?? 'VENDOR',
          gstin: dto.gstin ?? null,
          drugLicenceNumber: dto.drugLicenceNumber ?? null,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          address: dto.address ?? null,
          paymentTermsDays: dto.paymentTermsDays ?? 30,
        },
        select: PARTY_SELECT,
      });

      await this.audit.record({
        entityType: 'Party',
        entityId: created.id,
        action: 'CREATE',
        after: { code: created.code, name: created.name, partyType: created.partyType },
      });

      return toPartySummary(created);
    } catch (error) {
      throw this.asConflict(error, `Party code ${dto.code} is already in use.`);
    }
  }

  // ---------------------------------------------------------------------------
  // Bills of material
  // ---------------------------------------------------------------------------

  /**
   * Formulations from the shared master data.
   *
   * Read-only here: BOMs are authored by the master-data / production work, and
   * Procure-to-Pay only needs to cite one from a production plan. Creating them
   * from this module would be two places writing the same register.
   */
  async listBoms(): Promise<BomSummary[]> {
    const rows = await this.prisma.scoped.bom.findMany({
      where: { deletedAt: null },
      include: BOM_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });

    return rows.map(toBomSummary);
  }

  // ---------------------------------------------------------------------------
  // Production plans
  // ---------------------------------------------------------------------------

  async listProductionPlans(): Promise<ProductionPlanSummary[]> {
    const rows = await this.prisma.scoped.productionPlan.findMany({
      where: { deletedAt: null },
      include: PRODUCTION_PLAN_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });

    return rows.map(toProductionPlanSummary);
  }

  /**
   * Creates a plan and its component list in one transaction.
   *
   * A plan whose components failed to save would look complete and quietly
   * understate what the run consumes, which is exactly the sort of gap that
   * surfaces as a stockout on the shop floor.
   */
  async createProductionPlan(dto: CreateProductionPlanDto): Promise<ProductionPlanSummary> {
    const tenantId = this.tenantContext.requireTenantId();
    const createdById = this.tenantContext.getUserId();

    const finishedProduct = await this.prisma.scoped.item.findFirst({
      where: { id: dto.finishedProductId, deletedAt: null },
      select: { id: true, code: true, type: true },
    });

    if (!finishedProduct) throw new NotFoundException('Finished product not found.');

    if (finishedProduct.type !== 'FINISHED_GOOD') {
      throw new ConflictException(
        `${finishedProduct.code} is not a finished good, so a production plan cannot make it.`,
      );
    }

    const plannedQuantity = parsePositive(dto.plannedQuantity, 'Planned quantity');

    const created = await this.prisma.transaction(async (tx) => {
      const number = await this.numbering.next(tx, tenantId, 'PLAN');

      return tx.productionPlan.create({
        data: {
          tenantId,
          number,
          finishedProductId: finishedProduct.id,
          packVariant: dto.packVariant ?? null,
          plannedQuantity,
          plannedDate: dto.plannedDate ? new Date(dto.plannedDate) : null,
          notes: dto.notes ?? null,
          createdById,
          status: 'PLANNED',
          bomId: dto.bomId ?? null,
        },
        include: PRODUCTION_PLAN_INCLUDE,
      });
    });

    await this.audit.record({
      entityType: 'ProductionPlan',
      entityId: created.id,
      action: 'CREATE',
      after: {
        number: created.number,
        finishedProduct: finishedProduct.code,
        plannedQuantity: qty(plannedQuantity),
      },
    });

    return toProductionPlanSummary(created);
  }

  async requireItem(id: string): Promise<ItemSummary> {
    const row = await this.prisma.scoped.item.findFirst({
      where: { id, deletedAt: null },
      select: ITEM_SELECT,
    });

    if (!row) throw new NotFoundException('Item not found.');

    return toItemSummary(row);
  }

  /** Turns a unique-constraint violation into a message, leaving others alone. */
  private asConflict(error: unknown, message: string): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException(message);
    }

    return error;
  }
}
