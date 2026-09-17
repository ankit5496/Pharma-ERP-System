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

/**
 * Corrects a RECORDED receipt.
 *
 * THE AMOUNT IS NOT EDITABLE. A receipt for the wrong amount was not a typo in
 * a form — money moved, and the invoice balance and the receivable ledger both
 * followed it. Correcting it is `bounce` and a new receipt, which leaves the
 * credit and its reversal on the ledger where an auditor can see both.
 *
 * What can be corrected is how the payment is described: the reference number
 * somebody mistyped off a cheque, the method, the date it actually cleared,
 * and the note. None of those move money.
 *
 * RECORDED only: once CLEARED, BOUNCED or CANCELLED the receipt has been acted
 * on and is part of a settled position.
 */
export class UpdateReceiptDto {
  @IsOptional()
  @IsISO8601()
  receiptDate?: string;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
