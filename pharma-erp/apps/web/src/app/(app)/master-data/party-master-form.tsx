'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { useActionToast } from '@/components/toast';
import { useRouter } from 'next/navigation';
import {
  COUNTRY_DIAL_CODES,
  dialCodeLabel,
  PARTY_STATUS_LABELS,
  PARTY_TYPE_LABELS,
  splitPhoneNumber,
  type PartyStatus,
  type PartySummary,
  type PartyType,
} from '@pharma-erp/types';

import { savePartyAction, uploadCustomerDocumentAction, type ActionResult } from './actions';
import { CustomerDocuments } from './customer-documents';
import {
  FormGrid,
  FormSection,
  PhoneField,
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

const DIAL_OPTIONS = COUNTRY_DIAL_CODES.map((entry) => ({
  value: entry.dial,
  label: dialCodeLabel(entry),
  title: entry.country,
}));

const INITIAL: ActionResult = { ok: false };

export function PartyMasterForm({
  party,
  onSaved,
}: {
  party?: PartySummary;
  onSaved?: () => void;
}) {
  const documentRef = useRef<HTMLInputElement | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);

  /**
   * Saves the party, then attaches the chosen document to it.
   *
   * IN THAT ORDER, and it cannot be otherwise: a document is filed against a
   * party, so on a create there is nothing to attach to until the party exists.
   * `savePartyAction` hands back the saved id precisely so this can follow it.
   *
   * A failed upload does NOT fail the save. The party was written and saying
   * otherwise would send someone back to re-enter a record that is already
   * there; the document is reported separately, and the file is still sitting
   * in the control to try again.
   */
  const saveWithDocument = async (
    previous: ActionResult,
    formData: FormData,
  ): Promise<ActionResult> => {
    setDocumentError(null);

    const result = await savePartyAction(party?.id ?? null, previous, formData);

    if (!result.ok) return result;

    const file = documentRef.current?.files?.[0];
    const targetId = party?.id ?? result.savedId;

    if (!file || !targetId) return result;

    const upload = new FormData();
    upload.set('file', file);

    const uploaded = await uploadCustomerDocumentAction(targetId, upload);

    if (!uploaded.ok) {
      setDocumentError(
        `The record was saved, but the document was not attached: ${uploaded.message}`,
      );

      // Saved is saved. The drawer stays open on the document error rather than
      // closing as if everything had worked.
      return { ...result, ok: true, message: undefined };
    }

    return result;
  };

  const [state, formAction, isPending] = useActionState(saveWithDocument, INITIAL);

  // The result is announced by the application-wide centred toast rather than
  // by a banner inside this form, which on a form this long sat above the fold
  // while the submit button being watched was below it.
  useActionToast(isPending, state.ok ? 'success' : 'error', state.message);
  const router = useRouter();

  const [partyType, setPartyType] = useState<string>(party?.partyType ?? '');
  // No 'ACTIVE' fallback for a NEW party: the field is starred, and opening
  // it already answered means the answer was never given. An existing party
  // keeps the status it has.
  const [status, setStatus] = useState<string>(party?.status ?? '');

  // A stored number is E.164; the form shows it as a country and a national
  // part, so an edit does not make somebody retype the code.
  const storedPhone = splitPhoneNumber(party?.phone);
  const [phoneDial, setPhoneDial] = useState<string>(storedPhone.dial);

  const isCustomer = partyType === 'CUSTOMER';
  const needsLicence = isCustomer && status === 'ACTIVE';

  // The two dropdowns were already held in state for the conditional section;
  // they are now CONTROLLED by it, and re-seeded when a save is refused —
  // React 19 resets the form and a <select> does not re-read defaultValue.
  useEffect(() => {
    const values = state.values;
    if (!values) return;
    setPartyType(values.partyType ?? '');
    setStatus(values.status ?? '');
    setPhoneDial(values.phoneDial || storedPhone.dial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (!state.ok) return;

    router.refresh();

    // Held open when the document did not attach: closing would take the
    // message with it, and the file is still in the control to retry.
    if (documentError) return;

    onSaved?.();
  }, [state.ok, router, onSaved, documentError]);

  const typed = (field: string, stored?: string | number | null) =>
    state.values?.[field] ?? (stored === null || stored === undefined ? undefined : String(stored));

  /** The refusal about one control, when the save named it. */
  const errorFor = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={formAction} className="flex flex-col gap-8" noValidate>

      <FormSection title="Identity">
        <FormGrid>
          <TextField
            name="code"
            error={errorFor('code')}
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
            error={errorFor('partyType')}
            label="Party type"
            required
            options={TYPE_OPTIONS}
            value={partyType}
            placeholder="Supplier, customer, or principal…"
            onChange={setPartyType}
            hint="Decides which of the sections below apply."
          />
          <TextField
            name="name"
            error={errorFor('name')}
            label="Party name"
            required
            maxLength={255}
            defaultValue={typed('name', party?.name)}
            wide
          />
          <SelectField
            name="status"
            error={errorFor('status')}
            label="Status"
            required
            options={STATUS_OPTIONS}
            value={status}
            onChange={setStatus}
            hint={
              needsLicence
                ? 'An active customer must have a drug licence on file — see below.'
                : 'Inactive parties stay on record but cannot be transacted with.'
            }
          />
          <TextField
            name="gstin"
            error={errorFor('gstin')}
            label="GSTIN"
            maxLength={15}
            placeholder="27AABCU9603R1ZM"
            defaultValue={typed('gstin', party?.gstin)}
            hint="15 characters. Leave blank for an unregistered supplier."
          />
          <TextField
            name="email"
            error={errorFor('email')}
            label="Email"
            type="email"
            maxLength={320}
            defaultValue={typed('email', party?.email)}
            hint="Checked for a real address — a note to yourself belongs in the address box."
          />
          {/* The country code is CHOSEN, not typed. A bare "9876543210" gives
              the validator no country to check the length against, and a typed
              "+91" invites "0091", "91-" and "(+91)". One control, because it
              is one value: the two halves are joined into E.164 on save. */}
          <PhoneField
            name="phone"
            label="Contact number"
            dialOptions={DIAL_OPTIONS}
            dialValue={phoneDial}
            onDialChange={setPhoneDial}
            defaultNational={typed('phoneNational', storedPhone.national)}
            placeholder="98765 43210"
            hint="Checked against the country chosen beside it — a number that could not be dialled is refused."
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
              error={errorFor('drugLicenceNumber')}
              label="Drug licence number"
              required={needsLicence}
              maxLength={64}
              placeholder="20B/MH/2019/000123"
              defaultValue={typed('drugLicenceNumber', party?.drugLicenceNumber)}
              hint="Form 20B / 21B for a retailer, 20 / 21 for a wholesaler."
            />
            <TextField
              name="drugLicenceValidTo"
              error={errorFor('drugLicenceValidTo')}
              label="Drug licence valid until"
              required={needsLicence}
              type="date"
              defaultValue={typed('drugLicenceValidTo', party?.drugLicenceValidTo)}
              hint="The last day the licence is valid."
            />
            <TextField
              name="creditLimit"
              error={errorFor('creditLimit')}
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

      {isCustomer && (
        <FormSection
          title="Documents"
          description="The customer's paperwork — drug licence, GST certificate, purchase agreement. Held in the database, so a document is in the same backups and under the same company isolation as the rest of the record."
        >
          <CustomerDocuments
            partyId={party?.id ?? null}
            fileRef={documentRef}
            pendingName={pendingName}
            onPendingNameChange={setPendingName}
          />

          {documentError && (
            <p
              role="alert"
              className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900"
            >
              {documentError}
            </p>
          )}
        </FormSection>
      )}

      <SubmitActions label={party ? 'Save changes' : 'Save party'} pending={isPending} />
    </form>
  );
}
