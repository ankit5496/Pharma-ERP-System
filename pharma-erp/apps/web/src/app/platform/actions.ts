'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  PLATFORM_ROUTES,
  PLATFORM_SESSION_COOKIE_NAME,
  type CompanyListItem,
  type CreateCompanyResponse,
  type PlatformLoginResponse,
} from '@pharma-erp/types';

import { apiFetch, isColdStart, COLD_START_MESSAGE } from '@/lib/api';
import { platformFetch } from '@/lib/platform-session';

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface PlatformLoginState {
  /** 'waking' is not a failure: the API is booting and the form retries itself. */
  status: 'idle' | 'error' | 'waking';
  message?: string;
  email?: string;
}

export async function platformLoginAction(
  _previous: PlatformLoginState,
  formData: FormData,
): Promise<PlatformLoginState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { status: 'error', message: 'Enter your email and password.', email };
  }

  const result = await apiFetch<PlatformLoginResponse>('/api/v1/platform/auth/login', {
    method: 'POST',
    json: { email, password },
    // Long enough to outlast a cold start, which was measured at 22-53s on the
    // free instance type this deploys to. The previous 20s could not: it
    // expired while the container was still booting, so the first sign-in after
    // an idle period could never succeed, however correct the password.
    timeoutMs: 75_000,
  });

  if (!result.ok) {
    // A sleeping API is a wait, not a refusal. Saying so lets the form retry
    // instead of showing the operator a rate-limit error for a service that has
    // no rate limiter.
    if (isColdStart(result)) return { status: 'waking', message: COLD_START_MESSAGE, email };

    return { status: 'error', message: result.error, email };
  }

  const store = await cookies();

  store.set(PLATFORM_SESSION_COOKIE_NAME, result.data.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: result.data.expiresInSeconds,
  });

  redirect(
    result.data.user.mustChangePassword
      ? PLATFORM_ROUTES.changePassword
      : PLATFORM_ROUTES.dashboard,
  );
}

export async function platformLogoutAction(): Promise<void> {
  await platformFetch<void>('/api/v1/platform/auth/logout', { method: 'POST', timeoutMs: 5_000 });

  const store = await cookies();
  store.delete(PLATFORM_SESSION_COOKIE_NAME);

  redirect(PLATFORM_ROUTES.afterLogout);
}

export interface PlatformPasswordState {
  status: 'idle' | 'error';
  message?: string;
}

export async function platformChangePasswordAction(
  _previous: PlatformPasswordState,
  formData: FormData,
): Promise<PlatformPasswordState> {
  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  if (!currentPassword || !newPassword) {
    return { status: 'error', message: 'Fill in both password fields.' };
  }

  // Checked here, not sent to the API: the confirmation is a typing aid, not a
  // credential.
  if (newPassword !== confirmPassword) {
    return { status: 'error', message: 'The two new passwords do not match.' };
  }

  const result = await platformFetch<void>('/api/v1/platform/auth/change-password', {
    method: 'POST',
    json: { currentPassword, newPassword },
    timeoutMs: 20_000,
  });

  if (!result.ok) {
    if (result.status === 401) {
      return { status: 'error', message: 'Your current password is incorrect.' };
    }
    return { status: 'error', message: result.error };
  }

  revalidatePath('/platform', 'layout');
  redirect(PLATFORM_ROUTES.dashboard);
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export interface CreateCompanyState {
  status: 'idle' | 'error' | 'success';
  message?: string;
  /** The Admin's temporary password, shown once. Never stored in readable form. */
  adminPassword?: string;
  adminEmail?: string;
  values?: Record<string, string>;
}

/** Readable generated password. Mirrors the API's alphabet: no I/l/1/O/0. */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);

  let out = '';
  for (const byte of bytes) {
    if (out.length === 18) break;
    if (byte < 256 - (256 % alphabet.length)) out += alphabet[byte % alphabet.length];
  }

  return out;
}

export async function createCompanyAction(
  _previous: CreateCompanyState,
  formData: FormData,
): Promise<CreateCompanyState> {
  const read = (key: string) => String(formData.get(key) ?? '').trim();

  const values = {
    companyName: read('companyName'),
    slug: read('slug').toLowerCase(),
    drugLicenceNumber: read('drugLicenceNumber'),
    gstin: read('gstin'),
    timezone: read('timezone') || 'Asia/Kolkata',
    adminFullName: read('adminFullName'),
    adminEmail: read('adminEmail').toLowerCase(),
  };

  if (!values.companyName || !values.adminEmail || !values.adminFullName) {
    return {
      status: 'error',
      message: "Company name, and the administrator's name and email, are all required.",
      values,
    };
  }

  // Generated server-side so the length policy is always met and a Super User
  // cannot reuse one memorable password across every company they create.
  const adminTemporaryPassword = generatePassword();

  const result = await platformFetch<CreateCompanyResponse>('/api/v1/platform/companies', {
    method: 'POST',
    json: {
      companyName: values.companyName,
      slug: values.slug || undefined,
      drugLicenceNumber: values.drugLicenceNumber || undefined,
      gstin: values.gstin || undefined,
      timezone: values.timezone,
      adminEmail: values.adminEmail,
      adminFullName: values.adminFullName,
      adminTemporaryPassword,
    },
    timeoutMs: 25_000,
  });

  if (!result.ok) return { status: 'error', message: result.error, values };

  revalidatePath('/platform/companies');
  revalidatePath('/platform');

  return {
    status: 'success',
    message: `${result.data.tenantName} created, with ${result.data.adminEmail} as its administrator.`,
    adminPassword: adminTemporaryPassword,
    adminEmail: result.data.adminEmail,
  };
}

export async function updateCompanyAction(
  tenantId: string,
  patch: { status?: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' },
): Promise<{ ok: boolean; error?: string }> {
  const result = await platformFetch<CompanyListItem>(`/api/v1/platform/companies/${tenantId}`, {
    method: 'PATCH',
    json: patch,
  });

  revalidatePath('/platform/companies');
  revalidatePath('/platform');

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
