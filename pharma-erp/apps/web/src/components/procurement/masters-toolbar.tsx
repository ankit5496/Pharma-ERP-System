'use client';

import {
  ITEM_TYPES,
  UNITS_OF_MEASURE,
  UNIT_LABELS,
  type ItemSummary,
  type PartySummary,
} from '@pharma-erp/types';

import {
  createItemAction,
  createRequisitionAction,
  createVendorAction,
} from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, Disclosure, Field, SubmitButton, useAction } from './form-kit';

/**
 * Add an item, add a vendor, raise a requisition for anything.
 *
 * The low-stock panel covers the normal trigger — stock fell below the reorder
 * level — but three cases fall outside it and would otherwise have no route
 * at all: setting the system up from empty, adding a new material, and buying
 * something ahead of a shortage. Grouped into one toolbar rather than given a
 * masters screen of their own, which belongs with the Masters module when it
 * is built.
 */
export function MastersToolbar({
  items,
  vendors,
}: {
  items: readonly ItemSummary[];
  vendors: readonly PartySummary[];
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <AddVendor />
      <AddItem />
      <RaiseAnyRequisition items={items} vendors={vendors} />
    </div>
  );
}

function AddVendor() {
  const [state, formAction] = useAction(createVendorAction);

  return (
    <Disclosure label="Add vendor" title="New vendor">
      {() => (
        <form action={formAction} className="w-[min(30rem,80vw)] space-y-3">
          <ActionMessage state={state} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code" htmlFor="v-code" required>
              <input
                id="v-code"
                name="code"
                required
                maxLength={64}
                placeholder="VEN-001"
                defaultValue={state.values?.code ?? ''}
                className="field-sm w-full"
              />
            </Field>

            <Field label="Name" htmlFor="v-name" required>
              <input
                id="v-name"
                name="name"
                required
                maxLength={255}
                defaultValue={state.values?.name ?? ''}
                className="field-sm w-full"
              />
            </Field>

            <Field label="GSTIN" htmlFor="v-gstin">
              <input id="v-gstin" name="gstin" maxLength={15} className="field-sm w-full" />
            </Field>

            <Field label="Drug licence no." htmlFor="v-licence">
              <input
                id="v-licence"
                name="drugLicenceNumber"
                maxLength={64}
                className="field-sm w-full"
              />
            </Field>

            <Field label="Email" htmlFor="v-email">
              <input id="v-email" name="email" type="email" className="field-sm w-full" />
            </Field>

            <Field
              label="Payment terms (days)"
              htmlFor="v-terms"
              hint="Seeds the due date on their invoices."
            >
              <input
                id="v-terms"
                name="paymentTermsDays"
                type="number"
                min={0}
                max={365}
                defaultValue={30}
                className="field-sm w-full"
              />
            </Field>
          </div>

          <SubmitButton pendingLabel="Saving…">Add vendor</SubmitButton>
        </form>
      )}
    </Disclosure>
  );
}

function AddItem() {
  const [state, formAction] = useAction(createItemAction);

  return (
    <Disclosure label="Add item" title="New item">
      {() => (
        <form action={formAction} className="w-[min(30rem,80vw)] space-y-3">
          <ActionMessage state={state} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code" htmlFor="i-code" required>
              <input
                id="i-code"
                name="code"
                required
                maxLength={64}
                placeholder="RM-PARA-001"
                defaultValue={state.values?.code ?? ''}
                className="field-sm w-full"
              />
            </Field>

            <Field label="Name" htmlFor="i-name" required>
              <input
                id="i-name"
                name="name"
                required
                maxLength={255}
                defaultValue={state.values?.name ?? ''}
                className="field-sm w-full"
              />
            </Field>

            <Field label="Type" htmlFor="i-type">
              <select id="i-type" name="itemType" defaultValue="RAW_MATERIAL" className="field-sm w-full">
                {ITEM_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Unit" htmlFor="i-uom">
              <select id="i-uom" name="uom" defaultValue="KG" className="field-sm w-full">
                {UNITS_OF_MEASURE.map((unit) => (
                  <option key={unit} value={unit}>
                    {UNIT_LABELS[unit]}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Reorder level"
              htmlFor="i-reorder"
              required
              hint="Below this, the item appears in Low stock."
            >
              <input
                id="i-reorder"
                name="reorderLevel"
                inputMode="decimal"
                defaultValue={state.values?.reorderLevel ?? '0'}
                className="field-sm w-full"
              />
            </Field>

            <Field label="HSN code" htmlFor="i-hsn">
              <input id="i-hsn" name="hsnCode" maxLength={16} className="field-sm w-full" />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              name="requiresBatchTracking"
              defaultChecked
              className="rounded border-slate-300"
            />
            Batch tracked — batch number and expiry are mandatory on receipt
          </label>

          <SubmitButton pendingLabel="Saving…">Add item</SubmitButton>
        </form>
      )}
    </Disclosure>
  );
}

/** A requisition for any item, not only one already below its reorder level. */
function RaiseAnyRequisition({
  items,
  vendors,
}: {
  items: readonly ItemSummary[];
  vendors: readonly PartySummary[];
}) {
  const [state, formAction] = useAction(createRequisitionAction);

  return (
    <Disclosure label="Raise requisition" title="New requisition">
      {() => (
        <form action={formAction} className="w-[min(30rem,80vw)] space-y-3">
          <ActionMessage state={state} />

          <Field label="Item" htmlFor="r-item" required>
            <select id="r-item" name="itemId" required defaultValue="" className="field-sm w-full">
              <option value="">Choose an item</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Required quantity" htmlFor="r-qty" required>
              <input
                id="r-qty"
                name="requiredQuantity"
                required
                inputMode="decimal"
                defaultValue={state.values?.requiredQuantity ?? ''}
                className="field-sm w-full"
              />
            </Field>

            <Field label="Preferred vendor" htmlFor="r-vendor">
              <select id="r-vendor" name="preferredVendorId" defaultValue="" className="field-sm w-full">
                <option value="">Not specified</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Required by" htmlFor="r-by">
              <input id="r-by" name="requiredByDate" type="date" className="field-sm w-full" />
            </Field>

            <Field label="Notes" htmlFor="r-notes">
              <input
                id="r-notes"
                name="notes"
                maxLength={1000}
                defaultValue={state.values?.notes ?? ''}
                className="field-sm w-full"
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pendingLabel="Raising…">Submit for approval</SubmitButton>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" name="asDraft" className="rounded border-slate-300" />
              Save as draft
            </label>
          </div>
        </form>
      )}
    </Disclosure>
  );
}
