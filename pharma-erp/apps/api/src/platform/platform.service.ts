import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { Prisma, RESERVED_TENANT_SLUGS, slugifyCompanyName } from '@pharma-erp/database';
import {
  PG_TENANT_SETTING,
  USER_ROLE_LABELS,
  USER_ROLES,
  type CompanyListItem,
  type CreateCompanyResponse,
  type PlatformDashboard,
  type UpdateCompanyRequest,
  type UserRole,
} from '@pharma-erp/types';

import { PasswordService } from '../auth/password.service';

import type { CreateCompanyDto } from './dto/create-company.dto';
import { PlatformDbService } from './platform-db.service';

/**
 * How many per-tenant dashboard transactions may be in flight at once.
 *
 * Five, not unlimited: each one holds a pooled connection until it commits, so
 * the ceiling has to stay well under the pool size or the dashboard would
 * starve every other request on the instance.
 */
const DASHBOARD_FAN_OUT = 5;

/**
 * `Promise.all` with a ceiling on how many run at once.
 *
 * Written here rather than pulled in as a dependency: it is a dozen lines, and
 * the alternative — an unbounded fan out — is the kind of thing that works on a
 * deployment with three companies and takes the API down on one with three
 * hundred.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    // Each worker takes the next index until they are all claimed. Index-based
    // rather than shift()ing a queue so results stay in the input's order.
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  });

  await Promise.all(workers);

  return results;
}

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(
    private readonly platformDb: PlatformDbService,
    private readonly passwords: PasswordService,
  ) {}

  /**
   * Creates a company and its first Admin in one transaction.
   *
   * Both or neither: a company with no Admin is unreachable — nobody can sign
   * in to it and nobody can invite anyone — so that state must not be able to
   * persist even briefly.
   */
  async createCompany(
    platformUserId: string,
    dto: CreateCompanyDto,
  ): Promise<CreateCompanyResponse> {
    const slug = dto.slug?.trim().toLowerCase() || slugifyCompanyName(dto.companyName);

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 63) {
      throw new ConflictException(
        `Could not derive a valid identifier from "${dto.companyName}". Provide one explicitly: 3-63 lowercase letters, digits or single hyphens.`,
      );
    }

    if (RESERVED_TENANT_SLUGS.includes(slug)) {
      throw new ConflictException(`The identifier "${slug}" is reserved. Choose another.`);
    }

    // Hash before opening the transaction: argon2 takes ~20ms and there is no
    // reason to hold a database transaction open for it.
    const passwordHash = await this.passwords.hashPassword(dto.adminTemporaryPassword);

    try {
      const result = await this.platformDb.db.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            slug,
            name: dto.companyName,
            // TRIAL, not ACTIVE: activation is a commercial decision. A Super
            // User can flip it afterwards, deliberately.
            status: 'TRIAL',
            drugLicenceNumber: dto.drugLicenceNumber?.toUpperCase() ?? null,
            gstin: dto.gstin?.toUpperCase() ?? null,
            timezone: dto.timezone ?? 'Asia/Kolkata',
          },
          select: { id: true, slug: true, name: true },
        });

        // `users` keeps FORCE ROW LEVEL SECURITY, so this insert is subject to
        // users_tenant_isolation even on the owner connection. Setting the
        // tenant just created lets the WITH CHECK pass on its own terms rather
        // than by exemption — and means user rows stay tenant-isolated even
        // here, on the most privileged connection in the system.
        await tx.$executeRaw`SELECT set_config(${PG_TENANT_SETTING}, ${tenant.id}, true)`;

        const admin = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: dto.adminEmail,
            fullName: dto.adminFullName,
            role: 'ADMIN',
            status: 'ACTIVE',
            passwordHash,
            passwordSetAt: new Date(),
            // The Super User knows this password, so it is a shared secret
            // until the Admin replaces it on first sign-in.
            mustChangePassword: true,
          },
          select: { id: true, email: true },
        });

        // Logged inside the tenant's own trail too, so the company's audit
        // history starts with its own creation rather than beginning mid-story.
        await tx.auditLog.create({
          data: {
            tenantId: tenant.id,
            entityType: 'Tenant',
            entityId: tenant.id,
            action: 'CREATE',
            // userId is null on purpose: the actor was a platform operator, who
            // is not a user of this tenant. Attributing it to the new Admin
            // would be a convenient fiction in a compliance record.
            afterJson: {
              event: 'COMPANY_PROVISIONED',
              name: tenant.name,
              slug: tenant.slug,
              firstAdminUserId: admin.id,
              firstAdminEmail: admin.email,
            },
          },
        });

        return { tenant, admin };
      });

      await this.platformDb.recordAudit({
        platformUserId,
        action: 'COMPANY_CREATED',
        entityType: 'Tenant',
        entityId: result.tenant.id,
        details: {
          name: result.tenant.name,
          slug: result.tenant.slug,
          adminEmail: result.admin.email,
        },
      });

      this.logger.log(
        `Platform user ${platformUserId} created company ${result.tenant.slug} (${result.tenant.id})`,
      );

      return {
        tenantId: result.tenant.id,
        tenantSlug: result.tenant.slug,
        tenantName: result.tenant.name,
        adminUserId: result.admin.id,
        adminEmail: result.admin.email,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target)
          ? (error.meta.target as string[]).join(',')
          : String(error.meta?.target ?? '');

        if (target.includes('slug')) {
          throw new ConflictException(`A company with the identifier "${slug}" already exists.`);
        }

        // Email is globally unique across every company.
        throw new ConflictException(
          `The address "${dto.adminEmail}" already belongs to a user on this platform.`,
        );
      }

      throw error;
    }
  }

  /**
   * Every company, with per-company counts.
   *
   * Legitimately cross-tenant — this is the platform's whole purpose — and runs
   * on the elevated connection, so RLS is not filtering anything. The counts
   * come from grouped queries rather than N+1 per company.
   */
  async listCompanies(): Promise<CompanyListItem[]> {
    const db = this.platformDb.db;

    const tenants = await db.tenant.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        drugLicenceNumber: true,
        gstin: true,
        timezone: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (tenants.length === 0) return [];

    // `users` is FORCE'd, so even this connection cannot read across tenants
    // through Prisma's model API without a tenant set. Raw SQL on the owner
    // connection is also blocked by the policy — so the counts are gathered per
    // tenant, inside a transaction that sets each tenant in turn. Slower than
    // one GROUP BY, but it keeps the FORCE guarantee intact rather than
    // weakening the schema for a convenience query.
    const counts = new Map<
      string,
      {
        userCount: number;
        adminCount: number;
        activeUserCount: number;
        lastActivityAt: Date | null;
      }
    >();

    for (const tenant of tenants) {
      const stats = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config(${PG_TENANT_SETTING}, ${tenant.id}, true)`;

        const [total, admins, active, latest] = await Promise.all([
          tx.user.count({ where: { deletedAt: null } }),
          tx.user.count({ where: { deletedAt: null, role: 'ADMIN' } }),
          tx.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
          tx.user.findFirst({
            where: { deletedAt: null, lastLoginAt: { not: null } },
            orderBy: { lastLoginAt: 'desc' },
            select: { lastLoginAt: true },
          }),
        ]);

        return { total, admins, active, lastActivityAt: latest?.lastLoginAt ?? null };
      });

      counts.set(tenant.id, {
        userCount: stats.total,
        adminCount: stats.admins,
        activeUserCount: stats.active,
        lastActivityAt: stats.lastActivityAt,
      });
    }

    return tenants.map((tenant) => {
      const c = counts.get(tenant.id);

      return {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status as CompanyListItem['status'],
        drugLicenceNumber: tenant.drugLicenceNumber,
        gstin: tenant.gstin,
        timezone: tenant.timezone,
        userCount: c?.userCount ?? 0,
        adminCount: c?.adminCount ?? 0,
        activeUserCount: c?.activeUserCount ?? 0,
        createdAt: tenant.createdAt.toISOString(),
        lastActivityAt: c?.lastActivityAt?.toISOString() ?? null,
      };
    });
  }

  /** Edits a company's details or status. Suspension takes effect immediately. */
  async updateCompany(
    platformUserId: string,
    tenantId: string,
    patch: UpdateCompanyRequest,
  ): Promise<CompanyListItem> {
    const db = this.platformDb.db;

    const before = await db.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: { id: true, name: true, status: true },
    });

    if (!before) throw new NotFoundException('Company not found.');

    await db.tenant.update({
      where: { id: tenantId },
      data: {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.drugLicenceNumber === undefined
          ? {}
          : { drugLicenceNumber: patch.drugLicenceNumber || null }),
        ...(patch.gstin === undefined ? {} : { gstin: patch.gstin || null }),
        ...(patch.timezone === undefined ? {} : { timezone: patch.timezone }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
      },
    });

    await this.platformDb.recordAudit({
      platformUserId,
      action:
        patch.status && patch.status !== before.status
          ? 'COMPANY_STATUS_CHANGED'
          : 'COMPANY_UPDATED',
      entityType: 'Tenant',
      entityId: tenantId,
      details: { before: { name: before.name, status: before.status }, after: patch },
    });

    const [updated] = await this.listCompanies().then((all) =>
      all.filter((company) => company.id === tenantId),
    );

    if (!updated) throw new NotFoundException('Company not found.');

    return updated;
  }

  /**
   * System-wide figures for the platform dashboard.
   *
   * Everything here is a real count from the database. Nothing is estimated or
   * placeheld — a platform operator making commercial decisions from these
   * numbers needs them to be true.
   */
  async getDashboard(): Promise<PlatformDashboard> {
    const db = this.platformDb.db;
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const companies = await db.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true, status: true, createdAt: true },
    });

    // Per-tenant again, for the same FORCE-RLS reason as listCompanies: the
    // counts below cannot be one GROUP BY, because each tenant's rows are only
    // visible inside a transaction that has set `app.current_tenant_id`.
    //
    // Run in parallel, in bounded batches. Sequentially this was one full
    // round-trip chain per company — BEGIN, set_config, the counts, COMMIT —
    // which is unnoticeable against a database on the same host and roughly
    // 2.5 seconds each against one in another region. Three companies were
    // enough to exceed the caller's timeout.
    //
    // Bounded rather than a plain Promise.all over every tenant: each entry
    // holds a connection for the life of its transaction, so an unbounded fan
    // out would exhaust the pool once this deployment has more companies than
    // it has connections — turning a slow dashboard into a site-wide outage.
    const perCompany = await mapWithConcurrency(companies, DASHBOARD_FAN_OUT, (company) =>
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config(${PG_TENANT_SETTING}, ${company.id}, true)`;

        const [total, adminCount, active, pending, disabled, recentSignIns, audits] =
          await Promise.all([
            tx.user.count({ where: { deletedAt: null } }),
            tx.user.count({ where: { deletedAt: null, role: 'ADMIN' } }),
            tx.user.count({
              where: { deletedAt: null, status: 'ACTIVE', mustChangePassword: false },
            }),
            tx.user.count({
              where: {
                deletedAt: null,
                OR: [{ status: 'INVITED' }, { mustChangePassword: true }],
              },
            }),
            tx.user.count({ where: { deletedAt: null, status: 'DISABLED' } }),
            tx.user.count({ where: { deletedAt: null, lastLoginAt: { gte: dayAgo } } }),
            tx.auditLog.count(),
          ]);

        return { total, adminCount, active, pending, disabled, recentSignIns, audits };
      }),
    );

    const totalUsers = perCompany.reduce((sum, s) => sum + s.total, 0);
    const admins = perCompany.reduce((sum, s) => sum + s.adminCount, 0);
    const activeUsers = perCompany.reduce((sum, s) => sum + s.active, 0);
    const pendingUsers = perCompany.reduce((sum, s) => sum + s.pending, 0);
    const disabledUsers = perCompany.reduce((sum, s) => sum + s.disabled, 0);
    const signInsLast24h = perCompany.reduce((sum, s) => sum + s.recentSignIns, 0);
    const auditRecordCount = perCompany.reduce((sum, s) => sum + s.audits, 0);

    const [platformTotal, platformActive, recentPlatformActivity] = await Promise.all([
      db.platformUser.count({ where: { deletedAt: null } }),
      db.platformUser.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      db.platformAuditLog.findMany({
        take: 12,
        orderBy: { createdAt: 'desc' },
        select: {
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          platformUser: { select: { fullName: true } },
        },
      }),
    ]);

    let databaseStatus: 'up' | 'down' = 'down';
    let databaseLatencyMs: number | null = null;

    try {
      const started = process.hrtime.bigint();
      await db.$queryRaw`SELECT 1`;
      databaseLatencyMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
      databaseStatus = 'up';
    } catch {
      // Reaching here means this very request already succeeded against the
      // database, so it is close to impossible — but reporting 'up' without
      // checking would make the widget decorative.
      databaseStatus = 'down';
    }

    return {
      companies: {
        total: companies.length,
        trial: companies.filter((c) => c.status === 'TRIAL').length,
        active: companies.filter((c) => c.status === 'ACTIVE').length,
        suspended: companies.filter((c) => c.status === 'SUSPENDED').length,
      },
      users: {
        total: totalUsers,
        admins,
        active: activeUsers,
        pending: pendingUsers,
        disabled: disabledUsers,
      },
      platformUsers: { total: platformTotal, active: platformActive },
      activity: {
        signInsLast24h,
        companiesCreatedLast30d: companies.filter((c) => c.createdAt >= thirtyDaysAgo).length,
        recent: recentPlatformActivity.map((entry) => ({
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          actor: entry.platformUser?.fullName ?? null,
          at: entry.createdAt.toISOString(),
        })),
      },
      health: { databaseStatus, databaseLatencyMs, auditRecordCount },
    };
  }

  /** Role labels, so the console does not duplicate the mapping. */
  roleOptions(): { role: UserRole; label: string }[] {
    return USER_ROLES.map((role) => ({ role, label: USER_ROLE_LABELS[role] }));
  }
}
