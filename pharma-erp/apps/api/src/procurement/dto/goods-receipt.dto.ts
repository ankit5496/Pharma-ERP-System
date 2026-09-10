import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import type {
  CreateGoodsReceiptLineRequest,
  CreateGoodsReceiptRequest,
} from '@pharma-erp/types';

import { IsDecimalString, trim } from './common.dto';

/**
 * One received material.
 *
 * The batch fields are OPTIONAL here and mandatory in the service. That split
 * is deliberate: whether a batch number is required depends on the item's
 * `requiresBatchTracking` flag, which this layer cannot see. Marking them
 * required here would block the small number of items that genuinely have no
 * batch identity; leaving the check to the service means the rule is applied
 * against the actual item every time.
 */
export class CreateGoodsReceiptLineDto implements CreateGoodsReceiptLineRequest {
  @IsUUID()
  purchaseOrderLineId!: string;

  @IsDecimalString('Quantity received')
  quantityReceived!: string;

  @IsOptional()
  @IsDecimalString('Quantity rejected')
  quantityRejected?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(64)
  vendorBatchNumber?: string;

  @IsOptional()
  @IsISO8601()
  manufacturingDate?: string;

  @IsOptional()
  @IsISO8601()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(128)
  storageLocation?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(1000)
  remarks?: string;
}

export class CreateGoodsReceiptDto implements CreateGoodsReceiptRequest {
  @IsUUID()
  purchaseOrderId!: string;

  @IsOptional()
  @IsISO8601()
  receiptDate?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(64)
  vendorDocumentNumber?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(1000)
  remarks?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'A goods receipt needs at least one line' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateGoodsReceiptLineDto)
  lines!: CreateGoodsReceiptLineDto[];
}
