import type { PrismaClient } from '@prisma/client';

// PG_TENANT_SETTING is no longer needed here: the per-request identity lookup
// sets the tenant inside public.resolve_identity, alongside the RLS helper
// functions that read it. The login lookup below still sets its own.
import { PG_LOGIN_EMAIL_SETTING } from '@pharma-erp/types';

import { TRANSACTION_MAX_WAIT_MS, TRANSACTION_TIMEOUT_MS } from './tenant-scope';

/**
 * The same budget every tenant-scoped transaction gets. Sign-in needs it more
 * than most: it runs before anything else, so a tight budget presents as
 * "nobody can log in" (P2028) rather than as a slow query.
 */
const TRANSACTION_TIMEOUTS = {
  maxWait: TRANSACTION_MAX_WAIT_MS,
  timeout: TRANSACTION_TIMEOUT_MS,
} as const;

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
 * The shape `public.resolve_identity` returns, in database naming.
 *
 * Declared rather than inferred: `$queryRaw` cannot know the shape of a
 * function's result set, and an unchecked `any` here would let a column rename
 * in the migration surface as `undefined` on an authorisation decision.
 */
interface IdentityRow {
  user_id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  must_change_password: boolean;
  tenant_name: string;
  tenant_slug: string;
  tenant_status: string;
}

/**
 * Re-reads the account named by a verified token, on every request.
 *
 * This is what makes revocation immediate: disabling a user or changing their
 * role takes effect on their next request, rather than whenever their token
 * happens to expire.
 *
 * ONE ROUND TRIP, deliberately. It used to be an interactive transaction —
 * BEGIN, set the tenant, SELECT, COMMIT — which is four network round trips
 * before the request's own work starts. That is free on a local database and
 * measured at 1.2-1.9 seconds against the hosted one in Oregon, on every single
 * authenticated request. `public.resolve_identity` does the same two steps
 * inside one statement, so the cost is one.
 *
 * Nothing is given up for it. The function is SECURITY INVOKER, so row-level
 * security still evaluates as the runtime role; the tenant predicate is still
 * stated explicitly; and because a lone statement is its own implicit
 * transaction, the tenant setting is scoped to this call and cannot leak onto
 * the next request that borrows the same pooled connection — which the explicit
 * transaction only achieved by remembering to pass `is_local`.
 *
 * See 20260914130000_resolve_identity_in_one_round_trip.
 */
export async function resolveIdentityByUserId(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
): Promise<ResolvedIdentity | null> {
  const rows = await prisma.$queryRaw<IdentityRow[]>`
    SELECT * FROM public.resolve_identity(${tenantId}::uuid, ${userId}::uuid)
  `;

  const row = rows[0];

  // No row means a validly-signed token for an account that has since been
  // deleted, or whose company has been. The caller turns that into a 401.
  if (!row) return null;

  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    status: row.status,
    mustChangePassword: row.must_change_password,
    tenantName: row.tenant_name,
    tenantSlug: row.tenant_slug,
    tenantStatus: row.tenant_status,
  };
}
