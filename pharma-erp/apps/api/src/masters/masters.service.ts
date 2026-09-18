import { ConflictException, Injectable } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type { ItemListItem, O2cItemType, PriceControlType, ScheduleCategory } from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import type { CreateItemDto } from './dto/item.dto';

/**
 * Read-only master data for the Order-to-Cash screens.
 *
 * A thin projection over the SHARED item register, which Procure-to-Pay owns.
 * It exists because the sales desk needs the register in the vocabulary the
 * Order-to-Cash contract uses — and because it answers one question the other
 * screens never ask: how much of this product is actually saleable.
 *
 * SALEABLE means released, in date, and not already spoken for. A picker that
 * offered quarantined or expired stock would invite an order that allocation
 * then has to refuse, and an expired batch offered for sale is the kind of
 * mistake that ends in a recall.
 */
@Injectable()
export class MastersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Creates a finished product from the sales-order screen.
   *
   * Writes to the SHARED item register, so the product this creates is the same
   * one Procure-to-Pay and Production see. Two fields cannot be stored and are
   * dropped deliberately:
   *
   *   packSize         the register has no such column
   *   priceControlType the register records DPCO control as a boolean, so NLEM
   *                    and OTHER both collapse to "not DPCO"
   *
   * Dropping them silently is the lesser evil against refusing the form
   * outright, but it IS a loss, and the read path reports the same gap as null
   * rather than inventing a value.
   */
  async createItem(dto: CreateItemDto): Promise<ItemListItem> {
    const tenantId = this.tenantContext.requireTenantId();

    try {
      const created = await this.prisma.scoped.item.create({
        data: {
          tenantId,
          code: dto.code.trim(),
          name: dto.name.trim(),
          type: toPrismaItemType(dto.itemType),
          // The register requires a unit of measure; the form makes it optional.
          uom: dto.unitOfMeasure?.trim() || 'NOS',
          hsnCode: dto.hsnCode?.trim() || null,
          gstRate: dto.gstRatePercent ?? null,
          scheduleClassification: toScheduleClassification(dto.scheduleCategory ?? 'NONE'),
          mrp: dto.mrp ?? null,
          dpcoCeiling: dto.priceControlType === 'DPCO',
        },
      });

      const [item] = await this.listItems(undefined, created.code);

      if (!item) {
        throw new ConflictException('The item was created but could not be read back.');
      }

      return item;
    } catch (error) {
      if ((error as { code?: string } | null)?.code === 'P2002') {
        throw new ConflictException(`Item code "${dto.code}" is already in use.`);
      }
      throw error;
    }
  }

  async listItems(itemType?: string, search?: string): Promise<ItemListItem[]> {
    const term = search?.trim();

    const items = await this.prisma.scoped.item.findMany({
      where: {
        deletedAt: null,
        ...(itemType ? { type: toItemType(itemType) } : {}),
        ...(term
          ? {
              OR: [
                { code: { contains: term, mode: 'insensitive' } },
                { name: { contains: term, mode: 'insensitive' } },
                { brandName: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: 'asc' }],
    });

    if (items.length === 0) return [];

    // Saleable stock per item, in ONE grouped query rather than per row.
    const today = new Date();
    const lots = await this.prisma.scoped.finishedGoodsLot.groupBy({
      by: ['itemId'],
      where: {
        itemId: { in: items.map((item) => item.id) },
        expiryDate: { gte: today },
        batch: { releaseStatus: 'RELEASED', deletedAt: null },
      },
      _sum: { quantityAvailable: true },
    });

    // What allocation has already reserved but not yet despatched. Subtracted
    // so the picker shows what can still be promised, not what is on the shelf.
    const reserved = await this.prisma.scoped.batchAllocation.groupBy({
      by: ['batchId'],
      where: { status: { in: ['ALLOCATED', 'PARTIALLY_DISPATCHED'] } },
      _sum: { quantityAllocated: true, quantityDispatched: true },
    });

    const reservedByBatch = new Map(
      reserved.map((row) => [
        row.batchId,
        (row._sum.quantityAllocated ?? new Prisma.Decimal(0)).sub(
          row._sum.quantityDispatched ?? new Prisma.Decimal(0),
        ),
      ]),
    );

    // Map reservations back to items through their lots.
    const lotRows = await this.prisma.scoped.finishedGoodsLot.findMany({
      where: { itemId: { in: items.map((item) => item.id) } },
      select: { itemId: true, batchId: true },
    });

    const reservedByItem = new Map<string, Prisma.Decimal>();
    for (const lot of lotRows) {
      const held = reservedByBatch.get(lot.batchId);
      if (!held) continue;
      reservedByItem.set(
        lot.itemId,
        (reservedByItem.get(lot.itemId) ?? new Prisma.Decimal(0)).add(held),
      );
    }

    const onHandByItem = new Map(
      lots.map((row) => [row.itemId, row._sum.quantityAvailable ?? new Prisma.Decimal(0)]),
    );

    return items.map((item) => {
      const onHand = onHandByItem.get(item.id) ?? new Prisma.Decimal(0);
      const held = reservedByItem.get(item.id) ?? new Prisma.Decimal(0);
      const available = Prisma.Decimal.max(onHand.sub(held), 0);

      return {
        id: item.id,
        code: item.code,
        name: item.name,
        itemType: toO2cItemType(item.type),
        // The shared register has no pack-size column. Null rather than an
        // invented string — see the same note in the sales-order mapper.
        packSize: null,
        unitOfMeasure: item.uom,
        hsnCode: item.hsnCode,
        gstRatePercent: item.gstRate?.toFixed(2) ?? null,
        scheduleCategory: toScheduleCategory(item.scheduleClassification),
        mrp: item.mrp?.toFixed(2) ?? null,
        // The shared register records DPCO control as a boolean, not a
        // category, so NLEM and "other" cannot be distinguished here.
        priceControlType: (item.dpcoCeiling ? 'DPCO' : 'NONE') satisfies PriceControlType,
        status: item.deletedAt ? 'INACTIVE' : 'ACTIVE',
        availableQuantity: available.toFixed(3),
        quantityOnHand: onHand.toFixed(3),
        quantityReserved: held.toFixed(3),
        createdAt: item.createdAt.toISOString(),
      };
    });
  }
}

/**
 * The Order-to-Cash contract names types the shared register spells
 * differently. Mapped rather than merged: renaming the shared enum would reach
 * into Procure-to-Pay and Production.
 */
function toItemType(requested: string): Prisma.EnumItemTypeFilter | undefined {
  switch (requested) {
    case 'FINISHED_GOOD':
      return { equals: 'FINISHED_GOOD' };
    case 'RAW_MATERIAL':
      return { equals: 'RAW_MATERIAL' };
    case 'PACKAGING':
      return { equals: 'PACKING_MATERIAL' };
    default:
      return undefined;
  }
}

function toO2cItemType(type: string): O2cItemType {
  switch (type) {
    case 'PACKING_MATERIAL':
      return 'PACKAGING';
    case 'RAW_MATERIAL':
      return 'RAW_MATERIAL';
    case 'FINISHED_GOOD':
      return 'FINISHED_GOOD';
    default:
      // SEMI_FINISHED has no counterpart in the O2C vocabulary. It is not sold,
      // so CONSUMABLE is the closest honest answer rather than a wrong one.
      return 'CONSUMABLE';
  }
}

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

/** The reverse of `toO2cItemType`, for the write path. */
function toPrismaItemType(itemType: string): 'RAW_MATERIAL' | 'PACKING_MATERIAL' | 'SEMI_FINISHED' | 'FINISHED_GOOD' {
  switch (itemType) {
    case 'PACKAGING':
      return 'PACKING_MATERIAL';
    case 'RAW_MATERIAL':
      return 'RAW_MATERIAL';
    case 'FINISHED_GOOD':
      return 'FINISHED_GOOD';
    default:
      // CONSUMABLE has no counterpart in the shared register. SEMI_FINISHED is
      // the closest thing that is not sold, which is the property that matters.
      return 'SEMI_FINISHED';
  }
}

/** The reverse of `toScheduleCategory`. */
function toScheduleClassification(category: string): 'NONE' | 'H' | 'H1' | 'X' | 'G' {
  switch (category) {
    case 'SCHEDULE_H':
      return 'H';
    // The shared register has no H1X. H1 is the nearest control it can express
    // and is the stricter of the two it does have, so both map to it.
    case 'SCHEDULE_H1':
    case 'SCHEDULE_H1X':
      return 'H1';
    case 'SCHEDULE_X':
      return 'X';
    case 'SCHEDULE_G':
      return 'G';
    default:
      return 'NONE';
  }
}
