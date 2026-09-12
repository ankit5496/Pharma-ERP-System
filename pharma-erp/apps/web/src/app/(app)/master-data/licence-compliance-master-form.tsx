'use client';

import {
  FormActions,
  FormGrid,
  FormSection,
  NotWiredNotice,
  SelectField,
  TextField,
} from './form-kit';

/**
 * 4. Licence & Compliance Master — US-MD-04
 *
 * Spelled "licence" to match the rest of the codebase — `drugLicenceNumber`
 * on the tenant, "drug licence details" in the dataset registry.
 *
 * The expiry date is the point of the register: an expired manufacturing
 * licence does not stop production by itself, so the system has to be the
 * thing that notices, and it can only notice a date it has been told.
 */

const LICENCE_TYPE_OPTIONS = [
  { value: 'MANUFACTURING', label: 'Manufacturing licence' },
  { value: 'GST_REGISTRATION', label: 'GST registration' },
  { value: 'NARCOTICS', label: 'Narcotics dealing licence' },
] as const;

export function LicenceComplianceMasterForm() {
  return (
    <form onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-8">
      <NotWiredNotice>
        There is no <code>licences</code> table yet, and no renewal alerting behind the expiry date.
        This form is the specification for both.
      </NotWiredNotice>

      <FormSection title="Licence">
        <FormGrid>
          <SelectField
            name="licenceType"
            label="Licence type"
            required
            options={LICENCE_TYPE_OPTIONS}
            placeholder="Choose a licence type…"
          />
          <TextField
            name="licenceNumber"
            label="Licence number"
            required
            maxLength={64}
            placeholder="25/MH/2021/000456"
            hint="Not in the original field list, but a licence record that cannot be quoted on a document is not much use."
          />
          <TextField
            name="issuingAuthority"
            label="Issuing authority"
            required
            maxLength={255}
            placeholder="Food and Drug Administration, Maharashtra"
          />
          <TextField
            name="expiryDate"
            label="Expiry date"
            required
            type="date"
            hint="What the renewal alert counts down to."
          />
        </FormGrid>
      </FormSection>

      <FormActions label="Save licence" />
    </form>
  );
}
