import { Injectable, NotFoundException } from '@nestjs/common';

import type { Prisma } from '@pharma-erp/database';
import type { StockMovement, StockMovementBucket } from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { qty } from '../procurement/decimal.util';

/** How each stock-ledger entry reads in the history. */
const LEDGER_LABELS: Record<string, string> = {
  QC_ACCEPTED: 'QC accepted',
  QC_REJECTED: 'QC rejected',
  QC_HOLD: 'QC put on hold',
  QC_RELEASED_FROM_HOLD: 'Released from hold',
  ADJUSTMENT: 'Adjustment',
};

interface Movement extends StockMovement {
  /** Orders same-day movements by what logically happens first. */
  rank: number;
}

/**
 * A batch's movement history — US-INV-01's ledger.
 *
 * NOT ONE TABLE. Receipts, QC decisions, job-work issues and adjustments are in
 * the stock ledger; production material issues and every finished-goods
 * movement are not, so they are read from the records those steps write
 * (issue lines, the release, dispatch items, sales returns, job-work
 * dispatches). Nothing here is stored.
 */
@Injectable()
export class MovementsService {
  constructor(private readonly prisma: PrismaService) {}

  async forMaterialLot(lotId: string): Promise<StockMovement[]> {
    // The receipt is read from the line that created the lot rather than from
    // its GRN_QUARANTINE ledger row: every lot has that line, while lots
    // created before the ledger existed, or by the demo seeder, have no row.
    const lot = await this.prisma.scoped.stockLot.findFirst({
      where: { id: lotId },
      select: {
        id: true,
        createdAt: true,
        goodsReceiptLine: {
          select: {
            quantityReceived: true,
            goodsReceipt: { select: { number: true, receiptDate: true } },
          },
        },
        jobWorkMaterialReceiptLine: {
          select: {
            receivedQuantity: true,
            deliveryChallanNumber: true,
            receipt: { select: { receiptNumber: true, receiptDate: true } },
          },
        },
      },
    });

    if (!lot) throw new NotFoundException('That batch does not exist.');

    const received = lot.goodsReceiptLine
      ? {
          label: 'Received (goods receipt)',
          date: lot.goodsReceiptLine.goodsReceipt.receiptDate,
          reference: lot.goodsReceiptLine.goodsReceipt.number,
          quantity: lot.goodsReceiptLine.quantityReceived,
          notes: null,
        }
      : lot.jobWorkMaterialReceiptLine
        ? {
            label: 'Received from principal',
            date: lot.jobWorkMaterialReceiptLine.receipt.receiptDate,
            reference: lot.jobWorkMaterialReceiptLine.receipt.receiptNumber,
            quantity: lot.jobWorkMaterialReceiptLine.receivedQuantity,
            notes: `Challan ${lot.jobWorkMaterialReceiptLine.deliveryChallanNumber}`,
          }
        : null;

    const [ledger, issues] = await Promise.all([
      this.prisma.scoped.stockLedgerEntry.findMany({
        where: { stockLotId: lotId, entryType: { not: 'GRN_QUARANTINE' } },
        select: {
          id: true,
          entryType: true,
          quantityDelta: true,
          affectsUsableStock: true,
          reference: true,
          notes: true,
          createdAt: true,
        },
      }),
      // Production issues write no ledger row, so they are read from here.
      this.prisma.scoped.materialIssueLine.findMany({
        where: { lotId },
        select: {
          id: true,
          quantityIssued: true,
          overrideReason: true,
          materialIssue: {
            select: {
              issueNumber: true,
              issuedAt: true,
              productionOrder: { select: { orderNumber: true } },
            },
          },
        },
      }),
    ]);

    return ordered([
      ...(received
        ? [
            movement({
              id: `receipt-${lot.id}`,
              ...received,
              bucket: 'QUARANTINE',
              rank: 0,
            }),
          ]
        : []),
      ...ledger.map((entry) =>
        movement({
          id: `ledger-${entry.id}`,
          date: entry.createdAt,
          label: LEDGER_LABELS[entry.entryType] ?? entry.entryType,
          reference: entry.reference,
          quantity: entry.quantityDelta,
          bucket: entry.affectsUsableStock ? 'USABLE' : 'QUARANTINE',
          notes: entry.notes,
          rank: 1,
        }),
      ),
      ...issues.map((line) =>
        movement({
          id: `issue-${line.id}`,
          date: line.materialIssue.issuedAt,
          label: 'Issued to production',
          reference: `${line.materialIssue.issueNumber} · ${line.materialIssue.productionOrder.orderNumber}`,
          quantity: line.quantityIssued.negated(),
          bucket: 'USABLE',
          notes: line.overrideReason ? `FEFO override: ${line.overrideReason}` : null,
          rank: 2,
        }),
      ),
    ]);
  }

  async forFinishedLot(finishedLotId: string): Promise<StockMovement[]> {
    const lot = await this.prisma.scoped.finishedGoodsLot.findFirst({
      where: { id: finishedLotId },
      select: {
        id: true,
        createdAt: true,
        batchId: true,
        batch: {
          select: {
            releaseDecidedAt: true,
            packingRecord: { select: { packedQuantity: true } },
            productionOrder: { select: { orderNumber: true } },
          },
        },
      },
    });

    if (!lot) throw new NotFoundException('That batch does not exist.');

    const [dispatches, returns, jobWorkDispatches] = await Promise.all([
      // Stock leaves when a dispatch is confirmed; drafts have moved nothing.
      this.prisma.scoped.dispatchItem.findMany({
        where: {
          batchAllocation: { batchId: lot.batchId },
          dispatch: { status: { in: ['DISPATCHED', 'DELIVERED'] }, deletedAt: null },
        },
        select: {
          id: true,
          quantityDispatched: true,
          dispatch: {
            select: {
              dispatchNumber: true,
              dispatchDate: true,
              salesOrder: { select: { orderNumber: true } },
            },
          },
        },
      }),
      // Only RESTOCK lines come back into stock, and only once received.
      this.prisma.scoped.salesReturnItem.findMany({
        where: {
          batchId: lot.batchId,
          disposition: 'RESTOCK',
          salesReturn: { status: { notIn: ['DRAFT', 'CANCELLED'] }, deletedAt: null },
        },
        select: {
          id: true,
          quantity: true,
          salesReturn: { select: { returnNumber: true, returnDate: true } },
        },
      }),
      this.prisma.scoped.jobWorkInvoice.findMany({
        where: { batchId: lot.batchId, deletedAt: null },
        select: {
          id: true,
          invoiceNumber: true,
          dispatchDate: true,
          dispatchedQuantity: true,
          jobWorkOrder: { select: { orderNumber: true } },
        },
      }),
    ]);

    const packed = lot.batch.packingRecord?.packedQuantity;

    return ordered([
      ...(packed
        ? [
            movement({
              id: `release-${lot.id}`,
              date: lot.batch.releaseDecidedAt ?? lot.createdAt,
              label: 'Released by Quality',
              reference: lot.batch.productionOrder.orderNumber,
              quantity: packed,
              bucket: 'FINISHED',
              notes: null,
              rank: 0,
            }),
          ]
        : []),
      ...returns.map((line) =>
        movement({
          id: `return-${line.id}`,
          date: line.salesReturn.returnDate,
          label: 'Sales return, restocked',
          reference: line.salesReturn.returnNumber,
          quantity: line.quantity,
          bucket: 'FINISHED',
          notes: null,
          rank: 1,
        }),
      ),
      ...dispatches.map((item) =>
        movement({
          id: `dispatch-${item.id}`,
          date: item.dispatch.dispatchDate,
          label: 'Dispatched',
          reference: `${item.dispatch.dispatchNumber} · ${item.dispatch.salesOrder.orderNumber}`,
          quantity: item.quantityDispatched.negated(),
          bucket: 'FINISHED',
          notes: null,
          rank: 2,
        }),
      ),
      ...jobWorkDispatches.map((invoice) =>
        movement({
          id: `jw-dispatch-${invoice.id}`,
          date: invoice.dispatchDate,
          label: 'Dispatched to principal',
          reference: `${invoice.invoiceNumber} · ${invoice.jobWorkOrder.orderNumber}`,
          quantity: invoice.dispatchedQuantity.negated(),
          bucket: 'FINISHED',
          notes: null,
          rank: 2,
        }),
      ),
    ]);
  }
}

function movement(input: {
  id: string;
  date: Date;
  label: string;
  reference: string | null;
  quantity: Prisma.Decimal;
  bucket: StockMovementBucket;
  notes: string | null;
  rank: number;
}): Movement {
  return { ...input, date: input.date.toISOString(), quantity: qty(input.quantity) };
}

/**
 * Oldest first, like a ledger.
 *
 * By calendar day, then by `rank`, then by time: several sources record only a
 * date, which reads as midnight, and sorting on the timestamp alone would put a
 * dispatch before the release that made the stock it dispatched.
 */
function ordered(movements: Movement[]): StockMovement[] {
  return movements
    .sort(
      (a, b) =>
        a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)) ||
        a.rank - b.rank ||
        a.date.localeCompare(b.date),
    )
    .map(({ rank: _rank, ...rest }) => rest);
}
