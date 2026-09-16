import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type { CustomerLicence, Party, Prisma } from '@pharma-erp/database';
import type {
  CustomerDetail,
  CustomerLicenceView,
  CustomerListItem,
  CustomerStatus,
  CustomerType,
} from '@pharma-erp/types';
import { LICENCE_EXPIRY_WARNING_DAYS } from '@pharma-erp/types';

import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../tenant/tenant-context.service';

import type {
  CreateCustomerDto,
  CreateCustomerLicenceDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

/**
 * The Order-to-Cash customer register.
 *
 * A customer IS a party — `partyType = 'CUSTOMER'` on the shared `parties`
 * table — not a second master. parties.controller.ts states the rule: a
 * distributor that also supplies cartons is one legal entity, and giving it two
 * rows would give it two credit limits and two audit trails with nothing
 * keeping them agreed. This service is the sales desk's view of that register;
 * it does not own the table.
 *
 * Everything goes through `prisma.scoped`, so row-level security applies to
 * reads as well as writes. The explicit `tenantId` on a write is a second
 * layer — the policy's WITH CHECK would reject a mismatched row regardless.
 *
 * WHAT IS NOT HERE YET: `outstandingAmount` is reported as zero because sales
 * invoices do not exist. That is not a placeholder standing in for a number we
 * could compute — there are no invoice tables, so zero outstanding is the
 * literal truth today. When invoicing lands it is summed here, and the comment
 * at `toListItem` is the place to start.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(search?: string): Promise<CustomerListItem[]> {
    const term = search?.trim();

    const where: Prisma.PartyWhereInput = {
      partyType: 'CUSTOMER',
      deletedAt: null,
      ...(term
        ? {
            OR: [
              { code: { contains: term, mode: 'insensitive' } },
              { name: { contains: term, mode: 'insensitive' } },
              { gstin: { contains: term, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const parties = await this.prisma.scoped.party.findMany({
      where,
      include: { customerLicences: { where: { deletedAt: null } } },
      orderBy: [{ name: 'asc' }],
    });

    return parties.map((party) => toListItem(party, party.customerLicences));
  }

  async get(id: string): Promise<CustomerDetail> {
    const party = await this.prisma.scoped.party.findFirst({
      where: { id, partyType: 'CUSTOMER', deletedAt: null },
      include: {
        customerLicences: {
          where: { deletedAt: null },
          orderBy: [{ isPrimary: 'desc' }, { expiryDate: 'desc' }],
        },
      },
    });

    if (!party) throw new NotFoundException('Customer not found.');

    return toDetail(party, party.customerLicences);
  }

  async create(dto: CreateCustomerDto): Promise<CustomerDetail> {
    const tenantId = this.tenantContext.requireTenantId();

    try {
      const party = await this.prisma.scoped.party.create({
        data: {
          tenantId,
          partyType: 'CUSTOMER',
          // INACTIVE, deliberately. US-MD-02 is a CHECK constraint on the
          // table — parties_active_customer_is_licensed — and it refuses an
          // ACTIVE customer with no drug licence number and validity on file.
          // This form does not collect a licence: licences are a register, and
          // they are added to the customer after it exists.
          //
          // So a new customer starts INACTIVE and is promoted the moment a
          // valid licence is recorded (see syncPrimaryLicence). The alternative
          // — creating them ACTIVE — would mean either weakening a compliance
          // rule or failing every create, which is what it did.
          status: 'INACTIVE',
          code: dto.code.trim(),
          name: dto.name.trim(),
          customerType: dto.customerType,
          contactPerson: dto.contactPerson?.trim() || null,
          phone: dto.phone?.trim() || null,
          email: dto.email?.trim() || null,
          gstin: dto.gstin?.trim().toUpperCase() || null,
          stateCode: dto.stateCode?.trim() || deriveStateCode(dto.gstin),
          billingLine1: dto.billingLine1?.trim() || null,
          billingLine2: dto.billingLine2?.trim() || null,
          billingCity: dto.billingCity?.trim() || null,
          billingState: dto.billingState?.trim() || null,
          billingPin: dto.billingPin?.trim() || null,
          shippingLine1: dto.shippingLine1?.trim() || null,
          shippingLine2: dto.shippingLine2?.trim() || null,
          shippingCity: dto.shippingCity?.trim() || null,
          shippingState: dto.shippingState?.trim() || null,
          shippingPin: dto.shippingPin?.trim() || null,
          creditLimit: dto.creditLimit ?? null,
          creditPeriodDays: dto.creditTermsDays ?? null,
          // `paymentTermsDays` is the column Procure-to-Pay created and is NOT
          // NULL. The sales desk calls the same idea "credit terms", so it is
          // kept in step rather than left at a default that contradicts the
          // number shown on screen.
          paymentTermsDays: dto.creditTermsDays ?? 30,
          notes: dto.notes?.trim() || null,
        },
        include: { customerLicences: true },
      });

      return toDetail(party, party.customerLicences);
    } catch (error) {
      throw translateWriteError(error, dto.code);
    }
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<CustomerDetail> {
    const existing = await this.requireCustomer(id);

    // The database enforces this too; saying it here makes the refusal a
    // sentence somebody can act on rather than a constraint name.
    if (dto.status === 'ACTIVE') {
      const licensed = await this.hasValidLicence(id);

      if (!licensed && !existing.drugLicenceNumber) {
        throw new ConflictException(
          'A customer cannot be made active without a valid drug licence on file. Add one first.',
        );
      }
    }

    try {
      const party = await this.prisma.scoped.party.update({
        where: { id },
        data: {
          ...definedOnly({
            name: dto.name?.trim(),
            customerType: dto.customerType,
            status: dto.status,
            contactPerson: dto.contactPerson?.trim(),
            phone: dto.phone?.trim(),
            email: dto.email?.trim(),
            gstin: dto.gstin?.trim().toUpperCase(),
            stateCode: dto.stateCode?.trim(),
            billingLine1: dto.billingLine1?.trim(),
            billingLine2: dto.billingLine2?.trim(),
            billingCity: dto.billingCity?.trim(),
            billingState: dto.billingState?.trim(),
            billingPin: dto.billingPin?.trim(),
            shippingLine1: dto.shippingLine1?.trim(),
            shippingLine2: dto.shippingLine2?.trim(),
            shippingCity: dto.shippingCity?.trim(),
            shippingState: dto.shippingState?.trim(),
            shippingPin: dto.shippingPin?.trim(),
            creditLimit: dto.creditLimit,
            creditPeriodDays: dto.creditTermsDays,
            paymentTermsDays: dto.creditTermsDays,
            notes: dto.notes?.trim(),
          }),
        },
        include: {
          customerLicences: {
            where: { deletedAt: null },
            orderBy: [{ isPrimary: 'desc' }, { expiryDate: 'desc' }],
          },
        },
      });

      return toDetail(party, party.customerLicences);
    } catch (error) {
      throw translateWriteError(error, dto.name ?? id);
    }
  }

  /**
   * Retires a customer. A soft delete, never a hard one: their orders and
   * invoices reference this row, and removing it would orphan the audit trail
   * that makes those documents defensible.
   */
  async remove(id: string): Promise<void> {
    await this.requireCustomer(id);

    await this.prisma.scoped.party.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
  }

  async addLicence(customerId: string, dto: CreateCustomerLicenceDto): Promise<CustomerDetail> {
    const tenantId = this.tenantContext.requireTenantId();
    await this.requireCustomer(customerId);

    const issueDate = new Date(dto.issueDate);
    const expiryDate = new Date(dto.expiryDate);

    if (expiryDate < issueDate) {
      throw new ConflictException('A licence cannot expire before it was issued.');
    }

    try {
      await this.prisma.transaction(async (tx) => {
        // At most one primary per customer — a partial unique index enforces
        // it, so the previous holder is stood down inside the same transaction
        // rather than racing against the insert.
        if (dto.isPrimary) {
          await tx.customerLicence.updateMany({
            where: { partyId: customerId, isPrimary: true, deletedAt: null },
            data: { isPrimary: false },
          });
        }

        await tx.customerLicence.create({
          data: {
            tenantId,
            partyId: customerId,
            licenceNumber: dto.licenceNumber.trim(),
            category: dto.category,
            formNumber: dto.formNumber?.trim() || null,
            issuingAuthority: dto.issuingAuthority?.trim() || null,
            issueDate,
            expiryDate,
            status: dto.status ?? 'ACTIVE',
            coversScheduleX: dto.coversScheduleX ?? false,
            isPrimary: dto.isPrimary ?? false,
            notes: dto.notes?.trim() || null,
          },
        });

        await syncPrimaryLicence(tx, customerId);
      });
    } catch (error) {
      throw translateWriteError(error, dto.licenceNumber);
    }

    return this.get(customerId);
  }

  async removeLicence(customerId: string, licenceId: string): Promise<CustomerDetail> {
    await this.requireCustomer(customerId);

    const licence = await this.prisma.scoped.customerLicence.findFirst({
      where: { id: licenceId, partyId: customerId, deletedAt: null },
    });

    if (!licence) throw new NotFoundException('Licence not found for this customer.');

    await this.prisma.transaction(async (tx) => {
      await tx.customerLicence.update({
        where: { id: licenceId },
        // Stood down as well as removed: the partial unique index only ignores
        // soft-deleted rows, and leaving isPrimary set would block the next one.
        data: { deletedAt: new Date(), isPrimary: false },
      });

      await syncPrimaryLicence(tx, customerId);
    });

    return this.get(customerId);
  }

  /** Whether any licence on file is in date AND not withdrawn by the authority. */
  private async hasValidLicence(partyId: string): Promise<boolean> {
    const today = startOfUtcDay(new Date());

    const count = await this.prisma.scoped.customerLicence.count({
      where: {
        partyId,
        deletedAt: null,
        status: 'ACTIVE',
        expiryDate: { gte: today },
      },
    });

    return count > 0;
  }

  private async requireCustomer(id: string): Promise<Party> {
    const party = await this.prisma.scoped.party.findFirst({
      where: { id, partyType: 'CUSTOMER', deletedAt: null },
    });

    if (!party) throw new NotFoundException('Customer not found.');

    return party;
  }
}

/**
 * Mirrors the customer's governing licence onto the party row, and moves the
 * customer's status to match.
 *
 * WHY THE DUPLICATION IS DELIBERATE. `customer_licences` is the full register —
 * a distributor holds several at once. But US-MD-02 is a CHECK constraint, and
 * a CHECK cannot look at another table: it can only read
 * `parties.drug_licence_number` and `drug_licence_valid_to` on the row being
 * written. So those two columns carry the governing licence, and this function
 * is what keeps them true. They are a projection of the register, never an
 * independent fact — nothing else writes them.
 *
 * The status follows from the same question. A customer with a valid licence
 * becomes ACTIVE; one whose last licence expires or is withdrawn drops back to
 * INACTIVE, which is also what the constraint would force. Doing it here means
 * the flow stays legal instead of hitting a constraint violation and surfacing
 * as "Internal server error", which is exactly what it did.
 *
 * Runs inside the caller's transaction so the register and the mirror cannot be
 * observed disagreeing.
 */
async function syncPrimaryLicence(tx: Prisma.TransactionClient, partyId: string): Promise<void> {
  const today = new Date();
  const startOfToday = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );

  const valid = await tx.customerLicence.findMany({
    where: { partyId, deletedAt: null, status: 'ACTIVE', expiryDate: { gte: startOfToday } },
    // The one marked primary governs; otherwise whichever runs longest, so the
    // customer is judged on their strongest standing.
    orderBy: [{ isPrimary: 'desc' }, { expiryDate: 'desc' }],
    take: 1,
  });

  const governing = valid[0] ?? null;

  const party = await tx.party.findUnique({ where: { id: partyId } });
  if (!party) return;

  await tx.party.update({
    where: { id: partyId },
    data: {
      drugLicenceNumber: governing?.licenceNumber ?? null,
      drugLicenceValidTo: governing?.expiryDate ?? null,
      // Only ever moves between ACTIVE and INACTIVE. A customer someone has
      // deliberately BLOCKED stays blocked — a licence arriving does not undo a
      // commercial hold.
      ...(party.status === 'BLOCKED'
        ? {}
        : { status: governing ? 'ACTIVE' : 'INACTIVE' }),
    },
  });
}

/** Drops keys whose value is `undefined`, so a PATCH only writes what it sent. */
function definedOnly<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** The GST state code is the first two digits of the GSTIN, when there is one. */
function deriveStateCode(gstin?: string): string | null {
  const trimmed = gstin?.trim();
  return trimmed && trimmed.length >= 2 ? trimmed.slice(0, 2) : null;
}

/**
 * Expiry is decided against the API's clock, not the reader's, so every client
 * agrees about which licences are valid today.
 */
function toLicenceView(licence: CustomerLicence): CustomerLicenceView {
  const today = startOfUtcDay(new Date());
  const expiry = startOfUtcDay(licence.expiryDate);
  const daysToExpiry = Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
  const isExpired = daysToExpiry < 0;

  return {
    id: licence.id,
    licenceNumber: licence.licenceNumber,
    category: licence.category,
    formNumber: licence.formNumber,
    issuingAuthority: licence.issuingAuthority,
    issueDate: toIsoDate(licence.issueDate),
    expiryDate: toIsoDate(licence.expiryDate),
    status: licence.status,
    coversScheduleX: licence.coversScheduleX,
    isPrimary: licence.isPrimary,
    isExpired,
    daysToExpiry,
    // Both halves have to hold: in date AND not withdrawn by the authority. A
    // suspended licence inside its validity window is still no licence to sell
    // against, which is why status and expiry are separate fields.
    isValid: !isExpired && licence.status === 'ACTIVE',
  };
}

function toListItem(party: Party, licences: readonly CustomerLicence[]): CustomerListItem {
  const views = licences.map(toLicenceView);
  const primary = views.find((l) => l.isPrimary) ?? views.find((l) => l.isValid) ?? null;

  const creditLimit = party.creditLimit?.toFixed(2) ?? '0.00';

  // Zero because there are no sales invoices to owe against — see the class
  // comment. When invoicing lands, sum unpaid invoice totals for this party
  // here and availableCredit follows from it unchanged.
  const outstandingAmount = '0.00';
  const availableCredit = Math.max(
    0,
    Number(creditLimit) - Number(outstandingAmount),
  ).toFixed(2);

  return {
    id: party.id,
    code: party.code,
    name: party.name,
    // Every row on this screen is a CUSTOMER party, but `customerType` is
    // nullable on the shared table — a party created by the Procure-to-Pay
    // screens never filled it in. OTHER is the honest reading of "nobody has
    // said", and the edit screen offers the real choice.
    customerType: (party.customerType ?? 'OTHER') as CustomerType,
    status: party.status as CustomerStatus,
    contactPerson: party.contactPerson,
    phone: party.phone,
    email: party.email,
    gstin: party.gstin,
    stateCode: party.stateCode,
    billingCity: party.billingCity,
    billingState: party.billingState,
    creditLimit,
    creditTermsDays: party.creditPeriodDays ?? party.paymentTermsDays,
    outstandingAmount,
    availableCredit,
    primaryLicence: primary,
    licenceCount: views.length,
    hasValidLicence: views.some((l) => l.isValid),
    createdAt: party.createdAt.toISOString(),
  };
}

function toDetail(party: Party, licences: readonly CustomerLicence[]): CustomerDetail {
  return {
    ...toListItem(party, licences),
    billingLine1: party.billingLine1,
    billingLine2: party.billingLine2,
    billingPin: party.billingPin,
    shippingLine1: party.shippingLine1,
    shippingLine2: party.shippingLine2,
    shippingCity: party.shippingCity,
    shippingState: party.shippingState,
    shippingPin: party.shippingPin,
    notes: party.notes,
    licences: licences.map(toLicenceView),
  };
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Turns a unique-constraint violation into a sentence somebody can act on.
 * The database is what makes the rule true; this only says so readably.
 */
function translateWriteError(error: unknown, subject: string): Error {
  const code = (error as { code?: string } | null)?.code;

  if (code === 'P2002') {
    return new ConflictException(`“${subject}” is already in use — codes and licence numbers must be unique.`);
  }

  // US-MD-02 as the database states it. Reachable only if the status and the
  // licence mirror ever fall out of step; saying so beats a 500.
  if (String((error as { message?: string } | null)?.message ?? '').includes(
    'parties_active_customer_is_licensed',
  )) {
    return new ConflictException(
      'An active customer must have a valid drug licence on file. Add a licence before activating them.',
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

/** Kept exported so the expiry strip and the service agree on the threshold. */
export const LICENCE_WARNING_DAYS = LICENCE_EXPIRY_WARNING_DAYS;
