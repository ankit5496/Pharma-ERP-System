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

import type { ReturnReason, ReturnedStockDisposition } from '@pharma-erp/types';

const RETURN_REASONS = [
  'EXPIRED',
  'NEAR_EXPIRY',
  'DAMAGED',
  'BREAKAGE',
  'WRONG_ITEM',
  'QUALITY_COMPLAINT',
  'RECALL',
  'ORDER_ERROR',
  'OTHER',
] as const;

const DISPOSITIONS = ['QUARANTINE', 'DESTROY', 'RESTOCK'] as const;

type AssertSame<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _reasonsMatch: AssertSame<(typeof RETURN_REASONS)[number], ReturnReason> = true;
const _dispositionsMatch: AssertSame<(typeof DISPOSITIONS)[number], ReturnedStockDisposition> = true;
void _reasonsMatch;
void _dispositionsMatch;

const QUANTITY = /^\d{1,11}(\.\d{1,3})?$/;

export class CreateSalesReturnLineDto {
  @IsUUID()
  salesInvoiceItemId!: string;

  @Matches(QUANTITY, { message: 'quantity must be a positive decimal.' })
  quantity!: string;

  /** Falls back to the return's overall reason when omitted. */
  @IsOptional()
  @IsIn(RETURN_REASONS)
  reason?: ReturnReason;

  /** QUARANTINE unless somebody decides otherwise — see the service. */
  @IsOptional()
  @IsIn(DISPOSITIONS)
  disposition?: ReturnedStockDisposition;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateSalesReturnDto {
  @IsUUID()
  salesInvoiceId!: string;

  @IsISO8601()
  returnDate!: string;

  @IsIn(RETURN_REASONS)
  reason!: ReturnReason;

  @IsOptional() @IsString() @MaxLength(1000) reasonNotes?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSalesReturnLineDto)
  items!: CreateSalesReturnLineDto[];
}
