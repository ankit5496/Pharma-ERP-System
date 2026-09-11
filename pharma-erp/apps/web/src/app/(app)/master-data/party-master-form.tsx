'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  PARTY_STATUS_LABELS,
  PARTY_TYPE_LABELS,
  type PartyStatus,
  type PartySummary,
  type PartyType,
} from '@pharma-erp/types';

import { savePartyAction, type ActionResult } from './actions';
import {
  FormError,
  FormGrid,
  FormSection,
  SelectField,
  SubmitActions,
  TextAreaField,
  TextField,
} from './form-kit';

/**
 * 2. Party Master — US-MD-02
 *
 * One screen for suppliers, customers and job-work principals, which is the
 * acceptance criterion about supporting both types from a single screen. The
 * customer-only section appears when the type is CUSTOMER: a disclosure, not
 * a rule. The rule is a CHECK constraint on the table and a check on the API,
 * and it stands whatever this form shows.
 *
 * The table is shared with the Procure-to-Pay work, so the field names here
 * follow theirs — `code` identifies the party, `paymentTermsDays` is an
 * integer rather than a terms enum.
 */

const TYPE_OPTIONS = (Object.keys(PARTY_TYPE_LABELS) as PartyType[]).map((key) => ({
  value: key,
  label: PARTY_TYPE_LABELS[key],
}));

const STATUS_OPTIONS = (Object.keys(PARTY_STATUS_LABELS) as PartyStatus[]).map((key) => ({
  value: key,
  label: PARTY_STATUS_LABELS[key],
}));

const INITIAL: ActionResult = { ok: false };

export function PartyMasterForm({
  party,
  onSaved,
}: {
  party?: PartySummary;
  onSaved?: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    savePartyAction.bind(null, party?.id ?? null),
    INITIAL,
  );
  const router = useRouter();

  const [partyType, setPartyType] = useState<string>(party?.partyType ?? '');
  const [status, setStatus] = useState<string>(party?.status ?? 'ACTIVE');

  const isCustomer = partyType === 'CUSTOMER';
  const needsLicence = isCustomer && status === 'ACTIVE';

  useEffect(() => {
    if (!state.ok) return;

    router.refresh();
    onSaved?.();
  }, [state.ok, router, onSaved]);

  const typed = (field: string, stored?: string | number | null) =>
    state.values?.[field] ?? (stored === null || stored === undefined ? undefined : String(stored));

  return (
    <form action={formAction} className="flex flex-col gap-8" noValidate>
      {!state.ok && state.message && <FormError message={state.message} />}

      <FormSection title="Identity">
        <FormGrid>
          <TextField
            name="code"
            label="Party code"
            required
            maxLength={64}
            placeholder="SUP-0007"
            defaultValue={typed('code', party?.code)}
            readOnly={Boolean(party)}
            hint={
              party
                ? 'Fixed once created — it is on every order and invoice that already cites this party.'
                : 'Short, unique, and never reused.'
            }
          />
          <SelectField
            name="partyType"
            label="Party type"
            required
            options={TYPE_OPTIONS}
            defaultValue={typed('partyType', party?.partyType)}
            placeholder="Supplier, customer, or principal…"
            onChange={setPartyType}
            hint="Decides which of the sections below apply."
          />
          <TextField
            name="name"
            label="Party name"
            required
            maxLength={255}
            defaultValue={typed('name', party?.name)}
            wide
          />
          <SelectField
            name="status"
            label="Status"
            required
            options={STATUS_OPTIONS}
            defaultValue={typed('status', party?.status) ?? 'ACTIVE'}
            onChange={setStatus}
            hint={
              needsLicence
                ? 'An active customer must have a drug licence on file — see below.'
                : 'Inactive parties stay on record but cannot be transacted with.'
            }
          />
          <TextField
            name="gstin"
            label="GSTIN"
            maxLength={15}
            placeholder="27AABCU9603R1ZM"
            defaultValue={typed('gstin', party?.gstin)}
            hint="15 characters. Leave blank for an unregistered supplier."
          />
          <TextField
            name="email"
            label="Email"
            maxLength={320}
            defaultValue={typed('email', party?.email)}
          />
          <TextField
            name="phone"
            label="Contact number"
            maxLength={32}
            defaultValue={typed('phone', party?.phone)}
          />
          <TextAreaField
            name="address"
            label="Address"
            rows={3}
            wide
            defaultValue={typed('address', party?.address)}
            hint="The registered place of business, as it appears on the GST certificate."
          />
        </FormGrid>
      </FormSection>

      <FormSection
        title="Supplier terms"
        description="Applied when a purchase order is raised on this party."
      >
        <FormGrid>
          <TextField
            name="paymentTermsDays"
            label="Payment terms (days)"
            type="number"
            min="0"
            step="1"
            placeholder="30"
            defaultValue={typed('paymentTermsDays', party?.paymentTermsDays)}
            hint="Days from invoice to due date. 0 means payment on delivery."
          />
        </FormGrid>
      </FormSection>

      {isCustomer && (
        <FormSection
          title="Customer terms"
          description="A drug licence is required before this party can be active — the number and its validity are both checked, by the API and by the database."
        >
          <FormGrid>
            <TextField
              name="drugLicenceNumber"
              label="Drug licence number"
              required={needsLicence}
              maxLength={64}
              placeholder="20B/MH/2019/000123"
              defaultValue={typed('drugLicenceNumber', party?.drugLicenceNumber)}
              hint="Form 20B / 21B for a retailer, 20 / 21 for a wholesaler."
            />
            <TextField
              name="drugLicenceValidTo"
              label="Drug licence valid until"
              required={needsLicence}
              type="date"
              defaultValue={typed('drugLicenceValidTo', party?.drugLicenceValidTo)}
              hint="The last day the licence is valid."
            />
            <TextField
              name="creditLimit"
              label="Credit limit (₹)"
              type="number"
              min="0"
              step="0.01"
              defaultValue={typed('creditLimit', party?.creditLimit)}
              hint="Total outstanding this party may carry."
            />
            <TextField
              name="creditPeriodDays"
              label="Credit period (days)"
              type="number"
              min="0"
              step="1"
              placeholder="30"
              defaultValue={typed('creditPeriodDays', party?.creditPeriodDays)}
            />
          </FormGrid>
        </FormSection>
      )}

      <SubmitActions label={party ? 'Save changes' : 'Save party'} pending={isPending} />
    </form>
  );
}
