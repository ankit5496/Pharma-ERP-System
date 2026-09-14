import { Injectable } from '@nestjs/common';

import {
  LICENCE_VISIBLE_TO,
  READ_ONLY_ROLES,
  ROLE_MODULES,
  USER_ROLE_LABELS,
  USER_ROLES,
  type ActivityItem,
  type CompanyStats,
  type DashboardSection,
  type LicenceAlert,
  type PackagingShortageAlert,
  type StatWidget,
  type TenantDashboard,
  type UserRole,
} from '@pharma-erp/types';

import { LicencesService } from '../licences/licences.service';
import { PackagingService } from '../packaging/packaging.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

/**
 * Widgets whose data lives in tables that do not exist yet.
 *
 * These render as "not built yet" rather than as a zero or an invented figure.
 * A fabricated number in a pharma system is worse than an obvious gap: nobody
 * acts on a greyed-out card, but someone will act on a plausible-looking one.
 * Each entry lights up on its own when the module lands.
 */
const PENDING: Record<string, { label: string; module: string }> = {
  items: { label: 'Items', module: 'masters' },
  parties: { label: 'Suppliers & customers', module: 'masters' },
  boms: { label: 'Formulations', module: 'masters' },
  purchaseOrders: { label: 'Open purchase orders', module: 'purchase' },
  pendingGrns: { label: 'Awaiting GRN', module: 'purchase' },
  purchaseInvoices: { label: 'Unpaid purchase invoices', module: 'purchase' },
  batches: { label: 'Batches in stock', module: 'inventory' },
  expiringBatches: { label: 'Expiring within 90 days', module: 'inventory' },
  lowStock: { label: 'Below reorder level', module: 'inventory' },
  workOrders: { label: 'Open work orders', module: 'production' },
  inProduction: { label: 'In production', module: 'production' },
  awaitingRelease: { label: 'Awaiting QA release', module: 'quality' },
  onHold: { label: 'Batches on hold', module: 'quality' },
  rejected: { label: 'Rejected batches', module: 'quality' },
  salesOrders: { label: 'Open sales orders', module: 'sales' },
  dispatchesDue: { label: 'Dispatches due', module: 'sales' },
  salesInvoices: { label: 'Unpaid sales invoices', module: 'accounts' },
  receivables: { label: 'Outstanding receivables', module: 'accounts' },
  payables: { label: 'Outstanding payables', module: 'accounts' },
};

function pending(key: keyof typeof PENDING): StatWidget {
  const spec = PENDING[key];

  return {
    key,
    label: spec?.label ?? key,
    state: 'pending',
    value: null,
    module: spec?.module ?? 'dashboard',
  };
}

function ready(
  key: string,
  label: string,
  value: number,
  module: string,
  detail?: string,
): StatWidget {
  return { key, label, state: 'ready', value, module, ...(detail ? { detail } : {}) };
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly licences: LicencesService,
    private readonly packaging: PackagingService,
  ) {}

  /**
   * Builds the dashboard for the signed-in user.
   *
   * The API decides what the caller may see and returns only that. A dashboard
   * that fetched everything and hid part of it client-side would already have
   * sent the data — so role filtering happens here, before serialisation.
   */
  async forCurrentUser(): Promise<TenantDashboard> {
    const context = this.tenantContext.get();
    const role = context?.role;

    if (!role) {
      // Unreachable through the guard chain, which resolves a role before any
      // controller runs. Throwing beats returning an empty dashboard that looks
      // like a permissions bug.
      throw new Error('No role on the request context.');
    }

    const scoped = this.prisma.scoped;

    const tenant = await scoped.tenant.findFirst({
      select: {
        name: true,
        slug: true,
        status: true,
        drugLicenceNumber: true,
        timezone: true,
        createdAt: true,
      },
    });

    const canSeeCompanyStats = role === 'ADMIN' || role === 'MANAGEMENT';

    const [companyStats, recentActivity, licenceAlert, packagingShortages] = await Promise.all([
      canSeeCompanyStats ? this.companyStats(tenant?.createdAt ?? new Date()) : undefined,
      this.recentActivity(role),
      this.licenceAlert(role),
      this.packagingShortages(role),
    ]);

    return {
      role,
      roleLabel: USER_ROLE_LABELS[role],
      company: {
        name: tenant?.name ?? 'Unknown',
        slug: tenant?.slug ?? '',
        status: tenant?.status ?? 'UNKNOWN',
        drugLicenceNumber: tenant?.drugLicenceNumber ?? null,
        timezone: tenant?.timezone ?? 'UTC',
      },
      headline: this.headline(role),
      sections: await this.sections(role),
      accessibleModules: ROLE_MODULES[role],
      readOnly: READ_ONLY_ROLES.includes(role),
      recentActivity,
      ...(companyStats ? { companyStats } : {}),
      ...(licenceAlert ? { licenceAlert } : {}),
      ...(packagingShortages ? { packagingShortages } : {}),
    };
  }

  /**
   * Planned batches that will not pack cleanly — US-MD-06's fourth criterion:
   * "a packaging shortage must be visible on the Production/Purchase dashboard
   * before the batch is due for packing".
   *
   * Offered to whoever can open EITHER module, read from the same ROLE_MODULES
   * table the navigation uses. Purchase as well as Production because the
   * person who can actually fix a packaging shortage is the buyer — telling
   * only the packing line would be telling the people who cannot act on it.
   *
   * Returns undefined for a role with neither module, so the field is absent
   * rather than an empty alert claiming all is well.
   */
  private async packagingShortages(role: UserRole): Promise<PackagingShortageAlert | undefined> {
    const allowed = new Set(ROLE_MODULES[role]);

    if (!allowed.has('production') && !allowed.has('purchase')) return undefined;

    return this.packaging.shortageSweep();
  }

  /**
   * The renewal warning — US-MD-04.
   *
   * Returns undefined rather than an empty alert for a role that may not see
   * licences, so the field is ABSENT from the payload. That is the criterion's
   * "only visible to Admin and Quality/Compliance" honoured at the point of
   * serialisation: a Store Officer's dashboard never carries the records at
   * all, rather than carrying them and trusting the page to hide them.
   *
   * An allowed role with nothing expiring gets an alert with an empty list.
   * That is a different statement — "you may see this, and all is well" — and
   * the page needs it to say so.
   */
  private async licenceAlert(role: UserRole): Promise<LicenceAlert | undefined> {
    if (!LICENCE_VISIBLE_TO.includes(role as (typeof LICENCE_VISIBLE_TO)[number])) return undefined;

    const { alertLeadDays, licences } = await this.licences.expiring();

    return { leadDays: alertLeadDays, licences };
  }

  /** A role-appropriate framing, so the page does not greet everyone identically. */
  private headline(role: UserRole): string {
    switch (role) {
      case 'ADMIN':
        return 'Company overview';
      case 'MANAGEMENT':
        return 'Company performance';
      case 'PURCHASE_MANAGER':
        return 'Purchasing';
      case 'SALES_MANAGER':
        return 'Sales';
      case 'STORE_OFFICER':
        return 'Inventory & batches';
      case 'PRODUCTION_OFFICER':
        return 'Production';
      case 'QUALITY_OFFICER':
        return 'Quality & release';
      case 'ACCOUNTANT':
        return 'Accounts';
    }
  }

  /**
   * The widget sections for a role.
   *
   * Only sections whose module the role can open are included — the same
   * ROLE_MODULES table the navigation and the role guard read, so a user cannot
   * be shown a section they would be refused on.
   */
  private async sections(role: UserRole): Promise<DashboardSection[]> {
    const allowed = new Set(ROLE_MODULES[role]);
    const sections: DashboardSection[] = [];

    // Admins get a real, populated section: user management is fully built.
    if (allowed.has('admin') && role === 'ADMIN') {
      const scoped = this.prisma.scoped;

      const [total, active, pendingPassword, disabled, locked] = await Promise.all([
        scoped.user.count({ where: { deletedAt: null } }),
        scoped.user.count({
          where: { deletedAt: null, status: 'ACTIVE', mustChangePassword: false },
        }),
        scoped.user.count({ where: { deletedAt: null, mustChangePassword: true } }),
        scoped.user.count({ where: { deletedAt: null, status: 'DISABLED' } }),
        scoped.user.count({ where: { deletedAt: null, lockedUntil: { gt: new Date() } } }),
      ]);

      sections.push({
        key: 'people',
        title: 'People',
        widgets: [
          ready('users', 'Users', total, 'admin'),
          ready('activeUsers', 'Signed in and active', active, 'admin'),
          ready(
            'pendingPassword',
            'Awaiting password change',
            pendingPassword,
            'admin',
            pendingPassword > 0 ? 'They cannot use the system until they do' : undefined,
          ),
          ready('disabledUsers', 'Disabled', disabled, 'admin'),
          ...(locked > 0
            ? [ready('lockedUsers', 'Locked out', locked, 'admin', 'Failed sign-in attempts')]
            : []),
        ],
      });
    }

    if (allowed.has('masters')) {
      sections.push({
        key: 'masters',
        title: 'Items & parties',
        note: 'Item, formulation and party records are not built yet.',
        widgets: [pending('items'), pending('parties'), pending('boms')],
      });
    }

    if (allowed.has('purchase')) {
      sections.push({
        key: 'purchase',
        title: 'Purchasing',
        note: 'The purchase to GRN to invoice flow is not built yet.',
        widgets: [pending('purchaseOrders'), pending('pendingGrns'), pending('purchaseInvoices')],
      });
    }

    if (allowed.has('inventory')) {
      sections.push({
        key: 'inventory',
        title: 'Inventory & batches',
        note: 'Batch tracking is not built yet.',
        widgets: [pending('batches'), pending('expiringBatches'), pending('lowStock')],
      });
    }

    if (allowed.has('production')) {
      sections.push({
        key: 'production',
        title: 'Production',
        note: 'Work orders are not built yet.',
        widgets: [pending('workOrders'), pending('inProduction')],
      });
    }

    if (allowed.has('quality')) {
      sections.push({
        key: 'quality',
        title: 'Quality & release',
        note: 'Batch release is not built yet.',
        widgets: [pending('awaitingRelease'), pending('onHold'), pending('rejected')],
      });
    }

    if (allowed.has('sales')) {
      sections.push({
        key: 'sales',
        title: 'Sales',
        note: 'Sales orders and dispatch are not built yet.',
        widgets: [pending('salesOrders'), pending('dispatchesDue')],
      });
    }

    if (allowed.has('accounts')) {
      sections.push({
        key: 'accounts',
        title: 'Accounts',
        note: 'Invoicing and ledgers are not built yet.',
        widgets: [pending('salesInvoices'), pending('receivables'), pending('payables')],
      });
    }

    return sections;
  }

  private async companyStats(createdAt: Date): Promise<CompanyStats> {
    const scoped = this.prisma.scoped;

    const [total, active, pendingPassword, disabled, auditRecordCount, grouped] = await Promise.all(
      [
        scoped.user.count({ where: { deletedAt: null } }),
        scoped.user.count({
          where: { deletedAt: null, status: 'ACTIVE', mustChangePassword: false },
        }),
        scoped.user.count({ where: { deletedAt: null, mustChangePassword: true } }),
        scoped.user.count({ where: { deletedAt: null, status: 'DISABLED' } }),
        scoped.auditLog.count(),
        scoped.user.groupBy({ by: ['role'], where: { deletedAt: null }, _count: { _all: true } }),
      ],
    );

    const counts = new Map(grouped.map((row) => [row.role as UserRole, row._count._all]));

    return {
      users: {
        total,
        active,
        pendingPasswordChange: pendingPassword,
        disabled,
        // Every role listed, including zeros: an Admin deciding who to hire
        // needs to see the gaps, not just what exists.
        byRole: USER_ROLES.map((role) => ({
          role,
          label: USER_ROLE_LABELS[role],
          count: counts.get(role) ?? 0,
        })),
      },
      auditRecordCount,
      createdAt: createdAt.toISOString(),
    };
  }

  /**
   * Recent activity from the tenant's own audit trail.
   *
   * Withheld from roles with no business seeing company-wide activity: an
   * Accountant does not need to know that the Quality Officer's password was
   * reset. Admin and Management see everything; everyone else sees their own.
   */
  private async recentActivity(role: UserRole): Promise<ActivityItem[]> {
    const scoped = this.prisma.scoped;
    const seesEverything = role === 'ADMIN' || role === 'MANAGEMENT';
    const ownUserId = this.tenantContext.getUserId();

    const rows = await scoped.auditLog.findMany({
      where: seesEverything ? {} : { userId: ownUserId },
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        user: { select: { fullName: true } },
      },
    });

    return rows.map((row) => ({
      // BigInt is not JSON-serialisable, so the id is stringified here rather
      // than blowing up in the serialiser.
      id: row.id.toString(),
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actor: row.user?.fullName ?? null,
      at: row.createdAt.toISOString(),
    }));
  }
}
