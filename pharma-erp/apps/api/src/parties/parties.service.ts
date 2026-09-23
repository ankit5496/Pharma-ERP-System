import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { Party, Prisma } from '@pharma-erp/database';
import type { PartySummary, PartyStatus, PartyType } from '@pharma-erp/types';
import { PARTY_CODE_DIGITS, PARTY_CODE_PREFIXES, PARTY_TYPE_LABELS } from '@pharma-erp/types';

import { fieldConflict } from '../common/field-error';
import { withCreatedBy } from '../common/created-by';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import type { CreatePartyDto, UpdatePartyDto } from './dto/party.dto';

/**
 * The party register — suppliers, customers and job-work principals.
 *
 * The table is SHARED with the Procure-to-Pay work, which created it and
 * already references it from purchase orders, goods receipts and invoices.
 * This service adds the master-data screen over it; it does not own the
 * schema, and the column names reflect that.
 *
 * Everything goes through `prisma.scoped`, so row-level security applies to
 * reads as well as writes. The explicit `tenantId` on a write is a second
 * layer — the policy's WITH CHECK would reject a mismatched row regardless.
 *
 * US-MD-02's rule — an ACTIVE customer must have a drug licence number and
 * validity on file — is a CHECK constraint in the migration. It is checked
 * here too, but only so the refusal is a sentence somebody can act on rather
 * than a constraint name. The database is what makes it true.
 */
@Injectable()
export class PartiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(type?: string): Promise<PartySummary[]> {
    const partyType = PARTY_TYPES.includes(type as PartyType) ? (type as PartyType) : undefined;

    const parties = await this.prisma.scoped.party.findMany({
      where: { deletedAt: null, ...(partyType ? { partyType } : {}) },
      // Newest first: this list is read as a picklist as often as a
      // register, and the party somebody wants is usually the one just added.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // A count, never the documents: the bytes are in the row, so including
      // them would pull every customer's paperwork to draw a register.
      include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
    });

    return withCreatedBy(
      this.prisma,
      parties,
      parties.map((party) => toPartySummary(party, party._count.documents)),
    );
  }

  async create(dto: CreatePartyDto): Promise<PartySummary> {
    const tenantId = this.tenantContext.requireTenantId();
    const status = dto.status ?? 'ACTIVE';

    assertLicensedWhenActiveCustomer({
      partyType: dto.partyType,
      status,
      drugLicenceNumber: dto.drugLicenceNumber ?? null,
      drugLicenceValidTo: dto.drugLicenceValidTo ?? null,
    });

    try {
      // ALLOCATED, not accepted from the request. Inside the transaction that
      // writes the party, so a code and the row it belongs to land together or
      // not at all — and two people adding a party at once cannot be handed the
      // same one, because the counter is incremented under a row lock.
      const party = await this.prisma.transaction(async (tx) =>
        tx.party.create({
          data: {
            tenantId,
            createdById: this.tenantContext.getUserId(),
            code: await nextPartyCode(tx, tenantId, dto.partyType),
            name: dto.name.trim(),
            partyType: dto.partyType,
            status,
            gstin: dto.gstin?.trim().toUpperCase() || null,
            email: dto.email?.trim() || null,
            phone: dto.phone?.trim() || null,
            address: dto.address?.trim() || null,
            paymentTermsDays: dto.paymentTermsDays ?? 30,
            drugLicenceNumber: dto.drugLicenceNumber?.trim() || null,
            drugLicenceValidTo: dto.drugLicenceValidTo ? fromIsoDate(dto.drugLicenceValidTo) : null,
            creditLimit: dto.creditLimit ?? null,
            creditPeriodDays: dto.creditPeriodDays ?? null,
          },
        }),
      );

      return toPartySummary(party);
    } catch (error) {
      // No code to name in the message any more: the caller did not choose one.
      // A collision here would mean the counter has drifted behind the data
      // rather than anything the caller can fix.
      throw translate(error, '');
    }
  }

  /**
   * The code the next party of a type would take — a PREDICTION, not a
   * reservation.
   *
   * Nothing is held: if a colleague saves a party of the same type first they
   * take this code and the next one moves on. The form shows it so the code is
   * not a surprise that appears only after saving.
   *
   * Reads the SAME row the allocator increments, keyed identically. Computing
   * it any other way — from the highest existing code, say — is how a preview
   * comes to disagree with what is actually allocated.
   */
  async previewCode(type: PartyType): Promise<{ code: string }> {
    const tenantId = this.tenantContext.requireTenantId();
    const prefix = PARTY_CODE_PREFIXES[type];

    const sequence = await this.prisma.scoped.documentSequence.findUnique({
      where: { tenantId_docType_year: { tenantId, docType: prefix, year: PARTY_CODE_YEAR } },
      select: { nextValue: true },
    });

    // No counter yet means no party of this type has ever been created, so the
    // first one takes 1.
    return {
      code: `${prefix}-${String(sequence?.nextValue ?? 1).padStart(PARTY_CODE_DIGITS, '0')}`,
    };
  }

  async update(id: string, dto: UpdatePartyDto): Promise<PartySummary> {
    const existing = await this.prisma.scoped.party.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) throw new NotFoundException('That party does not exist.');

    // THE TYPE IS FIXED ONCE THE PARTY EXISTS.
    //
    // It decides which rules apply — a customer needs a drug licence to be
    // active, a principal carries job-work agreements — and those decisions
    // have already been made against orders, invoices and agreements citing
    // this row. Turning a customer into a supplier would leave that paperwork
    // describing a party it no longer matches.
    //
    // The party CODE is now derived from the type as well (VEN-00001 against
    // CUS-00001), which makes this rule load-bearing rather than merely
    // sensible: a vendor moved to customer would keep a VEN- code while filed
    // as a customer, and that code is already printed on documents.
    //
    // The same value is accepted silently: an edit form that round-trips every
    // field should not be refused for sending back what is already stored.
    if (dto.partyType !== undefined && dto.partyType !== existing.partyType) {
      throw fieldConflict(
        'partyType',
        `"${existing.code}" is already recorded as ` +
          `${PARTY_TYPE_LABELS[existing.partyType].toLowerCase()}, and its type cannot be ` +
          'changed — documents that cite it were raised against that type. Create a separate ' +
          'party instead.',
      );
    }

    // Checked against the state the row will be IN, not the fields that
    // happen to be in this request: activating a customer and supplying its
    // licence can arrive in one call or in either order, and only the
    // resulting row decides whether the rule holds.
    assertLicensedWhenActiveCustomer({
      partyType: dto.partyType ?? existing.partyType,
      status: dto.status ?? existing.status,
      drugLicenceNumber:
        dto.drugLicenceNumber !== undefined ? dto.drugLicenceNumber : existing.drugLicenceNumber,
      drugLicenceValidTo:
        dto.drugLicenceValidTo !== undefined
          ? dto.drugLicenceValidTo
          : existing.drugLicenceValidTo
            ? toIsoDate(existing.drugLicenceValidTo)
            : null,
    });

    const data: Prisma.PartyUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.partyType !== undefined) data.partyType = dto.partyType;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.gstin !== undefined) data.gstin = dto.gstin?.trim().toUpperCase() || null;
    if (dto.email !== undefined) data.email = dto.email?.trim() || null;
    if (dto.phone !== undefined) data.phone = dto.phone?.trim() || null;
    if (dto.address !== undefined) data.address = dto.address?.trim() || null;
    if (dto.paymentTermsDays !== undefined) data.paymentTermsDays = dto.paymentTermsDays;
    if (dto.drugLicenceNumber !== undefined) {
      data.drugLicenceNumber = dto.drugLicenceNumber?.trim() || null;
    }
    if (dto.drugLicenceValidTo !== undefined) {
      data.drugLicenceValidTo = dto.drugLicenceValidTo ? fromIsoDate(dto.drugLicenceValidTo) : null;
    }
    if (dto.creditLimit !== undefined) data.creditLimit = dto.creditLimit;
    if (dto.creditPeriodDays !== undefined) data.creditPeriodDays = dto.creditPeriodDays;

    try {
      const party = await this.prisma.scoped.party.update({ where: { id }, data });

      return toPartySummary(party);
    } catch (error) {
      throw translate(error, existing.code);
    }
  }

  /**
   * Retires a party.
   *
   * A soft delete — `parties_no_hard_delete` is a database trigger, so a real
   * DELETE is refused by Postgres. Purchase orders and invoices cite this row
   * and have to stay readable for years.
   *
   * NO IN-USE CHECK YET, and that is a gap rather than a decision: purchase
   * orders, receipts and invoices all reference `parties`, but those tables
   * belong to the Procure-to-Pay work and are not in this repository's schema,
   * so this service cannot query them. Until they are, a party can be retired
   * while orders still name it.
   */
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.scoped.party.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) throw new NotFoundException('That party does not exist.');

    await this.prisma.scoped.party.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}

const PARTY_TYPES: readonly PartyType[] = ['VENDOR', 'CUSTOMER', 'JOB_WORK_PRINCIPAL'];

/** US-MD-02, stated once and used by both create and update. */
function assertLicensedWhenActiveCustomer(party: {
  partyType: PartyType;
  status: PartyStatus;
  drugLicenceNumber: string | null;
  drugLicenceValidTo: string | null;
}): void {
  if (party.partyType !== 'CUSTOMER' || party.status !== 'ACTIVE') return;

  if (!party.drugLicenceNumber || !party.drugLicenceValidTo) {
    throw new BadRequestException(
      'A customer cannot be active without a drug licence number and its validity date. ' +
        'Save it as inactive until the licence is on file.',
    );
  }
}

/**
 * Party codes are not year-scoped, so they park on year 0.
 *
 * `document_sequences` keys on (tenant, docType, year) because the series it
 * was built for restart each January. A party code does not: VEN-00412 is the
 * four-hundred-and-twelfth vendor this company has ever recorded, and
 * restarting it annually would hand out a code that already exists.
 *
 * The same sentinel the item codes use, for the same reason. 0 cannot collide
 * with a real year.
 */
const PARTY_CODE_YEAR = 0;

/**
 * The next code for a party type, allocated inside the caller's transaction.
 *
 * ONE ATOMIC UPSERT, not a read-then-write. Two parties created in the same
 * instant would both read the same highest number and compute the same next
 * one; the unique index would then refuse the loser with a failure nobody
 * could act on. An UPDATE ... RETURNING takes a row lock, so the second caller
 * waits and gets the following value instead.
 *
 * `docType` is a VarChar(16), so VEN/CUS/PRI need no migration to store —
 * only a counter row, created on the first party of that type.
 */
async function nextPartyCode(
  tx: Prisma.TransactionClient,
  tenantId: string,
  type: PartyType,
): Promise<string> {
  const prefix = PARTY_CODE_PREFIXES[type];

  const sequence = await tx.documentSequence.upsert({
    where: { tenantId_docType_year: { tenantId, docType: prefix, year: PARTY_CODE_YEAR } },
    create: { tenantId, docType: prefix, year: PARTY_CODE_YEAR, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
    select: { nextValue: true },
  });

  // `create` sets nextValue to 2 and this party takes 1; `update` returns the
  // already-incremented value, so the number just used is one less.
  return `${prefix}-${String(sequence.nextValue - 1).padStart(PARTY_CODE_DIGITS, '0')}`;
}

/** Turns a database refusal into something the person who hit it can read. */
function translate(error: unknown, code: string): unknown {
  if (isConstraint(error, 'P2002') || isConstraint(error, 'parties_tenant_id_code_key')) {
    return fieldConflict('code', `A party with code "${code}" already exists.`);
  }

  if (isConstraint(error, 'parties_active_customer_is_licensed')) {
    return new BadRequestException(
      'A customer cannot be active without a drug licence number and its validity date.',
    );
  }

  if (isConstraint(error, 'parties_gstin_format')) {
    return new BadRequestException('That is not a valid GSTIN.');
  }

  return error;
}

/**
 * Matched on the error's `code` or its message rather than with
 * `instanceof Prisma.PrismaClientKnownRequestError`: `Prisma` is a type-only
 * import here, and `instanceof` across two copies of the client — which a
 * pnpm workspace can produce — silently returns false. Postgres always names
 * the constraint it rejected, and those names are ours.
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

/**
 * A `@db.Date` column read back as YYYY-MM-DD.
 *
 * Not `toLocaleDateString`: a licence expiry is a calendar day on a
 * certificate, and reformatting it into the reader's locale is how 03/04/2027
 * becomes ambiguous.
 */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC, so a date column never shifts a day by timezone. */
function fromIsoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

export function toPartySummary(party: Party, documentCount = 0): PartySummary {
  const validTo = party.drugLicenceValidTo ? toIsoDate(party.drugLicenceValidTo) : null;

  return {
    // Filled in by the register that lists these; see PeopleService.
    createdBy: null,
    id: party.id,
    createdAt: party.createdAt.toISOString(),
    code: party.code,
    name: party.name,
    partyType: party.partyType,
    status: party.status,
    gstin: party.gstin,
    email: party.email,
    phone: party.phone,
    address: party.address,
    paymentTermsDays: party.paymentTermsDays,
    drugLicenceNumber: party.drugLicenceNumber,
    drugLicenceValidTo: validTo,
    // `toString()` on a Prisma Decimal, never Number(): the column is exact
    // and a double is not.
    creditLimit: party.creditLimit?.toString() ?? null,
    creditPeriodDays: party.creditPeriodDays,
    // Compared as calendar days in UTC. A licence is valid THROUGH its final
    // day, so only a date strictly before today has lapsed.
    licenceExpired: validTo !== null && validTo < new Date().toISOString().slice(0, 10),
    // Defaults to 0 for the single-record paths: a create has none by
    // definition, and an update's own response is not what draws the register.
    // The listing passes the real count.
    documentCount,
  };
}
