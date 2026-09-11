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
  UOM_OPTIONS,
  useLineRows,
} from './form-kit';

/**
 * 3. BOM / Formulation Master — US-MD-03
 *
 * Quantities are stated against a reference batch size rather than per unit,
 * because that is how a formulation is actually written and how it is scaled:
 * a production order for half the reference size takes half of every line.
 * Recording per-unit quantities instead forces a division at entry time, and
 * the rounding error that introduces lands in the batch record.
 */

export function BomMasterForm() {
  const rawMaterials = useLineRows(2);
  const packingMaterials = useLineRows(1);

  return (
    <form onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-8">
      <NotWiredNotice>
        The <code>boms</code> and <code>bom_lines</code> tables exist and the production workflow
        reads them, but this form has no create endpoint behind it yet. Nothing is stored.
      </NotWiredNotice>

      <FormSection title="Formulation">
        <FormGrid>
          <TextField
            name="finishedProduct"
            label="Finished product"
            required
            maxLength={32}
            placeholder="FG-0142"
            hint="Item code of the product being made. Becomes a picker once the Item master is wired."
          />
          <TextField
            name="version"
            label="Version"
            required
            maxLength={16}
            placeholder="v1"
            hint="Only one version of a formulation may be active at a time."
          />
          <TextField
            name="referenceBatchSize"
            label="Reference batch size"
            required
            type="number"
            min="0"
            step="0.001"
            placeholder="100000"
            hint="Every quantity below is stated against this size."
          />
          <SelectField
            name="referenceBatchUom"
            label="Batch size unit"
            required
            options={UOM_OPTIONS}
          />
        </FormGrid>
      </FormSection>

      <FormSection
        title="Raw materials"
        description="Actives and excipients consumed per reference batch."
      >
        <LineList>
          {rawMaterials.ids.map((id, index) => (
            <LineRow
              key={id}
              index={index}
              canRemove={rawMaterials.ids.length > 1}
              onRemove={() => rawMaterials.remove(id)}
            >
              <TextField
                name={`rawMaterial.${id}.itemCode`}
                label="Item code"
                compact
                required
                maxLength={32}
                placeholder="RM-0031"
              />
              <TextField
                name={`rawMaterial.${id}.quantity`}
                label="Quantity per batch"
                compact
                required
                type="number"
                min="0"
                step="0.001"
              />
              <SelectField
                name={`rawMaterial.${id}.uom`}
                label="Unit"
                compact
                required
                options={UOM_OPTIONS}
                placeholder="Unit…"
              />
            </LineRow>
          ))}
        </LineList>
        <AddLineButton onClick={rawMaterials.add}>+ Add raw material</AddLineButton>
      </FormSection>

      <FormSection
        title="Packing materials"
        description="Consumed per reference batch. What goes on the line at packing is held separately, in the Packaging Requirement master."
      >
        <LineList>
          {packingMaterials.ids.map((id, index) => (
            <LineRow
              key={id}
              index={index}
              canRemove={packingMaterials.ids.length > 1}
              onRemove={() => packingMaterials.remove(id)}
            >
              <TextField
                name={`packingMaterial.${id}.itemCode`}
                label="Item code"
                compact
                required
                maxLength={32}
                placeholder="PM-0007"
              />
              <TextField
                name={`packingMaterial.${id}.quantity`}
                label="Quantity per batch"
                compact
                required
                type="number"
                min="0"
                step="0.001"
              />
              <SelectField
                name={`packingMaterial.${id}.uom`}
                label="Unit"
                compact
                required
                options={UOM_OPTIONS}
                placeholder="Unit…"
              />
            </LineRow>
          ))}
        </LineList>
        <AddLineButton onClick={packingMaterials.add}>+ Add packing material</AddLineButton>
      </FormSection>

      <FormActions label="Save formulation" />
    </form>
  );
}
