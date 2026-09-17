'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BILLING_MODEL_DESCRIPTIONS,
  BILLING_MODEL_LABELS,
  CONVERSION_RATE_BASIS_LABELS,
  type BillingModel,
  type BomView,
  type ConversionRateBasis,
  type JobWorkAgreementSummary,
  type PartySummary,
} from '@pharma-erp/types';

import { saveAgreementAction, type ActionResult } from './actions';
import {
  AddLineButton,
  FormError,
  FormGrid,
  FormSection,
  LineList,
  LineRow,
  SelectField,
  SubmitActions,
  TextAreaField,
  TextField,
  useLineRows,
} from './form-kit';

/**
 * 5. Principal & Job-Work Agreement Master — US-MD-05
 *
 * A principal is a brand owner you manufacture for, so the same physical
 * product carries their brand name and their pack design, not yours. The
 * mapping below is what keeps those two identities attached to one BOM without
 * duplicating the formulation.
 *
 * Both the principal and the formulations are PICKED, not typed: the payload
 * carries ids, and a code somebody typed would have to be parsed back into one.
 * The principal list is filtered to parties recorded as job-work principals,
 * which is the same rule the API enforces — a party that is only a supplier
 * cannot be a principal.
 *
 * WHAT THIS FORM DOES NOT DO: US-MD-05 also says the billing model "cannot be
 * changed on an order that is already in production". Production orders do not
 * reference an agreement yet, so that half is unenforceable today — see the
 * note beside the billing model field, and the migration header for what is
 * owed when Production is built.
 */

const BILLING_MODEL_OPTIONS = (Object.keys(BILLING_MODEL_LABELS) as BillingModel[]).map((key) => ({
  value: key,
  label: `${BILLING_MODEL_LABELS[key]} — ${BILLING_MODEL_DESCRIPTIONS[key]}`,
}));

const RATE_BASIS_OPTIONS = (Object.keys(CONVERSION_RATE_BASIS_LABELS) as ConversionRateBasis[]).map(
  (key) => ({ value: key, label: CONVERSION_RATE_BASIS_LABELS[key] }),
);

const INITIAL: ActionResult = { ok: false };

export function PrincipalAgreementMasterForm({
  agreement,
  parties,
  boms,
  onSaved,
}: {
  agreement?: JobWorkAgreementSummary;
  parties: readonly PartySummary[];
  boms: readonly BomView[];
  onSaved?: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    saveAgreementAction.bind(null, agreement?.id ?? null),
    INITIAL,
  );
  const router = useRouter();

  // Editing starts with a row per existing mapping, so an amendment is a change
  // to what is there rather than a re-entry of it.
  const mappings = useLineRows(Math.max(agreement?.mappings.length ?? 0, 1));

  // The dropdowns are CONTROLLED; the text fields are not. React 19 resets an
  // uncontrolled form once its action resolves, and a <select> does not pick up
  // a changed defaultValue on that reset the way an <input> does — so a
  // rejected save came back with every text field preserved and every dropdown
  // blank. See SelectField for the mechanism.
  const [principalId, setPrincipalId] = useState(agreement?.principalId ?? '');
  const [billingModel, setBillingModel] = useState<string>(agreement?.billingModel ?? '');
  const [rateBasis, setRateBasis] = useState<string>(agreement?.conversionRateBasis ?? '');
  const [mappingBoms, setMappingBoms] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!state.ok) return;

    router.refresh();
    onSaved?.();
  }, [state.ok, router, onSaved]);

  // Re-seed the dropdowns from what was submitted, whenever a save comes back
  // refused. Keyed on `state` rather than on its fields: a new result object is
  // a new answer, even when the values in it are the same as last time.
  useEffect(() => {
    const values = state.values;
    if (!values) return;

    setPrincipalId(values.principalId ?? '');
    setBillingModel(values.billingModel ?? '');
    setRateBasis(values.conversionRateBasis ?? '');
    setMappingBoms(
      Object.fromEntries(
        Object.entries(values)
          .map(([key, value]) => [/^mapping\.(\d+)\.bomId$/.exec(key)?.[1], value] as const)
          .filter((entry): entry is readonly [string, string] => Boolean(entry[0])),
      ),
    );
  }, [state]);

  const typed = (field: string, stored?: string | number | null) =>
    state.values?.[field] ?? (stored === null || stored === undefined ? undefined : String(stored));

  /** The refusal about one control, when the save named it. */
  const errorFor = (field: string) => state.fieldErrors?.[field];

  // Only parties recorded as job-work principals. The API refuses anything
  // else; offering it here would be offering a choice that cannot be saved.
  const principals = parties.filter((party) => party.partyType === 'JOB_WORK_PRINCIPAL');

  const principalOptions = principals.map((party) => ({
    value: party.id,
    label: `${party.code} — ${party.name}`,
  }));

  // A formulation is identified the way the rest of the app identifies one:
  // product code, version, and whether it is the live version.
  const bomOptions = boms.map((bom) => ({
    value: bom.id,
    label: `${bom.product.code} v${bom.version}${bom.isActive ? '' : ' (superseded)'} — ${
      bom.product.name
    }`,
  }));

  const noPrincipals = principals.length === 0;
  const noBoms = bomOptions.length === 0;

  return (
    <form action={formAction} className="flex flex-col gap-8" noValidate>
      {!state.ok && state.message && (
        <FormError message={state.message} fieldErrors={state.fieldErrors} />
      )}

      {(noPrincipals || noBoms) && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {noPrincipals && noBoms
            ? 'There are no job-work principals and no formulations yet. Add a party of type "Job-work principal" in the Party register, and a formulation in BOM / Formulation, before writing an agreement.'
            : noPrincipals
              ? 'No party is recorded as a job-work principal yet. Add one in the Party register first — an agreement needs a brand owner to be with.'
              : 'There are no formulations yet. An agreement has to cover at least one product, so add one in BOM / Formulation first.'}
        </p>
      )}

      <FormSection title="Agreement">
        <FormGrid>
          <SelectField
            name="principalId"
            error={errorFor('principalId')}
            label="Principal"
            required
            options={principalOptions}
            value={principalId}
            onChange={setPrincipalId}
            placeholder="Choose a principal…"
            hint="The brand owner, from the Party register. Only parties recorded as job-work principals appear here."
          />
          <TextField
            name="agreementReference"
            error={errorFor('agreementReference')}
            label="Agreement reference"
            maxLength={64}
            placeholder="JW-2026-018"
            defaultValue={typed('agreementReference', agreement?.agreementReference)}
            hint="The parties' own reference for the contract. Optional, but unique when given."
          />
          <SelectField
            name="billingModel"
            error={errorFor('billingModel')}
            label="Billing model"
            required
            options={BILLING_MODEL_OPTIONS}
            value={billingModel}
            onChange={setBillingModel}
            placeholder="Choose a billing model…"
            wide
            hint="Mandatory. Decides whose material is consumed and what the invoice is raised on. Once work orders can be raised against an agreement, this will be fixed on any order that has started."
          />
          <TextField
            name="conversionChargeRate"
            error={errorFor('conversionChargeRate')}
            label="Conversion charge rate (₹)"
            type="number"
            min="0"
            step="0.01"
            defaultValue={typed('conversionChargeRate', agreement?.conversionChargeRate)}
            hint="Charged on conversion and packing, not on the value of the goods."
          />
          <SelectField
            name="conversionRateBasis"
            error={errorFor('conversionRateBasis')}
            label="Rate charged"
            options={RATE_BASIS_OPTIONS}
            value={rateBasis}
            onChange={setRateBasis}
            placeholder="Choose a basis…"
            hint="Required whenever a rate is given — a rate with no basis cannot be invoiced."
          />
          <TextField
            name="validFrom"
            error={errorFor('validFrom')}
            label="Valid from"
            type="date"
            defaultValue={typed('validFrom', agreement?.validFrom)}
          />
          <TextField
            name="validTo"
            error={errorFor('validTo')}
            label="Valid until"
            type="date"
            defaultValue={typed('validTo', agreement?.validTo)}
            hint="Leave blank for an open-ended arrangement."
          />
        </FormGrid>
      </FormSection>

      <FormSection
        title="Product-to-brand mapping"
        description="Links one of our formulations to the principal's brand name and pack design. At least one line is required — that is what the agreement is about."
      >
        <LineList>
          {mappings.ids.map((id, index) => {
            const existing = agreement?.mappings[index];

            return (
              <LineRow
                key={id}
                index={index}
                canRemove={mappings.ids.length > 1}
                onRemove={() => mappings.remove(id)}
              >
                <SelectField
                  name={`mapping.${id}.bomId`}
                  label="Our formulation"
                  compact
                  required
                  options={bomOptions}
                  value={mappingBoms[id] ?? existing?.bomId ?? ''}
                  onChange={(value) => setMappingBoms((rows) => ({ ...rows, [id]: value }))}
                  placeholder="Choose a formulation…"
                />
                <TextField
                  name={`mapping.${id}.principalBrandName`}
                  label="Principal's brand name"
                  compact
                  required
                  maxLength={255}
                  placeholder="Dolotab 500"
                  defaultValue={typed(
                    `mapping.${id}.principalBrandName`,
                    existing?.principalBrandName,
                  )}
                />
                <TextField
                  name={`mapping.${id}.packDesignRef`}
                  label="Pack design reference"
                  compact
                  maxLength={64}
                  placeholder="ART-DOLO-500-10x10"
                  defaultValue={typed(`mapping.${id}.packDesignRef`, existing?.packDesignRef)}
                />
              </LineRow>
            );
          })}
        </LineList>
        <AddLineButton onClick={mappings.add}>+ Add product mapping</AddLineButton>
      </FormSection>

      <FormSection
        title="Notes"
        description="Anything the next person needs — special packing conditions, who supplies the artwork."
      >
        <TextAreaField
          name="notes"
          label="Notes"
          rows={3}
          defaultValue={typed('notes', agreement?.notes)}
        />
      </FormSection>

      <SubmitActions
        label={agreement ? 'Save agreement' : 'Add agreement'}
        pending={isPending}
        onCancel={onSaved}
      />
    </form>
  );
}
