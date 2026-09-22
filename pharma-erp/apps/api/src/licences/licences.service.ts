import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { Licence, Prisma } from '@pharma-erp/database';
import type {
  LicenceRegister,
  LicenceStatus,
  LicenceSummary,
  LicenceType,
} from '@pharma-erp/types';
import { LICENCE_NUMBER_RULES } from '@pharma-erp/types';

import { fieldBadRequest } from '../common/field-error';
import { withCreatedBy } from '../common/created-by';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import type { CreateLicenceDto, UpdateLicenceDto } from './dto/licence.dto';

/**
 * The Licence & Compliance register — US-MD-04.
 *
 * The company's own statutory permissions, and the sweep that notices one is
 * about to lapse. Everything goes through `prisma.scoped`, so row-level
 * security applies to reads as well as writes.
 *
 * WHO MAY SEE THIS is not decided here. `@Roles('ADMIN', 'QUALITY_OFFICER')`
 * on the controller is the gate; this service assumes the caller already
 * passed it. Putting the check in both places would look safer and mostly
 * mean two rules to keep in step.
 */
@Injectable()
export class LicencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * The register, with each row already classified against this company's own
   * lead time.
   *
   * The tenant row is read in the same call because `alertLeadDays` decides
   * what EXPIRING means, and a client that had to fetch it separately could
   * render the register against a stale threshold.
   */
  async list(): Promise<LicenceRegister> {
    const tenantId = this.tenantContext.requireTenantId();

    const [licences, tenant] = await Promise.all([
      this.prisma.scoped.licence.findMany({
        where: { deletedAt: null },
        // Newest first, like every other master-data register: the row
        // somebody wants is usually the one just added.
        //
        // THIS CHANGED FROM SOONEST-TO-LAPSE, and `expiring` below filters
        // this same list — so the dashboard's alert is no longer in expiry
        // order either. It groups expired ahead of expiring, which is the
        // distinction that actually drives action, but within each group the
        // order is now arbitrary. Worth sorting there if the alert ever grows
        // past a handful of rows.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.scoped.tenant.findFirst({
        where: { id: tenantId },
        select: { licenceAlertLeadDays: true },
      }),
    ]);

    const alertLeadDays = tenant?.licenceAlertLeadDays ?? DEFAULT_LEAD_DAYS;

    return {
      licences: await withCreatedBy(
        this.prisma,
        licences,
        licences.map((licence) => toLicenceSummary(licence, alertLeadDays)),
      ),
      alertLeadDays,
    };
  }

  /**
   * The licences this company should be warned about, soonest first.
   *
   * Read by the dashboard. Expired ones are included and sort first: a lapsed
   * manufacturing licence is a stop-work condition, not a reminder, and
   * dropping it from the list once the date passes would make the alert
   * disappear at exactly the moment it starts to matter.
   */
  async expiring(): Promise<{ alertLeadDays: number; licences: LicenceSummary[] }> {
    const { licences, alertLeadDays } = await this.list();

    return {
      alertLeadDays,
      licences: licences.filter((licence) => licence.status !== 'VALID'),
    };
  }

  async create(dto: CreateLicenceDto): Promise<LicenceSummary> {
    const tenantId = this.tenantContext.requireTenantId();

    assertExpiryAfterIssue(dto.expiryDate, dto.issuedOn ?? null);
    assertNumberMatchesType(dto.licenceType, dto.licenceNumber.trim());

    try {
      const licence = await this.prisma.scoped.licence.create({
        data: {
          tenantId,
          createdById: this.tenantContext.getUserId(),
          licenceType: dto.licenceType,
          licenceNumber: dto.licenceNumber.trim(),
          issuingAuthority: dto.issuingAuthority.trim(),
          issuedOn: dto.issuedOn ? fromIsoDate(dto.issuedOn) : null,
          expiryDate: fromIsoDate(dto.expiryDate),
          notes: dto.notes?.trim() || null,
        },
      });

      return toLicenceSummary(licence, await this.leadDays());
    } catch (error) {
      throw translate(error, dto.licenceNumber.trim());
    }
  }

  async update(id: string, dto: UpdateLicenceDto): Promise<LicenceSummary> {
    const existing = await this.prisma.scoped.licence.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) throw new NotFoundException('That licence does not exist.');

    // Checked against the state the row will be IN, not the fields that happen
    // to be in this request — a renewal that moves both dates can arrive in
    // one call or in either order.
    assertExpiryAfterIssue(
      dto.expiryDate ?? toIsoDate(existing.expiryDate),
      dto.issuedOn !== undefined
        ? dto.issuedOn
        : existing.issuedOn
          ? toIsoDate(existing.issuedOn)
          : null,
    );

    // Against the row's RESULTING state, like the dates above: changing the
    // type alone has to re-check the number it will then be paired with, and
    // changing the number alone has to check it against the type already
    // stored.
    assertNumberMatchesType(
      dto.licenceType ?? (existing.licenceType as LicenceType),
      (dto.licenceNumber ?? existing.licenceNumber).trim(),
    );

    const data: Prisma.LicenceUpdateInput = {};

    if (dto.licenceType !== undefined) data.licenceType = dto.licenceType;
    if (dto.licenceNumber !== undefined) data.licenceNumber = dto.licenceNumber.trim();
    if (dto.issuingAuthority !== undefined) data.issuingAuthority = dto.issuingAuthority.trim();
    if (dto.issuedOn !== undefined) data.issuedOn = dto.issuedOn ? fromIsoDate(dto.issuedOn) : null;
    if (dto.expiryDate !== undefined) data.expiryDate = fromIsoDate(dto.expiryDate);
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;

    try {
      const licence = await this.prisma.scoped.licence.update({ where: { id }, data });

      return toLicenceSummary(licence, await this.leadDays());
    } catch (error) {
      throw translate(error, dto.licenceNumber?.trim() ?? existing.licenceNumber);
    }
  }

  /**
   * Retires a licence from the register.
   *
   * A soft delete — `licences_no_hard_delete` is a database trigger, so a real
   * DELETE is refused by Postgres. A licence that covered a batch made last
   * year is part of that batch's compliance record and has to stay readable.
   */
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.scoped.licence.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) throw new NotFoundException('That licence does not exist.');

    await this.prisma.scoped.licence.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Changes how far ahead this company is warned. */
  async setAlertLeadDays(days: number): Promise<LicenceRegister> {
    const tenantId = this.tenantContext.requireTenantId();

    try {
      await this.prisma.scoped.tenant.update({
        where: { id: tenantId },
        data: { licenceAlertLeadDays: days },
        // Narrowed deliberately. Without a `select`, Prisma reads the whole
        // tenant row back, so this write depends on every OTHER column in the
        // table matching the schema — and fails outright on a database where
        // one of them is missing, for a column it never touched. One setting
        // changed, one column returned.
        select: { licenceAlertLeadDays: true },
      });
    } catch (error) {
      throw translate(error, '');
    }

    return this.list();
  }

  private async leadDays(): Promise<number> {
    const tenant = await this.prisma.scoped.tenant.findFirst({
      where: { id: this.tenantContext.requireTenantId() },
      select: { licenceAlertLeadDays: true },
    });

    return tenant?.licenceAlertLeadDays ?? DEFAULT_LEAD_DAYS;
  }
}

/**
 * The fallback when the tenant row cannot be read.
 *
 * Should not happen — RLS guarantees the caller's own tenant is visible — but
 * defaulting to the specified 60 is better than defaulting to no warning at
 * all, which is what `?? 0` would quietly produce.
 */
const DEFAULT_LEAD_DAYS = 60;

/** Milliseconds in a day, for the calendar-day arithmetic below. */
const DAY_MS = 86_400_000;

/**
 * Mirrors `licences_expiry_after_issue` so the refusal is a sentence rather
 * than a constraint name. The constraint is what makes it true.
 */
function assertExpiryAfterIssue(expiryDate: string, issuedOn: string | null): void {
  if (!issuedOn) return;

  if (expiryDate <= issuedOn) {
    throw new BadRequestException(
      'A licence cannot expire on or before the day it was issued. Check the two dates.',
    );
  }
}

/**
 * The number has to match the shape its TYPE requires.
 *
 * Not something a DTO decorator can do: the rule for `licenceNumber` depends on
 * `licenceType`, and class-validator checks one property at a time. A GSTIN has
 * a statutory 15-character format worth insisting on; a state drug licence does
 * not, so only its alphabet is checked. Both rules come from
 * LICENCE_NUMBER_RULES, which the form reads too — one definition, so a value
 * the screen accepts is one the server accepts.
 *
 * Attributed to `licenceNumber` so the message lands under that control rather
 * than as a sentence over the whole drawer.
 */
function assertNumberMatchesType(licenceType: LicenceType, licenceNumber: string): void {
  const rule = LICENCE_NUMBER_RULES[licenceType];

  if (new RegExp(rule.pattern).test(licenceNumber)) return;

  throw fieldBadRequest('licenceNumber', rule.message);
}

/** Turns a database refusal into something the person who hit it can read. */
function translate(error: unknown, licenceNumber: string): unknown {
  if (
    isConstraint(error, 'P2002') ||
    isConstraint(error, 'licences_tenant_id_licence_type_licence_number_key')
  ) {
    return new ConflictException(
      `A licence of that type numbered "${licenceNumber}" is already on the register. ` +
        'Renewing one means changing its expiry date, not adding a second record.',
    );
  }

  if (isConstraint(error, 'licences_expiry_after_issue')) {
    return new BadRequestException('A licence cannot expire on or before the day it was issued.');
  }

  if (isConstraint(error, 'licences_licence_number_not_blank')) {
    return new BadRequestException('A licence needs its number as printed on the certificate.');
  }

  if (isConstraint(error, 'licences_issuing_authority_not_blank')) {
    return new BadRequestException('A licence needs the authority that issued it.');
  }

  if (isConstraint(error, 'tenants_licence_alert_lead_days_sane')) {
    return new BadRequestException(
      'The renewal warning must be between 1 and 365 days before expiry.',
    );
  }

  return error;
}

/**
 * Matched on the error's `code` or its message rather than with
 * `instanceof Prisma.PrismaClientKnownRequestError`: `Prisma` is a type-only
 * import here, and `instanceof` across two copies of the client — which a
 * pnpm workspace can produce — silently returns false.
 */
function isConstraint(error: unknown, marker: string): boolean {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === marker
  ) {
    return true;
  }

  return error instanceof Error && error.message.includes(marker);
}

/** A `@db.Date` column read back as YYYY-MM-DD. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC, so a date column never shifts a day by timezone. */
function fromIsoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

/**
 * Whole calendar days from today until `expiryDate`, in UTC.
 *
 * Both sides are normalised to midnight UTC before subtracting, so the result
 * is a count of days and not a fraction that rounds differently depending on
 * the hour the request happened to arrive. A licence is valid THROUGH its
 * final day, so 0 means "expires today, still valid" and -1 means "lapsed
 * yesterday".
 */
function daysUntil(expiryDate: Date, now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiry = Date.UTC(
    expiryDate.getUTCFullYear(),
    expiryDate.getUTCMonth(),
    expiryDate.getUTCDate(),
  );

  return Math.round((expiry - today) / DAY_MS);
}

/**
 * One licence, classified against this company's configured lead time.
 *
 * Computed on the server on purpose: the comparison is against the SERVER's
 * today, so two browsers in different timezones cannot disagree about whether
 * a licence has lapsed.
 */
export function toLicenceSummary(licence: Licence, alertLeadDays: number): LicenceSummary {
  const daysUntilExpiry = daysUntil(licence.expiryDate, new Date());

  const status: LicenceStatus =
    daysUntilExpiry < 0 ? 'EXPIRED' : daysUntilExpiry <= alertLeadDays ? 'EXPIRING' : 'VALID';

  return {
    // Filled in by the register that lists these; see PeopleService.
    createdBy: null,
    id: licence.id,
    createdAt: licence.createdAt.toISOString(),
    licenceType: licence.licenceType as LicenceType,
    licenceNumber: licence.licenceNumber,
    issuingAuthority: licence.issuingAuthority,
    issuedOn: licence.issuedOn ? toIsoDate(licence.issuedOn) : null,
    expiryDate: toIsoDate(licence.expiryDate),
    notes: licence.notes,
    daysUntilExpiry,
    status,
  };
}
