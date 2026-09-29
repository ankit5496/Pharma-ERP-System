import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

import {
  RESERVATION_STATES,
  STOCK_BATCH_STATUSES,
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
