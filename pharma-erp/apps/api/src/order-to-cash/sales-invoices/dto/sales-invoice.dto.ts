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
