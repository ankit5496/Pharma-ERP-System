import { Injectable, NotFoundException } from '@nestjs/common';

import type { ProcurementSettings } from '@pharma-erp/types';

import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

/**
 * Company-level Procure-to-Pay settings.
 *
 * One flag today: whether the reorder check may raise requisitions by itself.
 *
 * WHY IT IS STORED ON THE TENANT ROW. It is a single boolean and `tenants` is
 * already the row every request resolves, so it costs nothing to read. More
 * importantly the tenant table's row-level security policy — `id =
 * current_tenant_id()` — already confines both the read and the write to the
 * caller's own company. A settings table of its own would need that written
 * again, correctly, to be equally safe.
 *
 * Both methods go through `prisma.scoped`, so isolation holds at the service
 * layer and not merely because the UI happens to send the right id.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<ProcurementSettings> {
    const tenantId = this.tenantContext.requireTenantId();

    const tenant = await this.prisma.scoped.tenant.findFirst({
      where: { id: tenantId },
      select: { autoRequisitionEnabled: true },
    });

    if (!tenant) throw new NotFoundException('Company not found.');

    return { autoRequisitionEnabled: tenant.autoRequisitionEnabled };
  }

  /** Reads it as a plain boolean, for callers that only need to decide. */
  async autoCreationEnabled(): Promise<boolean> {
    const settings = await this.get();

    return settings.autoRequisitionEnabled;
  }

  async update(autoRequisitionEnabled: boolean): Promise<ProcurementSettings> {
    const tenantId = this.tenantContext.requireTenantId();

    const before = await this.get();

    const tenant = await this.prisma.scoped.tenant.update({
      where: { id: tenantId },
      data: { autoRequisitionEnabled },
      select: { autoRequisitionEnabled: true },
    });

    // Audited because it changes whether the system creates documents on its
    // own. "Why did nothing get raised last month" needs an answer, and
    // "somebody turned it off on the 3rd" is that answer.
    await this.audit.record({
      entityType: 'Tenant',
      entityId: tenantId,
      action: 'UPDATE',
      before: { autoRequisitionEnabled: before.autoRequisitionEnabled },
      after: { autoRequisitionEnabled: tenant.autoRequisitionEnabled },
    });

    return { autoRequisitionEnabled: tenant.autoRequisitionEnabled };
  }
}
