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



export const PARTY_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type PartyStatus = (typeof PARTY_STATUSES)[number];

export const PARTY_TYPE_LABELS: Record<PartyType, string> = {
  VENDOR: 'Supplier',
  CUSTOMER: 'Customer',
  JOB_WORK_PRINCIPAL: 'Job-work principal',
};

export const PARTY_STATUS_LABELS: Record<PartyStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

/** Whether the customer-only fields apply — licence, credit limit, period. */
export function isCustomerParty(type: PartyType): boolean {
  return type === 'CUSTOMER';
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
