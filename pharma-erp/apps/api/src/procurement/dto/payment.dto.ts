import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import type { RecordPaymentRequest } from '@pharma-erp/types';

import { IsDecimalString, trim } from './common.dto';

/**
 * Body of `POST /api/v1/procurement/payments`.
 *
 * The amount is checked against the invoice's outstanding balance in the
 * service, where the balance is actually known. There is no field for which
 * vendor is being paid: that follows from the invoice.
 */
export class RecordPaymentDto implements RecordPaymentRequest {
  @IsUUID()
  purchaseInvoiceId!: string;

  @IsDecimalString('Payment amount')
  amount!: string;

  @IsOptional()
  @IsISO8601()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(64)
  reference?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(32)
  method?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(500)
  notes?: string;
}

/**
 * What may still be corrected on a recorded payment.
 *
 * THE AMOUNT IS NOT HERE, and neither is the invoice it was made against.
 * Either would change what the vendor is still owed without anything in the
 * payables ledger recording that it changed. Money that went to the wrong place
 * is corrected by a further payment, not by editing the record of the first.
 *
 * The bank reference, the method and the date are how a payment is reconciled
 * against a statement, and those are routinely corrected.
 */
export class UpdatePaymentDto {
  @IsOptional()
  @IsISO8601()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(64)
  reference?: string | null;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(32)
  method?: string | null;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(500)
  notes?: string | null;
}
