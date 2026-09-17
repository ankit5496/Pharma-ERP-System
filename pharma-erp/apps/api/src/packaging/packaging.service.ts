import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  PackagingAvailability,
  PackagingAvailabilityLine,
  PackagingComponentRequirement,
  PackagingLevel,
  PackagingQuantityBasis,
  PackagingReadiness,
  PackagingRequirementView,
  PackagingShortageAlert,
  PackagingShortagePlan,
} from '@pharma-erp/types';

import { fieldConflict } from '../common/field-error';
import { PrismaService } from '../prisma/prisma.service';
import { ITEM_SELECT, toItemSummary } from '../procurement/mappers';
import { StockService } from '../procurement/stock.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import type {
  CreatePackagingRequirementDto,
  PackagingLineDto,
  UpdatePackagingRequirementDto,
} from './dto/packaging.dto';

const ZERO = new Prisma.Decimal(0);

/** Matches BomLine's Decimal(14,3): the same arithmetic, so the same rounding. */
const QUANTITY_DP = 3;

/**
 * Plan states worth warning about.
 *
 * COMPLETED is past and CANCELLED is not happening; warning about either is
 * noise that teaches people to ignore the panel.
 */
const OPEN_PLAN_STATUSES = ['DRAFT', 'PLANNED', 'IN_PROGRESS'] as const;

/**
 * The Packaging Requirement Master — US-MD-06.
 *
 * All four criteria pass through here:
 *
 *   1. "cannot go into a Work Order until it has at least one active entry"
 *      -> `hasActiveRequirement`, called by ProductionService.
 *   2. "quantities must scale correctly with the batch size"
 *      -> `scaleQuantity`, the same Decimal ratio MaterialIssueService uses.
 *   3. "the availability check must run automatically"
 *      -> `availability`, computed on read against usable stock. Nothing is
 *         stored, so nothing can go stale and nobody cross-checks a list.
 *   4. "a shortage must be visible on the dashboard before the batch is due"
 *      -> `shortageSweep`, joined to production plans and ordered by the date
 *         the batch is due.
 */
@Injectable()
export class PackagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly stock: StockService,
  ) {}

  async list(): Promise<PackagingRequirementView[]> {
    const rows = await this.prisma.scoped.packagingRequirement.findMany({
      where: { deletedAt: null },
      include: REQUIREMENT_INCLUDE,
      orderBy: [{ packVariant: 'asc' }],
    });

    return rows.map(toRequirementView);
  }

  /**
   * US-MD-06 criterion 1, asked as a question so ProductionService can answer
   * it without knowing how packaging records are shaped.
   */
  async hasActiveRequirement(productId: string): Promise<boolean> {
    const count = await this.prisma.scoped.packagingRequirement.count({
      where: { productId, isActive: true, deletedAt: null },
    });

    return count > 0;
  }

  /**
   * Criteria 2 and 3 for one specification against one batch size.
   *
   * Two reads: the specification, and one grouped stock aggregate for every
   * component at once. Not a query per line — a pack with a dozen components
   * would otherwise cost a dozen round trips to answer one question.
   */
  async availability(requirementId: string, batchQuantity: string): Promise<PackagingAvailability> {
    const requirement = await this.prisma.scoped.packagingRequirement.findFirst({
      where: { id: requirementId, deletedAt: null },
      include: REQUIREMENT_INCLUDE,
    });

    if (!requirement) throw new NotFoundException('That pack specification does not exist.');

    const batch = toDecimal(batchQuantity, 'batchQuantity');

    if (batch.lessThanOrEqualTo(0)) {
      throw new BadRequestException('A batch quantity must be greater than zero.');
    }

    const usable = await this.stock.usableStockByItem('USABLE');

    return this.compute(requirement, batch, usable);
  }

  /**
   * US-MD-06 criterion 4: every planned batch that will not pack cleanly,
   * soonest due first.
   *
   * Deliberately three reads for the whole sweep rather than three per plan:
   * the plans, every active specification for the products they name, and one
   * stock aggregate. A company with fifty open plans would otherwise paint its
   * dashboard with a hundred and fifty round trips — and against a managed
   * database in another region that is the difference between a dashboard and a
   * timeout.
   */
  async shortageSweep(): Promise<PackagingShortageAlert> {
    const plans = await this.prisma.scoped.productionPlan.findMany({
      where: { deletedAt: null, status: { in: [...OPEN_PLAN_STATUSES] } },
      select: {
        id: true,
        number: true,
        packVariant: true,
        plannedQuantity: true,
        plannedDate: true,
        finishedProductId: true,
        finishedProduct: { select: { code: true, name: true } },
      },
    });

    if (plans.length === 0) return { plans: [], blockedCount: 0 };

    const productIds = [...new Set(plans.map((plan) => plan.finishedProductId))];

    const [requirements, usable] = await Promise.all([
      this.prisma.scoped.packagingRequirement.findMany({
        where: { productId: { in: productIds }, isActive: true, deletedAt: null },
        include: REQUIREMENT_INCLUDE,
      }),
      this.stock.usableStockByItem('USABLE'),
    ]);

    const byProduct = new Map<string, typeof requirements>();
    for (const requirement of requirements) {
      const list = byProduct.get(requirement.productId) ?? [];
      list.push(requirement);
      byProduct.set(requirement.productId, list);
    }

    const today = todayIso();
    const atRisk: PackagingShortagePlan[] = [];

    for (const plan of plans) {
      const candidates = byProduct.get(plan.finishedProductId) ?? [];

      // Match the plan's own pack variant where it named one. Where it did not
      // — or named one with no specification — fall back to the product's
      // specifications rather than skipping: an unmatched plan is exactly the
      // case that reaches the packing line unchecked, which is what this
      // criterion exists to prevent.
      const matched = plan.packVariant
        ? candidates.filter((candidate) => candidate.packVariant === plan.packVariant)
        : [];
      const chosen = matched.length > 0 ? matched : candidates;

      const base = {
        planId: plan.id,
        planNumber: plan.number,
        productCode: plan.finishedProduct.code,
        productName: plan.finishedProduct.name,
        packVariant: plan.packVariant,
        plannedQuantity: plan.plannedQuantity.toString(),
        plannedDate: plan.plannedDate ? toIsoDate(plan.plannedDate) : null,
        daysUntilPacking: plan.plannedDate ? daysBetween(today, toIsoDate(plan.plannedDate)) : null,
      };

      if (chosen.length === 0) {
        atRisk.push({ ...base, risk: 'NO_SPECIFICATION', shortComponents: [] });
        continue;
      }

      // A plan with several candidate specifications is reported against the
      // worst of them: if any way of packing it is blocked, somebody needs to
      // know before the day it is due.
      let worst: PackagingAvailability | null = null;

      for (const requirement of chosen) {
        const computed = this.compute(
          requirement,
          new Prisma.Decimal(plan.plannedQuantity),
          usable,
        );
        if (!worst || rank(computed.readiness) > rank(worst.readiness)) worst = computed;
      }

      if (!worst || worst.readiness === 'READY') continue;

      atRisk.push({
        ...base,
        risk: worst.readiness === 'BLOCKED' ? 'BLOCKED' : 'SHORT_OPTIONAL',
        shortComponents: worst.lines
          .filter((line) => line.isShort)
          .map((line) => ({
            itemCode: line.item.code,
            itemName: line.item.name,
            uom: line.item.uom,
            quantityRequired: line.quantityRequired,
            quantityAvailable: line.quantityAvailable,
            quantityShort: line.quantityShort,
            requirement: line.requirement,
          })),
      });
    }

    // Soonest due first; undated plans last. An undated plan is still listed —
    // it is a batch nobody can schedule material against, which is its own
    // problem — but it does not push a dated one down the page.
    atRisk.sort((a, b) => {
      if (a.daysUntilPacking === null && b.daysUntilPacking === null) return 0;
      if (a.daysUntilPacking === null) return 1;
      if (b.daysUntilPacking === null) return -1;
      return a.daysUntilPacking - b.daysUntilPacking;
    });

    return {
      plans: atRisk,
      blockedCount: atRisk.filter((plan) => plan.risk !== 'SHORT_OPTIONAL').length,
    };
  }

  async create(dto: CreatePackagingRequirementDto): Promise<PackagingRequirementView> {
    const tenantId = this.tenantContext.requireTenantId();

    await this.assertProductIsFinishedGood(dto.productId);
    await this.assertComponentsUsable(dto.lines);
    await this.assertVariantIsFree(dto.productId, dto.packVariant.trim(), null);

    try {
      const created = await this.prisma.transaction(async (tx) => {
        const requirement = await tx.packagingRequirement.create({
          data: {
            tenantId,
            productId: dto.productId,
            packVariant: dto.packVariant.trim(),
            unitsPerPack: dto.unitsPerPack,
            isActive: dto.isActive ?? true,
            notes: dto.notes?.trim() || null,
          },
        });

        await tx.packagingRequirementLine.createMany({
          data: dto.lines.map((line) => ({
            tenantId,
            requirementId: requirement.id,
            itemId: line.itemId,
            level: line.level,
            quantityPer: line.quantityPer,
            quantityBasis: line.quantityBasis,
            requirement: line.requirement,
            notes: line.notes?.trim() || null,
          })),
        });

        return tx.packagingRequirement.findFirstOrThrow({
          where: { id: requirement.id },
          include: REQUIREMENT_INCLUDE,
        });
      });

      return toRequirementView(created);
    } catch (error) {
      throw translate(error, dto.packVariant.trim());
    }
  }

  async update(id: string, dto: UpdatePackagingRequirementDto): Promise<PackagingRequirementView> {
    const existing = await this.prisma.scoped.packagingRequirement.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) throw new NotFoundException('That pack specification does not exist.');

    if (dto.lines !== undefined) await this.assertComponentsUsable(dto.lines);
    if (dto.packVariant !== undefined) {
      await this.assertVariantIsFree(existing.productId, dto.packVariant.trim(), id);
    }

    const data: Prisma.PackagingRequirementUpdateInput = {};

    if (dto.packVariant !== undefined) data.packVariant = dto.packVariant.trim();
    if (dto.unitsPerPack !== undefined) data.unitsPerPack = dto.unitsPerPack;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;

    const tenantId = this.tenantContext.requireTenantId();

    try {
      const updated = await this.prisma.transaction(async (tx) => {
        await tx.packagingRequirement.update({ where: { id }, data });

        // A line set, when sent, REPLACES what was there: an amended pack
        // specification restates what the pack contains, and merging would
        // make removing a component impossible.
        if (dto.lines !== undefined) {
          await tx.packagingRequirementLine.deleteMany({ where: { requirementId: id } });
          await tx.packagingRequirementLine.createMany({
            data: dto.lines.map((line) => ({
              tenantId,
              requirementId: id,
              itemId: line.itemId,
              level: line.level,
              quantityPer: line.quantityPer,
              quantityBasis: line.quantityBasis,
              requirement: line.requirement,
              notes: line.notes?.trim() || null,
            })),
          });
        }

        return tx.packagingRequirement.findFirstOrThrow({
          where: { id },
          include: REQUIREMENT_INCLUDE,
        });
      });

      return toRequirementView(updated);
    } catch (error) {
      throw translate(error, dto.packVariant?.trim() ?? existing.packVariant);
    }
  }

  /**
   * Retires a specification.
   *
   * A soft delete — the trigger refuses a real one. The specification a batch
   * was packed to is part of that batch's record.
   *
   * Retiring the LAST active specification for a product is allowed, and will
   * stop work orders being raised for it (criterion 1). That is the intended
   * consequence, not an oversight: a product whose pack is withdrawn should not
   * be going into production.
   */
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.scoped.packagingRequirement.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) throw new NotFoundException('That pack specification does not exist.');

    await this.prisma.scoped.packagingRequirement.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // -------------------------------------------------------------------------
  // The arithmetic
  // -------------------------------------------------------------------------

  /**
   * US-MD-06 criterion 2, in one place.
   *
   * PER_PACK scales by the number of packs the batch yields; PER_BATCH does
   * not scale at all. Written as a ratio — `batch / unitsPerPack` — rather than
   * a multiplication, for the same reason MaterialIssueService scales a BOM by
   * `plannedQuantity / outputQuantity`: the specification states quantities
   * against its own pack, not against one unit.
   */
  private scaleQuantity(
    quantityPer: Prisma.Decimal,
    basis: PackagingQuantityBasis,
    packs: Prisma.Decimal,
  ): Prisma.Decimal {
    if (basis === 'PER_BATCH') return quantityPer;

    return quantityPer.mul(packs);
  }

  private compute(
    requirement: RequirementWithRelations,
    batch: Prisma.Decimal,
    usable: Map<string, Prisma.Decimal>,
  ): PackagingAvailability {
    const packs = batch.div(requirement.unitsPerPack);

    const lines: PackagingAvailabilityLine[] = requirement.lines.map((line) => {
      const required = round(
        this.scaleQuantity(
          new Prisma.Decimal(line.quantityPer),
          line.quantityBasis as PackagingQuantityBasis,
          packs,
        ),
      );
      const available = round(usable.get(line.itemId) ?? ZERO);
      const short = round(Prisma.Decimal.max(required.sub(available), ZERO));

      return {
        item: toItemSummary(line.item),
        level: line.level as PackagingLevel,
        quantityBasis: line.quantityBasis as PackagingQuantityBasis,
        requirement: line.requirement as PackagingComponentRequirement,
        quantityPer: line.quantityPer.toString(),
        quantityRequired: required.toString(),
        quantityAvailable: available.toString(),
        quantityShort: short.toString(),
        isShort: short.greaterThan(0),
      };
    });

    // A short MANDATORY component blocks; a short OPTIONAL one only warns.
    const readiness: PackagingReadiness = lines.some(
      (line) => line.isShort && line.requirement === 'MANDATORY',
    )
      ? 'BLOCKED'
      : lines.some((line) => line.isShort)
        ? 'SHORT_OPTIONAL'
        : 'READY';

    return {
      requirementId: requirement.id,
      product: toItemSummary(requirement.product),
      packVariant: requirement.packVariant,
      unitsPerPack: requirement.unitsPerPack.toString(),
      batchQuantity: round(batch).toString(),
      packs: round(packs).toString(),
      readiness,
      lines,
    };
  }

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------

  private async assertProductIsFinishedGood(productId: string): Promise<void> {
    const item = await this.prisma.scoped.item.findFirst({
      where: { id: productId, deletedAt: null },
      select: { type: true, name: true },
    });

    if (!item) throw new BadRequestException('That product is not in the item master.');

    if (item.type !== 'FINISHED_GOOD') {
      throw new BadRequestException(
        `${item.name} is not a finished good, so it is not something that gets packed.`,
      );
    }
  }

  /**
   * Every component must exist, be ours, be a packing material, and appear
   * once. Checked here rather than in SQL: a CHECK constraint cannot read the
   * item master, and the unique index would answer a duplicate with a
   * constraint name instead of a sentence.
   */
  private async assertComponentsUsable(lines: readonly PackagingLineDto[]): Promise<void> {
    if (lines.length === 0) {
      throw new BadRequestException(
        'A pack specification needs at least one component — otherwise it specifies nothing.',
      );
    }

    const seen = new Set<string>();

    for (const line of lines) {
      if (seen.has(line.itemId)) {
        throw new BadRequestException(
          'A component appears on more than one line. Combine the quantities into a single line.',
        );
      }
      seen.add(line.itemId);
    }

    const items = await this.prisma.scoped.item.findMany({
      where: { id: { in: [...seen] }, deletedAt: null },
      select: { id: true, type: true, code: true, name: true },
    });

    if (items.length !== seen.size) {
      throw new BadRequestException(
        'One or more of those components do not exist. Refresh and choose again.',
      );
    }

    const wrong = items.find((item) => item.type !== 'PACKING_MATERIAL');

    if (wrong) {
      throw new BadRequestException(
        `${wrong.code} — ${wrong.name} is not a packing material. A pack is made of packing ` +
          'materials; the formulation is where raw materials belong.',
      );
    }
  }

  /**
   * One live specification per product per pack variant.
   *
   * A pre-check rather than a caught constraint violation, for the same reason
   * the job-work register has one: the index is PARTIAL, and Prisma reports a
   * partial-index violation as "Unique constraint failed on the (not
   * available)" with no target to match on. The index is still what guarantees
   * uniqueness; this decides how the refusal reads.
   */
  private async assertVariantIsFree(
    productId: string,
    packVariant: string,
    exceptId: string | null,
  ): Promise<void> {
    const clash = await this.prisma.scoped.packagingRequirement.findFirst({
      where: {
        productId,
        packVariant,
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });

    if (clash) {
      throw fieldConflict(
        'packVariant',
        `This product already has a specification for "${packVariant}". Edit that one instead.`,
      );
    }
  }
}

const REQUIREMENT_INCLUDE = {
  product: { select: ITEM_SELECT },
  lines: {
    include: { item: { select: ITEM_SELECT } },
    orderBy: [{ level: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.PackagingRequirementInclude;

type RequirementWithRelations = Prisma.PackagingRequirementGetPayload<{
  include: typeof REQUIREMENT_INCLUDE;
}>;

function toRequirementView(requirement: RequirementWithRelations): PackagingRequirementView {
  return {
    id: requirement.id,
    product: toItemSummary(requirement.product),
    packVariant: requirement.packVariant,
    unitsPerPack: requirement.unitsPerPack.toString(),
    isActive: requirement.isActive,
    notes: requirement.notes,
    lines: requirement.lines.map((line) => ({
      id: line.id,
      item: toItemSummary(line.item),
      level: line.level as PackagingLevel,
      quantityPer: line.quantityPer.toString(),
      quantityBasis: line.quantityBasis as PackagingQuantityBasis,
      requirement: line.requirement as PackagingComponentRequirement,
      notes: line.notes,
    })),
  };
}

/** Severity order, so the sweep can report a plan against its worst option. */
function rank(readiness: PackagingReadiness): number {
  return readiness === 'BLOCKED' ? 2 : readiness === 'SHORT_OPTIONAL' ? 1 : 0;
}

function round(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(QUANTITY_DP);
}

function toDecimal(value: string, field: string): Prisma.Decimal {
  try {
    return new Prisma.Decimal(value);
  } catch {
    throw new BadRequestException(`${field} is not a number.`);
  }
}

/** A `@db.Date` column read back as YYYY-MM-DD. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Whole days from `from` to `to`, both YYYY-MM-DD.
 *
 * Compared as calendar days in UTC rather than as instants, so "due today"
 * does not become "due yesterday" for a reader in another timezone.
 */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);

  return Math.round((b - a) / 86_400_000);
}

/** Turns a database refusal into something the person who hit it can read. */
function translate(error: unknown, packVariant: string): unknown {
  if (isConstraint(error, 'packaging_requirement_lines_requirement_id_item_id_key')) {
    return new BadRequestException('A component appears on more than one line of this pack.');
  }

  if (isConstraint(error, 'packaging_requirements_units_per_pack_positive')) {
    return new BadRequestException('Units per pack must be greater than zero.');
  }

  if (isConstraint(error, 'packaging_requirement_lines_quantity_positive')) {
    return new BadRequestException('Every component needs a quantity greater than zero.');
  }

  if (isConstraint(error, 'packaging_requirements_pack_variant_not_blank')) {
    return new BadRequestException('A pack specification needs a pack variant.');
  }

  // P2002 last, and the fallback for the partial unique index: the pre-check
  // normally gets there first, so reaching this means two requests raced.
  if (isConstraint(error, 'P2002')) {
    return new ConflictException(
      `A specification for "${packVariant}" was saved by someone else a moment ago.`,
    );
  }

  return error;
}

/**
 * Matched on the error's `code` or its message rather than with
 * `instanceof Prisma.PrismaClientKnownRequestError`: `instanceof` across two
 * copies of the client — which a pnpm workspace can produce — silently returns
 * false.
 */
function isConstraint(error: unknown, marker: string): boolean {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === marker
  ) {
    return true;
  }

  return error instanceof Error && error.message.includes(marker);
}
