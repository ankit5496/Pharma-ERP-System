'use client';

import {
  AddLineButton,
  FormActions,
  FormGrid,
  FormSection,
  LineList,
  LineRow,
  NotWiredNotice,
  SelectField,
  TextField,
  useLineRows,
} from './form-kit';

/**
 * 5. Principal & Job-Work Agreement Master — US-MD-05
 *
 * A principal is a brand owner you manufacture for, so the same physical
 * product carries their brand name and their pack design, not yours. The
 * mapping below is what keeps those two identities attached to one BOM
 * without duplicating the formulation.
 */

const BILLING_MODEL_OPTIONS = [
  {
    value: 'OWN_PROCUREMENT',
    label: 'Own-Procurement — we buy the materials and bill the finished goods',
  },
  {
    value: 'PURE_CONVERSION',
    label: 'Pure Conversion — the principal supplies materials, we bill the conversion',
  },
] as const;

/**
 * A conversion rate is meaningless without saying what it is charged per, so
 * the basis is captured beside it. Not in the original field list; the
 * alternative is a number nobody can interpret six months later.
 */
const RATE_BASIS_OPTIONS = [
  { value: 'PER_BATCH', label: 'per batch' },
  { value: 'PER_1000_UNITS', label: 'per 1,000 units' },
  { value: 'PER_PACK', label: 'per pack' },
  { value: 'PER_KG', label: 'per kg' },
] as const;

export function PrincipalAgreementMasterForm() {
  const mappings = useLineRows(1);

  return (
    <form onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-8">
      <NotWiredNotice>
        There is no <code>principals</code> or agreement table yet, and the Job Work workflow is
        still all placeholders. This form is the specification for both.
      </NotWiredNotice>

      <FormSection title="Agreement">
        <FormGrid>
          <TextField
            name="principal"
            label="Principal"
            required
            maxLength={255}
            placeholder="Party code or name"
            hint="The brand owner, registered in the Party master. Becomes a picker once that register is wired."
          />
          <TextField
            name="agreementReference"
            label="Agreement reference"
            maxLength={64}
            placeholder="JW-2026-018"
          />
          <SelectField
            name="billingModel"
            label="Billing model"
            required
            options={BILLING_MODEL_OPTIONS}
            placeholder="Choose a billing model…"
            wide
            hint="Decides whose material is consumed and what the invoice is raised on."
          />
          <TextField
            name="conversionChargeRate"
            label="Conversion charge rate (₹)"
            type="number"
            min="0"
            step="0.01"
            hint="Charged on conversion and packing, not on the value of the goods."
          />
          <SelectField
            name="conversionRateBasis"
            label="Rate charged"
            options={RATE_BASIS_OPTIONS}
            placeholder="Choose a basis…"
          />
          <TextField name="validFrom" label="Valid from" type="date" />
          <TextField name="validTo" label="Valid until" type="date" />
        </FormGrid>
      </FormSection>

      <FormSection
        title="Product-to-brand mapping"
        description="Links one of our formulations to the principal's brand name and pack design. One line per product covered by this agreement."
      >
        <LineList>
          {mappings.ids.map((id, index) => (
            <LineRow
              key={id}
              index={index}
              canRemove={mappings.ids.length > 1}
              onRemove={() => mappings.remove(id)}
            >
              <TextField
                name={`mapping.${id}.bomCode`}
                label="Our formulation"
                compact
                required
                maxLength={32}
                placeholder="FG-0142 v1"
              />
              <TextField
                name={`mapping.${id}.principalBrand`}
                label="Principal's brand name"
                compact
                required
                maxLength={255}
                placeholder="Dolotab 500"
              />
              <TextField
                name={`mapping.${id}.packDesign`}
                label="Pack design reference"
                compact
                maxLength={64}
                placeholder="ART-DOLO-500-10x10"
              />
            </LineRow>
          ))}
        </LineList>
        <AddLineButton onClick={mappings.add}>+ Add product mapping</AddLineButton>
      </FormSection>

      <FormActions label="Save agreement" />
    </form>
  );
}
