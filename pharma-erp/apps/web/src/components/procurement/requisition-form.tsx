'use client';

import { useState } from 'react';

import {
  type ItemSummary,
  type ProductionPlanSummary,
} from '@pharma-erp/types';

import { createRequisitionAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { SearchableSelect } from './searchable-select';

import { ActionMessage, Disclosure, Field, FormFooter, SubmitButton, useAction } from './form-kit';

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
  plans,
  raisedBy,
}: {
  items: readonly ItemSummary[];
  plans: readonly ProductionPlanSummary[];
  raisedBy: string;
}) {
  const [state, formAction] = useAction(createRequisitionAction);

  /**
   * What each lookup currently holds.
   *
   * A searchable lookup is a controlled control — it posts through a hidden
   * input — so the chosen id has to live somewhere. Seeded from the last
   * attempt's values, so a rejected submit does not empty the boxes.
   */
  const [itemId, setItemId] = useState(state.values?.itemId ?? '');
  const [planId, setPlanId] = useState('');

  /** An item as a lookup row: the code is what people search by. */
  const itemOption = (item: ItemSummary) => ({
    value: item.id,
    label: item.name,
    hint: item.code,
  });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Disclosure
      label="Create purchase requisition"
      title="New purchase requisition"
      subtitle="Raised against master data that already exists. Nothing here creates an item or a plan."
      closeWhen={state.status === 'success'}
    >
      {(close) => (
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
              <SearchableSelect
                id="pr-item"
                name="itemId"
                required
                options={items.map(itemOption)}
                value={itemId}
                onChange={setItemId}
                emptyLabel="Select item"
              />
            </Field>

            {/* NO DEFAULT. It used to fall back to the item's reorder quantity
                when left blank — a figure with no relationship to what anybody
                had ordered. Requirements come from sales orders now, and a
                person raising one by hand knows how much they want. */}
            <Field
              label="Requested quantity"
              htmlFor="pr-qty"
              required
              hint="How much to buy."
            >
              <input
                id="pr-qty"
                name="requiredQuantity"
                inputMode="decimal"
                required
                defaultValue={state.values?.requiredQuantity ?? ''}
                className="field-sm w-full"
              />
            </Field>

            {/* Fixed, not chosen. A requisition raised on this form is MANUAL
                by definition; Auto belongs to the system — it raises them from
                sales-order shortages — and letting a person select it would put
                a false trigger in the trail. */}
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
              <SearchableSelect
                id="pr-plan"
                name="productionPlanId"
                options={plans.map((plan) => ({
                  value: plan.id,
                  label: plan.number,
                  hint: plan.finishedProduct.name,
                }))}
                value={planId}
                onChange={setPlanId}
                emptyLabel="Not specified"
                disabled={plans.length === 0}
              />
            </Field>

            {/* THE PACKAGING FIELDS HAVE GONE, and their absence is the point.
                Finished product, pack variant, packaging component, packaging
                level, quantity per unit and a mandatory flag described a
                PRODUCT's packaging on a form that requests the purchase of one
                material. They belong to the Packaging Requirement master,
                which is where they are maintained and where the Required stock
                calculation reads them from.

                What the material is FOR still travels, and better: a
                requisition Auto raised carries its sales order, and the
                finished product is read back through that order line. */}
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

          <FormFooter onCancel={close}>
            <SubmitButton pendingLabel="Creating…">Create purchase requisition</SubmitButton>
          </FormFooter>
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
