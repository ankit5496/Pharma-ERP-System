import { UserRole as PrismaUserRole } from '@prisma/client';

import { USER_ROLES, type UserRole } from '@pharma-erp/types';

export * from '@prisma/client';
export * from './auth-lookup';
export * from './client';
export * from './provisioning';
export * from './tenant-scope';

/**
 * Tables that carry `deletedAt` and must never be hard-deleted. Kept as data so
 * a test can assert that every one of them has a prevent_hard_delete trigger in
 * the database, rather than trusting that each migration remembered.
 */
export const SOFT_DELETE_MODELS = [
  'Tenant',
  'User',
  'Item',
  'Party',
  'PurchaseRequisition',
  'PurchaseOrder',
  'GoodsReceipt',
  'PurchaseInvoice',
  'VendorPayment',
] as const;

/**
 * Tables that are append-only: no UPDATE, no DELETE, ever.
 *
 * StockLedgerEntry and QcResult join AuditLog here. Both record something that
 * happened — a stock movement, a quality decision — and a record of an event
 * that can be edited afterwards is not a record. Corrections are new rows.
 */
export const APPEND_ONLY_MODELS = ['AuditLog', 'StockLedgerEntry', 'QcResult'] as const;

// ---------------------------------------------------------------------------
// Role enum drift guard
// ---------------------------------------------------------------------------
// The role list exists in two places by necessity: a Prisma enum (for the
// column type) and a TypeScript const (usable by the web app, which does not
// depend on Prisma). The assertion below fails the build if either side gains,
// loses, or renames a role, so the pair cannot drift silently.

/** Resolves to `true` only when A and B are mutually assignable. */
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// A compile error here means @pharma-erp/types and the Prisma schema disagree
// about UserRole. Fix both, do not widen the type.
const _userRoleEnumsMatch: Equals<UserRole, PrismaUserRole> = true;
void _userRoleEnumsMatch;

/** Runtime counterpart of the type-level check above. */
export function assertRoleEnumsInSync(): void {
  const prismaRoles = Object.values(PrismaUserRole) as string[];
  const missing = USER_ROLES.filter((role) => !prismaRoles.includes(role));
  const extra = prismaRoles.filter((role) => !(USER_ROLES as readonly string[]).includes(role));

  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `UserRole enum drift between @pharma-erp/types and the Prisma schema. ` +
        `Missing in Prisma: [${missing.join(', ')}]. Missing in types: [${extra.join(', ')}].`,
    );
  }
}
