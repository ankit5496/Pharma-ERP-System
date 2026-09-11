import type { PrismaClient } from '@prisma/client';

import { PG_LOGIN_EMAIL_SETTING, PG_TENANT_SETTING } from '@pharma-erp/types';

import { TRANSACTION_TIMEOUTS } from './tenant-scope';

/**
 * An account as the sign-in path needs it — including the password hash, which
 * is why this type is never returned from a controller.
 */
export interface LoginCandidate {
  userId: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  passwordHash: string | null;
  mustChangePassword: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
}

/**
 * Finds the single account for an email, before any tenant is known.
 *
 * Runs in a transaction that sets `app.current_login_email` but NOT
 * `app.current_tenant_id` — the tenant is what this is trying to discover. The
 * `users_login_lookup` / `tenants_login_lookup` policies (see migration
 * 20260902000000_local_authentication) exist for exactly this query and expose
 * at most the one row for the address supplied.
 *
 * Returns null when no such account exists. The caller must NOT distinguish
 * that from a wrong password in what it returns to the client: doing so turns
 * the login form into an account-enumeration oracle.
 */
export async function findLoginCandidateByEmail(
  prisma: PrismaClient,
  email: string,
): Promise<LoginCandidate | null> {
  const normalised = email.trim().toLowerCase();

  if (!normalised) return null;

  // Explicit budgets, because this is the first transaction of every sign-in:
  // with Prisma's 2s default this is where a cross-region database surfaces as
  // "nobody can log in" (P2028). See TRANSACTION_TIMEOUTS.
  return prisma.$transaction(async (tx) => {
    // `true` = SET LOCAL: scoped to this transaction, and therefore to this
    // connection checkout. Parameterised via the tagged template, so the
    // address — which is untrusted input — is never interpolated into SQL.
    await tx.$executeRaw`SELECT set_config(${PG_LOGIN_EMAIL_SETTING}, ${normalised}, true)`;

    const user = await tx.user.findFirst({
      where: { email: normalised, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
        passwordHash: true,
        mustChangePassword: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        tenant: { select: { name: true, slug: true, status: true, deletedAt: true } },
      },
    });

    // An account whose company has been soft-deleted has no working session.
    if (!user || user.tenant.deletedAt !== null) return null;

    return {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      passwordHash: user.passwordHash,
      mustChangePassword: user.mustChangePassword,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
      tenantName: user.tenant.name,
      tenantSlug: user.tenant.slug,
      tenantStatus: user.tenant.status,
    };
  }, TRANSACTION_TIMEOUTS);
}

/** The subset of an account needed to authorise a request, minus credentials. */
export interface ResolvedIdentity {
  userId: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  mustChangePassword: boolean;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
}

/**
 * Re-reads the account named by a verified token, on every request.
 *
 * This is what makes revocation immediate: disabling a user or changing their
 * role takes effect on their next request, rather than whenever their token
 * happens to expire. The cost is one indexed primary-key lookup.
 *
 * Unlike the login lookup, the tenant is already known — it comes from the
 * token — so this runs fully tenant-scoped and needs no policy exception.
 */
export async function resolveIdentityByUserId(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
): Promise<ResolvedIdentity | null> {
  // Runs on EVERY authenticated request, so it needs the same budget as the
  // sign-in lookup — otherwise a cross-region database logs you in and then
  // fails every page that follows.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config(${PG_TENANT_SETTING}, ${tenantId}, true)`;

    const user = await tx.user.findFirst({
      // tenantId is redundant given the primary key, but stating it means a
      // token naming another tenant's user id cannot resolve even if the RLS
      // policy were ever loosened.
      where: { id: userId, tenantId, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
        mustChangePassword: true,
        tenant: { select: { name: true, slug: true, status: true, deletedAt: true } },
      },
    });

    if (!user || user.tenant.deletedAt !== null) return null;

    return {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      tenantName: user.tenant.name,
      tenantSlug: user.tenant.slug,
      tenantStatus: user.tenant.status,
    };
  }, TRANSACTION_TIMEOUTS);
}
