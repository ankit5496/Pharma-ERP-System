import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateSalesInvoiceDto {
  /** The confirmed dispatch being billed. Lines come from what actually shipped. */
  @IsUUID()
  dispatchId!: string;

  @IsISO8601()
  invoiceDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/**
 * Amends an issued tax invoice — NARROWLY.
 *
 * A tax invoice is a statutory document. Everything that appears on the filed
 * copy is snapshotted at issue and is NOT editable here: no amounts, no lines,
 * no batch numbers, no addresses, no GSTIN, no invoice date, no tax split.
 * Correcting any of those is a cancellation and a reissue, which leaves both
 * documents and the reversing ledger entry visible — that is the audit trail
 * doing its job.
 *
 * What remains is the commercial terms that are not part of the tax record:
 * the due date, which is a payment arrangement between the parties, and the
 * internal note. Refused once the invoice is CANCELLED, and the due date is
 * refused once money has been received against it, since the terms it was paid
 * under are then part of the settlement.
 */
export class UpdateSalesInvoiceDto {
  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
