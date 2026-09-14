import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import {
  PACKAGING_COMPONENT_REQUIREMENTS,
  PACKAGING_LEVELS,
  PACKAGING_QUANTITY_BASES,
  type PackagingComponentRequirement,
  type PackagingLevel,
  type PackagingQuantityBasis,
} from '@pharma-erp/types';

/**
 * Request shapes for the Packaging Requirement Master — US-MD-06.
 *
 * Quantities arrive as STRINGS and are validated by pattern rather than by
 * `@IsNumber`. The columns are `Decimal(14,3)`; parsing to a float here would
 * round before the value ever reached the database, and these are the numbers
 * a shortage is computed from.
 */

/** Matches DECIMAL(14,3), and refuses zero — see the CHECK of the same name. */
const QUANTITY = /^(?!0+(\.0+)?$)\d{1,11}(\.\d{1,3})?$/;
const QUANTITY_MESSAGE =
  'must be a positive quantity with at most 3 decimal places, sent as a string';

export class PackagingLineDto {
  @IsUUID()
  itemId!: string;

  @IsIn(PACKAGING_LEVELS)
  level!: PackagingLevel;

  @Matches(QUANTITY, { message: `quantityPer ${QUANTITY_MESSAGE}` })
  quantityPer!: string;

  @IsIn(PACKAGING_QUANTITY_BASES)
  quantityBasis!: PackagingQuantityBasis;

  /**
   * No default. Which components stop the line is the judgement this register
   * exists to record, and defaulting it would let a carton be filed as
   * optional because nobody chose.
   */
  @IsIn(PACKAGING_COMPONENT_REQUIREMENTS)
  requirement!: PackagingComponentRequirement;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class CreatePackagingRequirementDto {
  @IsUUID()
  productId!: string;

  @IsString()
  @MaxLength(128)
  @Matches(/\S/, { message: 'packVariant must not be blank' })
  packVariant!: string;

  /**
   * Required, and must be positive: a PER_PACK quantity cannot be scaled to a
   * batch without it, and a zero would be a division by zero the first time the
   * shortage sweep ran.
   */
  @Matches(QUANTITY, { message: `unitsPerPack ${QUANTITY_MESSAGE}` })
  unitsPerPack!: string;

  /**
   * US-MD-06 turns on a pack having components — an empty specification would
   * satisfy criterion 1's "has an active entry" while telling the packing line
   * nothing.
   */
  @IsArray()
  @ArrayMinSize(1, {
    message: 'A pack specification needs at least one component — otherwise it specifies nothing.',
  })
  @ValidateNested({ each: true })
  @Type(() => PackagingLineDto)
  lines!: PackagingLineDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/**
 * A change to an existing specification.
 *
 * `productId` is absent: a specification is FOR a product, and moving it to
 * another would silently re-point every shortage check that ever cited it.
 * Retire it and write one for the other product.
 */
export class UpdatePackagingRequirementDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/\S/, { message: 'packVariant must not be blank' })
  packVariant?: string;

  @IsOptional()
  @Matches(QUANTITY, { message: `unitsPerPack ${QUANTITY_MESSAGE}` })
  unitsPerPack?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, {
    message: 'A pack specification needs at least one component. Retire the specification instead.',
  })
  @ValidateNested({ each: true })
  @Type(() => PackagingLineDto)
  lines?: PackagingLineDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}
