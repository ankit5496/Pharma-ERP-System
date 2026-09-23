import { Injectable } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import {
  type BillingModel,
  type JobWorkMaterialReadiness,
  type JobWorkMaterialReadinessLine,
} from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import {
  stockBucketFor,
  stockBucketWhere,
  type StockBucketRule,
} from '../production/job-work-tagging';
import {
  issuableStockWhere,
  toItemSummary,
  type ItemRow,
} from '../production/production.mappers';

import { JobWorkOrdersService, parseQuantity } from './job-work-orders.service';

const ZERO = new Prisma.Decimal(0);

/**
 * Can this job-work order be manufactured, and if not, why not.
 *
 * ONE ANSWER, TWO AUDIENCES. The Production screen shows this as a table before
 * anybody presses the button, and the work-order service refuses on the same
 * figures. They are the same call: a screen that says "Ready" over a service
 * that then says "short 2 kg" is worse than no screen at all, and the only way
 * to be sure they agree is for there to be one piece of arithmetic.
 *
 * THE BILLING MODEL DECIDES WHICH POOL IS COUNTED, and that is the whole
 * difference between the two flows:
 *
 *   PURE CONVERSION counts the principal's own material received against THIS
 *   order. Company-owned stock of the identical item is invisible to it —
 *   converting their material is the job, and ours is not interchangeable with
 *   it however similar the two drums look.
 *
 *   OWN PROCUREMENT counts company-owned released stock, less what other work
 *   orders have already been raised against. Two work orders that each pass on
 *   the same 100 kg are two work orders that cannot both be issued.
 *
 * ELIGIBLE IS NOT THE SAME AS RECEIVED. A quantity counts only when it is the
 * right material in the right bucket, in date, released by QC where QC was
 * required, and not already consumed. The gap between received and eligible is
 * usually the interesting part of the screen, so the figures that explain it
 * are returned alongside rather than folded away.
 */
@Injectable()
export class JobWorkReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: JobWorkOrdersService,
  ) {}

  /**
   * @param batchSize what to work the requirement out for; the order's own
   *   quantity when the caller has no other figure in mind.
   */
  async forOrder(jobWorkOrderId: string, batchSize?: string): Promise<JobWorkMaterialReadiness> {
    const order = await this.orders.requireOrder(jobWorkOrderId);
    const billingModel = order.billingModel as BillingModel;
    // The same rule the work order and the material issue apply, from the same
    // helper — so the pool this screen measures is the pool they will draw on.
    const bucket = stockBucketFor({
      jobWorkOrderId: order.id,
      jobWorkBillingModel: billingModel,
    });

    const quantity = batchSize ? parseQuantity(batchSize, 'batchSize') : order.quantity;

    const product = await this.prisma.scoped.item.findFirstOrThrow({
      where: { id: order.mapping.bom.product.id },
    });

    const base = {
      jobWorkOrderId: order.id,
      jobWorkOrderNumber: order.orderNumber,
      principalId: order.principal.id,
      principalName: order.principal.name,
      agreementId: order.agreement.id,
      agreementReference: order.agreement.agreementReference,
      billingModel,
      product: toItemSummary(product),
      principalBrandName: order.mapping.principalBrandName,
      stockBucket: bucket.ownership,
      batchSize: quantity.toString(),
    };

    if (quantity.lessThanOrEqualTo(ZERO)) {
      return {
        ...base,
        bomId: order.mapping.bomId,
        bomVersion: 0,
        bomOutputQuantity: '0',
        lines: [],
        ready: false,
        blockedReason: 'The batch size has to be more than zero.',
      };
    }

    // THE BOM THE WORK ORDER WILL ACTUALLY USE. ProductionService reads the
    // product's ACTIVE formulation when it raises the order, so that is what
    // has to be measured here — reading the version pinned to the agreement
    // instead would produce a table that passes and a work order that fails.
    const bom = await this.prisma.scoped.bom.findFirst({
      where: { productId: product.id, isActive: true, deletedAt: null },
      include: { lines: { include: { item: true }, orderBy: { item: { code: 'asc' } } } },
    });

    if (!bom) {
      return {
        ...base,
        bomId: order.mapping.bomId,
        bomVersion: 0,
        bomOutputQuantity: '0',
        lines: [],
        ready: false,
        blockedReason:
          `${base.product.name} has no active formulation, so there is nothing to work a ` +
          'material requirement out from. Create one under Formulations first.',
      };
    }

    if (bom.lines.length === 0) {
      return {
        ...base,
        bomId: bom.id,
        bomVersion: bom.version,
        bomOutputQuantity: bom.outputQuantity.toString(),
        lines: [],
        ready: false,
        blockedReason:
          `Formulation version ${bom.version} lists no materials, so nothing could be issued.`,
      };
    }

    // US-MD-06, and the third thing ProductionService checks. A product needs
    // both a recipe and a pack before anyone starts making it: without this the
    // batch reaches the packing line with no specification to work to, and the
    // work order is refused at the point of saving — after this screen has said
    // it was ready.
    // Counted here rather than asked of PackagingService: that module imports
    // ProcurementModule, which imports this one, so importing it back closes a
    // ring Nest refuses to start. The predicate is PackagingService's own,
    // verbatim — if that one changes, this has to change with it.
    const packSpecifications = await this.prisma.scoped.packagingRequirement.count({
      where: { productId: product.id, isActive: true, deletedAt: null },
    });

    if (packSpecifications === 0) {
      return {
        ...base,
        bomId: bom.id,
        bomVersion: bom.version,
        bomOutputQuantity: bom.outputQuantity.toString(),
        lines: [],
        ready: false,
        blockedReason:
          `${product.name} has no active packaging requirement, so the batch would reach the ` +
          'packing line with no pack specification to work to. Add one under Master data → ' +
          'Packaging Requirement, and make sure it is active.',
      };
    }

    if (order.agreement.billingModel !== billingModel) {
      // The order froze its model; the agreement has since been renegotiated.
      // Worth saying out loud rather than silently measuring the wrong pool.
      return {
        ...base,
        bomId: bom.id,
        bomVersion: bom.version,
        bomOutputQuantity: bom.outputQuantity.toString(),
        lines: [],
        ready: false,
        blockedReason:
          `${order.orderNumber} was raised on a different billing model from the one its ` +
          'agreement now carries. Raise a fresh order under the current agreement.',
      };
    }

    const scale = quantity.div(bom.outputQuantity);
    const itemIds = bom.lines.map((line) => line.itemId);

    const lines = await this.measure(itemIds, bom.lines, scale, bucket, order.id);

    const short = lines.filter((line) => !line.ready);

    return {
      ...base,
      bomId: bom.id,
      bomVersion: bom.version,
      bomOutputQuantity: bom.outputQuantity.toString(),
      lines,
      ready: short.length === 0,
      blockedReason:
        short.length === 0
          ? null
          : 'Material shortage: ' +
            short
              .map(
                (line) =>
                  `${line.item.code} — required ${line.requiredQuantity} ${line.item.uom}, ` +
                  `available ${line.eligibleQuantity}, short ${line.shortageQuantity}`,
              )
              .join('; '),
    };
  }

  /**
   * How much of each material there is, and why the rest does not count.
   *
   * Four reads rather than one per material: the lots, what other work orders
   * have committed, and — under pure conversion — what was received in the
   * first place. Everything else is arithmetic.
   */
  private async measure(
    itemIds: string[],
    bomLines: readonly { itemId: string; quantityPer: Prisma.Decimal; item: ItemRow }[],
    scale: Prisma.Decimal,
    bucket: StockBucketRule,
    jobWorkOrderId: string,
  ): Promise<JobWorkMaterialReadinessLine[]> {
    const principalOwned = bucket.ownership === 'PRINCIPAL_OWNED';

    const where = { itemId: { in: itemIds }, ...stockBucketWhere(bucket) };

    const [lots, received, committed] = await Promise.all([
      // EVERY lot in the bucket, whatever its state. The eligible figure is one
      // filter over these; the quarantined, held and expired figures are the
      // others, and showing them is what turns "short" into something a person
      // can act on.
      this.prisma.scoped.stockLot.findMany({
        where,
        select: {
          itemId: true,
          status: true,
          expiryDate: true,
          quantityAvailable: true,
        },
      }),

      principalOwned
        ? this.prisma.scoped.jobWorkMaterialReceiptLine.findMany({
            where: {
              deletedAt: null,
              itemId: { in: itemIds },
              receipt: { jobWorkOrderId, deletedAt: null },
            },
            select: { itemId: true, receivedQuantity: true },
          })
        : Promise.resolve([]),

      // WHAT OTHER WORK ORDERS HAVE ALREADY SPOKEN FOR — own procurement only.
      //
      // There is no reservation table, and inventing one would mean a second
      // place that can disagree with the truth. A commitment is derivable from
      // what already exists: an open work order's formulation requirement, less
      // what has actually been issued against it. Two work orders raised on the
      // same 100 kg are two work orders that cannot both be fulfilled, and this
      // is what makes the second one fail at the point it is raised rather than
      // at the point somebody tries to dispense.
      //
      // Principal-owned material needs none of this: a receipt belongs to one
      // job-work order, so there is nobody else to compete with it.
      principalOwned ? Promise.resolve([]) : this.committedToOpenOrders(itemIds),
    ]);

    const receivedByItem = fold(received, (row) => row.itemId, (row) => row.receivedQuantity);
    const committedByItem = new Map(committed.map((row) => [row.itemId, row.quantity]));

    const cutoff = shelfLifeCutoff();

    return bomLines.map((bomLine) => {
      const itemLots = lots.filter((lot) => lot.itemId === bomLine.itemId);
      const item = toItemSummary(bomLine.item);

      const required = bomLine.quantityPer.mul(scale).toDecimalPlaces(3);

      const usableInDate = itemLots.filter(
        (lot) =>
          lot.status === 'USABLE' &&
          lot.quantityAvailable.greaterThan(ZERO) &&
          (lot.expiryDate === null || lot.expiryDate >= cutoff),
      );

      const inStock = sum(usableInDate.map((lot) => lot.quantityAvailable));
      const committedHere = committedByItem.get(bomLine.itemId) ?? ZERO;

      // Under own procurement the pool is shared, so what is already promised
      // comes off. Under pure conversion it is not shared, so nothing does.
      const eligible = principalOwned
        ? inStock
        : Prisma.Decimal.max(ZERO, inStock.sub(committedHere));

      const shortage = Prisma.Decimal.max(ZERO, required.sub(eligible)).toDecimalPlaces(3);

      return {
        item,
        requiredQuantity: required.toString(),

        receivedQuantity: principalOwned
          ? (receivedByItem.get(bomLine.itemId) ?? ZERO).toString()
          : null,

        eligibleQuantity: eligible.toDecimalPlaces(3).toString(),

        availableStock: principalOwned ? null : inStock.toDecimalPlaces(3).toString(),
        reservedQuantity: principalOwned ? null : committedHere.toDecimalPlaces(3).toString(),

        shortageQuantity: shortage.toString(),

        quantityAwaitingQc: sum(
          itemLots.filter((lot) => lot.status === 'QUARANTINE').map((l) => l.quantityAvailable),
        )
          .toDecimalPlaces(3)
          .toString(),
        quantityRejectedOrHeld: sum(
          itemLots
            .filter((lot) => lot.status === 'REJECTED' || lot.status === 'ON_HOLD')
            .map((l) => l.quantityAvailable),
        )
          .toDecimalPlaces(3)
          .toString(),
        quantityExpired: sum(
          itemLots
            .filter(
              (lot) =>
                lot.status === 'USABLE' && lot.expiryDate !== null && lot.expiryDate < cutoff,
            )
            .map((l) => l.quantityAvailable),
        )
          .toDecimalPlaces(3)
          .toString(),

        ready: shortage.equals(ZERO),
      };
    });
  }

  /**
   * What open work orders still need but have not yet drawn.
   *
   * An order that has been raised and not yet fully issued is holding stock in
   * everything but name. PLANNED and MATERIAL_ISSUED are the two states where
   * that is true; once a batch is in progress the material has left the shelf
   * and is already off `quantityAvailable`, so counting it again here would
   * deduct it twice.
   */
  async committedToOpenOrders(
    itemIds: string[],
  ): Promise<{ itemId: string; quantity: Prisma.Decimal }[]> {
    const open = await this.prisma.scoped.productionOrder.findMany({
      where: { deletedAt: null, status: { in: ['PLANNED', 'MATERIAL_ISSUED'] } },
      select: {
        id: true,
        plannedQuantity: true,
        productId: true,
      },
    });

    if (open.length === 0) return [];

    const boms = await this.prisma.scoped.bom.findMany({
      where: {
        productId: { in: open.map((order) => order.productId) },
        isActive: true,
        deletedAt: null,
      },
      select: {
        productId: true,
        outputQuantity: true,
        lines: { where: { itemId: { in: itemIds } }, select: { itemId: true, quantityPer: true } },
      },
    });

    const bomByProduct = new Map(boms.map((bom) => [bom.productId, bom]));

    const issued = await this.prisma.scoped.materialIssueLine.findMany({
      where: {
        itemId: { in: itemIds },
        materialIssue: { productionOrderId: { in: open.map((order) => order.id) } },
      },
      select: {
        itemId: true,
        quantityIssued: true,
        materialIssue: { select: { productionOrderId: true } },
      },
    });

    const issuedByOrderItem = new Map<string, Prisma.Decimal>();

    for (const line of issued) {
      const key = `${line.materialIssue.productionOrderId}:${line.itemId}`;

      issuedByOrderItem.set(key, (issuedByOrderItem.get(key) ?? ZERO).add(line.quantityIssued));
    }

    const byItem = new Map<string, Prisma.Decimal>();

    for (const order of open) {
      const bom = bomByProduct.get(order.productId);

      if (!bom) continue;

      const scale = order.plannedQuantity.div(bom.outputQuantity);

      for (const line of bom.lines) {
        const needs = line.quantityPer.mul(scale);
        const already = issuedByOrderItem.get(`${order.id}:${line.itemId}`) ?? ZERO;
        const outstanding = Prisma.Decimal.max(ZERO, needs.sub(already));

        byItem.set(line.itemId, (byItem.get(line.itemId) ?? ZERO).add(outstanding));
      }
    }

    return [...byItem].map(([itemId, quantity]) => ({ itemId, quantity }));
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function sum(values: readonly Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((total, value) => total.add(value), ZERO);
}

function fold<T>(
  rows: readonly T[],
  key: (row: T) => string,
  value: (row: T) => Prisma.Decimal,
): Map<string, Prisma.Decimal> {
  const out = new Map<string, Prisma.Decimal>();

  for (const row of rows) out.set(key(row), (out.get(key(row)) ?? ZERO).add(value(row)));

  return out;
}

/**
 * The date a lot has to outlive to be worth issuing.
 *
 * The same margin `issuableStockWhere` applies, read off it rather than
 * restated: two definitions of "too near expiry" is one more than the number
 * that can be correct.
 */
function shelfLifeCutoff(): Date {
  // Read off the predicate the FEFO allocator actually dispenses against,
  // rather than restated here: two definitions of "too near expiry" is one more
  // than the number that can be correct. The shape is this module's own, so the
  // narrowing below is a type-system formality rather than a real doubt.
  const [dated] = issuableStockWhere().OR;

  if (!dated?.expiryDate?.gte) {
    throw new Error(
      'issuableStockWhere no longer expresses a shelf-life cutoff, so readiness cannot ' +
        'agree with the allocator about what is too near expiry.',
    );
  }

  return dated.expiryDate.gte;
}
