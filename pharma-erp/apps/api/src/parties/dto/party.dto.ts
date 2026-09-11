import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { PartyStatus, PartyType } from '@pharma-erp/types';

/**
 * Accepted enum values, as arrays because `@IsIn` needs a runtime list. The
 * assertions below fail the build if @pharma-erp/types gains a value these
 * miss — which matters more than usual here, because PartyType is shared with
 * work that lives outside this repository.
 */
const PARTY_TYPES = ['VENDOR', 'CUSTOMER', 'JOB_WORK_PRINCIPAL'] as const;
const PARTY_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

type AssertSame<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

const _typesMatch: AssertSame<(typeof PARTY_TYPES)[number], PartyType> = true;
const _statusesMatch: AssertSame<(typeof PARTY_STATUSES)[number], PartyStatus> = true;
void _typesMatch;
void _statusesMatch;

/**
 * The statutory GSTIN format: two-digit state code, ten-character PAN, entity
 * number, a literal Z, checksum. The same expression is a CHECK constraint on
 * the column — this one exists to answer with a readable message instead of a
 * constraint violation.
 */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const GSTIN_MESSAGE =
  'gstin must be 15 characters: state code, PAN, entity number, Z, checksum (e.g. 27AABCU9603R1ZM)';

/** Matches DECIMAL(14,2) — money, so two decimal places. */
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

const MONEY_MESSAGE = 'must be an amount with at most 2 decimal places, sent as a string';

export class CreatePartyDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^\S(.*\S)?$/, { message: 'code must not start or end with whitespace' })
  code!: string;

  @IsString()
  @MaxLength(255)
  @Matches(/\S/, { message: 'name must not be blank' })
  name!: string;

  @IsIn(PARTY_TYPES)
  partyType!: (typeof PARTY_TYPES)[number];

  @IsOptional()
  @IsIn(PARTY_STATUSES)
  status?: (typeof PARTY_STATUSES)[number];

  @IsOptional()
  @Matches(GSTIN, { message: GSTIN_MESSAGE })
  gstin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string;

  // Bounded at a year: anything beyond that is a typo, not terms.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  drugLicenceNumber?: string;

  @IsOptional()
  @IsISO8601()
  drugLicenceValidTo?: string;

  @IsOptional()
  @Matches(MONEY, { message: `creditLimit ${MONEY_MESSAGE}` })
  creditLimit?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  creditPeriodDays?: number;
}

/**
 * A change to an existing party. Every field optional; nullable ones accept
 * an explicit `null` to clear.
 *
 * `code` is not here. It identifies the party on every purchase order and
 * invoice already raised.
 */
export class UpdatePartyDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/\S/, { message: 'name must not be blank' })
  name?: string;

  @IsOptional()
  @IsIn(PARTY_TYPES)
  partyType?: (typeof PARTY_TYPES)[number];

  @IsOptional()
  @IsIn(PARTY_STATUSES)
  status?: (typeof PARTY_STATUSES)[number];

  @IsOptional()
  @Matches(GSTIN, { message: GSTIN_MESSAGE })
  gstin?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  drugLicenceNumber?: string | null;

  @IsOptional()
  @IsISO8601()
  drugLicenceValidTo?: string | null;

  @IsOptional()
  @Matches(MONEY, { message: `creditLimit ${MONEY_MESSAGE}` })
  creditLimit?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  creditPeriodDays?: number | null;
}
