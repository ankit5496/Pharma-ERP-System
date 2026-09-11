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
 * 6. Packaging Requirement Master — US-MD-06
 *
 * Held per pack variant, not per product: the same tablet in a 10x10 blister
 * carton and in a 500-count jar needs a completely different component list,
 * and folding them into one record makes every shortage check ambiguous.
 *
 * The mandatory flag is the field that does real work. Short of a carton, the
 * line stops; short of an outer shipper, it can usually run and be shipped
 * later. Recording which is which is what lets the system block one and only
 * warn on the other.
 */

const PACKAGING_LEVEL_OPTIONS = [
  { value: 'PRIMARY', label: 'Primary — touches the product' },
  { value: 'SECONDARY', label: 'Secondary — carton, insert' },
  { value: 'TERTIARY', label: 'Tertiary — shipper, pallet' },
] as const;

const QUANTITY_BASIS_OPTIONS = [
  { value: 'PER_PACK', label: 'per pack' },
  { value: 'PER_BATCH', label: 'per batch' },
] as const;

const REQUIREMENT_OPTIONS = [
  { value: 'MANDATORY', label: 'Mandatory — block if short' },
  { value: 'OPTIONAL', label: 'Optional — warn if short' },
] as const;

export function PackagingRequirementMasterForm() {
  const components = useLineRows(2);

  return (
    <form onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-8">
      <NotWiredNotice>
        There is no packaging-requirement table yet, and nothing checks these quantities at packing.
        This form is the specification for both.
      </NotWiredNotice>

      <FormSection title="Pack">
        <FormGrid>
          <TextField
            name="finishedProduct"
            label="Finished product"
            required
            maxLength={32}
            placeholder="FG-0142"
            hint="Item code of the product being packed."
          />
          <TextField
            name="packVariant"
            label="Pack variant"
            required
            maxLength={128}
            placeholder="10 x 10 blister carton"
            hint="One record per variant — a strip and a bottle of the same product need separate component lists."
          />
        </FormGrid>
      </FormSection>

      <FormSection
        title="Packaging components"
        description="Caps, labels, cartons, inserts, shippers — everything the pack consumes, and whether the line may run without it."
      >
        <LineList>
          {components.ids.map((id, index) => (
            <LineRow
              key={id}
              index={index}
              columns={4}
              canRemove={components.ids.length > 1}
              onRemove={() => components.remove(id)}
            >
              <TextField
                name={`component.${id}.itemCode`}
                label="Component"
                compact
                required
                maxLength={32}
                placeholder="PM-0007"
              />
              <SelectField
                name={`component.${id}.level`}
                label="Level"
                compact
                required
                options={PACKAGING_LEVEL_OPTIONS}
                placeholder="Level…"
              />
              <TextField
                name={`component.${id}.quantity`}
                label="Quantity"
                compact
                required
                type="number"
                min="0"
                step="0.001"
              />
              <SelectField
                name={`component.${id}.quantityBasis`}
                label="Charged"
                compact
                required
                options={QUANTITY_BASIS_OPTIONS}
                placeholder="Basis…"
              />
              <SelectField
                name={`component.${id}.requirement`}
                label="If short at packing"
                compact
                required
                options={REQUIREMENT_OPTIONS}
                placeholder="Block or warn…"
              />
            </LineRow>
          ))}
        </LineList>
        <AddLineButton onClick={components.add}>+ Add packaging component</AddLineButton>
      </FormSection>

      <FormActions label="Save packaging requirement" />
    </form>
  );
}
