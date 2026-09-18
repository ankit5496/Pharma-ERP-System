import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { Prisma } from '@pharma-erp/database';
import type {
  AgreementStatus,
  BillingModel,
  ConversionRateBasis,
  JobWorkAgreementSummary,
  JobWorkMappingView,
} from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import type {
  CreateJobWorkAgreementDto,
  JobWorkMappingDto,
  UpdateJobWorkAgreementDto,
} from './dto/job-work.dto';

/**
 * The Principal & Job-Work Agreement register — US-MD-05.
 *
 * Two criteria, and only one of them can be fully honoured today:
 *
 *   "The billing model is a mandatory field on the agreement and cannot be
 *    changed on an order that is already in production."
 *      The first half is a NOT NULL column plus a required DTO field.
 *      THE SECOND HALF IS NOT ENFORCED. It is a rule about production ORDERS,
 *      and `production_orders` neither references an agreement nor exists on
 *      the hosted database. See the migration header for exactly what is owed
 *      when the Production module is built.
 *
 *   "The product-brand mapping must link one or more of the company's BOMs to
 *    the principal's specific brand name and pack design."
 *      Enforced here, inside the creating transaction — a CHECK constraint
 *      cannot count rows in another table.
 *
 * Everything goes through `prisma.scoped`, so row-level security applies to
 * reads as well as writes.
 */
@Injectable()
export class JobWorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(): Promise<JobWorkAgreementSummary[]> {
    const agreements = await this.prisma.scoped.jobWorkAgreement.findMany({
      where: { deletedAt: null },
      include: AGREEMENT_INCLUDE,
      // Soonest to lapse first, open-ended agreements last: the register and
      // the question "what needs renegotiating" are the same question.
      orderBy: [{ validTo: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    });

    return agreements.map(toAgreementSummary);
  }

  async create(dto: CreateJobWorkAgreementDto): Promise<JobWorkAgreementSummary> {
    const tenantId = this.tenantContext.requireTenantId();

    assertRateHasBasis(dto.conversionChargeRate ?? null, dto.conversionRateBasis ?? null);
    assertDatesOrdered(dto.validFrom ?? null, dto.validTo ?? null);
    await this.assertPrincipalIsAPrincipal(dto.principalId);
    await this.assertMappingsUsable(dto.mappings);

    try {
      // One transaction: an agreement with no mappings is not a half-saved
      // record, it is a record that fails its own acceptance criterion. Either
      // both land or neither does.
      //
      // `prisma.transaction`, NOT `prisma.scoped.$transaction`. The difference
      // is not stylistic and it cost a production 500:
      //
      //   * `scoped` is an EXTENDED client — it wraps every model call in its
      //     own `$transaction([set_config, query])` on the OUTER client. Nest
      //     those inside another transaction and the tenant is set on a
      //     different connection from the one doing the work, so the outer
      //     transaction is not the atomic unit it looks like.
      //   * It also takes Prisma's raw defaults, 5s timeout and 2s maxWait.
      //     This helper uses TRANSACTION_TIMEOUT_MS / TRANSACTION_MAX_WAIT_MS
      //     (30s / 10s), which exist because the managed database is in another
      //     region: at ~800ms a round trip, four statements blow the 5s default
      //     and the save dies as "Transaction already closed" — a 500 the
      //     person at the form reads as "Internal server error".
      //
      // It passes every test against localhost, where a round trip is
      // sub-millisecond. That is what makes it worth a comment this long.
      const agreement = await this.prisma.transaction(async (tx) => {
        const created = await tx.jobWorkAgreement.create({
          data: {
            tenantId,
            principalId: dto.principalId,
            billingModel: dto.billingModel,
            // ALLOCATED HERE, not accepted from the request. The reference used
            // to be typed by hand and optional, which left the register holding
            // things like "13123" beside "12341123" — no shape, no order, and
            // nothing to quote on a document. Inside this transaction, so the
            // number and the agreement it belongs to land together or not at
            // all.
            agreementReference: await this.nextReference(tx),
            conversionChargeRate: dto.conversionChargeRate ?? null,
            conversionRateBasis: dto.conversionRateBasis ?? null,
            validFrom: dto.validFrom ? fromIsoDate(dto.validFrom) : null,
            validTo: dto.validTo ? fromIsoDate(dto.validTo) : null,
            notes: dto.notes?.trim() || null,
          },
        });

        await tx.jobWorkProductMapping.createMany({
          data: dto.mappings.map((mapping) => ({
            tenantId,
            agreementId: created.id,
            bomId: mapping.bomId,
            principalBrandName: mapping.principalBrandName.trim(),
            packDesignRef: mapping.packDesignRef?.trim() || null,
          })),
        });

        return tx.jobWorkAgreement.findFirstOrThrow({
          where: { id: created.id },
          include: AGREEMENT_INCLUDE,
        });
      });

      return toAgreementSummary(agreement);
    } catch (error) {
      // No reference to quote: it is allocated inside the transaction that just
      // failed, so there is no number this agreement can be called yet.
      throw translate(error, '');
    }
  }

  async update(id: string, dto: UpdateJobWorkAgreementDto): Promise<JobWorkAgreementSummary> {
    const existing = await this.prisma.scoped.jobWorkAgreement.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) throw new NotFoundException('That agreement does not exist.');

    // Checked against the state the row will be IN, not the fields that happen
    // to be in this request: clearing a rate and its basis can arrive in one
    // call or in either order, and only the resulting row decides whether the
    // rule holds.
    const nextRate =
      dto.conversionChargeRate !== undefined
        ? dto.conversionChargeRate
        : (existing.conversionChargeRate?.toString() ?? null);
    const nextBasis =
      dto.conversionRateBasis !== undefined
        ? dto.conversionRateBasis
        : ((existing.conversionRateBasis as ConversionRateBasis | null) ?? null);

    assertRateHasBasis(nextRate, nextBasis);

    assertDatesOrdered(
      dto.validFrom !== undefined
        ? dto.validFrom
        : existing.validFrom
          ? toIsoDate(existing.validFrom)
          : null,
      dto.validTo !== undefined
        ? dto.validTo
        : existing.validTo
          ? toIsoDate(existing.validTo)
          : null,
    );

    if (dto.principalId !== undefined) await this.assertPrincipalIsAPrincipal(dto.principalId);
    if (dto.mappings !== undefined) await this.assertMappingsUsable(dto.mappings);

    const data: Prisma.JobWorkAgreementUpdateInput = {};

    if (dto.principalId !== undefined) data.principal = { connect: { id: dto.principalId } };
    if (dto.billingModel !== undefined) data.billingModel = dto.billingModel;
    // THE REFERENCE IS NOT EDITABLE. It is allocated on create and is what the
    // agreement is cited as on every work order and invoice raised under it —
    // changing it would rewrite the meaning of paperwork already issued, in the
    // same way a party code or an item code cannot move. A request carrying one
    // is ignored rather than refused: the edit form does not send it, and a
    // caller that round-trips every field should not be rejected for sending
    // back what is already stored.
    if (dto.conversionChargeRate !== undefined)
      data.conversionChargeRate = dto.conversionChargeRate;
    if (dto.conversionRateBasis !== undefined) data.conversionRateBasis = dto.conversionRateBasis;
    if (dto.validFrom !== undefined)
      data.validFrom = dto.validFrom ? fromIsoDate(dto.validFrom) : null;
    if (dto.validTo !== undefined) data.validTo = dto.validTo ? fromIsoDate(dto.validTo) : null;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;

    const tenantId = this.tenantContext.requireTenantId();

    try {
      // `prisma.transaction` rather than `scoped.$transaction` — see create().
      const agreement = await this.prisma.transaction(async (tx) => {
        await tx.jobWorkAgreement.update({ where: { id }, data });

        // A mapping set, when sent, REPLACES what was there. An amendment
        // restates which products are covered; merging would make removing one
        // impossible. Delete-then-insert inside the transaction, so the
        // register is never briefly an agreement covering nothing.
        if (dto.mappings !== undefined) {
          await tx.jobWorkProductMapping.deleteMany({ where: { agreementId: id } });
          await tx.jobWorkProductMapping.createMany({
            data: dto.mappings.map((mapping) => ({
              tenantId,
              agreementId: id,
              bomId: mapping.bomId,
              principalBrandName: mapping.principalBrandName.trim(),
              packDesignRef: mapping.packDesignRef?.trim() || null,
            })),
          });
        }

        return tx.jobWorkAgreement.findFirstOrThrow({ where: { id }, include: AGREEMENT_INCLUDE });
      });

      return toAgreementSummary(agreement);
    } catch (error) {
      // The stored reference: an update cannot change it.
      throw translate(error, existing.agreementReference ?? '');
    }
  }

  /**
   * Retires an agreement.
   *
   * A soft delete — `job_work_agreements_no_hard_delete` is a database trigger,
   * so a real DELETE is refused by Postgres. The agreement that governed a
   * batch made last year is part of that batch's commercial record.
   *
   * NO IN-USE CHECK, and that is a gap rather than a decision: nothing
   * references an agreement yet. When production orders do, retiring one that
   * an open order is running under must be refused here.
   */
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.scoped.jobWorkAgreement.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) throw new NotFoundException('That agreement does not exist.');

    await this.prisma.scoped.jobWorkAgreement.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Refuses a reference already in use by a LIVE agreement.
   *
   * A check-then-act, which is normally the wrong shape — but the partial
   * unique index is what actually guarantees uniqueness, and this exists only
   * so the refusal can name the reference. Prisma cannot name a partial index
   * in its error, so without this the message would be a generic conflict; see
   * the note on isConstraint. If two requests race, the index refuses the
   * loser and `translate` says so.
   *
   * `exceptId` is the row being updated: an agreement keeping its own
   * reference is not a collision with itself.
   */
  /**
   * The next agreement reference, as JW-YYYY-NNN.
   *
   * One atomic upsert inside the caller's transaction, the same as batch,
   * material-issue and purchase-document numbering. NOT a read-then-write: two
   * agreements created in the same second would both read the same highest
   * number and compute the same next one, and the unique index would then
   * reject the loser with a failure nobody could act on.
   *
   * Counted per YEAR, because the number carries the year and the series
   * restarts each January.
   */
  private async nextReference(tx: Prisma.TransactionClient): Promise<string> {
    const tenantId = this.tenantContext.requireTenantId();
    const year = new Date().getFullYear();

    const sequence = await tx.documentSequence.upsert({
      where: { tenantId_docType_year: { tenantId, docType: `JW-${year}`, year } },
      create: { tenantId, docType: `JW-${year}`, year, nextValue: 2 },
      update: { nextValue: { increment: 1 } },
      select: { nextValue: true },
    });

    // `create` sets nextValue to 2 and this agreement takes 1; `update` returns
    // the already-incremented value, so the number just used is one less.
    return `JW-${year}-${String(sequence.nextValue - 1).padStart(3, '0')}`;
  }

  /**
   * The reference the next agreement would take, for the form to show before
   * anything is saved.
   *
   * A PREDICTION, not a reservation: the real number is allocated inside the
   * create transaction, so an agreement saved in between takes this one and the
   * next moves on. Nothing is held, which is why this reads the sequence rather
   * than incrementing it.
   */
  async previewReference(): Promise<{ agreementReference: string }> {
    const tenantId = this.tenantContext.requireTenantId();
    const year = new Date().getFullYear();

    const sequence = await this.prisma.scoped.documentSequence.findUnique({
      where: { tenantId_docType_year: { tenantId, docType: `JW-${year}`, year } },
      select: { nextValue: true },
    });

    // No row yet means none has been raised this year, and the first takes 1.
    return {
      agreementReference: `JW-${year}-${String(sequence?.nextValue ?? 1).padStart(3, '0')}`,
    };
  }

  // `assertReferenceIsFree` stood here, checking a hand-typed reference against
  // the register before a save. It went with the typing: the reference is now
  // allocated from a per-tenant sequence, so a collision is not something a
  // caller can cause — and the unique index remains the backstop either way.

  /**
   * The principal must be a party of type JOB_WORK_PRINCIPAL.
   *
   * Checked here rather than in SQL: a CHECK constraint cannot read another
   * table, and a trigger that did would fire on every write to `parties` too.
   */
  private async assertPrincipalIsAPrincipal(principalId: string): Promise<void> {
    const party = await this.prisma.scoped.party.findFirst({
      where: { id: principalId, deletedAt: null },
      select: { partyType: true, name: true },
    });

    if (!party) throw new BadRequestException('That principal is not in the party register.');

    if (party.partyType !== 'JOB_WORK_PRINCIPAL') {
      throw new BadRequestException(
        `${party.name} is not recorded as a job-work principal. ` +
          'Change their party type in the Party register first.',
      );
    }
  }

  /**
   * US-MD-05: the mapping must link one or more of the COMPANY'S BOMs.
   *
   * Three things are checked, and each has a different failure:
   *   - at least one line, which is the criterion itself;
   *   - no formulation listed twice, because the unique index would refuse it
   *     with a constraint name rather than a sentence;
   *   - every BOM exists and belongs to this tenant — "the company's BOMs".
   */
  private async assertMappingsUsable(mappings: readonly JobWorkMappingDto[]): Promise<void> {
    if (mappings.length === 0) {
      throw new BadRequestException(
        'An agreement must cover at least one product. Map a formulation to the ' +
          "principal's brand name before saving.",
      );
    }

    const seen = new Set<string>();

    for (const mapping of mappings) {
      if (seen.has(mapping.bomId)) {
        throw new BadRequestException(
          'A formulation appears on more than one line. One agreement cannot bill ' +
            'the same recipe two ways.',
        );
      }
      seen.add(mapping.bomId);
    }

    // `scoped` means row-level security has already limited this to our own
    // tenant, so a count short of the request means an id that is not ours —
    // which is the same answer as "does not exist", and deliberately so.
    const found = await this.prisma.scoped.bom.count({
      where: { id: { in: [...seen] }, deletedAt: null },
    });

    if (found !== seen.size) {
      throw new BadRequestException(
        'One or more of those formulations do not exist. Refresh and choose again.',
      );
    }
  }
}

const AGREEMENT_INCLUDE = {
  principal: { select: { id: true, code: true, name: true } },
  mappings: {
    include: {
      bom: {
        select: { id: true, version: true, product: { select: { code: true, name: true } } },
      },
    },
    orderBy: { principalBrandName: 'asc' },
  },
} satisfies Prisma.JobWorkAgreementInclude;

type AgreementWithRelations = Prisma.JobWorkAgreementGetPayload<{
  include: typeof AGREEMENT_INCLUDE;
}>;

/** A rate with no basis cannot be interpreted; a basis with no rate is a unit for nothing. */
function assertRateHasBasis(rate: string | null, basis: ConversionRateBasis | null): void {
  if (rate !== null && basis === null) {
    throw new BadRequestException(
      'A conversion charge needs a basis — per batch, per 1,000 units, per pack or per kg. ' +
        'A rate on its own cannot be invoiced.',
    );
  }

  if (rate === null && basis !== null) {
    throw new BadRequestException('A rate basis was given with no rate to charge.');
  }
}

function assertDatesOrdered(validFrom: string | null, validTo: string | null): void {
  if (validFrom && validTo && validTo <= validFrom) {
    throw new BadRequestException(
      'The agreement cannot end on or before the day it starts. Check the two dates.',
    );
  }
}

/** Turns a database refusal into something the person who hit it can read. */
function translate(error: unknown, reference: string): unknown {
  if (isConstraint(error, 'job_work_product_mappings_agreement_id_bom_id_key')) {
    return new BadRequestException(
      'A formulation appears on more than one line of this agreement.',
    );
  }

  if (isConstraint(error, 'job_work_agreements_rate_has_basis')) {
    return new BadRequestException(
      'A conversion charge rate and its basis must be given together.',
    );
  }

  if (isConstraint(error, 'job_work_agreements_valid_to_after_from')) {
    return new BadRequestException('The agreement cannot end on or before the day it starts.');
  }

  if (isConstraint(error, 'job_work_product_mappings_brand_not_blank')) {
    return new BadRequestException("Every mapped product needs the principal's brand name.");
  }

  // P2002 last, and it is the fallback for the reference index too — see
  // isConstraint. The pre-check normally gets there first, so reaching this
  // means two requests raced, which the message says without pretending to
  // know which field collided.
  if (isConstraint(error, 'P2002')) {
    return new ConflictException(
      reference
        ? `An agreement with reference "${reference}" was saved by someone else a moment ago.`
        : 'That agreement conflicts with one already on the register.',
    );
  }

  return error;
}

/**
 * Matched on the error's `code` or its message rather than with
 * `instanceof Prisma.PrismaClientKnownRequestError`: `Prisma` is a type-only
 * import here, and `instanceof` across two copies of the client — which a pnpm
 * workspace can produce — silently returns false.
 *
 * NOTE on what this cannot do: for a PARTIAL unique index, Prisma reports
 * "Unique constraint failed on the (not available)" and carries no target at
 * all — neither in the message nor in meta. So a named branch for
 * job_work_agreements_tenant_id_agreement_reference_key could never match, and
 * the readable refusal for a duplicate reference is a pre-check in create/update
 * instead. The index is still what GUARANTEES uniqueness; the pre-check only
 * decides how the refusal reads.
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
 * Whether the agreement is in force, against the SERVER's today.
 *
 * No dates at all means IN_FORCE: an open-ended arrangement is a real thing,
 * and treating "no end date" as expired would retire every one of them.
 */
function agreementStatus(validFrom: Date | null, validTo: Date | null): AgreementStatus {
  const today = new Date().toISOString().slice(0, 10);

  if (validFrom && toIsoDate(validFrom) > today) return 'NOT_YET_STARTED';
  // Valid THROUGH the final day, so only a date strictly before today has run out.
  if (validTo && toIsoDate(validTo) < today) return 'EXPIRED';

  return 'IN_FORCE';
}

function toMappingView(mapping: AgreementWithRelations['mappings'][number]): JobWorkMappingView {
  return {
    id: mapping.id,
    bomId: mapping.bomId,
    // The formulation as this codebase names one everywhere else: product code
    // and version. "FG-0142 v2".
    bomLabel: `${mapping.bom.product.code} v${mapping.bom.version}`,
    productName: mapping.bom.product.name,
    principalBrandName: mapping.principalBrandName,
    packDesignRef: mapping.packDesignRef,
  };
}

export function toAgreementSummary(agreement: AgreementWithRelations): JobWorkAgreementSummary {
  return {
    id: agreement.id,
    principalId: agreement.principalId,
    principalCode: agreement.principal.code,
    principalName: agreement.principal.name,
    agreementReference: agreement.agreementReference,
    billingModel: agreement.billingModel as BillingModel,
    // `toString()` on a Prisma Decimal, never Number(): the column is exact and
    // a double is not.
    conversionChargeRate: agreement.conversionChargeRate?.toString() ?? null,
    conversionRateBasis: agreement.conversionRateBasis as ConversionRateBasis | null,
    validFrom: agreement.validFrom ? toIsoDate(agreement.validFrom) : null,
    validTo: agreement.validTo ? toIsoDate(agreement.validTo) : null,
    notes: agreement.notes,
    status: agreementStatus(agreement.validFrom, agreement.validTo),
    mappings: agreement.mappings.map(toMappingView),
  };
}
