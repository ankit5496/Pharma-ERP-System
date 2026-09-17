import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

import type { PaymentMethod } from '@pharma-erp/types';

const PAYMENT_METHODS = ['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'OTHER'] as const;

type AssertSame<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _methodsMatch: AssertSame<(typeof PAYMENT_METHODS)[number], PaymentMethod> = true;
void _methodsMatch;

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

export class CreateReceiptDto {
  @IsUUID()
  salesInvoiceId!: string;

  @IsISO8601()
  receiptDate!: string;

  @Matches(MONEY, { message: 'amount must be a decimal amount, e.g. "12500.00".' })
  amount!: string;

  @IsIn(PAYMENT_METHODS)
  paymentMethod!: PaymentMethod;

  /** Cheque number, UPI reference, bank transaction id. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
