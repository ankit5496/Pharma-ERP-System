/**
 * Wire types for the Licence & Compliance register — US-MD-04.
 *
 * These are the COMPANY'S OWN statutory permissions, not a trading partner's.
 * `Party.drugLicenceNumber` in ./parties is somebody else's licence recorded
 * against their party row; this register is the manufacturer's own paperwork,
 * the manufacturing licence that makes production lawful at all.
 *
 * Dates cross the wire as YYYY-MM-DD strings, never as a serialised Date. The
 * columns are `@db.Date`, a licence is valid THROUGH a calendar day printed on
 * a certificate, and an ISO timestamp would make "expires today" depend on the
 * reader's timezone.
 *
 * VISIBILITY: Admin and Quality Officer only. Enforced by `@Roles(...)` on the
 * API, not by anything in this file — a type cannot keep a secret.
 */

export const LICENCE_TYPES = ['MANUFACTURING', 'GST_REGISTRATION', 'NARCOTICS'] as const;
export type LicenceType = (typeof LICENCE_TYPES)[number];

export const LICENCE_TYPE_LABELS: Record<LicenceType, string> = {
  MANUFACTURING: 'Manufacturing licence',
  GST_REGISTRATION: 'GST registration',
  NARCOTICS: 'Narcotics dealing licence',
};

/**
 * What the number field is called, and what counts as a valid one, per type.
 *
 * ONE DEFINITION, read by the form and by the API. A GSTIN has a statutory
 * 15-character shape; a state drug licence does not — its structure varies by
 * state and by the form it was issued under, so the only honest rule there is
 * the alphabet it may use. Writing those rules twice is how a screen comes to
 * accept something the server refuses.
 *
 * `pattern` is a SOURCE string rather than a RegExp so it can cross the wire
 * and be reconstructed on either side; `new RegExp(pattern)` is how both ends
 * use it.
 */
export interface LicenceNumberRule {
  /** The field's label, which changes with the type. */
  label: string;
  /** Shown under the field, as the format in words. */
  hint: string;
  placeholder: string;
  /** Anchored; test the whole trimmed value against it. */
  pattern: string;
  /** What to say when the pattern does not match. */
  message: string;
  maxLength: number;
}

export const LICENCE_NUMBER_RULES: Record<LicenceType, LicenceNumberRule> = {
  /**
   * A manufacturing licence is issued by a state FDA under a numbered form —
   * 25 and 28 for manufacture, 20B and 21B for sale — and the number carries
   * the form, the state and a serial in a shape that differs between them.
   * Only the alphabet is checked: letters, digits, and the delimiters the real
   * formats use.
   */
  MANUFACTURING: {
    label: 'Licence number',
    hint: 'Exactly as printed on the certificate — it is quoted on invoices and batch records.',
    placeholder: '25/MH/2021/000456',
    pattern: '^[0-9A-Za-z/-]{1,64}$',
    message: 'A licence number may contain only letters, numbers, hyphens and forward slashes.',
    maxLength: 64,
  },

  /**
   * The statutory GSTIN: two-digit state code, ten-character PAN, entity
   * number, a literal Z, checksum. The one type here with a fixed shape, so it
   * is the one type worth checking in full.
   */
  GST_REGISTRATION: {
    label: 'GST number',
    hint: '15 characters: state code, PAN, entity number, Z, checksum.',
    placeholder: '27AABCU9603R1ZM',
    pattern: '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$',
    message:
      'A GST number must be 15 characters: state code, PAN, entity number, Z, checksum (e.g. 27AABCU9603R1ZM).',
    maxLength: 15,
  },

  /**
   * Issued by the state narcotics authority under the NDPS rules. Like the
   * manufacturing licence, the structure varies by state, so the alphabet is
   * all that can fairly be insisted on.
   */
  NARCOTICS: {
    label: 'Narcotics licence number',
    hint: 'As printed on the NDPS licence issued by the state authority.',
    placeholder: 'NDPS/MH/2021/00123',
    pattern: '^[0-9A-Za-z/-]{1,64}$',
    message: 'A licence number may contain only letters, numbers, hyphens and forward slashes.',
    maxLength: 64,
  },
};

/**
 * The roles allowed to see licence records (US-MD-04).
 *
 * Exported so the API guard and the web app's register list read the same
 * list rather than each carrying its own copy — two copies of a permission
 * rule is how a screen ends up visible to someone the API refuses.
 *
 * MANAGEMENT is deliberately absent despite being "read everything, write
 * nothing" elsewhere: the criterion says Admin and Quality/Compliance only,
 * and a narrower reading is the safe one to be wrong about.
 */
export const LICENCE_VISIBLE_TO = ['ADMIN', 'QUALITY_OFFICER'] as const;

/**
 * How far ahead the dashboard warns, when a company has not chosen.
 *
 * The number itself lives on the tenant row — this is only the fallback the
 * column defaults to, kept here so the UI can label the control honestly.
 */
export const DEFAULT_LICENCE_ALERT_LEAD_DAYS = 60;

/** Bounds enforced by the `tenants_licence_alert_lead_days_sane` constraint. */
export const MIN_LICENCE_ALERT_LEAD_DAYS = 1;
export const MAX_LICENCE_ALERT_LEAD_DAYS = 365;

/**
 * One licence as the register shows it.
 *
 * `daysUntilExpiry` and `status` are computed by the API rather than by each
 * screen. Two reasons: the comparison is against the SERVER's today, so two
 * browsers in different timezones cannot disagree about whether a licence has
 * lapsed; and "expiring" depends on the tenant's configured lead time, which
 * the client would otherwise have to fetch and apply itself.
 */
export interface LicenceSummary {
  id: string;
  licenceType: LicenceType;
  licenceNumber: string;
  issuingAuthority: string;
  /** YYYY-MM-DD, or null when the issue date was not recorded. */
  issuedOn: string | null;
  /** YYYY-MM-DD. */
  expiryDate: string;
  notes: string | null;
  /** Negative once the licence has lapsed; 0 on the final valid day. */
  daysUntilExpiry: number;
  status: LicenceStatus;
}

/**
 * `EXPIRING` means "inside this company's configured lead time", so the same
 * licence is VALID for a company that warns 30 days ahead and EXPIRING for one
 * that warns 90 days ahead. That is the criterion working as specified.
 */
export const LICENCE_STATUSES = ['VALID', 'EXPIRING', 'EXPIRED'] as const;
export type LicenceStatus = (typeof LICENCE_STATUSES)[number];

export const LICENCE_STATUS_LABELS: Record<LicenceStatus, string> = {
  VALID: 'Valid',
  EXPIRING: 'Expiring soon',
  EXPIRED: 'Expired',
};

/** The register plus the setting that decides which rows are "expiring". */
export interface LicenceRegister {
  licences: LicenceSummary[];
  alertLeadDays: number;
}

export interface CreateLicenceRequest {
  licenceType: LicenceType;
  licenceNumber: string;
  issuingAuthority: string;
  issuedOn?: string;
  expiryDate: string;
  notes?: string;
}

/**
 * A change to an existing licence. Omitted means unchanged, `null` clears.
 *
 * `expiryDate` cannot be cleared — a licence with no expiry date is invisible
 * to the alert that is the point of this register. Renewing one is an update
 * to this field, not a new row.
 */
export interface UpdateLicenceRequest {
  licenceType?: LicenceType;
  licenceNumber?: string;
  issuingAuthority?: string;
  issuedOn?: string | null;
  expiryDate?: string;
  notes?: string | null;
}

/** Changes how far ahead this company is warned. */
export interface UpdateLicenceAlertRequest {
  alertLeadDays: number;
}
