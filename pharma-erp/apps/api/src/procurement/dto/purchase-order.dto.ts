import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  PURCHASE_ORDER_STATUSES,
  type ConvertRequisitionRequest,
  type CreatePurchaseOrderLineRequest,
  type CreatePurchaseOrderRequest,
  type PurchaseOrderStatus,
} from '@pharma-erp/types';

import { IsDecimalString, trim } from './common.dto';

export class CreatePurchaseOrderLineDto implements CreatePurchaseOrderLineRequest {
  @IsUUID()
  itemId!: string;

  @IsOptional()
  @IsUUID()
  requisitionId?: string;

  @IsDecimalString('Quantity')
  quantity!: string;

  @IsDecimalString('Rate')
  rate!: string;

  @IsDecimalString('Tax rate')
  taxRatePercent!: string;
}

export class CreatePurchaseOrderDto implements CreatePurchaseOrderRequest {
  @IsUUID()
  vendorId!: string;

  @IsOptional()
  @IsISO8601()
  expectedDeliveryDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  // Two years of credit is not a payment term, it is a typo.
  @Max(365)
  @Type(() => Number)
  paymentTermsDays?: number;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'A purchase order needs at least one line' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderLineDto)
  lines!: CreatePurchaseOrderLineDto[];
}

/** Header-only edit. Lines are not patchable — replace the draft instead. */
export class UpdatePurchaseOrderDto {
  @IsOptional()
  @IsISO8601()
  expectedDeliveryDate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  @Type(() => Number)
  paymentTermsDays?: number;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(1000)
  notes?: string | null;
}

/** Body of `POST /requisitions/:id/convert`. */
export class ConvertRequisitionDto implements ConvertRequisitionRequest {
  @IsUUID()
  vendorId!: string;

  @IsDecimalString('Rate')
  rate!: string;

  @IsDecimalString('Tax rate')
  taxRatePercent!: string;

  @IsOptional()
  @IsISO8601()
  expectedDeliveryDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  @Type(() => Number)
  paymentTermsDays?: number;
}

export class ChangePurchaseOrderStatusDto {
  @IsIn(PURCHASE_ORDER_STATUSES, {
    message: `Status must be one of: ${PURCHASE_ORDER_STATUSES.join(', ')}`,
  })
  status!: PurchaseOrderStatus;
}
