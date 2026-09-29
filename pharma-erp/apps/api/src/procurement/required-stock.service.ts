import { Injectable, Logger } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  AutoRequisitionOutcome,
  RequiredMaterialKind,
  RequiredStockLine,
  RequisitionTriggerType,
  SalesOrderStatusValue,
} from '@pharma-erp/types';
import { REQUIRED_STOCK_SALES_ORDER_STATUSES } from '@pharma-erp/types';

import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { loadRecipes, scaleRecipe } from '../production/material-requirements';
import { TenantContextService } from '../tenant/tenant-context.service';

import { ZERO, pendingOn, qty } from './decimal.util';
import { toItemSummary } from './mappers';
import { NumberingService } from './numbering.service';
import { SettingsService } from './settings.service';

/**
 * What live sales orders need, and what has to be bought to serve them.
 *
 * THE SALES ORDER IS THE SOURCE OF TRUTH. This replaces a reorder check that
 * compared each item's usable stock against a level typed on the item master.
 * That answered "are we low on this?", which is a question about the shelf; it
 * could not answer "can we make what we have promised?", which is the question
 * a buyer actually has. A reorder level is a guess at future demand. A sales
 * order IS the demand.
 *
 * SO THERE IS NO REORDER LEVEL, NO REORDER QUANTITY AND NO THRESHOLD in any of
 * the arithmetic below. Every figure comes from the order, the product's active
 * formulation, its pack specification, and the stock ledger.
 *
 * THE CHAIN, AND WHY EACH LINK IS A REFERENCE RATHER THAN A COPY:
 *
 *   sales order line (product + quantity still owed)
 *     -> the product's active BOM and pack specification
 *     -> one required quantity per raw material and packing component
 *     -> free stock, shared out between competing orders
 *     -> shortfall
 *     -> a purchase requisition, when Auto is on
 *
 * Nothing here is stored. A required-stock line is a CALCULATION over records
 * that already exist, so there is no table to fall out of step with the orders
 * it came from — which is also why the sales order form can change shape
 * without this needing to know.
 */
@Injectable()
export class RequiredStockService {
  private readonly logger = new Logger(RequiredStockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Every material every live sales order still needs.
   *
   * ONE TRANSACTION for the whole read. Each operation on `prisma.scoped` opens
   * a transaction of its own — four round trips per query against this database
   * — and this reads six things. See `material-requirements.ts` for the
   * measurement.
   */
  async lines(): Promise<RequiredStockLine[]> {
    const rows = await this.prisma.transaction(async (tx) => {
      const orders = await tx.salesOrder.findMany({
        where: {
          deletedAt: null,
          status: { in: [...REQUIRED_STOCK_SALES_ORDER_STATUSES] },
        },
        select: {
          id: true,
          orderNumber: true,
          orderDate: true,
          requestedDeliveryDate: true,
          status: true,
          customer: { select: { name: true } },
          items: {
            where: { status: { not: 'CANCELLED' } },
            select: {
              id: true,
              quantityOrdered: true,
              quantityDispatched: true,
              item: true,
            },
            orderBy: { lineNumber: 'asc' },
          },
        },
        // EARLIEST WANTED FIRST, because that is the order stock is shared out
        // in below. An order due next week has a better claim on the shelf than
        // one due next month, and the tie-break keeps the answer stable between
        // reloads rather than depending on which row the database returned
        // first.
        orderBy: [{ requestedDeliveryDate: { sort: 'asc', nulls: 'last' } }, { orderNumber: 'asc' }],
      });

      const products = orders
        .flatMap((order) => order.items)
        .map((line) => ({ id: line.item.id, name: line.item.name }));

      if (products.length === 0) {
        return {
          orders,
          recipes: new Map(),
          free: new Map<string, Prisma.Decimal>(),
          reservedByLine: new Map<string, Prisma.Decimal>(),
          openByKey: new Map<string, { number: string; triggerType: RequisitionTriggerType }>(),
          onOrder: new Set<string>(),
        };
      }

      const recipes = await loadRecipes(tx, products);

      // WHAT IS ACTUALLY FREE, and "free" is doing two jobs here.
      //
      // USABLE LOTS ONLY: material in quarantine has not passed QC and cannot
      // lawfully be dispensed, so counting it would suppress a purchase that
      // genuinely has to happen. Rejected and held stock is excluded for the
      // same reason and never appears in any figure below.
      //
      // LESS WHAT IS RESERVED: material held for a sales order is not free for
      // a different one. Without this, one drum bought for order A would report
      // order B as covered too, and the shortage would only surface when
      // somebody went to the shelf.
      const [usable, reservations] = await Promise.all([
        tx.stockLot.groupBy({
          by: ['itemId'],
          where: { status: 'USABLE' },
          _sum: { quantityAvailable: true },
        }),
        tx.stockReservation.findMany({
          where: { releasedAt: null, stockLot: { status: 'USABLE' } },
          select: { quantity: true, salesOrderItemId: true, stockLot: { select: { itemId: true } } },
        }),
      ]);

      // Held per (material, order line) AND in total. Both, because a line's
      // OWN hold is available to it — see `build`.
      const reservedByLine = new Map<string, Prisma.Decimal>();
      const reservedByItem = new Map<string, Prisma.Decimal>();

      for (const row of reservations) {
        const itemId = row.stockLot.itemId;
        const key = `${row.salesOrderItemId}:${itemId}`;

        reservedByLine.set(key, (reservedByLine.get(key) ?? ZERO).plus(row.quantity));
        reservedByItem.set(itemId, (reservedByItem.get(itemId) ?? ZERO).plus(row.quantity));
      }

      // The pool nobody has spoken for. Floored: a hold larger than what is
      // left is stale rather than negative stock.
      const free = new Map(
        usable.map((row) => {
          const held = reservedByItem.get(row.itemId) ?? ZERO;
          const pool = (row._sum.quantityAvailable ?? ZERO).sub(held);

          return [row.itemId, Prisma.Decimal.max(pool, ZERO)] as const;
        }),
      );

      // SHORTAGES ALREADY BEING DEALT WITH, so the screen can say so and Auto
      // can decline to raise a second document for the same one.
      const [open, ordered] = await Promise.all([
        tx.purchaseRequisition.findMany({
          where: { deletedAt: null, status: { in: ['OPEN', 'APPROVED'] } },
          select: {
            number: true,
            itemId: true,
            salesOrderItemId: true,
            // HOW IT CAME TO EXIST, for the Trigger type column. Read rather
            // than inferred: a requisition raised by hand while Auto was on is
            // still MANUAL, and deciding it from the switch would say otherwise.
            triggerType: true,
          },
        }),
        tx.purchaseOrderLine.findMany({
          where: { purchaseOrder: { deletedAt: null, status: { notIn: ['DRAFT', 'CANCELLED'] } } },
          select: {
            itemId: true,
            quantity: true,
            quantityReceived: true,
            quantityCancelled: true,
          },
        }),
      ]);

      // KEYED ON THE SHORTAGE, not on the item. Two sales orders short of the
      // same material are two shortages and want two requisitions — one order
      // being dealt with does not feed the other. A requisition with no sales
      // order line behind it (raised by hand) covers the item generally, and is
      // keyed that way.
      const openByKey = new Map<string, { number: string; triggerType: RequisitionTriggerType }>();

      for (const requisition of open) {
        openByKey.set(keyFor(requisition.salesOrderItemId, requisition.itemId), {
          number: requisition.number,
          triggerType: requisition.triggerType as RequisitionTriggerType,
        });
      }

      const onOrder = new Set(
        ordered.filter((line) => pendingOn(line).greaterThan(0)).map((line) => line.itemId),
      );

      return { orders, recipes, free, reservedByLine, openByKey, onOrder };
    });

    return this.build(rows);
  }

  /**
   * The calculation, kept separate from the reads so it can be reasoned about.
   *
   * `free` is MUTATED as it goes: each line takes what it can from the shelf
   * and leaves the rest for the orders behind it. That is the whole reason the
   * orders arrive sorted by delivery date.
   */
  private build({
    orders,
    recipes,
    free,
    reservedByLine,
    openByKey,
    onOrder,
  }: {
    orders: SalesOrderRow[];
    recipes: Awaited<ReturnType<typeof loadRecipes>>;
    free: Map<string, Prisma.Decimal>;
    reservedByLine: Map<string, Prisma.Decimal>;
    /** Keyed on the shortage; the value is the document and how it was raised. */
    openByKey: Map<string, { number: string; triggerType: RequisitionTriggerType }>;
    onOrder: Set<string>;
  }): RequiredStockLine[] {
    const lines: RequiredStockLine[] = [];

    for (const order of orders) {
      for (const orderLine of order.items) {
        // WHAT IS STILL OWED, not what was ordered. Material for the half of an
        // order already dispatched has been consumed; asking for it again would
        // buy it twice.
        const outstanding = orderLine.quantityOrdered.sub(orderLine.quantityDispatched);

        if (outstanding.lessThanOrEqualTo(0)) continue;

        const recipe = recipes.get(orderLine.item.id);
        const requirement = scaleRecipe(recipe, outstanding);

        const shared = {
          salesOrderId: order.id,
          salesOrderNumber: order.orderNumber,
          salesOrderItemId: orderLine.id,
          customerName: order.customer.name,
          orderDate: order.orderDate.toISOString().slice(0, 10),
          requestedDeliveryDate: order.requestedDeliveryDate
            ? order.requestedDeliveryDate.toISOString().slice(0, 10)
            : null,
          salesOrderStatus: order.status as SalesOrderStatusValue,
          finishedProduct: toItemSummary(orderLine.item),
          productQuantity: qty(outstanding),
          packVariant: recipe?.packaging?.packVariant ?? null,
        };

        // NO FORMULATION IS A ROW, NOT A SILENCE. A product nobody has written
        // a BOM for needs materials all the same, and a tab that simply omits
        // it reports "nothing to buy" for an order that cannot be made.
        if (typeof requirement === 'string') {
          lines.push({
            ...shared,
            id: `${orderLine.id}:none`,
            materialType: 'RAW',
            material: toItemSummary(orderLine.item),
            requiredQuantity: '0',
            availableQuantity: '0',
            shortfallQuantity: '0',
            blockedReason: requirement,
            hasOpenRequisition: false,
            hasOpenPurchaseOrder: false,
            requisitionNumber: null,
            triggerType: null,
          });

          continue;
        }

        for (const material of requirement) {
          // WHAT THIS LINE MAY DRAW ON: its own reservation first, then the
          // unspoken-for pool.
          //
          // ITS OWN HOLD COUNTS AS AVAILABLE TO IT, and that is not a detail.
          // Material bought for this very order line is reserved to it the
          // moment QC accepts — so netting every reservation off would show
          // the order that paid for it as still short, and Auto would buy the
          // same thing again on the next page load.
          const ownHold = reservedByLine.get(`${orderLine.id}:${material.item.id}`) ?? ZERO;
          const fromOwnHold = Prisma.Decimal.min(ownHold, material.quantity);

          const stillNeeded = material.quantity.sub(fromOwnHold);
          const pool = free.get(material.item.id) ?? ZERO;

          // TAKEN OFF THE SHELF FOR THIS LINE, so the next order sees what is
          // genuinely left. `Decimal.min` rather than a comparison so a partial
          // cover is shared correctly rather than all-or-nothing.
          const fromPool = Prisma.Decimal.min(pool, stillNeeded);

          const taken = fromOwnHold.plus(fromPool);
          const shortfall = material.quantity.sub(taken);

          free.set(material.item.id, pool.sub(fromPool));

          const existing = openByKey.get(keyFor(orderLine.id, material.item.id));

          lines.push({
            ...shared,
            id: `${orderLine.id}:${material.item.id}`,
            materialType: material.kind as RequiredMaterialKind,
            material: material.item,
            requiredQuantity: qty(material.quantity),
            availableQuantity: qty(taken),
            shortfallQuantity: qty(shortfall),
            blockedReason: null,
            hasOpenRequisition: existing !== undefined,
            hasOpenPurchaseOrder: onOrder.has(material.item.id),
            requisitionNumber: existing?.number ?? null,
            triggerType: existing?.triggerType ?? null,
          });
        }
      }
    }

    return lines;
  }

  /**
   * Raises a purchase requisition for every shortage that has none.
   *
   * THE QUANTITY IS THE SHORTFALL, and that is the change this whole round is
   * about. It used to be the item master's reorder quantity — a fixed figure
   * with no relationship to what anybody had ordered. Now it is exactly what
   * the sales order needs and the shelf cannot cover.
   *
   * IDEMPOTENT, keyed on (sales order line, material). Opening the tab twice
   * raises nothing the second time, and two orders short of the same material
   * get one requisition each rather than one between them.
   *
   * AUTO CAN BE SWITCHED OFF, per company. When it is, this still runs and
   * still reports every shortage it would have raised — knowing is useful
   * whether or not the system may act — but it writes nothing.
   */
  async autoRaise(): Promise<AutoRequisitionOutcome> {
    const tenantId = this.tenantContext.requireTenantId();
    const autoCreationEnabled = await this.settings.autoCreationEnabled();

    const lines = await this.lines();

    const shortages = lines.filter(
      (line) =>
        line.blockedReason === null &&
        new Prisma.Decimal(line.shortfallQuantity).greaterThan(0) &&
        !line.hasOpenRequisition,
    );

    const created: string[] = [];
    const skipped: { material: string; reason: string }[] = [];

    if (shortages.length === 0) return { created, skipped, autoCreationEnabled };

    if (!autoCreationEnabled) {
      for (const line of shortages) {
        skipped.push({
          material: `${line.material.code} for ${line.salesOrderNumber}`,
          reason:
            `Short by ${line.shortfallQuantity} ${line.material.uom}, but Auto creation is ` +
            'switched off. Raise a requisition on the form.',
        });
      }

      return { created, skipped, autoCreationEnabled };
    }

    // ONE TRANSACTION for the whole pass: the sequence numbers it consumes and
    // the rows it writes have to commit together, or a failure halfway leaves
    // gaps in a numbering series an auditor expects to be contiguous.
    const outcome = await this.prisma.transaction(async (tx) => {
      const ids: { id: string; number: string }[] = [];

      for (const line of shortages) {
        // RE-CHECKED INSIDE THE TRANSACTION. `lines()` read a moment ago and
        // two people can open this tab at once; the guard that matters is the
        // one holding a lock.
        const already = await tx.purchaseRequisition.findFirst({
          where: {
            deletedAt: null,
            status: { in: ['OPEN', 'APPROVED'] },
            salesOrderItemId: line.salesOrderItemId,
            itemId: line.material.id,
          },
          select: { number: true },
        });

        if (already) {
          skipped.push({
            material: `${line.material.code} for ${line.salesOrderNumber}`,
            reason: `Requisition ${already.number} is already open for this shortage.`,
          });
          continue;
        }

        const number = await this.numbering.next(tx, tenantId, 'PR');

        const requisition = await tx.purchaseRequisition.create({
          data: {
            tenantId,
            number,
            itemId: line.material.id,

            // THE TRAIL, AND ONLY THE TRAIL. Two references, and nothing
            // copied: the finished product, the ordered quantity and the pack
            // variant are all read back through the sales order line, which is
            // the source of truth for each of them. Copying them onto the
            // requisition would be a second version of the same fact, free to
            // drift, and packaging in particular has no business on a document
            // that requests one material.
            salesOrderId: line.salesOrderId,
            salesOrderItemId: line.salesOrderItemId,

            stockAtRequest: new Prisma.Decimal(line.availableQuantity),
            // NULL, not zero. There is no reorder level behind this document —
            // see the column's own note for why the field survives at all.
            reorderLevelAtRequest: null,
            requiredQuantity: new Prisma.Decimal(line.shortfallQuantity),

            triggerType: 'AUTO_REORDER',
            // No author: the system raised it. Attributing it to whoever
            // happened to open the tab would be a lie in the trail.
            requestedById: null,
            status: 'OPEN',
            notes:
              `Raised automatically: ${line.salesOrderNumber} needs ` +
              `${line.requiredQuantity} ${line.material.uom} of ${line.material.code} for ` +
              `${line.productQuantity} of ${line.finishedProduct.code}, and only ` +
              `${line.availableQuantity} is free.`,
          },
          select: { id: true, number: true },
        });

        ids.push(requisition);

        this.logger.log(
          `Auto-raised ${requisition.number}: ${line.material.code} short by ` +
            `${line.shortfallQuantity} for ${line.salesOrderNumber}`,
        );
      }

      return ids;
    });

    // Audited outside the transaction: AuditService never throws, and a failure
    // to record must not roll back requisitions that were correctly raised.
    for (const requisition of outcome) {
      created.push(requisition.number);

      await this.audit.record({
        entityType: 'PurchaseRequisition',
        entityId: requisition.id,
        action: 'CREATE',
        after: { trigger: 'AUTO_REORDER', raisedBy: 'system', source: 'sales order requirement' },
      });
    }

    return { created, skipped, autoCreationEnabled };
  }
}

type SalesOrderRow = {
  id: string;
  orderNumber: string;
  orderDate: Date;
  requestedDeliveryDate: Date | null;
  status: string;
  customer: { name: string };
  items: {
    id: string;
    quantityOrdered: Prisma.Decimal;
    quantityDispatched: Prisma.Decimal;
    item: Prisma.ItemGetPayload<object>;
  }[];
};

/**
 * One shortage, named.
 *
 * A requisition with no sales order line behind it — raised by hand — keys on
 * the item alone, so it counts as covering that material generally. One raised
 * from a shortage keys on the line too, so two orders short of the same
 * material do not silently share a single document.
 */
function keyFor(salesOrderItemId: string | null, itemId: string): string {
  return `${salesOrderItemId ?? 'manual'}:${itemId}`;
}
