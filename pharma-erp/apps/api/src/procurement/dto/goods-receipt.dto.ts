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
  UpdateGoodsReceiptLineRequest,
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

/**
 * One line's batch identity, corrected.
 *
 * The three fields a person transcribes from the delivery note, and the three a
 * typo actually happens on. Each is applied to the STOCK LOT the line created
 * as well as to the line, because a lot whose expiry disagreed with the receipt
 * it came from would be picked FEFO on one date and recalled on another.
 */
export class UpdateGoodsReceiptLineDto implements UpdateGoodsReceiptLineRequest {
  @IsUUID()
  id!: string;

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
}

/**
 * What may still be corrected on a booked receipt.
 *
 * THE QUANTITY IS NOT HERE, and that is the whole shape of this DTO. Booking a
 * receipt creates batches and moves stock; re-typing a received quantity
 * afterwards would leave the stock ledger — which is append-only — describing a
 * delivery that never happened. A wrong quantity is corrected by receiving the
 * difference, or by rejecting the batch at QC.
 *
 * What is left is what a person transcribed: the batch number and the two
 * dates, per line, and the paperwork around the delivery.
 */
export class UpdateGoodsReceiptDto {
  @IsOptional()
  @IsISO8601()
  receiptDate?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(64)
  vendorDocumentNumber?: string | null;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(1000)
  remarks?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => UpdateGoodsReceiptLineDto)
  lines?: UpdateGoodsReceiptLineDto[];
}
