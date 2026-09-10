import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type { ItemSummary, PartySummary, PartyType } from '@pharma-erp/types';

import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import { parseNonNegative, qty } from './decimal.util';
import type { CreateItemDto, CreatePartyDto } from './dto/masters.dto';
import { ITEM_SELECT, PARTY_SELECT, toItemSummary, toPartySummary } from './mappers';

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
          itemType: dto.itemType ?? 'RAW_MATERIAL',
          uom: dto.uom ?? 'KG',
          reorderLevel,
          // Defaults true, and the caller has to say so explicitly to turn it
          // off. For a pharmaceutical raw material, untracked is the wrong
          // default in every case that matters.
          requiresBatchTracking: dto.requiresBatchTracking ?? true,
          hsnCode: dto.hsnCode ?? null,
          notes: dto.notes ?? null,
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
