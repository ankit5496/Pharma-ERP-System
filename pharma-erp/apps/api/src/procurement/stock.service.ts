import { Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type { ItemStockPosition, LowStockItem, StockLedgerRow } from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

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
        where: { deletedAt: null, itemType: { in: ['RAW_MATERIAL', 'PACKAGING'] } },
        select: ITEM_SELECT,
        orderBy: [{ name: 'asc' }],
      }),
      this.usableStockByItem('USABLE'),
      this.usableStockByItem('QUARANTINE'),
      // Items already being dealt with. Shown rather than hidden, flagged so a
      // buyer does not raise a second requisition for the same shortage.
      this.prisma.scoped.purchaseRequisition.findMany({
        where: { deletedAt: null, status: { in: ['DRAFT', 'PENDING', 'APPROVED'] } },
        select: { itemId: true },
        distinct: ['itemId'],
      }),
    ]);

    const openByItem = new Set(openRequisitions.map((row) => row.itemId));

    return items
      .map((item) => {
        const available = usable.get(item.id) ?? ZERO;
        const reorderLevel = new Prisma.Decimal(item.reorderLevel);

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
        belowReorderLevel: available.lessThan(new Prisma.Decimal(item.reorderLevel)),
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
