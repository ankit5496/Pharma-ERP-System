import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
} from 'class-validator';

import {
  MAX_EXPIRY_ALERT_DAYS,
  MAX_EXPIRY_ALERT_WINDOWS,
  MIN_EXPIRY_ALERT_DAYS,
  RESERVATION_STATES,
  STOCK_BATCH_STATUSES,
  type NearExpiryQuery,
  type ReservationState,
  type StockBatchStatus,
  type StockEnquiryQuery,
} from '@pharma-erp/types';

import { trim } from '../../procurement/dto/common.dto';

const ITEM_TYPES = ['RAW_MATERIAL', 'PACKING_MATERIAL', 'SEMI_FINISHED', 'FINISHED_GOOD'];

/** Which batch to read the movements of. */
export class BatchMovementsQueryDto {
  @IsIn(['MATERIAL', 'FINISHED_GOOD'])
  source!: 'MATERIAL' | 'FINISHED_GOOD';

  @IsUUID()
  id!: string;
}

export class StockEnquiryQueryDto implements StockEnquiryQuery {
  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsIn(ITEM_TYPES)
  itemType?: string;

  @IsOptional()
  @IsIn(STOCK_BATCH_STATUSES)
  status?: StockBatchStatus;

  @IsOptional()
  @IsIn(RESERVATION_STATES)
  reservation?: ReservationState;

  // Query parameters arrive as strings; coerced before @IsInt sees them.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  expiringWithin?: number;
}

export class NearExpiryQueryDto implements NearExpiryQuery {
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(120)
  search?: string;

  /** Checked against this company's own windows by the service. */
  @IsOptional()
  @Matches(/^(EXPIRED|WITHIN_\d{1,3})$/, { message: 'bucket must be EXPIRED or WITHIN_<days>' })
  bucket?: string;
}

const isWindow = (value: unknown): boolean =>
  Number.isInteger(value) &&
  (value as number) >= MIN_EXPIRY_ALERT_DAYS &&
  (value as number) <= MAX_EXPIRY_ALERT_DAYS;

/**
 * Each window is a whole number of days from 1 to 730 — ONE check with one
 * message, rather than `isInt` + `min` + `max`.
 *
 * Two reasons, both about the message the person reads. The global formatter
 * (config/validation-message.ts) reads a failed `isInt` as "nothing was sent"
 * and answers "Alert days is required", which is wrong for a window of 30.5
 * that plainly was sent. And a value that is not a number at all fails all
 * three rules at once, where the formatter keeps whichever it meets first — so
 * "abc" was answered "must be at most 730 days". One constraint under its own
 * name keeps its own message, and the message names the actual problem.
 */
function IsAlertWindow(): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isAlertWindow',
      validator: {
        validate: isWindow,
        defaultMessage: (args) => {
          const values: unknown[] = Array.isArray(args?.value) ? args.value : [args?.value];
          const bad = values.find((value) => !isWindow(value));

          return !Number.isInteger(bad)
            ? 'Each alert window must be a whole number of days'
            : (bad as number) < MIN_EXPIRY_ALERT_DAYS
              ? `Each alert window must be at least ${MIN_EXPIRY_ALERT_DAYS} day`
              : `Each alert window must be at most ${MAX_EXPIRY_ALERT_DAYS} days`;
        },
      },
    },
    { each: true },
  );
}

/**
 * The near-expiry windows, in days. Bounds mirror
 * `tenants_expiry_alert_days_sane`, so a refusal is a sentence, not a
 * constraint violation.
 */
export class UpdateExpiryAlertsDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Enter at least one alert window' })
  @ArrayMaxSize(MAX_EXPIRY_ALERT_WINDOWS, {
    message: `Enter at most ${MAX_EXPIRY_ALERT_WINDOWS} alert windows`,
  })
  @ArrayUnique({ message: 'Each alert window can appear only once' })
  @IsAlertWindow()
  alertDays!: number[];
}
