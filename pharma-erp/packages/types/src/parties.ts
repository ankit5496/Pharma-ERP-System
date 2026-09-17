/**
 * Wire types for the Party master — US-MD-02.
 *
 * The `parties` table is SHARED. It was created by the Procure-to-Pay work,
 * whose migrations live on the hosted database rather than in this
 * repository, and purchase orders, goods receipts and invoices already
 * reference it. Column names, nullability and the PartyType values are
 * therefore mirrored here, not chosen here — see the note on PartyType.
 *
 * Money crosses the wire as a STRING, for the same reason quantities do in
 * ./production: the column is `Decimal(14,2)` and JSON has only doubles, so
 * serialising a credit limit as a number silently rounds it.
 */

// PartyType and PartySummary live in ./procurement, alongside the rest of
// the shared master data. This module adds what only the Party register
// needs: status, the licence validity, and the credit terms.
import type { PartyType } from './procurement';

export const PARTY_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'] as const;
export type PartyStatus = (typeof PARTY_STATUSES)[number];

export const PARTY_TYPE_LABELS: Record<PartyType, string> = {
  VENDOR: 'Supplier',
  CUSTOMER: 'Customer',
  JOB_WORK_PRINCIPAL: 'Job-work principal',
};

export const PARTY_STATUS_LABELS: Record<PartyStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  /// A commercial hold, distinct from simply not being in use.
  BLOCKED: 'Blocked',
};

/** Whether the customer-only fields apply — licence, credit limit, period. */
export function isCustomerParty(type: PartyType): boolean {
  return type === 'CUSTOMER';
}

/**
 * Dial codes offered beside the phone field.
 *
 * A phone number is stored in E.164 — "+919876543210" — and the country code
 * is CHOSEN rather than typed. Two reasons: a bare "9876543210" is not a
 * dialable number and gives the validator no country to check the length
 * against, and a typed "+91" invites "0091", "91-", and "(+91)".
 *
 * Not an exhaustive list of the world's dial codes, and deliberately so: a
 * two-hundred-entry dropdown is worse to use than a short one covering where
 * this company actually trades. Adding a row is a one-line change.
 */
export const COUNTRY_DIAL_CODES = [
  { dial: '+91', iso: 'IN', country: 'India' },
  { dial: '+971', iso: 'AE', country: 'United Arab Emirates' },
  { dial: '+1', iso: 'US', country: 'United States / Canada' },
  { dial: '+44', iso: 'GB', country: 'United Kingdom' },
  { dial: '+65', iso: 'SG', country: 'Singapore' },
  { dial: '+61', iso: 'AU', country: 'Australia' },
  { dial: '+49', iso: 'DE', country: 'Germany' },
  { dial: '+33', iso: 'FR', country: 'France' },
  { dial: '+880', iso: 'BD', country: 'Bangladesh' },
  { dial: '+94', iso: 'LK', country: 'Sri Lanka' },
  { dial: '+977', iso: 'NP', country: 'Nepal' },
  { dial: '+234', iso: 'NG', country: 'Nigeria' },
  { dial: '+254', iso: 'KE', country: 'Kenya' },
  { dial: '+27', iso: 'ZA', country: 'South Africa' },
] as const;

/**
 * "IN +91" — what the dropdown shows.
 *
 * The ISO code rather than a flag emoji, and rather than the full country
 * name. Flag emoji were tried and are not an option on Windows: Chrome there
 * has no flag glyphs, so it falls back to drawing the two regional-indicator
 * letters the emoji is built from — "KE Kenya (+254)" rendered as "κε Kenya
 * (+254)", which looks like a rendering fault rather than a flag.
 *
 * The full country name is left out because a native `<select>` shows the same
 * text in the closed control as in the open list, and the closed control is
 * where it has to fit beside the number. The ISO code carries the same
 * information in two characters.
 */
export function dialCodeLabel(entry: (typeof COUNTRY_DIAL_CODES)[number]): string {
  return `${entry.iso} ${entry.dial}`;
}

export const DEFAULT_DIAL_CODE = '+91';

/**
 * Splits a stored E.164 number back into the dial code and the national part,
 * so an edit form can put each in its own control.
 *
 * Longest dial code first, because "+1" is a prefix of neither "+91" nor
 * "+971" but "+9" would be — matching short-first would file a Dubai number
 * under India.
 */
export function splitPhoneNumber(phone: string | null | undefined): {
  dial: string;
  national: string;
} {
  if (!phone) return { dial: DEFAULT_DIAL_CODE, national: '' };

  const compact = phone.replace(/[^\d+]/g, '');

  const match = [...COUNTRY_DIAL_CODES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((entry) => compact.startsWith(entry.dial));

  if (!match) return { dial: DEFAULT_DIAL_CODE, national: compact.replace(/^\+/, '') };

  return { dial: match.dial, national: compact.slice(match.dial.length) };
}

/**
 * Joins a chosen dial code and a typed national number into E.164.
 *
 * Returns null for a blank national number: a party with no phone is normal,
 * and storing a lone "+91" would be storing a country rather than a number.
 */
export function joinPhoneNumber(dial: string, national: string): string | null {
  const digits = national.replace(/\D/g, '');

  if (!digits) return null;

  return `${dial}${digits}`;
}

/**
 * What the create endpoint accepts.
 *
 * The licence fields are optional even though an ACTIVE customer cannot be
 * saved without them. Deliberate: it lets someone record the party as
 * INACTIVE today and activate it when the paperwork arrives, rather than
 * inventing a licence number to get past a form.
 */
export interface CreatePartyRequest {
  code: string;
  name: string;
  partyType: PartyType;
  status?: PartyStatus;
  gstin?: string;
  email?: string;
  phone?: string;
  address?: string;
  paymentTermsDays?: number;
  drugLicenceNumber?: string;
  drugLicenceValidTo?: string;
  creditLimit?: string;
  creditPeriodDays?: number;
}

/**
 * A change to an existing party. Omitted means unchanged, `null` clears.
 *
 * `code` is absent: it identifies the party on every purchase order and
 * invoice already raised.
 */
export interface UpdatePartyRequest {
  name?: string;
  partyType?: PartyType;
  status?: PartyStatus;
  gstin?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  paymentTermsDays?: number;
  drugLicenceNumber?: string | null;
  drugLicenceValidTo?: string | null;
  creditLimit?: string | null;
  creditPeriodDays?: number | null;
}

// ---------------------------------------------------------------------------
// Customer documents
// ---------------------------------------------------------------------------

/**
 * What a customer's document may be.
 *
 * A whitelist, not a blocklist. The set of things a browser will happily
 * execute if it is persuaded to treat them as a page is large and grows; the
 * set of things a licence or a certificate actually arrives as is small and
 * does not. Anything outside this is refused rather than stored and worried
 * about later.
 */
export const DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];

/**
 * 5 MB.
 *
 * The bytes live in a Postgres column, so every read pulls the whole file
 * through the database connection — which, against a cross-region database, is
 * already the slowest thing in the system. Generous for a scanned certificate
 * and deliberately nowhere near enough to make this a general file store.
 */
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

export const DOCUMENT_CONTENT_TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG image',
  'image/png': 'PNG image',
  'image/webp': 'WebP image',
};

/** A document on file. The bytes are NOT included; fetch them separately. */
export interface CustomerDocumentSummary {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  uploadedAt: string;
}

/** Human-readable size, for a listing. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
