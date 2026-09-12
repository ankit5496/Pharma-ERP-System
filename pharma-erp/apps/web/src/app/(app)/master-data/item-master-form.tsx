'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  GST_RATES,
  SCHEDULE_CLASSIFICATION_HINTS,
  SCHEDULE_CLASSIFICATION_LABELS,
  type ItemSummary,
  type ScheduleClassification,
} from '@pharma-erp/types';

import { saveItemAction, type ActionResult } from './actions';
import {
  CheckboxField,
  FormError,
  FormGrid,
  FormSection,
  SelectField,
  SubmitActions,
  TextField,
  UOM_OPTIONS,
} from './form-kit';

/**
 * 1. Item / Product Master — US-MD-01
 *
 * Every other register points at this one: a BOM line, a packaging component
 * and a purchase order all name an item, so this is the register to get right
 * first. It is also the only one wired to a real endpoint today.
 */

const CATEGORY_OPTIONS = [
  { value: 'RAW_MATERIAL', label: 'Raw material' },
  { value: 'PACKING_MATERIAL', label: 'Packing material' },
  { value: 'SEMI_FINISHED', label: 'Semi-finished' },
  { value: 'FINISHED_GOOD', label: 'Finished good' },
] as const;

const SCHEDULE_OPTIONS = (
  Object.keys(SCHEDULE_CLASSIFICATION_LABELS) as ScheduleClassification[]
).map((key) => ({
  value: key,
  label: `${SCHEDULE_CLASSIFICATION_LABELS[key]} — ${SCHEDULE_CLASSIFICATION_HINTS[key]}`,
}));

const GST_RATE_OPTIONS = GST_RATES.map((rate) => ({ value: rate, label: `${rate}%` }));

const INITIAL: ActionResult = { ok: false };

export function ItemMasterForm({
  item,
  onSaved,
}: {
  /** Present when editing; absent when creating. */
  item?: ItemSummary;
  onSaved?: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    saveItemAction.bind(null, item?.id ?? null),
    INITIAL,
  );
  const router = useRouter();

  useEffect(() => {
    if (!state.ok) return;

    // The grid is rendered from data the route fetched, so the change only
    // appears once the server component re-runs. `refresh` does that without
    // a full navigation, which would lose the selected register.
    router.refresh();
    onSaved?.();
  }, [state.ok, router, onSaved]);

  /**
   * What to show in a field: whatever was typed on a rejected attempt, then
   * the item being edited, then nothing. In that order — a refusal must not
   * throw away the correction someone just made and hand back the stored
   * value instead.
   */
  const typed = (field: string, stored?: string | number | null) =>
    state.values?.[field] ?? (stored === null || stored === undefined ? undefined : String(stored));

  return (
    <form action={formAction} className="flex flex-col gap-8" noValidate>
      {!state.ok && state.message && <FormError message={state.message} />}

      <FormSection title="Identity">
        <FormGrid>
          <TextField
            name="code"
            label="Item code"
            required
            maxLength={64}
            placeholder="FG-0142"
            defaultValue={typed('code', item?.code)}
            readOnly={Boolean(item)}
            hint={
              item
                ? 'Fixed once created — it is printed on every document that already cites this item.'
                : 'Short, unique, and never reused — it appears on every document that cites this item.'
            }
          />
          <SelectField
            name="category"
            label="Category"
            required
            options={CATEGORY_OPTIONS}
            defaultValue={typed('category', item?.type)}
            placeholder="Choose a category…"
          />
          <TextField
            name="brandName"
            label="Brand name"
            maxLength={255}
            placeholder="Calpol 500"
            defaultValue={typed('brandName', item?.brandName)}
            hint="Finished goods only. A raw or packing material has no brand — give it a generic name instead."
          />
          <TextField
            name="genericName"
            label="Generic name / composition"
            maxLength={512}
            placeholder="Paracetamol IP 500 mg"
            defaultValue={typed('genericName', item?.genericName)}
            hint="The actual composition, as it must appear on the label."
          />
          <SelectField
            name="scheduleClassification"
            label="Schedule classification"
            options={SCHEDULE_OPTIONS}
            defaultValue={typed('scheduleClassification', item?.scheduleClassification) ?? 'NONE'}
            placeholder="Choose a schedule…"
            hint="Decides what the sale of this item legally requires."
          />
          <SelectField
            name="uom"
            label="Unit of measure"
            required
            options={UOM_OPTIONS}
            defaultValue={typed('uom', item?.uom)}
          />
        </FormGrid>
      </FormSection>

      <FormSection
        title="Tax and pricing"
        description="HSN and GST are required on every item — an invoice cannot be raised without them."
      >
        <FormGrid>
          <TextField
            name="hsnCode"
            label="HSN code"
            required
            inputMode="numeric"
            maxLength={8}
            placeholder="30049099"
            defaultValue={typed('hsnCode', item?.hsnCode)}
            hint="4 to 8 digits. Most formulations sit under 3004."
          />
          <SelectField
            name="gstRate"
            label="GST rate"
            required
            options={GST_RATE_OPTIONS}
            defaultValue={typed('gstRate', item?.gstRate)}
            placeholder="Choose a rate…"
          />
          <TextField
            name="mrp"
            label="MRP (₹)"
            type="number"
            min="0"
            step="0.01"
            placeholder="32.50"
            defaultValue={typed('mrp', item?.mrp)}
            hint="Maximum retail price, inclusive of tax."
          />
          <CheckboxField
            name="dpcoCeiling"
            label="Falls under a DPCO ceiling price"
            defaultChecked={
              state.values ? state.values.dpcoCeiling !== undefined : (item?.dpcoCeiling ?? false)
            }
            hint="Scheduled formulations cannot be priced above the NPPA ceiling. The database refuses this without an MRP, since a ceiling on no price means nothing."
          />
        </FormGrid>
      </FormSection>

      <FormSection title="Stock and shelf life">
        <FormGrid>
          <TextField
            name="storageConditions"
            label="Storage conditions"
            maxLength={255}
            placeholder="Store below 25 °C, protect from light and moisture"
            defaultValue={typed('storageConditions', item?.storageConditions)}
            wide
          />
          <TextField
            name="reorderLevel"
            label="Reorder level"
            type="number"
            min="0"
            step="0.001"
            defaultValue={typed('reorderLevel', item?.reorderLevel)}
            hint="Stock falling to this triggers a purchase alert."
          />
          <TextField
            name="reorderQuantity"
            label="Reorder quantity"
            type="number"
            min="0"
            step="0.001"
            defaultValue={typed('reorderQuantity', item?.reorderQuantity)}
            hint="How much to order when it does."
          />
          <TextField
            name="shelfLifeMonths"
            label="Shelf-life (months)"
            type="number"
            min="1"
            step="1"
            placeholder="36"
            defaultValue={typed('shelfLifeMonths', item?.shelfLifeMonths)}
            hint="Batch expiry is computed from this and the date of manufacture."
          />
        </FormGrid>
      </FormSection>

      <SubmitActions label={item ? 'Save changes' : 'Save item'} pending={isPending} />
    </form>
  );
}
