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

import type { ItemType, ScheduleClassification } from '@pharma-erp/types';

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
  @IsString()
  @MaxLength(64)
  @Matches(/^\S(.*\S)?$/, { message: 'code must not start or end with whitespace' })
  code!: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(512)
  genericName?: string;

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

export class RecordPackingDto {
  @Matches(QUANTITY, { message: `packedQuantity ${QUANTITY_MESSAGE}` })
  packedQuantity!: string;

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
   * PENDING is not accepted. This endpoint decides; it cannot un-decide, and
   * offering a value that reverses a quality verdict would imply otherwise.
   */
  @IsIn(['RELEASED', 'BLOCKED'])
  decision!: 'RELEASED' | 'BLOCKED';

  /** Required when blocking — see the service, which enforces that. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}
