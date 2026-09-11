import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsUUID,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  ITEM_TYPES,
  SCHEDULE_CLASSIFICATIONS,
  PARTY_TYPES,
  type ItemType,
  type ScheduleClassification,
  type PartyType,
} from '@pharma-erp/types';

import { IsDecimalString, trim } from './common.dto';

export class CreateItemDto {
  @IsString()
  @trim()
  @Length(1, 64)
  code!: string;

  @IsString()
  @trim()
  @Length(2, 255)
  name!: string;

  @IsOptional()
  @IsIn(ITEM_TYPES)
  type?: ItemType;

  /// Free text on the shared item master; length-checked, not enumerated.
  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(16)
  uom?: string;

  @IsOptional()
  @IsDecimalString('Reorder level')
  reorderLevel?: string;

  /** How much to buy when the level is breached. Seeds an auto-requisition. */
  @IsOptional()
  @IsDecimalString('Reorder quantity')
  reorderQuantity?: string;

  /** Minimum remaining shelf life demanded at goods receipt, in days. */
  /// Total shelf life in MONTHS, matching the shared column.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  @Type(() => Number)
  shelfLifeMonths?: number;

  /** GST percentage. Lives on the item; an invoice reads it rather than taking one. */
  @IsOptional()
  @IsDecimalString('GST rate')
  gstRate?: string;

  @IsOptional()
  @IsIn(SCHEDULE_CLASSIFICATIONS)
  scheduleClassification?: ScheduleClassification;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(255)
  brandName?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(512)
  genericName?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(255)
  storageConditions?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(16)
  hsnCode?: string;

}

export class CreatePartyDto {
  @IsString()
  @trim()
  @Length(1, 64)
  code!: string;

  @IsString()
  @trim()
  @Length(2, 255)
  name!: string;

  @IsOptional()
  @IsIn(PARTY_TYPES)
  partyType?: PartyType;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(15)
  gstin?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(64)
  drugLicenceNumber?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @trim()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(1000)
  address?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  @Type(() => Number)
  paymentTermsDays?: number;
}

/** Body of `POST /api/v1/procurement/tax-rates`. */
/**
 * Body of `POST /api/v1/procurement/production-plans`.
 *
 * The packaging detail the brief attaches to a requisition lives on the plan's
 * components: component item, packaging level, quantity per unit, and whether
 * it is mandatory. A requisition references the plan and reads them, so
 * revising a recipe cannot strand stale copies on documents already raised.
 */
export class CreateProductionPlanDto {
  @IsUUID()
  finishedProductId!: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(128)
  packVariant?: string;

  @IsDecimalString('Planned quantity')
  plannedQuantity!: string;

  @IsOptional()
  @IsISO8601()
  plannedDate?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(1000)
  notes?: string;

  /** The formulation this run follows; its lines are the component list. */
  @IsOptional()
  @IsUUID()
  bomId?: string;
}
