import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type { ItemStockPosition, LowStockItem, StockLedgerRow } from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import { ZERO, positiveDifference, qty } from './decimal.util';
import { ITEM_SELECT, LOT_SELECT, toItemSummary, toStockLotSummary } from './mappers';

/**
 * Stock positions, the low-stock trigger, and the ledger.
 *
 * The rule this service exists to enforce is business rule 7: only QC-accepted
 * material counts as usable. Every "how much do we have" question here answers
 * it with USABLE lots and nothing else. Quarantined and rejected quantities are
 * reported separately and never folded into the usable figure — if they were,
 * a Production Officer would see stock that cannot lawfully be dispensed, and
 * a low-stock alert that should have fired would stay silent.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Usable stock per item, as a map.
   *
   * One grouped aggregate rather than a query per item: a company with a few
   * hundred raw materials would otherwise issue a few hundred round trips to
   * paint one screen.
   */
  async usableStockByItem(status: 'USABLE' | 'QUARANTINE' | 'REJECTED' | 'ON_HOLD' = 'USABLE') {
    const grouped = await this.prisma.scoped.stockLot.groupBy({
      by: ['itemId'],
      where: { status },
      _sum: { quantityAvailable: true },
    });

    return new Map(
      grouped.map((row) => [row.itemId, row._sum.quantityAvailable ?? ZERO] as const),
    );
  }

  /**
   * Raw materials whose usable stock has fallen below their reorder level.
   *
   * This is the trigger for the whole Procure-to-Pay flow: `available < reorder`.
   * Restricted to RAW_MATERIAL and PACKAGING because finished goods are made,
   * not bought, and would otherwise sit permanently in the buyer's queue.
   */
  async lowStockItems(): Promise<LowStockItem[]> {
    const [items, usable, quarantine, openRequisitions] = await Promise.all([
      this.prisma.scoped.item.findMany({
        where: { deletedAt: null, type: { in: ['RAW_MATERIAL', 'PACKING_MATERIAL', 'SEMI_FINISHED'] } },
        select: ITEM_SELECT,
        orderBy: [{ name: 'asc' }],
      }),
      this.usableStockByItem('USABLE'),
      this.usableStockByItem('QUARANTINE'),
      // Items already being dealt with. Shown rather than hidden, flagged so a
      // buyer does not raise a second requisition for the same shortage.
      this.prisma.scoped.purchaseRequisition.findMany({
        where: { deletedAt: null, status: { in: ['OPEN', 'APPROVED'] } },
        select: { itemId: true },
        distinct: ['itemId'],
      }),
    ]);

    const openByItem = new Set(openRequisitions.map((row) => row.itemId));

    return items
      .map((item) => {
        const available = usable.get(item.id) ?? ZERO;
        const reorderLevel = new Prisma.Decimal(item.reorderLevel ?? 0);

        return {
          item: toItemSummary(item),
          available,
          reorderLevel,
          quarantined: quarantine.get(item.id) ?? ZERO,
          hasOpenRequisition: openByItem.has(item.id),
        };
      })
      .filter((row) => row.available.lessThan(row.reorderLevel))
      .map((row) => ({
        item: row.item,
        availableStock: qty(row.available),
        quarantineStock: qty(row.quarantined),
        shortfall: qty(positiveDifference(row.reorderLevel, row.available)),
        hasOpenRequisition: row.hasOpenRequisition,
      }));
  }

  /** Every item's position, with its usable lots in FEFO order. */
  async stockPositions(): Promise<ItemStockPosition[]> {
    const [items, lots] = await Promise.all([
      this.prisma.scoped.item.findMany({
        where: { deletedAt: null },
        select: ITEM_SELECT,
        orderBy: [{ name: 'asc' }],
      }),
      this.prisma.scoped.stockLot.findMany({
        where: { status: { in: ['USABLE', 'QUARANTINE', 'REJECTED', 'ON_HOLD'] } },
        select: { ...LOT_SELECT, itemId: true },
        // FEFO: first expiry, first out. Nulls last so a lot with no recorded
        // expiry is offered only after every dated lot has been used — the
        // conservative order, since an unknown expiry might be the soonest.
        orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      }),
    ]);

    return items.map((item) => {
      const own = lots.filter((lot) => lot.itemId === item.id);
      const sumWhere = (status: string) =>
        own
          .filter((lot) => lot.status === status)
          .reduce((total, lot) => total.plus(lot.quantityAvailable), ZERO);

      const available = sumWhere('USABLE');

      return {
        item: toItemSummary(item),
        availableStock: qty(available),
        quarantineStock: qty(sumWhere('QUARANTINE')),
        rejectedStock: qty(sumWhere('REJECTED')),
        onHoldStock: qty(sumWhere('ON_HOLD')),
        belowReorderLevel: available.lessThan(new Prisma.Decimal(item.reorderLevel ?? 0)),
        fefoLots: own.filter((lot) => lot.status === 'USABLE').map(toStockLotSummary),
      };
    });
  }

  /** The stock ledger, newest first. */
  async ledger(itemId?: string, limit = 200): Promise<StockLedgerRow[]> {
    const rows = await this.prisma.scoped.stockLedgerEntry.findMany({
      where: itemId ? { itemId } : {},
      select: {
        id: true,
        entryType: true,
        quantityDelta: true,
        affectsUsableStock: true,
        reference: true,
        notes: true,
        createdAt: true,
        item: { select: { code: true, name: true } },
        stockLot: { select: { lotNumber: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });

    return rows.map((row) => ({
      // BigInt does not survive JSON.stringify; the id is an identifier here,
      // not a number to compute with, so it crosses as a string.
      id: row.id.toString(),
      itemCode: row.item.code,
      itemName: row.item.name,
      lotNumber: row.stockLot?.lotNumber ?? null,
      entryType: row.entryType,
      quantityDelta: qty(row.quantityDelta),
      affectsUsableStock: row.affectsUsableStock,
      reference: row.reference,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * Consumes or corrects usable stock, lot by lot in FEFO order.
   *
   * Exists because stock has to be able to GO DOWN for the reorder trigger to
   * mean anything, and production — the normal consumer — is not built yet.
   * It is a real inventory operation, not a test hook: an adjustment for
   * breakage, a stock count correction or a manual issue all land here, and
   * each one posts a ledger entry with a reason.
   *
   * FEFO is not optional here. Consuming the earliest-expiring lot first is
   * the rule the whole batch model exists to support; picking an arbitrary lot
   * would leave short-dated material to expire on the shelf.
   */
  async consumeStock(
    itemId: string,
    quantity: Prisma.Decimal,
    reason: string,
    actingUserId: string | null,
  ): Promise<{ consumedFrom: { lotNumber: string; quantity: string }[] }> {
    const tenantId = this.tenantContext.requireTenantId();

    return this.prisma.transaction(async (tx) => {
      const item = await tx.item.findFirst({
        where: { id: itemId, deletedAt: null },
        select: { id: true, code: true },
      });

      if (!item) throw new NotFoundException('Item not found.');

      const lots = await tx.stockLot.findMany({
        where: { itemId, status: 'USABLE', quantityAvailable: { gt: 0 } },
        orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        select: { id: true, lotNumber: true, quantityAvailable: true },
      });

      const total = lots.reduce((sum, lot) => sum.plus(lot.quantityAvailable), ZERO);

      if (total.lessThan(quantity)) {
        throw new ConflictException(
          `Only ${qty(total)} of ${item.code} is usable; cannot consume ${qty(quantity)}.`,
        );
      }

      let remaining = quantity;
      const consumedFrom: { lotNumber: string; quantity: string }[] = [];

      for (const lot of lots) {
        if (remaining.lessThanOrEqualTo(0)) break;

        const available = new Prisma.Decimal(lot.quantityAvailable);
        const take = available.lessThan(remaining) ? available : remaining;
        const left = available.minus(take);

        await tx.stockLot.update({
          where: { id: lot.id },
          data: {
            quantityAvailable: left,
            // A lot drawn to zero is CONSUMED, not deleted: its batch number
            // and expiry stay traceable for as long as anything made from it
            // is on the market.
            ...(left.isZero() ? { status: 'CONSUMED' as const } : {}),
          },
        });

        await tx.stockLedgerEntry.create({
          data: {
            tenantId,
            itemId,
            stockLotId: lot.id,
            entryType: 'ADJUSTMENT',
            quantityDelta: take.negated(),
            affectsUsableStock: true,
            reference: null,
            notes: reason,
            createdById: actingUserId,
          },
        });

        consumedFrom.push({ lotNumber: lot.lotNumber, quantity: qty(take) });
        remaining = remaining.minus(take);
      }

      return { consumedFrom };
    });
  }

  /** Usable stock for one item, for the requisition form's snapshot. */
  async usableStockForItem(itemId: string): Promise<Prisma.Decimal> {
    const item = await this.prisma.scoped.item.findFirst({
      where: { id: itemId, deletedAt: null },
      select: { id: true },
    });

    if (!item) throw new NotFoundException('Item not found.');

    const aggregate = await this.prisma.scoped.stockLot.aggregate({
      where: { itemId, status: 'USABLE' },
      _sum: { quantityAvailable: true },
    });

    return aggregate._sum.quantityAvailable ?? ZERO;
  }
}
