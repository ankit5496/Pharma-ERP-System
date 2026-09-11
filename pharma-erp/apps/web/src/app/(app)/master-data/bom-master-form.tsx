'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ITEM_TYPE_LABELS, type ItemSummary } from '@pharma-erp/types';

import { saveBomAction, type ActionResult } from './actions';
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
 * 3. BOM / Formulation Master — US-MD-03
 *
 * Quantities are stated against a reference batch size rather than per unit,
 * because that is how a formulation is written and how it is scaled: a work
 * order for half the reference size takes half of every line. Recording
 * per-unit quantities instead forces a division at entry time, and the
 * rounding error that introduces lands in the batch record.
 *
 * CREATE ONLY. There is no edit, and that is the point: a batch made last
 * month was made to the recipe as it stood then, so a change is a new version
 * and the old one survives because production orders still point at it. The
 * version number is the API's to choose, which is why this form has no
 * version field.
 *
 * Materials are PICKED, not typed. The lines carry an item id, and the unit
 * comes from the item itself — so a quantity can never be entered in kg
 * against something measured in tablets.
 */

const INITIAL: ActionResult = { ok: false };

export function BomMasterForm({
  items,
  onSaved,
}: {
  items: readonly ItemSummary[];
  onSaved?: () => void;
}) {
  const [state, formAction, isPending] = useActionState(saveBomAction, INITIAL);
  const router = useRouter();

  const rawMaterials = useLineRows(2);
  const packingMaterials = useLineRows(1);

  // Which item each line points at, so the unit beside its quantity is the
  // item's own — and so the batch-size unit follows the product.
  const [productId, setProductId] = useState('');
  const [lineItems, setLineItems] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!state.ok) return;

    router.refresh();
    onSaved?.();
  }, [state.ok, router, onSaved]);

  const byId = new Map(items.map((item) => [item.id, item]));
  const uomOf = (key: string) => byId.get(lineItems[key] ?? '')?.uom;

  const products = items.filter((item) => item.type === 'FINISHED_GOOD');
  // Semi-finished counts as a raw material here: it is something consumed to
  // make something else, which is the only distinction this section draws.
  const rawOptions = toOptions(
    items.filter((item) => item.type === 'RAW_MATERIAL' || item.type === 'SEMI_FINISHED'),
  );
  const packOptions = toOptions(items.filter((item) => item.type === 'PACKING_MATERIAL'));

  const typed = (field: string) => state.values?.[field];

  if (products.length === 0) {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
        There are no finished goods in the item register yet, so there is nothing to write a
        formulation for. Add one under <strong className="font-semibold">Item / Product</strong>{' '}
        first.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-8" noValidate>
      {!state.ok && state.message && <FormError message={state.message} />}

      <FormSection title="Formulation">
        <FormGrid>
          <SelectField
            name="productId"
            label="Finished product"
            required
            options={toOptions(products)}
            defaultValue={typed('productId')}
            placeholder="Choose a finished good…"
            onChange={setProductId}
            wide
            hint="Only finished goods can be made to a formulation."
          />
          <TextField
            name="outputQuantity"
            label="Reference batch size"
            required
            type="number"
            min="0"
            step="0.001"
            placeholder="100000"
            defaultValue={typed('outputQuantity')}
            hint={
              byId.get(productId)
                ? `In ${byId.get(productId)!.uom}. Every quantity below is stated against this size.`
                : 'Every quantity below is stated against this size.'
            }
          />
          <CheckboxField
            name="activate"
            label="Make this the active version"
            defaultChecked={state.values ? state.values.activate !== undefined : true}
            hint="A work order can only be raised against an active formulation, and a product has exactly one. Ticking this supersedes the previous version."
          />
          <TextAreaField
            name="instructions"
            label="Manufacturing instructions"
            rows={4}
            wide
            defaultValue={typed('instructions')}
            hint="Optional. The standard method, as it should appear on the batch record."
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
              columns={2}
              canRemove={rawMaterials.ids.length > 1}
              onRemove={() => rawMaterials.remove(id)}
            >
              <SelectField
                name={`raw.${id}.itemId`}
                label="Material"
                compact
                required
                options={rawOptions}
                defaultValue={typed(`raw.${id}.itemId`)}
                placeholder="Choose a material…"
                onChange={(value) => setLineItems((map) => ({ ...map, [`raw.${id}`]: value }))}
              />
              <TextField
                name={`raw.${id}.quantityPer`}
                label={
                  uomOf(`raw.${id}`)
                    ? `Quantity per batch (${uomOf(`raw.${id}`)})`
                    : 'Quantity per batch'
                }
                compact
                required
                type="number"
                min="0"
                step="0.001"
                defaultValue={typed(`raw.${id}.quantityPer`)}
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
        {packOptions.length === 0 ? (
          <p className="text-sm text-slate-600">
            No packing materials in the item register yet. Add one under{' '}
            <strong className="font-semibold">Item / Product</strong>, or leave this section empty.
          </p>
        ) : (
          <>
            <LineList>
              {packingMaterials.ids.map((id, index) => (
                <LineRow
                  key={id}
                  index={index}
                  columns={2}
                  canRemove={packingMaterials.ids.length > 1}
                  onRemove={() => packingMaterials.remove(id)}
                >
                  <SelectField
                    name={`pack.${id}.itemId`}
                    label="Material"
                    compact
                    options={packOptions}
                    defaultValue={typed(`pack.${id}.itemId`)}
                    placeholder="Choose a material…"
                    onChange={(value) => setLineItems((map) => ({ ...map, [`pack.${id}`]: value }))}
                  />
                  <TextField
                    name={`pack.${id}.quantityPer`}
                    label={
                      uomOf(`pack.${id}`)
                        ? `Quantity per batch (${uomOf(`pack.${id}`)})`
                        : 'Quantity per batch'
                    }
                    compact
                    type="number"
                    min="0"
                    step="0.001"
                    defaultValue={typed(`pack.${id}.quantityPer`)}
                  />
                </LineRow>
              ))}
            </LineList>
            <AddLineButton onClick={packingMaterials.add}>+ Add packing material</AddLineButton>
          </>
        )}
      </FormSection>

      <SubmitActions label="Save formulation" pending={isPending} />
    </form>
  );
}

/** Code first, because that is what people search and compare on. */
function toOptions(items: readonly ItemSummary[]) {
  return items.map((item) => ({
    value: item.id,
    label: `${item.code} — ${item.name} (${ITEM_TYPE_LABELS[item.type]})`,
  }));
}
