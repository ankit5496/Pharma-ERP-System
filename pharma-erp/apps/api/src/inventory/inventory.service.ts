import { Injectable } from '@nestjs/common';

import { Prisma, type ItemType } from '@pharma-erp/database';
import type {
  ReservationState,
  StockBatchRow,
  StockBatchStatus,
  StockEnquiry,
  StockEnquiryQuery,
  StockItemGroup,
  StockReservation,
  StockReservationKind,
} from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { ZERO, daysUntil, qty } from '../procurement/decimal.util';

const ITEM_SELECT = { id: true, code: true, name: true, type: true, uom: true } as const;

type Row = StockBatchRow & {
  item: StockItemGroup['item'];
  available: Prisma.Decimal;
  reserved: Prisma.Decimal;
};

/** An order a batch is held for, before quantities are formatted. */
interface HeldFor {
  kind: StockReservationKind;
  orderId: string;
  orderNumber: string;
  quantity: Prisma.Decimal;
}

/**
 * Stock enquiry — US-INV-01.
 *
 * Batch-level stock across raw/packing material and released finished goods,
 * read live from the tables every stock movement already maintains. Nothing is
 * stored by this service.
 *
 * WHAT COUNTS AS HELD. Material lots that are USABLE, in QUARANTINE or ON HOLD
 * with quantity left — REJECTED and CONSUMED lots are history, not stock.
 * Finished goods appear only as `FinishedGoodsLot` rows, which exist only for a
 * released batch.
 *
 * RESERVATION comes from what already ties a batch to an order:
 *   - Order-to-Cash allocation: allocated minus dispatched, on allocations
 *     still open, against sales orders that are not cancelled. Cancelling an
 *     order does not yet release its allocations, so they are excluded here
 *     rather than shown as holding stock for an order that no longer exists.
 *   - A job-work principal's material, held for the order it arrived on.
 * Company-owned raw and packing material has no such link, so it is Free until
 * US-INV-06 tags it.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async stockEnquiry(query: StockEnquiryQuery): Promise<StockEnquiry> {
    const itemFilter = {
      deletedAt: null,
      ...(query.itemId ? { id: query.itemId } : {}),
      // Validated against the four item types by the DTO.
      ...(query.itemType ? { type: query.itemType as ItemType } : {}),
    };

    const [lots, finishedLots, allocations] = await Promise.all([
      this.prisma.scoped.stockLot.findMany({
        where: {
          status: { in: ['USABLE', 'QUARANTINE', 'ON_HOLD'] },
          quantityAvailable: { gt: 0 },
          item: itemFilter,
        },
        select: {
          id: true,
          lotNumber: true,
          vendorBatchNumber: true,
          manufacturingDate: true,
          expiryDate: true,
          quantityAvailable: true,
          status: true,
          ownership: true,
          item: { select: ITEM_SELECT },
          jobWorkMaterialReceiptLine: {
            select: {
              receipt: { select: { jobWorkOrder: { select: { id: true, orderNumber: true } } } },
            },
          },
        },
      }),
      this.prisma.scoped.finishedGoodsLot.findMany({
        where: { quantityAvailable: { gt: 0 }, item: itemFilter },
        select: {
          id: true,
          batchId: true,
          expiryDate: true,
          quantityAvailable: true,
          batch: { select: { batchNumber: true, manufacturedOn: true } },
          item: { select: ITEM_SELECT },
        },
      }),
      this.prisma.scoped.batchAllocation.findMany({
        where: {
          status: { in: ['ALLOCATED', 'PARTIALLY_DISPATCHED'] },
          salesOrder: { status: { not: 'CANCELLED' }, deletedAt: null },
        },
        select: {
          batchId: true,
          quantityAllocated: true,
          quantityDispatched: true,
          salesOrder: { select: { id: true, orderNumber: true } },
        },
      }),
    ]);

    const reservationsByBatch = groupReservations(allocations);
    const now = new Date();

    const rows: Row[] = [
      ...lots.map((lot) =>
        toRow({
          id: lot.id,
          source: 'MATERIAL',
          batchNumber: lot.lotNumber,
          vendorBatchNumber: lot.vendorBatchNumber,
          manufacturingDate: lot.manufacturingDate,
          expiryDate: lot.expiryDate,
          status: lot.status as StockBatchStatus,
          principalOwned: lot.ownership === 'PRINCIPAL_OWNED',
          available: lot.quantityAvailable,
          reservations: principalHold(lot),
          item: lot.item,
          now,
        }),
      ),
      ...finishedLots.map((lot) =>
        toRow({
          id: lot.id,
          source: 'FINISHED_GOOD',
          batchNumber: lot.batch.batchNumber,
          vendorBatchNumber: null,
          manufacturingDate: lot.batch.manufacturedOn,
          expiryDate: lot.expiryDate,
          status: 'RELEASED',
          principalOwned: false,
          available: lot.quantityAvailable,
          reservations: reservationsByBatch.get(lot.batchId) ?? [],
          item: lot.item,
          now,
        }),
      ),
    ];

    const searched = query.search ? matchingItems(rows, query.search) : null;

    return {
      groups: toGroups(
        rows.filter((row) => (!searched || searched.has(row.item.id)) && matches(row, query)),
      ),
    };
  }
}

/**
 * The items a search names, by item name or code or by any one of their batch
 * numbers.
 *
 * The search picks ITEMS, not batches: finding one batch of an item shows all
 * of that item's batches, so a search never hides the stock beside the batch
 * that was typed.
 */
function matchingItems(rows: Row[], search: string): Set<string> {
  const term = search.toLowerCase();

  return new Set(
    rows
      .filter((row) =>
        [row.item.name, row.item.code, row.batchNumber, row.vendorBatchNumber ?? ''].some((value) =>
          value.toLowerCase().includes(term),
        ),
      )
      .map((row) => row.item.id),
  );
}

/**
 * A principal's material is held, in full, for the job-work order it was
 * received against: the job-work flow will not issue it to any other order.
 */
function principalHold(lot: {
  ownership: string;
  quantityAvailable: Prisma.Decimal;
  jobWorkMaterialReceiptLine: {
    receipt: { jobWorkOrder: { id: string; orderNumber: string } };
  } | null;
}): HeldFor[] {
  const order = lot.jobWorkMaterialReceiptLine?.receipt.jobWorkOrder;

  if (lot.ownership !== 'PRINCIPAL_OWNED' || !order) return [];

  return [
    {
      kind: 'JOB_WORK_ORDER',
      orderId: order.id,
      orderNumber: order.orderNumber,
      quantity: lot.quantityAvailable,
    },
  ];
}

/** Open allocations per batch, summed per sales order, net of dispatch. */
function groupReservations(
  allocations: {
    batchId: string;
    quantityAllocated: Prisma.Decimal;
    quantityDispatched: Prisma.Decimal;
    salesOrder: { id: string; orderNumber: string };
  }[],
) {
  const byBatch = new Map<string, Map<string, { number: string; quantity: Prisma.Decimal }>>();

  for (const allocation of allocations) {
    const remaining = allocation.quantityAllocated.minus(allocation.quantityDispatched);

    if (remaining.lessThanOrEqualTo(0)) continue;

    const orders = byBatch.get(allocation.batchId) ?? new Map();
    const existing = orders.get(allocation.salesOrder.id);

    orders.set(allocation.salesOrder.id, {
      number: allocation.salesOrder.orderNumber,
      quantity: existing ? existing.quantity.plus(remaining) : remaining,
    });
    byBatch.set(allocation.batchId, orders);
  }

  return new Map(
    [...byBatch].map(([batchId, orders]) => [
      batchId,
      [...orders].map(([orderId, order]): HeldFor => ({
        kind: 'SALES_ORDER',
        orderId,
        orderNumber: order.number,
        quantity: order.quantity,
      })),
    ]),
  );
}

function toRow(input: {
  id: string;
  source: StockBatchRow['source'];
  batchNumber: string;
  vendorBatchNumber: string | null;
  manufacturingDate: Date | null;
  expiryDate: Date | null;
  status: StockBatchStatus;
  principalOwned: boolean;
  available: Prisma.Decimal;
  reservations: HeldFor[];
  item: StockItemGroup['item'];
  now: Date;
}): Row {
  const allocated = input.reservations.reduce((sum, r) => sum.plus(r.quantity), ZERO);
  // Never more than is on hand: dispatch lowers both together, so this only
  // guards against a row that drifted, rather than showing negative free stock.
  const reserved = Prisma.Decimal.min(allocated, input.available);
  const free = input.available.minus(reserved);

  const reservationState: ReservationState = reserved.isZero()
    ? 'FREE'
    : free.isZero()
      ? 'RESERVED'
      : 'PARTIALLY_RESERVED';

  const reservations: StockReservation[] = input.reservations.map((r) => ({
    kind: r.kind,
    orderId: r.orderId,
    orderNumber: r.orderNumber,
    quantity: qty(r.quantity),
  }));

  return {
    id: input.id,
    source: input.source,
    batchNumber: input.batchNumber,
    vendorBatchNumber: input.vendorBatchNumber,
    manufacturingDate: input.manufacturingDate ? toIsoDate(input.manufacturingDate) : null,
    expiryDate: input.expiryDate ? toIsoDate(input.expiryDate) : null,
    daysToExpiry: input.expiryDate ? daysUntil(input.expiryDate, input.now) : null,
    status: input.status,
    principalOwned: input.principalOwned,
    quantityAvailable: qty(input.available),
    reservedQuantity: qty(reserved),
    freeQuantity: qty(free),
    reservationState,
    reservations,
    item: input.item,
    available: input.available,
    reserved,
  };
}

function matches(row: Row, query: StockEnquiryQuery): boolean {
  if (query.status && row.status !== query.status) return false;
  if (query.reservation && row.reservationState !== query.reservation) return false;

  if (query.expiringWithin !== undefined) {
    if (row.daysToExpiry === null || row.daysToExpiry > query.expiringWithin) return false;
  }

  return true;
}

function toGroups(rows: Row[]): StockItemGroup[] {
  const byItem = new Map<string, Row[]>();

  for (const row of rows) {
    byItem.set(row.item.id, [...(byItem.get(row.item.id) ?? []), row]);
  }

  return [...byItem.values()]
    .map((batches) => {
      const available = batches.reduce((sum, b) => sum.plus(b.available), ZERO);
      const reserved = batches.reduce((sum, b) => sum.plus(b.reserved), ZERO);

      return {
        item: batches[0]!.item,
        quantityAvailable: qty(available),
        reservedQuantity: qty(reserved),
        freeQuantity: qty(available.minus(reserved)),
        // First-expiry-first: the order stock should be used in.
        batches: batches
          .sort(
            (a, b) =>
              (a.expiryDate ?? '9999-12-31').localeCompare(b.expiryDate ?? '9999-12-31') ||
              a.batchNumber.localeCompare(b.batchNumber),
          )
          .map(({ item: _item, available: _a, reserved: _r, ...batch }) => batch),
      };
    })
    .sort((a, b) => a.item.name.localeCompare(b.item.name));
}

/** A `@db.Date` column as YYYY-MM-DD. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
