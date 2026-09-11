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
  PURCHASE_INVOICE_STATUSES,
  type CreatePurchaseInvoiceLineRequest,
  type CreatePurchaseInvoiceRequest,
  type PurchaseInvoiceStatus,
} from '@pharma-erp/types';

import { IsDecimalString, trim } from './common.dto';

export class CreatePurchaseInvoiceLineDto implements CreatePurchaseInvoiceLineRequest {
  @IsUUID()
  itemId!: string;

  @IsDecimalString('Quantity')
  quantity!: string;

  @IsDecimalString('Rate')
  rate!: string;

  @IsDecimalString('Tax rate')
  taxRatePercent!: string;
}

/**
 * Body of `POST /api/v1/procurement/invoices`.
 *
 * No `dueDate`: it is derived from the invoice date plus the agreed payment
 * terms. Accepting one would let the due date disagree with the terms printed
 * beside it, and the payables screen would then chase the wrong date.
 */
export class CreatePurchaseInvoiceDto implements CreatePurchaseInvoiceRequest {
  @IsUUID()
  purchaseOrderId!: string;

  @IsOptional()
  @IsUUID()
  goodsReceiptId?: string;

  @IsString()
  @trim()
  @MaxLength(64)
  vendorInvoiceNumber!: string;

  @IsISO8601()
  invoiceDate!: string;

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
  notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'An invoice needs at least one line' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseInvoiceLineDto)
  lines!: CreatePurchaseInvoiceLineDto[];
}

export class ChangeInvoiceStatusDto {
  @IsIn(PURCHASE_INVOICE_STATUSES, {
    message: `Status must be one of: ${PURCHASE_INVOICE_STATUSES.join(', ')}`,
  })
  status!: PurchaseInvoiceStatus;
}
