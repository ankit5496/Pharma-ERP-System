'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LICENCE_TYPE_LABELS, type LicenceSummary, type LicenceType } from '@pharma-erp/types';

import { saveLicenceAction, type ActionResult } from './actions';
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
 * 4. Licence & Compliance Master — US-MD-04
 *
 * Spelled "licence" to match the rest of the codebase — `drugLicenceNumber` on
 * the tenant, "drug licence details" in the dataset registry.
 *
 * These are the COMPANY'S OWN permissions, not a trading partner's. A
 * supplier's drug licence lives on their party record; this register is the
 * manufacturing licence that makes production lawful at all.
 *
 * The expiry date is the point of the register: an expired manufacturing
 * licence does not stop the line by itself, so the system has to be the thing
 * that notices — and it can only notice a date it has been told.
 */

const TYPE_OPTIONS = (Object.keys(LICENCE_TYPE_LABELS) as LicenceType[]).map((key) => ({
  value: key,
  label: LICENCE_TYPE_LABELS[key],
}));

const INITIAL: ActionResult = { ok: false };

export function LicenceComplianceMasterForm({
  licence,
  onSaved,
}: {
  licence?: LicenceSummary;
  onSaved?: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    saveLicenceAction.bind(null, licence?.id ?? null),
    INITIAL,
  );
  const router = useRouter();

  // Controlled, because React 19 resets an uncontrolled form when its action
  // resolves and a <select> does not pick up a changed defaultValue on that
  // reset the way an <input> does. See SelectField.
  const [licenceType, setLicenceType] = useState<string>(licence?.licenceType ?? '');

  useEffect(() => {
    const values = state.values;
    if (!values) return;
    setLicenceType(values.licenceType ?? '');
  }, [state]);

  useEffect(() => {
    if (!state.ok) return;

    router.refresh();
    onSaved?.();
  }, [state.ok, router, onSaved]);

  // What was typed wins over what was stored, so a rejected save re-renders
  // the attempt rather than reverting to the saved record. React 19 resets an
  // uncontrolled form once its action resolves, so without this the correction
  // is typed twice.
  const typed = (field: string, stored?: string | number | null) =>
    state.values?.[field] ?? (stored === null || stored === undefined ? undefined : String(stored));

  /** The refusal about one control, when the save named it. */
  const errorFor = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={formAction} className="flex flex-col gap-8" noValidate>
      {!state.ok && state.message && (
        <FormError message={state.message} fieldErrors={state.fieldErrors} />
      )}

      <FormSection title="Licence">
        <FormGrid>
          <SelectField
            name="licenceType"
            error={errorFor('licenceType')}
            label="Licence type"
            required
            options={TYPE_OPTIONS}
            value={licenceType}
            onChange={setLicenceType}
            placeholder="Choose a licence type…"
          />
          <TextField
            name="licenceNumber"
            error={errorFor('licenceNumber')}
            label="Licence number"
            required
            maxLength={64}
            placeholder="25/MH/2021/000456"
            defaultValue={typed('licenceNumber', licence?.licenceNumber)}
            hint="Exactly as printed on the certificate — it is quoted on invoices and batch records."
          />
          <TextField
            name="issuingAuthority"
            error={errorFor('issuingAuthority')}
            label="Issuing authority"
            required
            maxLength={255}
            placeholder="Food and Drug Administration, Maharashtra"
            defaultValue={typed('issuingAuthority', licence?.issuingAuthority)}
            hint="Renewal goes back to the same office."
          />
          <TextField
            name="issuedOn"
            label="Issued on"
            type="date"
            defaultValue={typed('issuedOn', licence?.issuedOn)}
            hint="Optional. Recorded for the file; the alert does not use it."
          />
          <TextField
            name="expiryDate"
            error={errorFor('expiryDate')}
            label="Expiry date"
            required
            type="date"
            defaultValue={typed('expiryDate', licence?.expiryDate)}
            hint="What the renewal alert counts down to. Renewing means changing this date, not adding a second record."
          />
        </FormGrid>
      </FormSection>

      <FormSection
        title="Notes"
        description="Anything the next person needs — conditions on the licence, the reference of a pending renewal application."
      >
        {/* No maxLength: TextAreaField does not take one, and the API caps
            notes at 1000 characters — which is the cap that counts. */}
        <TextAreaField
          name="notes"
          label="Notes"
          rows={3}
          defaultValue={typed('notes', licence?.notes)}
        />
      </FormSection>

      <SubmitActions
        label={licence ? 'Save licence' : 'Add licence'}
        pending={isPending}
        onCancel={onSaved}
      />
    </form>
  );
}
