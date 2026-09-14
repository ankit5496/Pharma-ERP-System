import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import {
  LICENCE_TYPES,
  MAX_LICENCE_ALERT_LEAD_DAYS,
  MIN_LICENCE_ALERT_LEAD_DAYS,
  type LicenceType,
} from '@pharma-erp/types';

/**
 * Request shapes for the licence register — US-MD-04.
 *
 * `LICENCE_TYPES` is imported rather than restated. The party DTOs keep their
 * own copy because PartyType is shared with work outside this repository and
 * had to be mirrored; LicenceType is ours, declared once, and a second copy
 * here would be a second place to forget.
 */

const _typesAreOurs: readonly LicenceType[] = LICENCE_TYPES;
void _typesAreOurs;

/**
 * A calendar day, not a timestamp.
 *
 * `@IsISO8601()` alone would accept "2027-01-01T18:30:00Z", which is a
 * different day in half the world. The column is `@db.Date`, so the API
 * refuses anything that is not already a plain date rather than silently
 * truncating one and shifting it.
 */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_DAY_MESSAGE = 'must be a calendar date in YYYY-MM-DD form, with no time part';

export class CreateLicenceDto {
  @IsIn(LICENCE_TYPES)
  licenceType!: LicenceType;

  @IsString()
  @MaxLength(64)
  @Matches(/^\S(.*\S)?$/, { message: 'licenceNumber must not start or end with whitespace' })
  licenceNumber!: string;

  @IsString()
  @MaxLength(255)
  @Matches(/\S/, { message: 'issuingAuthority must not be blank' })
  issuingAuthority!: string;

  @IsOptional()
  @IsISO8601()
  @Matches(CALENDAR_DAY, { message: `issuedOn ${CALENDAR_DAY_MESSAGE}` })
  issuedOn?: string;

  /**
   * Required, and deliberately so. A licence row with no expiry date never
   * appears in the alert, which is the only reason this register exists.
   */
  @IsISO8601()
  @Matches(CALENDAR_DAY, { message: `expiryDate ${CALENDAR_DAY_MESSAGE}` })
  expiryDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/**
 * A change to an existing licence. Omitted means unchanged; `null` clears the
 * two fields that are genuinely optional.
 *
 * `expiryDate` is `string` and never `string | null` — unlike the party DTO's
 * nullable fields. Clearing it would hide the licence from the expiry sweep,
 * so the type does not offer it. A renewal sets a new date here.
 */
export class UpdateLicenceDto {
  @IsOptional()
  @IsIn(LICENCE_TYPES)
  licenceType?: LicenceType;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^\S(.*\S)?$/, { message: 'licenceNumber must not start or end with whitespace' })
  licenceNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/\S/, { message: 'issuingAuthority must not be blank' })
  issuingAuthority?: string;

  @IsOptional()
  @IsISO8601()
  @Matches(CALENDAR_DAY, { message: `issuedOn ${CALENDAR_DAY_MESSAGE}` })
  issuedOn?: string | null;

  @IsOptional()
  @IsISO8601()
  @Matches(CALENDAR_DAY, { message: `expiryDate ${CALENDAR_DAY_MESSAGE}` })
  expiryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

/**
 * How many days before expiry this company wants to be warned.
 *
 * The bounds mirror `tenants_licence_alert_lead_days_sane` exactly, so the
 * refusal is a readable message rather than a constraint violation. 0 would
 * mean "tell me once it has already expired", which is not a warning.
 */
export class UpdateLicenceAlertDto {
  @IsInt()
  @Min(MIN_LICENCE_ALERT_LEAD_DAYS)
  @Max(MAX_LICENCE_ALERT_LEAD_DAYS)
  alertLeadDays!: number;
}
