import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import {
  BILLING_MODELS,
  CONVERSION_RATE_BASES,
  type BillingModel,
  type ConversionRateBasis,
} from '@pharma-erp/types';

/**
 * Request shapes for the job-work agreement register — US-MD-05.
 *
 * The enum lists are imported rather than restated: both are ours, declared
 * once in @pharma-erp/types, and a second copy here would be a second place to
 * forget.
 */

/** A calendar day, not an instant. See the licence DTO for the full reasoning. */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_DAY_MESSAGE = 'must be a calendar date in YYYY-MM-DD form, with no time part';

/** Matches DECIMAL(12,2) — a rate, so two decimal places. */
const RATE = /^\d{1,10}(\.\d{1,2})?$/;
const RATE_MESSAGE =
  'conversionChargeRate must be an amount with at most 2 decimal places, sent as a string';

/**
 * One line of the product-to-brand mapping.
 *
 * The BOM is addressed by id rather than by code and version: the form offers a
 * picker, and resolving "FG-0142 v2" server-side would mean parsing a label
 * somebody typed.
 */
export class JobWorkMappingDto {
  @IsUUID()
  bomId!: string;

  @IsString()
  @MaxLength(255)
  @Matches(/\S/, { message: 'principalBrandName must not be blank' })
  principalBrandName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  packDesignRef?: string | null;
}

export class CreateJobWorkAgreementDto {
  @IsUUID()
  principalId!: string;

  /**
   * US-MD-05: mandatory. Not `@IsOptional()`, and the column is NOT NULL — an
   * agreement whose billing model is unknown cannot be invoiced against.
   */
  @IsIn(BILLING_MODELS)
  billingModel!: BillingModel;

  /**
   * US-MD-05: "one or more". `@ArrayMinSize(1)` is the first of three places
   * that hold this — the form refuses an empty set, this refuses it, and the
   * service refuses it inside the creating transaction. The service's check is
   * the one that cannot be bypassed by a hand-made request.
   */
  @IsArray()
  @ArrayMinSize(1, {
    message:
      'An agreement must cover at least one product — that is what it is an agreement about.',
  })
  @ValidateNested({ each: true })
  @Type(() => JobWorkMappingDto)
  mappings!: JobWorkMappingDto[];

  // NO `agreementReference`. It is allocated by the server as JWA-YYYY-NNNN when
  // the agreement is created — see JobWorkService.nextReference — so accepting
  // one here would let a caller choose a number out of the series, or collide
  // with one the sequence is about to hand out.

  @IsOptional()
  @Matches(RATE, { message: RATE_MESSAGE })
  conversionChargeRate?: string;

  @IsOptional()
  @IsIn(CONVERSION_RATE_BASES)
  conversionRateBasis?: ConversionRateBasis;

  @IsOptional()
  @IsISO8601()
  @Matches(CALENDAR_DAY, { message: `validFrom ${CALENDAR_DAY_MESSAGE}` })
  validFrom?: string;

  @IsOptional()
  @IsISO8601()
  @Matches(CALENDAR_DAY, { message: `validTo ${CALENDAR_DAY_MESSAGE}` })
  validTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/**
 * A change to an existing agreement.
 *
 * `billingModel` is present and non-nullable: it may be changed to the other
 * value but never cleared. US-MD-05's other half — that it cannot change on an
 * order already in production — is not checkable yet; production orders do not
 * reference an agreement.
 *
 * `mappings`, when given, REPLACES the set. A contract amendment restates the
 * products covered, and merging would make removal impossible.
 */
export class UpdateJobWorkAgreementDto {
  @IsOptional()
  @IsUUID()
  principalId?: string;

  @IsOptional()
  @IsIn(BILLING_MODELS)
  billingModel?: BillingModel;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, {
    message: 'An agreement must cover at least one product. Remove the agreement instead.',
  })
  @ValidateNested({ each: true })
  @Type(() => JobWorkMappingDto)
  mappings?: JobWorkMappingDto[];

  // NO `agreementReference` here either: it is fixed once allocated, being what
  // every work order and invoice under this agreement cites.

  @IsOptional()
  @Matches(RATE, { message: RATE_MESSAGE })
  conversionChargeRate?: string | null;

  @IsOptional()
  @IsIn(CONVERSION_RATE_BASES)
  conversionRateBasis?: ConversionRateBasis | null;

  @IsOptional()
  @IsISO8601()
  @Matches(CALENDAR_DAY, { message: `validFrom ${CALENDAR_DAY_MESSAGE}` })
  validFrom?: string | null;

  @IsOptional()
  @IsISO8601()
  @Matches(CALENDAR_DAY, { message: `validTo ${CALENDAR_DAY_MESSAGE}` })
  validTo?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}
