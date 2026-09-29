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

/**
 * The near-expiry windows, in days. Bounds mirror
 * `tenants_expiry_alert_days_sane`, so a refusal is a sentence, not a
 * constraint violation.
 */
export class UpdateExpiryAlertsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_EXPIRY_ALERT_WINDOWS)
  @ArrayUnique({ message: 'alertDays must not repeat a window' })
  @IsInt({ each: true, message: 'each alert window must be a whole number of days' })
  @Min(MIN_EXPIRY_ALERT_DAYS, {
    each: true,
    message: `each alert window must be at least ${MIN_EXPIRY_ALERT_DAYS} day`,
  })
  @Max(MAX_EXPIRY_ALERT_DAYS, {
    each: true,
    message: `each alert window must be at most ${MAX_EXPIRY_ALERT_DAYS} days`,
  })
  alertDays!: number[];
}
