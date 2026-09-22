import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { BATCH_RELEASE_DECISIONS } from '@pharma-erp/types';
import type { BatchReleaseDecision, ItemType, ScheduleClassification } from '@pharma-erp/types';

/**
 * Accepted enum values, as arrays because `@IsIn` needs a runtime list.
 *
 * Written out here rather than imported from Prisma's generated enums: this
 * is the request boundary, and it should be readable without knowing what the
 * ORM happens to produce. The compile-time assertions below keep them honest
 * — they fail the build if @pharma-erp/types ever gains a value these miss.
 */
const ITEM_TYPES = ['RAW_MATERIAL', 'PACKING_MATERIAL', 'SEMI_FINISHED', 'FINISHED_GOOD'] as const;
const SCHEDULE_CLASSIFICATIONS = ['NONE', 'H', 'H1', 'X', 'G'] as const;

type AssertSame<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

const _itemTypesMatch: AssertSame<(typeof ITEM_TYPES)[number], ItemType> = true;
const _schedulesMatch: AssertSame<
  (typeof SCHEDULE_CLASSIFICATIONS)[number],
  ScheduleClassification
> = true;
void _itemTypesMatch;
void _schedulesMatch;

/**
 * Quantities arrive as strings and stay strings all the way to Prisma's
 * Decimal.
 *
 * Not `@IsNumber()`: class-transformer would parse it into a JavaScript number
 * first, and 14 significant digits do not survive a double. The regex is the
 * validation — up to 11 integer digits and 3 decimals, matching
 * `Decimal(14,3)` in the schema — so a value that would be silently rounded on
 * insert is rejected at the boundary instead.
 */
const QUANTITY = /^\d{1,11}(\.\d{1,3})?$/;

const QUANTITY_MESSAGE =
  'must be a positive number with at most 3 decimal places, sent as a string';

// ---------------------------------------------------------------------------
// Item master
// ---------------------------------------------------------------------------

/** Matches DECIMAL(5,2) constrained to 0–100 by the column's CHECK. */
const PERCENTAGE = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;

/** Matches DECIMAL(12,2) — a price, so two decimals rather than three. */
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

export class CreateItemDto {
  // NO `code`. It is allocated by the server as RM-00001 from a per-category
  // counter — see nextItemCode — so accepting one here would let a caller pick
  // a number out of the series, or collide with one about to be handed out.
  //
  // It used to be typed, and the register ended up holding "pcm-500",
  // "PCM- 500", "PCM 500" and "PCM-500" as four separate items.

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsIn(ITEM_TYPES)
  type!: (typeof ITEM_TYPES)[number];

  @IsString()
  @MaxLength(16)
  uom!: string;

  /**
   * Required here although the column is nullable. Rows written before the
   * field existed keep their NULL; anything created from now on carries one,
   * because an invoice cannot be raised without it.
   */
  @Matches(/^[0-9]{4,8}$/, { message: 'hsnCode must be 4 to 8 digits' })
  hsnCode!: string;

  @Matches(PERCENTAGE, { message: 'gstRate must be a percentage between 0 and 100' })
  gstRate!: string;

  @IsOptional()
  @IsIn(SCHEDULE_CLASSIFICATIONS)
  scheduleClassification?: (typeof SCHEDULE_CLASSIFICATIONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  brandName?: string;

  /**
   * REQUIRED, although the column is nullable and rows written before this
   * keep their NULL.
   *
   * Every item has a composition — lactose has no brand, a printed carton has
   * no brand — and it is the composition that must appear on the label, so it
   * is the half of the brand/generic pair worth insisting on. The brand stays
   * optional above it.
   *
   * Only on the PRODUCTION route, which is what Master Data posts to.
   * Procurement and Masters carry their own CreateItemDto and are unchanged:
   * their forms ask for different things, and tightening a rule under a screen
   * nobody asked me to change is how a working form starts refusing saves.
   */
  @IsString()
  @MaxLength(512)
  @Matches(/\S/, { message: 'genericName must not be blank' })
  genericName!: string;

  @IsOptional()
  @Matches(MONEY, { message: 'mrp must be an amount with at most 2 decimal places, as a string' })
  mrp?: string;

  @IsOptional()
  @IsBoolean()
  dpcoCeiling?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  storageConditions?: string;

  // A real integer, not a quantity string: months are countable and the column
  // is INTEGER. Bounded at 120 because a ten-year shelf life on a medicine is
  // a typo, not a product.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  shelfLifeMonths?: number;

  @IsOptional()
  @Matches(QUANTITY, { message: `reorderLevel ${QUANTITY_MESSAGE}` })
  reorderLevel?: string;

  @IsOptional()
  @Matches(QUANTITY, { message: `reorderQuantity ${QUANTITY_MESSAGE}` })
  reorderQuantity?: string;
}

/**
 * A change to an existing item.
 *
 * Every field optional, and the nullable ones accept an explicit `null` to
 * clear the value — `@IsOptional()` skips validation for both `undefined` and
 * `null`, so a null passes through to the service, which distinguishes the
 * two. Sending nothing leaves a field alone.
 *
 * `code` is not here. It identifies the item on documents already issued, so
 * it is fixed once created.
 */
export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsIn(ITEM_TYPES)
  type?: (typeof ITEM_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(16)
  uom?: string;

  @IsOptional()
  @Matches(/^[0-9]{4,8}$/, { message: 'hsnCode must be 4 to 8 digits' })
  hsnCode?: string;

  @IsOptional()
  @Matches(PERCENTAGE, { message: 'gstRate must be a percentage between 0 and 100' })
  gstRate?: string;

  @IsOptional()
  @IsIn(SCHEDULE_CLASSIFICATIONS)
  scheduleClassification?: (typeof SCHEDULE_CLASSIFICATIONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  brandName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  genericName?: string | null;

  @IsOptional()
  @Matches(MONEY, { message: 'mrp must be an amount with at most 2 decimal places, as a string' })
  mrp?: string | null;

  @IsOptional()
  @IsBoolean()
  dpcoCeiling?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  storageConditions?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  shelfLifeMonths?: number | null;

  @IsOptional()
  @Matches(QUANTITY, { message: `reorderLevel ${QUANTITY_MESSAGE}` })
  reorderLevel?: string | null;

  @IsOptional()
  @Matches(QUANTITY, { message: `reorderQuantity ${QUANTITY_MESSAGE}` })
  reorderQuantity?: string | null;
}

// ---------------------------------------------------------------------------
// Formulations
// ---------------------------------------------------------------------------

export class BomLineDto {
  @IsUUID()
  itemId!: string;

  @Matches(QUANTITY, { message: `quantityPer ${QUANTITY_MESSAGE}` })
  quantityPer!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

export class CreateBomDto {
  @IsUUID()
  productId!: string;

  @Matches(QUANTITY, { message: `outputQuantity ${QUANTITY_MESSAGE}` })
  outputQuantity!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string;

  /** Makes this the current version, superseding whichever was active. */
  @IsOptional()
  @IsBoolean()
  activate?: boolean;

  // Bounded because each line becomes a row in one transaction, and an
  // unbounded array is a cheap way to hold a connection open.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BomLineDto)
  lines!: BomLineDto[];
}

/**
 * Changes a formulation IN PLACE, rather than superseding it with a new
 * version.
 *
 * Deliberately NOT a partial of CreateBomDto. `productId` is absent because a
 * formulation that changes which product it makes is a different formulation,
 * and the version it carries would then be a version of nothing. Correcting a
 * recipe and repointing it at another product are not the same request.
 *
 * `activate` is absent for the same reason: which version is current is a
 * decision about the SET of versions, and the partial unique index allows only
 * one active version per product. Switching that belongs in its own operation,
 * not folded into an edit.
 *
 * The service refuses this entirely once the formulation has been used to
 * manufacture. See updateBom.
 */
export class UpdateBomDto {
  @Matches(QUANTITY, { message: `outputQuantity ${QUANTITY_MESSAGE}` })
  outputQuantity!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BomLineDto)
  lines!: BomLineDto[];
}

// ---------------------------------------------------------------------------
// Production orders
// ---------------------------------------------------------------------------

export class CreateProductionOrderDto {
  @IsUUID()
  productId!: string;

  @Matches(QUANTITY, { message: `plannedQuantity ${QUANTITY_MESSAGE}` })
  plannedQuantity!: string;

  @IsOptional()
  @IsISO8601()
  plannedStartOn?: string;

  /**
   * The job-work order this batch is being made against — US-JW-03.
   *
   * OPTIONAL, and absent on every own-brand work order. When given, the service
   * copies the principal, the agreement and the BILLING MODEL off it, and the
   * stock bucket production may consume follows from that model. There is
   * deliberately no `billingModel` or `stockBucket` field here: US-JW-03 rule 2
   * is "user cannot select an incorrect stock bucket", and the surest way to
   * honour it is to accept no bucket at all.
   */
  @IsOptional()
  @IsUUID()
  jobWorkOrderId?: string;
}

// ---------------------------------------------------------------------------
// Batch record
// ---------------------------------------------------------------------------

export class RecordBatchDto {
  @IsUUID()
  productionOrderId!: string;

  @IsOptional()
  @IsISO8601()
  manufacturedOn?: string;

  @Matches(QUANTITY, { message: `actualQuantity ${QUANTITY_MESSAGE}` })
  actualQuantity!: string;
}

/**
 * Naming the lot to draw from, rather than taking the one FEFO proposed —
 * US-PROD-02.
 *
 * `reason` is OPTIONAL HERE and required by the service, which is the only
 * layer that can tell whether this is a departure at all. The criterion is
 * "mandatory only if Actual Batch ≠ Suggested Batch", and whether it differs
 * depends on the FEFO plan for this order at this moment — something a DTO
 * validating one object in isolation cannot know.
 *
 * It was `@IsString()` here, which made the reason unconditional and meant
 * confirming the suggested lot by hand was rejected at the boundary for having
 * nothing to explain. See MaterialIssueService.applyOverrides, which compares
 * the chosen lot against the plan and refuses a reasonless DEPARTURE; the
 * column's CHECK constraint is the backstop under that.
 */
export class MaterialIssueOverrideDto {
  @IsUUID()
  itemId!: string;

  @IsUUID()
  lotId!: string;

  @Matches(QUANTITY, { message: `quantity ${QUANTITY_MESSAGE}` })
  quantity!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/\S/, { message: 'reason must not be blank' })
  reason?: string;
}

export class IssueMaterialDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MaterialIssueOverrideDto)
  overrides?: MaterialIssueOverrideDto[];
}

/** One packaging component actually consumed by the batch — US-PROD-04. */
export class PackagingConsumptionDto {
  @IsUUID()
  itemId!: string;

  @Matches(QUANTITY, { message: `quantityConsumed ${QUANTITY_MESSAGE}` })
  quantityConsumed!: string;

  /** The lot it came from, where the line recorded one. */
  @IsOptional()
  @IsUUID()
  lotId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class RecordPackingDto {
  @Matches(QUANTITY, { message: `packedQuantity ${QUANTITY_MESSAGE}` })
  packedQuantity!: string;

  /**
   * Units damaged or discarded on the line — US-PROD-04.
   *
   * Defaults to zero rather than being required: a run with no losses is
   * normal, and forcing a "0" would be asking a question whose answer is
   * usually obvious. What it must not do is go unrecorded when it happens,
   * because packed + rejected is what reconciles against the bulk yield.
   */
  @IsOptional()
  @Matches(QUANTITY, { message: `rejectedQuantity ${QUANTITY_MESSAGE}` })
  rejectedQuantity?: string;

  /** Which presentation was packed; matches a PackagingRequirement pack variant. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  packVariant?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackagingConsumptionDto)
  consumptions?: PackagingConsumptionDto[];

  @IsOptional()
  @IsISO8601()
  packedOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ---------------------------------------------------------------------------
// The quality gate
// ---------------------------------------------------------------------------

export class ReleaseDecisionDto {
  /**
   * THREE OUTCOMES, and neither PENDING nor BLOCKED among them.
   *
   * PENDING is not accepted because this endpoint decides; it cannot un-decide,
   * and offering a value that reverses a quality verdict would imply otherwise.
   *
   * BLOCKED is not accepted because it is what ON_HOLD and REJECTED were called
   * before they were separated. Rows decided under it keep it — a quality
   * decision already taken is not rewritten — but nothing new is recorded that
   * way, because "blocked" cannot answer whether the batch may ever ship.
   */
  @IsIn(BATCH_RELEASE_DECISIONS)
  decision!: BatchReleaseDecision;

  /** Required for ON_HOLD and REJECTED — see the service, which enforces it. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}
