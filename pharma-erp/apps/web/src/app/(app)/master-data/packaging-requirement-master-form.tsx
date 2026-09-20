'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  PACKAGING_COMPONENT_REQUIREMENT_DESCRIPTIONS,
  PACKAGING_COMPONENT_REQUIREMENT_LABELS,
  PACKAGING_LEVEL_DESCRIPTIONS,
  PACKAGING_LEVEL_LABELS,
  PACKAGING_QUANTITY_BASIS_LABELS,
  type ItemSummary,
  type PackagingComponentRequirement,
  type PackagingLevel,
  type PackagingQuantityBasis,
  type PackagingRequirementView,
} from '@pharma-erp/types';

import { savePackagingAction, type ActionResult } from './actions';
import {
  AddLineButton,
  CheckboxField,
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
 * 6. Packaging Requirement Master — US-MD-06
 *
 * Held per pack variant, not per product: the same tablet in a 10x10 blister
 * carton and in a 500-count jar needs a completely different component list,
 * and folding them into one record makes every shortage check ambiguous.
 *
 * Two fields do the real work:
 *
 *   UNITS PER PACK is what makes a per-pack quantity scalable. A batch of
 *   100,000 tablets needs 1,000 cartons only because something records that a
 *   carton holds 100. Without it the availability check cannot run at all.
 *
 *   IF SHORT AT PACKING decides whether a shortage stops the line. Short of a
 *   carton, packing halts; short of an outer shipper, it can usually run and be
 *   shipped later. Recording which is which is what lets the system block one
 *   and merely warn on the other.
 *
 * Components are PICKED and restricted to packing materials — a pack is made of
 * packing materials, and the formulation is where raw materials belong.
 */

const LEVEL_OPTIONS = (Object.keys(PACKAGING_LEVEL_LABELS) as PackagingLevel[]).map((key) => ({
  value: key,
  label: `${PACKAGING_LEVEL_LABELS[key]} — ${PACKAGING_LEVEL_DESCRIPTIONS[key]}`,
}));

const BASIS_OPTIONS = (
  Object.keys(PACKAGING_QUANTITY_BASIS_LABELS) as PackagingQuantityBasis[]
).map((key) => ({ value: key, label: PACKAGING_QUANTITY_BASIS_LABELS[key] }));

const REQUIREMENT_OPTIONS = (
  Object.keys(PACKAGING_COMPONENT_REQUIREMENT_LABELS) as PackagingComponentRequirement[]
).map((key) => ({
  value: key,
  label: `${PACKAGING_COMPONENT_REQUIREMENT_LABELS[key]} — ${PACKAGING_COMPONENT_REQUIREMENT_DESCRIPTIONS[key]}`,
}));

/** The fields this form marks; see FormError in ./form-kit. */
const MARKED_FIELDS = ['productId', 'packVariant', 'unitsPerPack'] as const;

const INITIAL: ActionResult = { ok: false };

export function PackagingRequirementMasterForm({
  requirement,
  items,
  onSaved,
}: {
  requirement?: PackagingRequirementView;
  items: readonly ItemSummary[];
  /** Called with the confirmation line, so the workspace can show it. */
  onSaved?: (message?: string) => void;
}) {
  const [state, formAction, isPending] = useActionState(
    savePackagingAction.bind(null, requirement?.id ?? null),
    INITIAL,
  );
  const router = useRouter();

  // ONE empty line on a new record, not two — "+ Add packaging component" is
  // right there, and an unwanted second line has to be removed by hand. Editing
  // still opens with a row per existing component.
  const components = useLineRows(Math.max(requirement?.lines.length ?? 0, 1));

  // Dropdowns are CONTROLLED. React 19 resets an uncontrolled form once its
  // action resolves, and a <select> does not pick up a changed defaultValue on
  // that reset the way an <input> does — so a rejected save would come back
  // with every text field preserved and every dropdown blank. With four
  // dropdowns per component line, this form is the worst place for that.
  const [productId, setProductId] = useState(requirement?.product.id ?? '');
  const [rows, setRows] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(
      (requirement?.lines ?? []).map((line, index) => [
        String(index),
        {
          itemId: line.item.id,
          level: line.level,
          quantityBasis: line.quantityBasis,
          requirement: line.requirement,
        },
      ]),
    ),
  );

  useEffect(() => {
    if (!state.ok) return;

    router.refresh();
    onSaved?.(state.message);
  }, [state.ok, state.message, router, onSaved]);

  // Re-seed from what was submitted whenever a save comes back refused.
  useEffect(() => {
    const values = state.values;
    if (!values) return;

    setProductId(values.productId ?? '');

    const next: Record<string, Record<string, string>> = {};
    for (const [key, value] of Object.entries(values)) {
      const match = /^component\.(\d+)\.(itemId|level|quantityBasis|requirement)$/.exec(key);
      if (!match) continue;
      const row = match[1]!;
      next[row] = { ...(next[row] ?? {}), [match[2]!]: value };
    }
    setRows(next);
  }, [state]);

  const typed = (field: string, stored?: string | number | null) =>
    state.values?.[field] ?? (stored === null || stored === undefined ? undefined : String(stored));

  /** The refusal about one control, when the save named it. */
  const errorFor = (field: string) => state.fieldErrors?.[field];

  const cell = (row: number, field: string, fallback?: string) =>
    rows[String(row)]?.[field] ?? fallback ?? '';

  const products = items.filter((item) => item.type === 'FINISHED_GOOD');
  const packingMaterials = items.filter((item) => item.type === 'PACKING_MATERIAL');

  // Newest first: the closed picklist offers the most recent few, and the
  // record somebody is reaching for is usually the one just added.
  const byNewest = (a: ItemSummary, b: ItemSummary) => b.createdAt.localeCompare(a.createdAt);

  const productOptions = [...products].sort(byNewest).map((item) => ({
    value: item.id,
    label: `${item.code} — ${item.name}`,
  }));

  const componentOptions = [...packingMaterials].sort(byNewest).map((item) => ({
    value: item.id,
    label: `${item.code} — ${item.name} (${item.uom})`,
  }));

  const unitOfProduct = products.find((item) => item.id === productId)?.uom;

  return (
    <form action={formAction} className="flex flex-col gap-8" noValidate>
      {!state.ok && state.message && (
        <FormError
          message={state.message}
          fieldErrors={state.fieldErrors}
          shownFields={MARKED_FIELDS}
        />
      )}

      {(products.length === 0 || packingMaterials.length === 0) && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {products.length === 0 && packingMaterials.length === 0
            ? 'There are no finished goods and no packing materials in the item master yet. Add both under Item / Product before specifying a pack.'
            : products.length === 0
              ? 'There are no finished goods in the item master yet. A pack specification is for a product that gets packed.'
              : 'There are no packing materials in the item master yet. Add the cartons, foil and labels under Item / Product first.'}
        </p>
      )}

      <FormSection title="Pack">
        <FormGrid>
          {/* On an edit the product is shown, not offered. A specification is
              FOR a product, and the update endpoint does not accept a new one —
              moving it would silently re-point every shortage check that ever
              cited it. A disabled dropdown would imply it might be changeable. */}
          {requirement ? (
            <TextField
              name="productLabel"
              label="Finished product"
              readOnly
              defaultValue={`${requirement.product.code} — ${requirement.product.name}`}
              hint="Fixed once created. Retire this specification and write one for the other product."
            />
          ) : (
            <SelectField
              name="productId"
              error={errorFor('productId')}
              label="Finished product"
              required
              options={productOptions}
              searchable
              value={productId}
              onChange={setProductId}
              hint="Only finished goods appear here."
            />
          )}
          <TextField
            name="packVariant"
            error={errorFor('packVariant')}
            label="Pack variant"
            required
            maxLength={128}
            placeholder="10 x 10 blister carton"
            defaultValue={typed('packVariant', requirement?.packVariant)}
            hint="One record per variant — a strip and a bottle of the same product need separate component lists."
          />
          <TextField
            name="unitsPerPack"
            error={errorFor('unitsPerPack')}
            label="Units per pack"
            required
            type="number"
            min="0.001"
            step="0.001"
            defaultValue={typed('unitsPerPack', requirement?.unitsPerPack)}
            hint={`How many${unitOfProduct ? ` ${unitOfProduct}` : ''} one pack holds — 100 for a 10x10 carton. This is what scales a per-pack quantity to a batch.`}
          />
          <CheckboxField
            name="isActive"
            label="Active"
            defaultChecked={requirement ? requirement.isActive : true}
            hint="A work order cannot be raised for a product with no active pack specification. Deactivate a superseded pack rather than deleting it."
          />
        </FormGrid>
      </FormSection>

      <FormSection
        title="Packaging components"
        description="Caps, labels, cartons, inserts, shippers — everything the pack consumes, and whether the line may run without it."
      >
        <LineList>
          {components.ids.map((id, index) => {
            const existing = requirement?.lines[index];

            return (
              <LineRow
                key={id}
                index={index}
                columns={4}
                canRemove={components.ids.length > 1}
                onRemove={() => components.remove(id)}
              >
                <SelectField
                  name={`component.${id}.itemId`}
                  label="Component"
                  compact
                  required
                  options={componentOptions}
                  searchable
                  value={cell(id, 'itemId', existing?.item.id)}
                  onChange={(value) =>
                    setRows((current) => ({
                      ...current,
                      [String(id)]: { ...(current[String(id)] ?? {}), itemId: value },
                    }))
                  }
                />
                <SelectField
                  name={`component.${id}.level`}
                  label="Level"
                  compact
                  required
                  options={LEVEL_OPTIONS}
                  value={cell(id, 'level', existing?.level)}
                  onChange={(value) =>
                    setRows((current) => ({
                      ...current,
                      [String(id)]: { ...(current[String(id)] ?? {}), level: value },
                    }))
                  }
                  placeholder="Level…"
                />
                <TextField
                  name={`component.${id}.quantityPer`}
                  label="Quantity"
                  compact
                  required
                  type="number"
                  min="0.001"
                  step="0.001"
                  defaultValue={typed(`component.${id}.quantityPer`, existing?.quantityPer)}
                />
                <SelectField
                  name={`component.${id}.quantityBasis`}
                  label="Charged"
                  compact
                  required
                  options={BASIS_OPTIONS}
                  value={cell(id, 'quantityBasis', existing?.quantityBasis)}
                  onChange={(value) =>
                    setRows((current) => ({
                      ...current,
                      [String(id)]: { ...(current[String(id)] ?? {}), quantityBasis: value },
                    }))
                  }
                  placeholder="Basis…"
                />
                <SelectField
                  name={`component.${id}.requirement`}
                  label="If short at packing"
                  compact
                  required
                  options={REQUIREMENT_OPTIONS}
                  value={cell(id, 'requirement', existing?.requirement)}
                  onChange={(value) =>
                    setRows((current) => ({
                      ...current,
                      [String(id)]: { ...(current[String(id)] ?? {}), requirement: value },
                    }))
                  }
                  placeholder="Block or warn…"
                />
              </LineRow>
            );
          })}
        </LineList>
        <AddLineButton onClick={components.add}>+ Add packaging component</AddLineButton>
      </FormSection>

      <FormSection
        title="Notes"
        description="Anything the next person needs — artwork references, special handling at packing."
      >
        <TextAreaField
          name="notes"
          label="Notes"
          rows={3}
          defaultValue={typed('notes', requirement?.notes)}
        />
      </FormSection>

      <SubmitActions
        label={requirement ? 'Save pack specification' : 'Add pack specification'}
        pending={isPending}
        onCancel={onSaved}
      />
    </form>
  );
}
