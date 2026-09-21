'use client';

import { useActionState, useEffect, useState } from 'react';

import { useActionToast } from '@/components/toast';
import { useRouter } from 'next/navigation';
import {
  GST_RATES,
  ITEM_TYPE_LABELS,
  SCHEDULE_CLASSIFICATION_HINTS,
  SCHEDULE_CLASSIFICATION_LABELS,
  type ItemSummary,
  type ItemType,
  type ScheduleClassification,
} from '@pharma-erp/types';

import { saveItemAction, type ActionResult } from './actions';
import {
  CheckboxField,
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

/**
 * Built from ITEM_TYPE_LABELS rather than spelled out again.
 *
 * This list used to be its own copy of the same four categories, which is how
 * the item master came to say "Raw material" while everything reading the
 * shared map said something else. One definition, in the types package, so a
 * change to the wording reaches every screen at once.
 */
const CATEGORY_OPTIONS = (Object.keys(ITEM_TYPE_LABELS) as ItemType[]).map((value) => ({
  value,
  label: ITEM_TYPE_LABELS[value],
}));

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
  /** Called with the confirmation line, so the workspace can show it. */
  onSaved?: (message?: string) => void;
}) {
  const [state, formAction, isPending] = useActionState(
    saveItemAction.bind(null, item?.id ?? null),
    INITIAL,
  );

  // The result is announced by the application-wide centred toast rather
  // than by a banner inside this form, which on a form this long sat above
  // the fold while the submit button being watched was below it.
  // ERRORS ONLY. A success is confirmed by the workspace's SavedDialog, and a
  // toast as well would be the same news twice — once in a box to dismiss and
  // once in a strip that fades.
  useActionToast(isPending, 'error', state.ok ? undefined : state.message);
  const router = useRouter();

  // Controlled dropdowns. React 19 resets an uncontrolled form once its action
  // resolves, and a <select> does not pick up a changed defaultValue on that
  // reset the way an <input> does — so a rejected save came back with the text
  // preserved and every dropdown blank. See SelectField.
  const [category, setCategory] = useState<string>(item?.type ?? '');
  const [schedule, setSchedule] = useState<string>(item?.scheduleClassification ?? 'NONE');
  const [uom, setUom] = useState<string>(item?.uom ?? '');
  const [gstRate, setGstRate] = useState<string>(
    item?.gstRate === null || item?.gstRate === undefined ? '' : String(item.gstRate),
  );

  // Every fallback keeps what is already selected rather than blanking it: a
  // refusal about one field must not clear the answers to three others.
  //
  // `||`, NOT `??`. The action captures every submitted field including the
  // blank ones, so an unanswered dropdown arrives as '' rather than undefined —
  // and `'' ?? current` keeps the empty string, which is exactly the reset this
  // effect exists to prevent. `||` treats '' as "no answer" and holds what is
  // on screen. The same mistake is why the first attempt at this fix changed
  // nothing.
  useEffect(() => {
    const values = state.values;
    if (!values) return;

    setCategory((current) => values.category || current);
    setSchedule((current) => values.scheduleClassification || current);
    setUom((current) => values.uom || current);
    setGstRate((current) => values.gstRate || current);
  }, [state]);

  useEffect(() => {
    if (!state.ok) return;

    // The grid is rendered from data the route fetched, so the change only
    // appears once the server component re-runs. `refresh` does that without
    // a full navigation, which would lose the selected register.
    router.refresh();
    onSaved?.(state.message);
  }, [state.ok, state.message, router, onSaved]);

  /**
   * What to show in a field: whatever was typed on a rejected attempt, then
   * the item being edited, then nothing. In that order — a refusal must not
   * throw away the correction someone just made and hand back the stored
   * value instead.
   */
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
            error={errorFor('category')}
            label="Category"
            required
            options={CATEGORY_OPTIONS}
            value={category}
            onChange={setCategory}
          />
          {/* THE GENERIC NAME IS THE REQUIRED ONE, and the brand is optional.

              It used to be "one or the other", which meant neither could carry
              a star and the rule only appeared once a save was refused for it.
              Making the composition the required half is also the sounder
              rule: every item has one — lactose has no brand, a carton has no
              brand — and it is the composition that must appear on the label. */}
          <TextField
            name="brandName"
            error={errorFor('brandName')}
            label="Brand name"
            maxLength={255}
            placeholder="Calpol 500"
            defaultValue={typed('brandName', item?.brandName)}
            hint="Finished goods only. A raw or packing material has no brand."
          />
          <TextField
            name="genericName"
            error={errorFor('genericName')}
            label="Generic name / composition"
            required
            maxLength={512}
            placeholder="Paracetamol IP 500 mg"
            defaultValue={typed('genericName', item?.genericName)}
            hint="The actual composition, as it must appear on the label."
          />
          <SelectField
            name="scheduleClassification"
            label="Schedule classification"
            options={SCHEDULE_OPTIONS}
            value={schedule}
            onChange={setSchedule}
            // No `--None--` above the list: `NONE — General / OTC` is already
            // in it, and it is a real classification rather than the absence
            // of one. Two ways to say "unscheduled", one of which the API
            // rejects, is one too many.
            placeholder={null}
            hint="Decides what the sale of this item legally requires."
          />
          <SelectField
            name="uom"
            error={errorFor('uom')}
            label="Unit of measure"
            required
            options={UOM_OPTIONS}
            value={uom}
            onChange={setUom}
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
            error={errorFor('hsnCode')}
            label="HSN code"
            required
            inputMode="numeric"
            maxLength={8}
            // The API requires `/^[0-9]{4,8}$/`. `maxLength` alone stopped a
            // NINTH digit and nothing else, so "3004ab" reached the server and
            // came back refused — a round trip to learn something the control
            // could refuse outright. The LENGTH is still the server's to judge:
            // blocking a short value mid-typing would refuse "300" on its way
            // to "30049099".
            digitsOnly
            placeholder="30049099"
            defaultValue={typed('hsnCode', item?.hsnCode)}
            hint="4 to 8 digits. Most formulations sit under 3004."
          />
          <SelectField
            name="gstRate"
            error={errorFor('gstRate')}
            label="GST rate"
            required
            options={GST_RATE_OPTIONS}
            value={gstRate}
            onChange={setGstRate}
          />
          <TextField
            name="mrp"
            error={errorFor('mrp')}
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
