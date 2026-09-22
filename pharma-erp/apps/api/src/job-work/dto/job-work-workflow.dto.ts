import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { BATCH_RELEASE_DECISIONS, type BatchReleaseDecision } from '@pharma-erp/types';

/**
 * Request shapes for the job-work issue, batch record and release.
 *
 * WHAT IS NOT ACCEPTED, again, is the point. An issue line names a lot and a
 * quantity and nothing else — no item, no batch marking, no expiry, because all
 * three are facts about the drum that the inward receipt already recorded, and
 * a request free to restate them is a request free to contradict them.
 */

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_DAY_MESSAGE = 'must be a calendar date in YYYY-MM-DD form, with no time part';

/** Matches DECIMAL(14,3), the precision the columns hold. */
const QUANTITY = /^\d{1,11}(\.\d{1,3})?$/;
const QUANTITY_MESSAGE = 'must be a quantity with at most 3 decimal places, sent as a string';

export class JobWorkIssueLineDto {
  /**
   * The lot being drawn on.
   *
   * The service checks it belongs to this production order's own receipt. A
   * lot id alone would otherwise be enough to consume another principal's
   * material into this batch.
   */
  @IsUUID()
  lotId!: string;

  @Matches(QUANTITY, { message: `quantityIssued ${QUANTITY_MESSAGE}` })
  quantityIssued!: string;
}

export class RecordJobWorkIssueDto {
  @IsUUID()
  jobWorkProductionOrderId!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Enter a quantity against at least one drum.' })
  @ValidateNested({ each: true })
  @Type(() => JobWorkIssueLineDto)
  lines!: JobWorkIssueLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * Opening the batch record.
 *
 * No batch number — the JWB series allocates it. No planned quantity — that is
 * the production order's figure, and a batch claiming a different plan than the
 * order it was made under is two documents disagreeing.
 */
export class RecordJobWorkBatchDto {
  @IsUUID()
  jobWorkProductionOrderId!: string;

  @Matches(CALENDAR_DAY, { message: `manufacturedOn ${CALENDAR_DAY_MESSAGE}` })
  manufacturedOn!: string;

  @Matches(CALENDAR_DAY, { message: `expiryDate ${CALENDAR_DAY_MESSAGE}` })
  expiryDate!: string;

  /** What was actually made. Blank until the run finishes. */
  @IsOptional()
  @Matches(QUANTITY, { message: `actualQuantity ${QUANTITY_MESSAGE}` })
  actualQuantity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/**
 * The packing figures, recorded against a batch that already exists.
 *
 * ITS OWN SHAPE rather than the create one with everything optional: packing is
 * a later event, and the dates of manufacture and expiry are settled by then.
 * Accepting them here would offer a route to rewrite them from the packing
 * screen.
 */
export class RecordJobWorkPackingDto {
  @IsOptional()
  @Matches(QUANTITY, { message: `actualQuantity ${QUANTITY_MESSAGE}` })
  actualQuantity?: string;

  @IsOptional()
  @Matches(QUANTITY, { message: `packedQuantity ${QUANTITY_MESSAGE}` })
  packedQuantity?: string;

  @IsOptional()
  @Matches(QUANTITY, { message: `rejectedQuantity ${QUANTITY_MESSAGE}` })
  rejectedQuantity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  packVariant?: string;

  @IsOptional()
  @Matches(CALENDAR_DAY, { message: `packedOn ${CALENDAR_DAY_MESSAGE}` })
  packedOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/**
 * The release decision on a finished batch.
 *
 * THE SAME THREE the internal quality gate offers, from the same constant:
 * PENDING is where a batch starts rather than somewhere a decision can put it,
 * and BLOCKED is readable but not chooseable.
 */
export class DecideJobWorkBatchDto {
  @IsIn([...BATCH_RELEASE_DECISIONS], {
    message: `decision must be one of: ${BATCH_RELEASE_DECISIONS.join(', ')}`,
  })
  decision!: BatchReleaseDecision;

  /** Required by the service for anything but a release. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
