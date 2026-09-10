import type { UserRole } from './roles';
import { WORKFLOW_HOME } from './workflows';

/**
 * The authenticated user as the web app sees them, returned by `GET /api/v1/me`
 * and by a successful sign-in.
 *
 * Note what is absent: no password hash, no token. The hash must never leave
 * the API, and the token is delivered as an httpOnly cookie the browser cannot
 * read rather than in a response body.
 */
export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  status: UserAccountStatus;
  /**
   * True after an Admin created the account or reset the password. While set,
   * every route except change-password is refused — an admin-chosen password is
   * a shared secret until the user replaces it.
   */
  mustChangePassword: boolean;
}

export type UserAccountStatus = 'INVITED' | 'ACTIVE' | 'DISABLED';

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: SessionUser;
  /**
   * Bearer token for the API. The web app puts this straight into an httpOnly
   * cookie and never exposes it to client-side JavaScript.
   */
  accessToken: string;
  /** Seconds until `accessToken` expires. */
  expiresInSeconds: number;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/**
 * Password rules, shared so the form and the API agree on what is acceptable
 * rather than the user discovering the real rule on submit.
 *
 * Length over composition classes, deliberately: NIST SP 800-63B advises
 * against mandatory character-class rules, which push people toward
 * `Passw0rd!` and no further.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_RULE_TEXT = `At least ${PASSWORD_MIN_LENGTH} characters. A passphrase of a few words is stronger than a short password with symbols.`;

// ---------------------------------------------------------------------------
// Admin user management
// ---------------------------------------------------------------------------

/** Body of `POST /api/v1/users` — an Admin creating a colleague. */
export interface CreateUserRequest {
  email: string;
  fullName: string;
  /** Assigned by the Admin. Never chosen by the user being created. */
  role: UserRole;
  phone?: string;
  /**
   * Temporary password, communicated to the user out of band. They are forced
   * to replace it on first sign-in.
   */
  temporaryPassword: string;
}

/** Body of `PATCH /api/v1/users/:id`. Every field optional. */
export interface UpdateUserRequest {
  fullName?: string;
  phone?: string;
  role?: UserRole;
  /** ACTIVE or DISABLED. Use the delete endpoint to soft-delete instead. */
  status?: Extract<UserAccountStatus, 'ACTIVE' | 'DISABLED'>;
}

/** Body of `POST /api/v1/users/:id/reset-password`. */
export interface ResetPasswordRequest {
  temporaryPassword: string;
}

/** A row in the Admin's user list. */
export interface UserListItem {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: UserRole;
  status: UserAccountStatus;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  /** True while a failed-login lockout is in force. */
  isLocked: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Feature areas
// ---------------------------------------------------------------------------

/**
 * Feature areas of the application. Used to decide what a role may see; the
 * authoritative write-side check is the API's role guard, this drives navigation.
 */
export const APP_MODULES = [
  'dashboard',
  'masters',
  'purchase',
  'inventory',
  'production',
  'quality',
  'sales',
  'accounts',
  'admin',
] as const;

export type AppModule = (typeof APP_MODULES)[number];

/**
 * Which modules each role can open. MANAGEMENT sees everything but writes
 * nothing — see READ_ONLY_ROLES in ./roles.
 *
 * Deliberately data rather than a pile of conditionals: the API guard and the
 * web navigation read the same table, so a role cannot end up with a menu item
 * it is not allowed to use.
 */
export const ROLE_MODULES: Record<UserRole, readonly AppModule[]> = {
  ADMIN: [...APP_MODULES],
  MANAGEMENT: [...APP_MODULES],
  PURCHASE_MANAGER: ['dashboard', 'masters', 'purchase'],
  STORE_OFFICER: ['dashboard', 'masters', 'inventory'],
  PRODUCTION_OFFICER: ['dashboard', 'production', 'inventory'],
  QUALITY_OFFICER: ['dashboard', 'quality', 'production'],
  SALES_MANAGER: ['dashboard', 'masters', 'sales'],
  ACCOUNTANT: ['dashboard', 'accounts', 'purchase', 'sales'],
};

/** Only these roles may create, edit or disable users. */
export const USER_MANAGEMENT_ROLES: readonly UserRole[] = ['ADMIN'];

export function canAccessModule(role: UserRole, appModule: AppModule): boolean {
  return ROLE_MODULES[role].includes(appModule);
}

export function canManageUsers(role: UserRole): boolean {
  return USER_MANAGEMENT_ROLES.includes(role);
}

/** Auth-related route paths, shared so the web middleware and API agree. */
export const AUTH_ROUTES = {
  login: '/login',
  changePassword: '/change-password',
  /**
   * The first workflow tab rather than /dashboard: the staff application is
   * organised around the four workflows now, and landing somewhere absent from
   * the tab bar leaves a user with no obvious way back. /dashboard still works
   * for anyone holding the URL — it was removed from the navigation, not
   * deleted.
   */
  afterLogin: WORKFLOW_HOME,
  afterLogout: '/login',
} as const;

/** Name of the httpOnly cookie holding the API access token. */
export const SESSION_COOKIE_NAME = 'pharma_erp_session';

/**
 * Scope stamped on a tenant access token. The platform equivalent lives in
 * ./platform. Both guards check it, so a token minted for one surface is
 * refused by the other deliberately rather than by accident.
 */
export const TENANT_TOKEN_SCOPE = 'tenant';
