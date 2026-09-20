import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import { isUserRole, type UserListItem, type UserRole } from '@pharma-erp/types';

import { PasswordService } from '../auth/password.service';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

/** Columns safe to return. `passwordHash` is absent on purpose. */
const LIST_SELECT = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  role: true,
  status: true,
  mustChangePassword: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly auditService: AuditService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Everyone in the caller's company. Tenant-scoped by RLS, not by this filter. */
  async list(): Promise<UserListItem[]> {
    const rows = await this.prisma.scoped.user.findMany({
      where: { deletedAt: null },
      select: LIST_SELECT,
      // Newest first, matching every other lookup in the app: the account
      // somebody is looking for is usually the one just created.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return rows.map((row) => this.toListItem(row));
  }

  /**
   * Creates a colleague with an assigned role and a temporary password.
   *
   * The tenant comes from the acting Admin's session, never from the request —
   * that is what stops an Admin creating users in another company.
   */
  async create(dto: CreateUserDto): Promise<UserListItem> {
    const tenantId = this.tenantContext.requireTenantId();

    // Validate and hash before touching the database, so a rejected password
    // cannot leave a half-created account.
    const passwordHash = await this.passwords.hashPassword(dto.temporaryPassword);

    try {
      const created = await this.prisma.scoped.user.create({
        data: {
          tenantId,
          email: dto.email,
          fullName: dto.fullName,
          phone: dto.phone ?? null,
          role: dto.role,
          // ACTIVE, not INVITED: they have a working password and can sign in
          // straight away. INVITED means "no credential exists at all".
          status: 'ACTIVE',
          passwordHash,
          passwordSetAt: new Date(),
          // The Admin knows this password, so it is a shared secret until the
          // user replaces it. Until then they can reach nothing but the
          // change-password screen.
          mustChangePassword: true,
        },
        select: LIST_SELECT,
      });

      await this.auditService.record({
        entityType: 'User',
        entityId: created.id,
        action: 'CREATE',
        // Never the password or its hash — audit rows are readable across the
        // whole tenant.
        after: {
          email: created.email,
          fullName: created.fullName,
          role: created.role,
          status: created.status,
        },
      });

      this.logger.log(`Created user ${created.id} (${created.role}) in tenant ${tenantId}`);

      return this.toListItem(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Email is globally unique, so this can also mean the address belongs
        // to another company. The message stays vague about which: confirming
        // that an address exists elsewhere on the platform would leak the
        // customer list one address at a time.
        throw new ConflictException('That email address is already in use.');
      }

      throw error;
    }
  }

  /**
   * Edits a colleague's name, phone, role or status.
   *
   * Records before and after in the audit trail, which a request-level
   * interceptor cannot do — it never sees the prior state.
   */
  async update(userId: string, dto: UpdateUserDto): Promise<UserListItem> {
    const tenantId = this.tenantContext.requireTenantId();
    const actingUserId = this.tenantContext.getUserId();

    const before = await this.prisma.scoped.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: LIST_SELECT,
    });

    if (!before) throw new NotFoundException('User not found.');

    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Nothing to update.');
    }

    // An Admin removing their own admin rights, or disabling themselves, can
    // leave a company with no one able to manage users — recoverable only from
    // the database. Refuse, and let them ask another Admin.
    if (userId === actingUserId) {
      if (dto.role && dto.role !== 'ADMIN') {
        throw new ForbiddenException(
          'You cannot change your own role. Ask another administrator to do it.',
        );
      }

      if (dto.status === 'DISABLED') {
        throw new ForbiddenException('You cannot disable your own account.');
      }
    }

    if (dto.role && dto.role !== before.role) {
      await this.assertNotLastAdmin(userId, before.role, dto.role);
    }

    if (dto.status === 'DISABLED' && before.role === 'ADMIN') {
      await this.assertNotLastAdmin(userId, before.role, null);
    }

    const after = await this.prisma.scoped.user.update({
      where: { id: userId },
      data: {
        ...(dto.fullName === undefined ? {} : { fullName: dto.fullName }),
        ...(dto.phone === undefined ? {} : { phone: dto.phone || null }),
        ...(dto.role === undefined ? {} : { role: dto.role }),
        ...(dto.status === undefined ? {} : { status: dto.status }),
        // Re-enabling clears any lockout; otherwise the account appears enabled
        // but still refuses sign-in until the timer runs out.
        ...(dto.status === 'ACTIVE' ? { failedLoginAttempts: 0, lockedUntil: null } : {}),
      },
      select: LIST_SELECT,
    });

    await this.auditService.record({
      entityType: 'User',
      entityId: userId,
      action: 'UPDATE',
      before: { role: before.role, status: before.status, fullName: before.fullName },
      after: { role: after.role, status: after.status, fullName: after.fullName },
    });

    this.logger.log(`Updated user ${userId} in tenant ${tenantId}`);

    return this.toListItem(after);
  }

  /**
   * Sets a new temporary password for a colleague who has forgotten theirs.
   *
   * This is the whole password-recovery story, by design: there is no emailed
   * reset link, so there is no reset-token surface to attack and no email
   * provider to configure. An Admin sets a new password and passes it on.
   */
  async resetPassword(userId: string, temporaryPassword: string): Promise<void> {
    const tenantId = this.tenantContext.requireTenantId();

    const user = await this.prisma.scoped.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true, status: true },
    });

    if (!user) throw new NotFoundException('User not found.');

    const passwordHash = await this.passwords.hashPassword(temporaryPassword);

    await this.prisma.scoped.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordSetAt: new Date(),
        // Admin-set again, so the shared-secret state returns.
        mustChangePassword: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        // An INVITED account now has a credential.
        ...(user.status === 'INVITED' ? { status: 'ACTIVE' as const } : {}),
      },
    });

    await this.auditService.record({
      entityType: 'User',
      entityId: userId,
      action: 'UPDATE',
      after: { event: 'PASSWORD_RESET_BY_ADMIN', email: user.email },
    });

    this.logger.log(`Password reset for user ${userId} in tenant ${tenantId}`);
  }

  /**
   * Soft-deletes a colleague.
   *
   * `users` carries a prevent_hard_delete trigger, so this is the only way to
   * remove someone — and their audit rows survive, which is the point.
   */
  async softDelete(userId: string): Promise<void> {
    const actingUserId = this.tenantContext.getUserId();

    if (userId === actingUserId) {
      throw new ForbiddenException('You cannot delete your own account.');
    }

    const user = await this.prisma.scoped.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true, role: true },
    });

    if (!user) throw new NotFoundException('User not found.');

    await this.assertNotLastAdmin(userId, user.role, null);

    await this.prisma.scoped.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        status: 'DISABLED',
        // Clear the credential: a deleted account must not be able to sign in
        // even if the deletion is later reversed by hand.
        passwordHash: null,
      },
    });

    await this.auditService.record({
      entityType: 'User',
      entityId: userId,
      action: 'SOFT_DELETE',
      before: { email: user.email, role: user.role },
    });

    this.logger.log(`Soft-deleted user ${userId}`);
  }

  /**
   * Refuses a change that would leave the company with no active Admin.
   *
   * Without this, one careless edit locks every user out of user management,
   * fixable only with database access — and on a hosted database that means the
   * vendor. Pass `null` as the new role for a removal or a disable.
   */
  private async assertNotLastAdmin(
    userId: string,
    currentRole: string,
    newRole: UserRole | null,
  ): Promise<void> {
    if (currentRole !== 'ADMIN') return;
    if (newRole === 'ADMIN') return;

    const otherAdmins = await this.prisma.scoped.user.count({
      where: {
        role: 'ADMIN',
        status: 'ACTIVE',
        deletedAt: null,
        id: { not: userId },
      },
    });

    if (otherAdmins === 0) {
      throw new ForbiddenException(
        'This is the only active administrator. Promote another user to Admin first.',
      );
    }
  }

  private toListItem(row: {
    id: string;
    email: string;
    fullName: string;
    phone: string | null;
    role: string;
    status: string;
    mustChangePassword: boolean;
    lastLoginAt: Date | null;
    lockedUntil: Date | null;
    createdAt: Date;
  }): UserListItem {
    if (!isUserRole(row.role)) {
      // Enum drift; assertRoleEnumsInSync should have caught this at boot.
      throw new BadRequestException(`User ${row.id} has an unrecognised role.`);
    }

    return {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      phone: row.phone,
      role: row.role,
      status: row.status as UserListItem['status'],
      mustChangePassword: row.mustChangePassword,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      isLocked: row.lockedUntil !== null && row.lockedUntil.getTime() > Date.now(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
