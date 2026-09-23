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

import {
  nextPartyCodeAction,
  savePartyAction,
  uploadCustomerDocumentAction,
  type ActionResult,
} from './actions';
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
  /** Called with the confirmation line, so the workspace can show it. */
  onSaved?: (message?: string) => void;
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
  // ERRORS ONLY. A success is confirmed by the workspace's SavedDialog, and a
  // toast as well would be the same news twice — once in a box to dismiss and
  // once in a strip that fades.
  useActionToast(isPending, 'error', state.ok ? undefined : state.message);
  const router = useRouter();

  const [partyType, setPartyType] = useState<string>(party?.partyType ?? '');

  /**
   * The code this party would take, shown before it is saved.
   *
   * Asked per TYPE, because the prefix follows it — choosing "Customer" has to
   * change VEN-00004 into CUS-00011, not leave the previous answer standing.
   *
   * A prediction rather than a reservation: nothing is held, and if a colleague
   * saves a party of the same type first they take this code and the next moves
   * on. Not asked at all when editing — the party already has one, and it is
   * fixed.
   */
  const [nextCode, setNextCode] = useState<string | null>(null);

  useEffect(() => {
    if (party || !partyType) {
      setNextCode(null);
      return;
    }

    let cancelled = false;

    void nextPartyCodeAction(partyType).then((code) => {
      if (!cancelled) setNextCode(code);
    });

    return () => {
      cancelled = true;
    };
  }, [party, partyType]);
  // No 'ACTIVE' fallback for a NEW party: the field is starred, and opening
  // it already answered means the answer was never given. An existing party
  // keeps the status it has.
  const [status, setStatus] = useState<string>(party?.status ?? '');

  // A stored number is E.164; the form shows it as a country and a national
  // part, so an edit does not make somebody retype the code.
  const storedPhone = splitPhoneNumber(party?.phone);
  const [phoneDial, setPhoneDial] = useState<string>(storedPhone.dial);

  const isCustomer = partyType === 'CUSTOMER';

  // Who is asked for a drug licence. A job-work principal is a licensed
  // pharmaceutical business too, so the fields are offered — but only a
  // customer is REQUIRED to have one, which is the rule the table enforces.
  const holdsLicence = isCustomer || partyType === 'JOB_WORK_PRINCIPAL';
  const needsLicence = isCustomer && status === 'ACTIVE';

  // The two dropdowns were already held in state for the conditional section;
  // they are now CONTROLLED by it, and re-seeded when a save is refused —
  // React 19 resets the form and a <select> does not re-read defaultValue.
  //
  // EVERY FALLBACK KEEPS WHAT IS ALREADY SELECTED. Reading `values.x ?? ''`
  // blanked a dropdown whenever the submitted value did not come back — which
  // happens for a field the form renders read-only, and for any path that
  // returns a result without `values` at all. The symptom was a refused save
  // that cleared Party type and Status, so a refusal about the GSTIN silently
  // took two unrelated answers with it. Falling back to the live state means
  // the worst case is a dropdown that does not change, never one that empties.
  useEffect(() => {
    const values = state.values;
    if (!values) return;

    // `||`, NOT `??`: the action captures every submitted field including the
    // blank ones, so an unanswered dropdown arrives as '' rather than
    // undefined, and `'' ?? current` keeps the empty string — the very reset
    // this effect exists to prevent.
    setPartyType((current) => values.partyType || party?.partyType || current);
    setStatus((current) => values.status || party?.status || current);
    setPhoneDial((current) => values.phoneDial || current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (!state.ok) return;

    router.refresh();

    // Held open when the document did not attach: closing would take the
    // message with it, and the file is still in the control to retry.
    if (documentError) return;

    onSaved?.(state.message);
  }, [state.ok, state.message, router, onSaved, documentError]);

  const typed = (field: string, stored?: string | number | null) =>
    state.values?.[field] ?? (stored === null || stored === undefined ? undefined : String(stored));

  /** The refusal about one control, when the save named it. */
  const errorFor = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={formAction} className="flex flex-col gap-8" noValidate>
      <FormSection title="Identity">
        <FormGrid>
          {/* ALLOCATED BY THE SERVER as VEN-00001, and read-only here.
              The prefix follows the party type, so the preview changes when the
              type does.

              It used to be typed, and one supplier ended up in the register as
              "SUP-7", "SUP-007" and "sup 7". A code quoted on every purchase
              order and invoice is not something to leave to typing.

              `readOnly` rather than `disabled`: a disabled input is left out of
              the submission entirely, and the value still has to be readable
              and copyable. The server ignores what is sent regardless. */}
          <TextField
            // KEYED ON THE CODE AND THE TYPE, so the control is remounted when
            // either changes. `defaultValue` is only read on mount, and the
            // code arrives after the first render and again whenever the type
            // changes — without the key the box would keep showing the first
            // answer. The type is in the key too because clearing it changes
            // only the PLACEHOLDER, which is read on mount for the same reason.
            key={`${party?.code ?? nextCode ?? 'pending'}:${partyType}`}
            name="code"
            label="Party code"
            readOnly
            defaultValue={party?.code ?? nextCode ?? ''}
            // The prefix comes FROM the party type, so there is no code to show
            // until one is chosen.
            placeholder={party ? undefined : partyType ? 'Assigned on save' : 'Select Party type'}
            hint={
              party
                ? 'Fixed once created — it is on every order and invoice that already cites this party.'
                : 'Assigned automatically from the party type when this party is saved.'
            }
          />
          {/* FIXED ONCE CREATED, like the code above it.

              A party's type decides which rules apply to it — a customer needs
              a drug licence to be active, a principal carries job-work
              agreements — and those decisions have already been made against
              orders, invoices and agreements that cite this row. Turning a
              customer into a supplier would leave that paperwork describing a
              party it no longer matches.

              A read-only TEXT field rather than a disabled select: a disabled
              control is left out of the submission entirely, and the value
              still has to be readable. The API refuses a change regardless. */}
          {party ? (
            <>
              <TextField
                name="partyTypeDisplay"
                label="Party type"
                readOnly
                defaultValue={PARTY_TYPE_LABELS[party.partyType]}
                hint="Fixed once created — orders and agreements already cite this party as this type."
              />
              {/* SUBMITTED, even though it cannot be changed. The visible field
                  above is `partyTypeDisplay` and carries a LABEL, so without
                  this the form sent no `partyType` at all on an edit — and the
                  action reads it to decide whether the customer-only fields
                  apply. A customer editing their licence expiry was therefore
                  treated as "not a customer", and the save cleared the licence
                  number and date instead of updating them.

                  The API refuses a change to it regardless, so sending the
                  party's own type is stating what is already true. */}
              <input type="hidden" name="partyType" value={party.partyType} />
            </>
          ) : (
            <SelectField
              name="partyType"
              error={errorFor('partyType')}
              label="Party type"
              required
              options={TYPE_OPTIONS}
              value={partyType}
              onChange={setPartyType}
              hint="Decides which of the sections below apply."
            />
          )}
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
          {/* GSTIN, EMAIL AND CONTACT NUMBER ARE REQUIRED ON A NEW PARTY.
              The GSTIN decides the tax treatment of every invoice raised
              against this party, and one nobody can reach is one whose orders
              stall with no way to chase them.

              STARRED ON CREATE ONLY. Parties recorded before this rule have
              them blank, and a star on an edit form would promise a refusal
              that is not coming — the save goes through, because demanding a
              GSTIN that may not exist would leave those rows uneditable for
              even an unrelated change. */}
          <TextField
            name="gstin"
            error={errorFor('gstin')}
            label="GSTIN"
            required={!party}
            maxLength={15}
            placeholder="27AABCU9603R1ZM"
            defaultValue={typed('gstin', party?.gstin)}
            hint="15 characters, from the GST certificate."
          />
          <TextField
            name="email"
            error={errorFor('email')}
            label="Email"
            type="email"
            required={!party}
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
            // Without this a number the API refuses — a legacy 9-digit one, say
            // — failed the save with no message anywhere on screen.
            error={errorFor('phone')}
            label="Contact number"
            required={!party}
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

      {/* THE LICENCE IS ITS OWN SECTION, shared by customers and job-work
          principals. It used to sit inside "Customer terms" beside the credit
          limit, which made it look like a commercial term — it is not. A
          principal is a licensed pharmaceutical business whose licence we hold
          on file for the same reason we hold a customer's.

          Only the CUSTOMER rule makes it mandatory, though: the constraint on
          the table is about an active customer, and requiring it of a principal
          here would refuse records the database is perfectly willing to store. */}
      {holdsLicence && (
        <FormSection
          title="Drug licence"
          description={
            isCustomer
              ? 'Required before this party can be active — the number and its validity are both checked, by the API and by the database.'
              : "The principal's own licence, kept on file. Optional here."
          }
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
          </FormGrid>
        </FormSection>
      )}

      {isCustomer && (
        <FormSection
          title="Customer terms"
          description="What this party may owe, and for how long."
        >
          <FormGrid>
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
