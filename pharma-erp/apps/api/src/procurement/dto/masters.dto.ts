import { Type } from 'class-transformer';
import {
  IsBoolean,
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
  PARTY_TYPES,
  UNITS_OF_MEASURE,
  type ItemType,
  type PartyType,
  type UnitOfMeasure,
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

  @IsOptional()
  @IsIn(UNITS_OF_MEASURE)
  uom?: UnitOfMeasure;

  @IsOptional()
  @IsDecimalString('Reorder level')
  reorderLevel?: string;

  @IsOptional()
  @IsBoolean()
  requiresBatchTracking?: boolean;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(16)
  hsnCode?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(1000)
  notes?: string;
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
