'use client';

import {
  PACKAGING_LEVELS,
  PACKAGING_LEVEL_LABELS,
  type ItemSummary,
  type PartySummary,
  type ProductionPlanSummary,
} from '@pharma-erp/types';

import { createRequisitionAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, Disclosure, Field, SubmitButton, useAction } from './form-kit';

/**
 * Create Purchase Requisition — the one place a requisition is raised by hand.
 *
 * IT CREATES EXACTLY ONE RECORD. Every select below lists master data that
 * already exists and submits its id; nothing on this form creates an item, a
 * vendor, a product or a production plan, and there is deliberately no link
 * offering to. If a list here is empty, the fix is in the relevant master, not
 * on this screen.
 *
 * The four system-generated fields — number, date, raised by, status — are
 * SHOWN BUT NOT EDITABLE, as a short summary above the inputs rather than as
 * disabled boxes. Disabled boxes read as something you failed to fill in; a
 * sentence reads as a statement about what will happen, which is what it is.
 * They are also not submitted: the API sets all four, and accepting them from
 * a browser would let a requisition pick its own number or claim the system
 * raised it.
 */
export function RequisitionForm({
  items,
  vendors,
  plans,
  raisedBy,
}: {
  items: readonly ItemSummary[];
  vendors: readonly PartySummary[];
  plans: readonly ProductionPlanSummary[];
  raisedBy: string;
}) {
  const [state, formAction] = useAction(createRequisitionAction);

  // Split by type rather than offering every item everywhere: a finished
  // product is what the material is FOR, a packaging component is part of the
  // pack, and letting either list offer an API is how wrong data gets entered
  // by people moving quickly.
  const finishedGoods = items.filter((item) => item.type === 'FINISHED_GOOD');
  const packagingItems = items.filter((item) => item.type === 'PACKING_MATERIAL');

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Disclosure label="Create purchase requisition" title="New purchase requisition">
      {() => (
        <form action={formAction} className="w-full space-y-4">
          <ActionMessage state={state} />

          {items.length === 0 && (
            <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              No items exist in the item master for this company, so there is nothing to
              requisition. Items are maintained in the Masters module.
            </p>
          )}

          {/* What the system fills in. Stated once, plainly. */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-white p-3 text-xs sm:grid-cols-4">
            <SystemField label="Requisition no." value="Generated on save" />
            <SystemField label="Date" value={today} />
            <SystemField label="Raised by" value={raisedBy} />
            <SystemField label="Status" value="Open" />
          </dl>

          <Section title="What to buy">
            <Field label="Item" htmlFor="pr-item" required hint="From the item master.">
              <select
                id="pr-item"
                name="itemId"
                required
                defaultValue={state.values?.itemId ?? ''}
                className="field-sm w-full"
              >
                <option value="">Choose an item</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} — {item.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Requested quantity"
              htmlFor="pr-qty"
              hint="Blank uses the item's configured reorder quantity."
            >
              <input
                id="pr-qty"
                name="requiredQuantity"
                inputMode="decimal"
                defaultValue={state.values?.requiredQuantity ?? ''}
                className="field-sm w-full"
              />
            </Field>

            {/* Fixed, not chosen. A requisition raised on this form is MANUAL
                by definition; AUTO_REORDER belongs to the system and letting
                a person select it would put a false trigger in the trail. */}
            <Field label="Trigger type" htmlFor="pr-trigger">
              <input
                id="pr-trigger"
                value="Manual"
                readOnly
                disabled
                className="field-sm w-full bg-slate-100 text-slate-600"
              />
              <p className="field-hint">
                Auto-reorder requisitions are raised by the system, not here.
              </p>
            </Field>

            <Field label="Preferred vendor" htmlFor="pr-vendor" hint="Optional.">
              <select
                id="pr-vendor"
                name="preferredVendorId"
                defaultValue=""
                className="field-sm w-full"
              >
                <option value="">Not specified</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Required by" htmlFor="pr-by">
              <input id="pr-by" name="requiredByDate" type="date" className="field-sm w-full" />
            </Field>
          </Section>

          <Section title="What it is for">
            <Field
              label="Linked production plan"
              htmlFor="pr-plan"
              hint={
                plans.length === 0
                  ? 'No production plans exist yet. Leave blank.'
                  : 'Optional — the run this material is for.'
              }
            >
              <select
                id="pr-plan"
                name="productionPlanId"
                defaultValue=""
                disabled={plans.length === 0}
                className="field-sm w-full"
              >
                <option value="">Not specified</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.number} — {plan.finishedProduct.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Finished product"
              htmlFor="pr-product"
              hint={
                finishedGoods.length === 0
                  ? 'No finished goods in the item master. Leave blank.'
                  : 'Optional — from the item master.'
              }
            >
              <select
                id="pr-product"
                name="finishedProductId"
                defaultValue=""
                disabled={finishedGoods.length === 0}
                className="field-sm w-full"
              >
                <option value="">Not specified</option>
                {finishedGoods.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} — {item.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Pack variant" htmlFor="pr-variant" hint="e.g. 10x10 blister.">
              <input
                id="pr-variant"
                name="packVariant"
                maxLength={128}
                defaultValue={state.values?.packVariant ?? ''}
                className="field-sm w-full"
              />
            </Field>
          </Section>

          <Section title="Packaging">
            <Field
              label="Packaging component"
              htmlFor="pr-component"
              hint={
                packagingItems.length === 0
                  ? 'No packing materials in the item master. Leave blank.'
                  : 'Optional — from the item master.'
              }
            >
              <select
                id="pr-component"
                name="packagingComponentId"
                defaultValue=""
                disabled={packagingItems.length === 0}
                className="field-sm w-full"
              >
                <option value="">Not specified</option>
                {packagingItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} — {item.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Packaging level" htmlFor="pr-level">
              <select
                id="pr-level"
                name="packagingLevel"
                defaultValue=""
                className="field-sm w-full"
              >
                <option value="">Not specified</option>
                {PACKAGING_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {PACKAGING_LEVEL_LABELS[level]}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Quantity per unit/batch"
              htmlFor="pr-per"
              hint="The rate this requirement was worked out from."
            >
              <input
                id="pr-per"
                name="quantityPerUnit"
                inputMode="decimal"
                defaultValue={state.values?.quantityPerUnit ?? ''}
                className="field-sm w-full"
              />
            </Field>

            {/* Mandatory is the default, and the safe reading: a component
                marked optional can be dropped from an order. */}
            <Field label="Mandatory or optional" htmlFor="pr-mandatory">
              <select
                id="pr-mandatory"
                name="isMandatory"
                defaultValue="true"
                className="field-sm w-full"
              >
                <option value="true">Mandatory</option>
                <option value="false">Optional</option>
              </select>
            </Field>
          </Section>

          <Field label="Notes" htmlFor="pr-notes">
            <input
              id="pr-notes"
              name="notes"
              maxLength={1000}
              defaultValue={state.values?.notes ?? ''}
              className="field-sm w-full"
            />
          </Field>

          <SubmitButton pendingLabel="Creating…">Create purchase requisition</SubmitButton>
        </form>
      )}
    </Disclosure>
  );
}

function SystemField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}
