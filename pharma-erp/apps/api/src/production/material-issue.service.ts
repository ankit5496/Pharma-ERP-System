import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  MaterialIssueOverride,
  MaterialIssuePlan,
  MaterialIssuePlanLine,
  MaterialIssueView,
} from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../procurement/numbering.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import {
  assertLotInBucket,
  describeBucket,
  stockBucketFor,
  stockBucketWhere,
  type StockBucketRule,
} from './job-work-tagging';
import { issuableStockWhere, toIsoDate, toItemSummary } from './production.mappers';
import { ProductionService } from './production.service';

const ZERO = new Prisma.Decimal(0);

/**
 * Dispensing raw and packing material to the shop floor, FEFO.
 *
 * FEFO — First Expiry, First Out — rather than FIFO. In pharma the risk being
 * managed is stock expiring on the shelf, and the lot that arrived first is not
 * necessarily the one that expires first: a supplier may ship older stock, or a
 * later delivery may carry a shorter remaining life. Ordering by receipt date
 * would leave short-dated material to expire while newer stock is consumed.
 */
@Injectable()
export class MaterialIssueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly production: ProductionService,
    /** Allocates the MI-YYYY-NNNN dispensing note number. */
    private readonly numbering: NumberingService,
  ) {}

  /**
   * What issuing would consume, without writing anything.
   *
   * Separate from the act of issuing because dispensing is hard to reverse:
   * once material is weighed out against a batch, correcting a mistake means a
   * deviation report. Showing the plan — and any shortfall — first costs one
   * read.
   */
  async plan(productionOrderId: string): Promise<MaterialIssuePlan> {
    const order = await this.production.requireOrder(productionOrderId);

    // US-JW-03: which stock this order may draw on, derived from the billing
    // model pinned on it when it was raised. Own-brand orders get
    // COMPANY_OWNED, which is what every lot had before job work existed —
    // so this is a no-op for them.
    const bucket = stockBucketFor(order);

    // Scale the recipe to the order: a BOM states quantities per its own
    // output quantity, not per unit, so this is a ratio rather than a
    // multiplication by the order size.
    const scale = new Prisma.Decimal(order.plannedQuantity).div(order.bom.outputQuantity);

    const lines: MaterialIssuePlanLine[] = [];

    for (const bomLine of order.bom.lines) {
      const required = new Prisma.Decimal(bomLine.quantityPer).mul(scale);
      const allocations = await this.allocate(bomLine.itemId, required, bucket);

      const allocated = allocations.reduce(
        (total, allocation) => total.add(allocation.quantity),
        ZERO,
      );

      lines.push({
        item: toItemSummary(bomLine.item),
        quantityRequired: this.round(required).toString(),
        quantityAllocated: this.round(allocated).toString(),
        quantityShort: this.round(Prisma.Decimal.max(required.sub(allocated), ZERO)).toString(),
        allocations: allocations.map((allocation) => ({
          lotId: allocation.lot.id,
          lotNumber: allocation.lot.lotNumber,
          expiryDate: allocation.lot.expiryDate ? toIsoDate(allocation.lot.expiryDate) : null,
          quantity: this.round(allocation.quantity).toString(),
          quantityAvailable: allocation.lot.quantityAvailable.toString(),
        })),
      });
    }

    return {
      productionOrderId: order.id,
      orderNumber: order.orderNumber,
      canIssue:
        order.status === 'PLANNED' && lines.every((line) => line.quantityShort === ZERO.toString()),
      lines,
    };
  }

  /**
   * Dispenses against the order, consuming lots in expiry order.
   *
   * Everything happens in one transaction, and the lot decrements are
   * conditional: `updateMany` with a `quantityAvailable: { gte }` guard writes
   * nothing if another dispensing run took the stock first, and a count of 0
   * aborts the whole issue. Without that guard two concurrent issues would both
   * read the same availability and both succeed, leaving negative stock — which
   * the CHECK constraint would then reject with a message nobody can act on.
   */
  async issue(
    productionOrderId: string,
    overrides: readonly MaterialIssueOverride[] = [],
  ): Promise<MaterialIssueView> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const order = await this.production.requireOrder(productionOrderId);

    if (order.status !== 'PLANNED') {
      throw new ConflictException(
        `Material has already been issued against ${order.orderNumber} — its status is ` +
          `${order.status.toLowerCase().replace('_', ' ')}. Issuing twice would double-count ` +
          'consumption and corrupt the variance on the batch record.',
      );
    }

    const bucket = stockBucketFor(order);

    const plan = await this.applyOverrides(
      await this.plan(productionOrderId),
      overrides,
      bucket,
    );
    const short = plan.lines.filter((line) => line.quantityShort !== ZERO.toString());

    if (short.length > 0) {
      const detail = short
        .map((line) => `${line.item.code} (short ${line.quantityShort} ${line.item.uom})`)
        .join(', ');

      throw new BadRequestException(
        `Not enough ${describeBucket(bucket)} to issue ${order.orderNumber}: ${detail}. ` +
          'Only lots marked usable and not yet expired can be dispensed.' +
          (bucket.ownership === 'PRINCIPAL_OWNED'
            ? ' This is a pure-conversion job-work order, so company-owned stock cannot be' +
              ' substituted.'
            : ''),
      );
    }

    return this.prisma.transaction(async (tx) => {
      const issueNumber = await this.numbering.next(tx, tenantId, 'MI');

      const issue = await tx.materialIssue.create({
        data: { tenantId, issueNumber, productionOrderId: order.id, issuedById: userId },
      });

      for (const line of plan.lines) {
        for (const allocation of line.allocations) {
          const claimed = await tx.stockLot.updateMany({
            where: {
              id: allocation.lotId,
              status: 'USABLE',
              // CONTROL 5, in the write itself and not only in the read that
              // chose the lot. This is the statement that actually moves the
              // stock, so this is where the bucket has to hold: a lot whose
              // ownership does not match updates zero rows and aborts the
              // whole issue, even if something upstream proposed it.
              ...stockBucketWhere(bucket),
              // The guard: only decrement if the stock is still there.
              quantityAvailable: { gte: new Prisma.Decimal(allocation.quantity) },
            },
            data: { quantityAvailable: { decrement: new Prisma.Decimal(allocation.quantity) } },
          });

          if (claimed.count === 0) {
            throw new ConflictException(
              `Lot ${allocation.lotNumber} of ${line.item.code} no longer has ` +
                `${allocation.quantity} ${line.item.uom} available — it was consumed while this ` +
                'issue was being prepared. Nothing has been dispensed; review the plan and retry.',
            );
          }

          await tx.materialIssueLine.create({
            data: {
              tenantId,
              materialIssueId: issue.id,
              itemId: line.item.id,
              lotId: allocation.lotId,
              quantityIssued: new Prisma.Decimal(allocation.quantity),
              isFefoOverride: allocation.isFefoOverride ?? false,
              overrideReason: allocation.overrideReason ?? null,
            },
          });
        }
      }

      await tx.productionOrder.update({
        where: { id: order.id },
        data: { status: 'MATERIAL_ISSUED' },
      });

      const saved = await tx.materialIssue.findUniqueOrThrow({
        where: { id: issue.id },
        include: {
          productionOrder: { select: { orderNumber: true } },
          issuedBy: { select: { fullName: true } },
          lines: { include: { item: true, lot: true } },
        },
      });

      return this.toView(saved);
    });
  }

  /**
   * Every dispensing record, newest first — the Material issue register.
   *
   * Unbounded deliberately, for now: one row per work order that has been
   * dispensed against, and a company running a few batches a week takes years
   * to make this a page worth splitting. When it is, the fix is a cursor, not a
   * filter that hides older records from the register that exists to show them.
   */
  async list(): Promise<MaterialIssueView[]> {
    const issues = await this.prisma.scoped.materialIssue.findMany({
      include: {
        productionOrder: { select: { orderNumber: true } },
        issuedBy: { select: { fullName: true } },
        lines: { include: { item: true, lot: true } },
      },
      orderBy: { issuedAt: 'desc' },
    });

    return issues.map((issue) => this.toView(issue));
  }

  async listForOrder(productionOrderId: string): Promise<MaterialIssueView[]> {
    const issues = await this.prisma.scoped.materialIssue.findMany({
      where: { productionOrderId },
      include: {
        productionOrder: { select: { orderNumber: true } },
        issuedBy: { select: { fullName: true } },
        lines: { include: { item: true, lot: true } },
      },
      orderBy: { issuedAt: 'desc' },
    });

    return issues.map((issue) => this.toView(issue));
  }

  /**
   * Replaces the FEFO proposal for the materials an override names — US-PROD-02.
   *
   * The criterion is that the screen always PROPOSES the nearest-expiry lot,
   * not that it forbids anything else: a container damaged in the store, or one
   * held back for a retained sample, is a real reason to reach past it. What it
   * cannot be is silent, so a line that DEPARTS from the suggestion is marked as
   * an override and carries the reason, which the CHECK constraint on the column
   * then makes impossible to omit.
   *
   * "A LINE THAT DEPARTS" IS THE WHOLE POINT, and it used to read "every line".
   * US-PROD-02 asks for the reason "only if Actual Batch ≠ Suggested Batch", and
   * requiring one unconditionally had two costs. It made confirming the
   * suggested lot by hand — which is exactly what "Actual Batch, manually
   * confirmed, defaults to the suggestion" invites — impossible without
   * inventing a reason for agreeing. And because `isFefoOverride` was then
   * stamped `true` regardless, the FEFO-compliance figure counted departures
   * that never happened. A false deviation in that column is worse than a
   * missing one: it is the number an inspector reads.
   *
   * So each chosen lot is compared against the lots FEFO proposed for that same
   * material, and only the ones that are not among them need explaining.
   *
   * An override REPLACES that material's allocation rather than adding to it.
   * Merging a hand-picked lot into a FEFO plan would issue more than the
   * requirement, and deciding which of the two to trim is a question with no
   * good answer — so the person who picks a lot picks the whole line.
   */
  private async applyOverrides(
    plan: MaterialIssuePlan,
    overrides: readonly MaterialIssueOverride[],
    bucket: StockBucketRule,
  ): Promise<MaterialIssuePlan> {
    if (overrides.length === 0) return plan;

    const known = new Set(plan.lines.map((line) => line.item.id));
    // What FEFO proposed, per material, before any of this ran. This is the
    // "Suggested Batch" of the story, and the thing a choice is a departure
    // FROM — so it is read from the plan rather than recomputed, which would
    // re-query stock that may have moved in between.
    const suggestedByItem = new Map(
      plan.lines.map((line) => [
        line.item.id,
        new Set(line.allocations.map((allocation) => allocation.lotId)),
      ]),
    );

    for (const override of overrides) {
      if (!known.has(override.itemId)) {
        throw new BadRequestException(
          'One of the overrides names a material this formulation does not use. ' +
            'Refresh the plan and try again.',
        );
      }

      // Only a real departure needs a reason. Picking the lot FEFO already
      // suggested is confirming it, not overriding it.
      const isDeparture = !suggestedByItem.get(override.itemId)?.has(override.lotId);

      if (isDeparture && !override.reason?.trim()) {
        throw new BadRequestException(
          'Choosing a lot other than the one suggested needs a reason. The suggestion is ' +
            'the nearest-expiry lot, and departing from it has to be explainable later.',
        );
      }
    }

    const byItem = new Map<string, MaterialIssueOverride[]>();
    for (const override of overrides) {
      byItem.set(override.itemId, [...(byItem.get(override.itemId) ?? []), override]);
    }

    const lines = await Promise.all(
      plan.lines.map(async (line) => {
        const chosen = byItem.get(line.item.id);

        if (!chosen) return line;

        const lots = await this.prisma.scoped.stockLot.findMany({
          where: { id: { in: chosen.map((entry) => entry.lotId) }, itemId: line.item.id },
          // Needed to judge the bucket: ownership is on the lot, but which
          // job-work order a principal-owned lot belongs to is on its receipt.
          include: {
            jobWorkMaterialReceiptLine: { select: { receipt: { select: { jobWorkOrderId: true } } } },
          },
        });

        const lotsById = new Map(lots.map((lot) => [lot.id, lot]));
        const suggested = suggestedByItem.get(line.item.id) ?? new Set<string>();

        const allocations = chosen.map((entry) => {
          const lot = lotsById.get(entry.lotId);

          if (!lot) {
            throw new BadRequestException(
              `A chosen lot is not a lot of ${line.item.code}. Pick from the lots listed for ` +
                'that material.',
            );
          }

          // CONTROL 5, on the one path that could otherwise reach around the
          // FEFO filter. US-PROD-02 lets a person pick a lot other than the
          // proposal — a damaged container, a retained sample — but the bucket
          // is not part of what an override may set aside.
          assertLotInBucket(lot, bucket);

          if (lot.status !== 'USABLE') {
            throw new BadRequestException(
              `Lot ${lot.lotNumber} is ${lot.status.toLowerCase()}, so it cannot be dispensed. ` +
                'Only stock released by incoming QC may be issued — that rule is not one an ' +
                'override can set aside.',
            );
          }

          const quantity = this.round(new Prisma.Decimal(entry.quantity));

          // Caught here rather than at the decrement. The `gte` guard in
          // `issue` would reject this too, but it blames a concurrent
          // consumer — "it was consumed while this issue was being prepared" —
          // which is a confusing thing to read when nobody else touched it and
          // the real answer is that the lot never held this much.
          if (quantity.greaterThan(lot.quantityAvailable)) {
            throw new BadRequestException(
              `Lot ${lot.lotNumber} of ${line.item.code} holds ` +
                `${lot.quantityAvailable.toString()} ${line.item.uom}, so ${quantity.toString()} ` +
                'cannot be drawn from it. Reduce the quantity, or name a second lot.',
            );
          }

          // The comparison US-PROD-02 actually asks for. A lot FEFO already
          // proposed is a confirmation, and recording it as a departure would
          // put a deviation in the record that did not happen.
          const isFefoOverride = !suggested.has(lot.id);

          return {
            lotId: lot.id,
            lotNumber: lot.lotNumber,
            expiryDate: lot.expiryDate ? toIsoDate(lot.expiryDate) : null,
            quantity: quantity.toString(),
            quantityAvailable: lot.quantityAvailable.toString(),
            isFefoOverride,
            // Only a departure carries one. The column's CHECK constraint
            // allows a reason without an override but not the reverse, and
            // storing "confirmed the suggestion" as an override reason would
            // make the field unreadable as a list of deviations.
            overrideReason: isFefoOverride ? (entry.reason?.trim() ?? null) : null,
          };
        });

        const allocated = allocations.reduce(
          (total, allocation) => total.add(new Prisma.Decimal(allocation.quantity)),
          ZERO,
        );
        const required = new Prisma.Decimal(line.quantityRequired);

        // US-PROD-01's scaling is what says how much this batch needs, and an
        // override replaces the plan rather than adding to it — so naming more
        // than the requirement is not a bigger issue, it is a wrong one. The
        // shortfall below clamps at zero, so without this the excess would pass
        // every check and simply be dispensed.
        if (allocated.greaterThan(required)) {
          throw new BadRequestException(
            `The lots chosen for ${line.item.code} come to ${allocated.toString()} ` +
              `${line.item.uom}, but the batch needs ${required.toString()}. An override replaces ` +
              'the suggestion rather than adding to it, so the quantities have to match the ' +
              'requirement.',
          );
        }

        return {
          ...line,
          quantityAllocated: this.round(allocated).toString(),
          quantityShort: this.round(Prisma.Decimal.max(required.sub(allocated), ZERO)).toString(),
          allocations,
        };
      }),
    );

    return { ...plan, lines };
  }

  /**
   * Chooses lots for one material, earliest expiry first.
   *
   * Stops as soon as the requirement is met, and returns a partial allocation
   * rather than throwing when it cannot be — the caller decides whether a
   * shortfall is an error (issuing) or information (previewing).
   */
  private async allocate(itemId: string, required: Prisma.Decimal, bucket: StockBucketRule) {
    const lots = await this.prisma.scoped.stockLot.findMany({
      where: {
        itemId,
        // WHAT may be dispensed: released, in stock, not expired. Shared with
        // the work-order gate and the feasibility preview so all three agree.
        ...issuableStockWhere(),
        // WHOSE may be dispensed — control 4, in the FEFO query itself. Under
        // PURE_CONVERSION this narrows to the principal's own material for this
        // job-work order; otherwise it is the company-owned stock that was
        // always meant. Filtering here rather than afterwards means the wrong
        // bucket is never even proposed.
        //
        // The two compose because they constrain different columns: one status,
        // quantity and expiry, the other ownership.
        ...stockBucketWhere(bucket),
      },
      // FEFO, with no-expiry lots LAST: something that cannot expire is the
      // safest thing to leave on the shelf. `lotNumber` breaks ties so the
      // order is deterministic — two lots sharing an expiry must not be picked
      // in whatever order the planner happens to return, or the same plan
      // would issue differently twice.
      orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { lotNumber: 'asc' }],
    });

    const allocations: { lot: (typeof lots)[number]; quantity: Prisma.Decimal }[] = [];
    let outstanding = required;

    for (const lot of lots) {
      if (outstanding.lessThanOrEqualTo(ZERO)) break;

      const take = Prisma.Decimal.min(outstanding, lot.quantityAvailable);

      allocations.push({ lot, quantity: this.round(take) });
      outstanding = outstanding.sub(take);
    }

    return allocations;
  }

  /** Decimal(14,3) is what the column holds; rounding here keeps the arithmetic honest. */
  private round(value: Prisma.Decimal): Prisma.Decimal {
    return value.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  }

  /**
   * The number the next dispensing record would take, for the form to show
   * before anything is saved — US-PROD-02's "Issue No. (auto-generated)".
   *
   * A PREDICTION, not a reservation. The real number is allocated by
   * NumberingService inside the issuing transaction, so a colleague who
   * dispenses first takes this one and the next moves on. Nothing is held,
   * which is why this reads the sequence rather than incrementing it.
   *
   * It reads the same (docType, year) row NumberingService writes — docType
   * 'MI', with the year in its own column. This previously read `MI-${year}`,
   * a key allocation never wrote, so the preview sat at MI-YYYY-0001 no matter
   * how many notes had been raised. A mismatched key does not fail loudly; it
   * just shows a number that is always wrong after the first.
   */
  async previewIssueNumber(): Promise<{ issueNumber: string }> {
    const tenantId = this.tenantContext.requireTenantId();
    const year = new Date().getUTCFullYear();

    const sequence = await this.prisma.scoped.documentSequence.findUnique({
      where: { tenantId_docType_year: { tenantId, docType: 'MI', year } },
      select: { nextValue: true },
    });

    // No row yet means nothing has been dispensed this year, and the first
    // issue will take 1.
    return { issueNumber: `MI-${year}-${String(sequence?.nextValue ?? 1).padStart(4, '0')}` };
  }

  private toView(issue: {
    id: string;
    issueNumber: string;
    issuedAt: Date;
    notes: string | null;
    productionOrder: { orderNumber: string };
    issuedBy: { fullName: string } | null;
    lines: {
      id: string;
      quantityIssued: Prisma.Decimal;
      item: Parameters<typeof toItemSummary>[0];
      isFefoOverride: boolean;
      overrideReason: string | null;
      lot: { lotNumber: string; expiryDate: Date | null };
    }[];
  }): MaterialIssueView {
    return {
      orderNumber: issue.productionOrder.orderNumber,
      id: issue.id,
      issueNumber: issue.issueNumber,
      issuedAt: issue.issuedAt.toISOString(),
      issuedBy: issue.issuedBy?.fullName ?? null,
      notes: issue.notes,
      lines: issue.lines.map((line) => ({
        id: line.id,
        item: toItemSummary(line.item),
        lotNumber: line.lot.lotNumber,
        expiryDate: line.lot.expiryDate ? toIsoDate(line.lot.expiryDate) : null,
        quantityIssued: line.quantityIssued.toString(),
        isFefoOverride: line.isFefoOverride,
        overrideReason: line.overrideReason,
      })),
    };
  }
}
