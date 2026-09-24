'use server';

import { revalidatePath } from 'next/cache';
import { USER_ROLES, type UserListItem, type UserRole } from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

export interface UserFormState {
  status: 'idle' | 'error' | 'success';
  message?: string;
  /**
   * The temporary password just set, echoed back so the Admin can pass it on.
   * Shown once and never stored — the API only ever holds its argon2 hash.
   */
  temporaryPassword?: string;
  /** Kept so a rejected form does not lose what was typed. */
  values?: { email?: string; fullName?: string; role?: string; phone?: string };
}

/** Generates a readable temporary password. Mirrors the API's alphabet: no I/l/1/O/0. */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);

  let out = '';
  for (const byte of bytes) {
    if (out.length === 16) break;
    // Rejection sampling: a plain modulo would bias toward the alphabet's start.
    if (byte < 256 - (256 % alphabet.length)) out += alphabet[byte % alphabet.length];
  }

  return out;
}

function isRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

export async function createUserAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const fullName = String(formData.get('fullName') ?? '').trim();
  const role = String(formData.get('role') ?? '');
  const phone = String(formData.get('phone') ?? '').trim();
  const values = { email, fullName, role, phone };

  if (!email || !fullName || !role) {
    return { status: 'error', message: 'Email, full name and role are all required.', values };
  }

  if (!isRole(role)) {
    return { status: 'error', message: 'Choose a valid role.', values };
  }

  // Generated server-side rather than typed by the Admin: it guarantees the
  // length policy is met and avoids an Admin reusing one memorable password
  // across every colleague they create.
  const temporaryPassword = generatePassword();

  const result = await apiFetch<UserListItem>('/api/v1/users', {
    method: 'POST',
    json: { email, fullName, role, phone: phone || undefined, temporaryPassword },
    authenticated: true,
    // argon2 hashing on the API side.
    timeoutMs: 20_000,
  });

  if (!result.ok) {
    return { status: 'error', message: result.error, values };
  }

  revalidatePath('/admin/users');

  return {
    status: 'success',
    message: `${fullName} can now sign in as ${email}.`,
    temporaryPassword,
  };
}

export async function updateUserAction(
  userId: string,
  patch: { role?: UserRole; status?: 'ACTIVE' | 'DISABLED' },
): Promise<{ ok: boolean; error?: string }> {
  const result = await apiFetch<UserListItem>(`/api/v1/users/${userId}`, {
    method: 'PATCH',
    json: patch,
    authenticated: true,
  });

  revalidatePath('/admin/users');

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function resetPasswordAction(
  userId: string,
): Promise<{ ok: boolean; temporaryPassword?: string; error?: string }> {
  const temporaryPassword = generatePassword();

  const result = await apiFetch<void>(`/api/v1/users/${userId}/reset-password`, {
    method: 'POST',
    json: { temporaryPassword },
    authenticated: true,
    timeoutMs: 20_000,
  });

  revalidatePath('/admin/users');

  return result.ok ? { ok: true, temporaryPassword } : { ok: false, error: result.error };
}
