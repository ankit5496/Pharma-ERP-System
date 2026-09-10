import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

import type { ProcurementListQuery } from '@pharma-erp/types';

/**
 * A decimal arriving as a string.
 *
 * Validated as a pattern rather than with `@IsNumber`, deliberately: turning
 * the value into a JS number to check it is a number would defeat the reason
 * it is a string. The service parses it into a Prisma.Decimal, which is where
 * range and sign are enforced.
 */
export const DECIMAL_PATTERN = /^-?\d{1,15}(\.\d{1,4})?$/;

export const IsDecimalString = (field: string) =>
  Matches(DECIMAL_PATTERN, {
    message: `${field} must be a number with at most 4 decimal places`,
  });

export const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/**
 * Query parameters every Procure-to-Pay list accepts.
 *
 * `status` is a plain string rather than an enum: the six lists have six
 * different status vocabularies, and some accept derived values (OVERDUE,
 * QC_PENDING) that are not columns at all. Each service validates its own.
 */
export class ProcurementListQueryDto implements ProcurementListQuery {
  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(40)
  status?: string;

  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}
