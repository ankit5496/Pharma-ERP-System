import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import type {
  CustomerType,
  CustomerStatus,
  LicenceCategory,
  O2cLicenceStatus,
} from '@pharma-erp/types';

/**
 * Accepted enum values, as arrays because `@IsIn` needs a runtime list. The
 * assertions below fail the BUILD if @pharma-erp/types gains a value these
 * miss, which is the only thing keeping the wire contract and the validator
 * from drifting apart silently.
 */
const CUSTOMER_TYPES = [
  'DISTRIBUTOR',
  'STOCKIST',
  'WHOLESALER',
  'RETAIL_CHAIN',
  'HOSPITAL',
  'GOVERNMENT',
  'EXPORT',
  'OTHER',
] as const;

const CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'] as const;
const LICENCE_CATEGORIES = ['RETAIL', 'WHOLESALE', 'MANUFACTURING', 'OTHER'] as const;
const LICENCE_STATUSES = ['ACTIVE', 'SUSPENDED', 'CANCELLED'] as const;

type AssertSame<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

const _typesMatch: AssertSame<(typeof CUSTOMER_TYPES)[number], CustomerType> = true;
const _statusesMatch: AssertSame<(typeof CUSTOMER_STATUSES)[number], CustomerStatus> = true;
const _categoriesMatch: AssertSame<(typeof LICENCE_CATEGORIES)[number], LicenceCategory> = true;
const _licenceStatusesMatch: AssertSame<(typeof LICENCE_STATUSES)[number], O2cLicenceStatus> = true;
void _typesMatch;
void _statusesMatch;
void _categoriesMatch;
void _licenceStatusesMatch;

/**
 * The statutory GSTIN format: two-digit state code, ten-character PAN, entity
 * number, a literal Z, checksum. Mirrors the expression already used on the
 * party register so one screen cannot accept what the other refuses.
 */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Money crosses the wire as a decimal STRING — see the note in types. */
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

export class CreateCustomerDto {
  /**
   * Permanent once set: it is printed on invoices and despatch notes, so a
   * later rename would leave issued documents pointing at a code that no
   * longer resolves.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;

  @IsIn(CUSTOMER_TYPES)
  customerType!: CustomerType;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  contactPerson?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @Matches(GSTIN, { message: 'gstin must be a valid 15-character GSTIN.' })
  gstin?: string;

  /**
   * Its first two digits decide IGST vs CGST+SGST. Accepted separately because
   * a customer without a GSTIN still has a place of supply.
   */
  @IsOptional()
  @Matches(/^[0-9]{2}$/, { message: 'stateCode must be the two-digit GST state code.' })
  stateCode?: string;

  @IsOptional() @IsString() @MaxLength(255) billingLine1?: string;
  @IsOptional() @IsString() @MaxLength(255) billingLine2?: string;
  @IsOptional() @IsString() @MaxLength(120) billingCity?: string;
  @IsOptional() @IsString() @MaxLength(120) billingState?: string;
  @IsOptional() @IsString() @MaxLength(10) billingPin?: string;

  @IsOptional() @IsString() @MaxLength(255) shippingLine1?: string;
  @IsOptional() @IsString() @MaxLength(255) shippingLine2?: string;
  @IsOptional() @IsString() @MaxLength(120) shippingCity?: string;
  @IsOptional() @IsString() @MaxLength(120) shippingState?: string;
  @IsOptional() @IsString() @MaxLength(10) shippingPin?: string;

  /** A string, not a number — see the decimal note in @pharma-erp/types. */
  @IsOptional()
  @IsNumberString({ no_symbols: false })
  @Matches(MONEY, { message: 'creditLimit must be a decimal amount, e.g. "250000.00".' })
  creditLimit?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  creditTermsDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/**
 * Everything is optional, and `code` is absent entirely: the code is permanent,
 * so there is no field here to change it with.
 */
export class UpdateCustomerDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(255) name?: string;
  @IsOptional() @IsIn(CUSTOMER_TYPES) customerType?: CustomerType;
  @IsOptional() @IsIn(CUSTOMER_STATUSES) status?: CustomerStatus;
  @IsOptional() @IsString() @MaxLength(255) contactPerson?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(320) email?: string;

  @IsOptional()
  @Matches(GSTIN, { message: 'gstin must be a valid 15-character GSTIN.' })
  gstin?: string;

  @IsOptional()
  @Matches(/^[0-9]{2}$/, { message: 'stateCode must be the two-digit GST state code.' })
  stateCode?: string;

  @IsOptional() @IsString() @MaxLength(255) billingLine1?: string;
  @IsOptional() @IsString() @MaxLength(255) billingLine2?: string;
  @IsOptional() @IsString() @MaxLength(120) billingCity?: string;
  @IsOptional() @IsString() @MaxLength(120) billingState?: string;
  @IsOptional() @IsString() @MaxLength(10) billingPin?: string;

  @IsOptional() @IsString() @MaxLength(255) shippingLine1?: string;
  @IsOptional() @IsString() @MaxLength(255) shippingLine2?: string;
  @IsOptional() @IsString() @MaxLength(120) shippingCity?: string;
  @IsOptional() @IsString() @MaxLength(120) shippingState?: string;
  @IsOptional() @IsString() @MaxLength(10) shippingPin?: string;

  @IsOptional()
  @Matches(MONEY, { message: 'creditLimit must be a decimal amount, e.g. "250000.00".' })
  creditLimit?: string;

  @IsOptional() @IsInt() @Min(0) @Max(365) creditTermsDays?: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class CreateCustomerLicenceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  licenceNumber!: string;

  @IsIn(LICENCE_CATEGORIES)
  category!: LicenceCategory;

  /** "20B", "21B" — the form the licence was granted on. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  formNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  issuingAuthority?: string;

  /** Dates, not timestamps — validity is a day, not an instant. */
  @IsISO8601()
  issueDate!: string;

  @IsISO8601()
  expiryDate!: string;

  @IsOptional()
  @IsIn(LICENCE_STATUSES)
  status?: O2cLicenceStatus;

  @IsOptional()
  @IsBoolean()
  coversScheduleX?: boolean;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
