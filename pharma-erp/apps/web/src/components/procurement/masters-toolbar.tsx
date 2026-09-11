'use client';

import {
  COMMON_UNITS,
  ITEM_TYPES,
  ITEM_TYPE_LABELS,
  SCHEDULE_CLASSIFICATIONS,
  SCHEDULE_LABELS,
  type ItemSummary,
  type PartySummary,
  type BomSummary,
  type ProductionPlanSummary,
} from '@pharma-erp/types';

import {
  consumeStockAction,
  createItemAction,
  createProductionPlanAction,
  createRequisitionAction,
  createVendorAction,
} from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, Disclosure, Field, SubmitButton, useAction } from './form-kit';

/**
 * The setup and manual-entry actions for Procure-to-Pay.
 *
 * Grouped into one toolbar rather than given a masters screen of their own,
 * which belongs with the Masters module when it is built. What is here is
 * what this workflow cannot function without: somewhere to define an HSN rate
 * (GST is read from it and never typed), a vendor, an item, a production plan
 * for manual requisitions to cite, and a way to move stock so the reorder
 * trigger is observable before Production exists.
 */
export function MastersToolbar({
  items,
  vendors,
  plans,
  boms,
}: {
  items: readonly ItemSummary[];
  vendors: readonly PartySummary[];
  plans: readonly ProductionPlanSummary[];
  boms: readonly BomSummary[];
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <AddVendor />
      <AddItem />
      <AddProductionPlan items={items} boms={boms} />
      <RaiseManualRequisition items={items} vendors={vendors} plans={plans} />
      <IssueStock items={items} />
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
        <form action={formAction} className="w-[min(34rem,80vw)] space-y-3">
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
              <select
                id="i-type"
                name="itemType"
                defaultValue="RAW_MATERIAL"
                className="field-sm w-full"
              >
                {ITEM_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ITEM_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Unit" htmlFor="i-uom">
              {/* Free text on the shared schema; the list is a convenience,
                  not a constraint, so the input accepts anything. */}
              <input
                id="i-uom"
                name="uom"
                list="uom-options"
                defaultValue="kg"
                maxLength={16}
                className="field-sm w-full"
              />
              <datalist id="uom-options">
                {COMMON_UNITS.map((unit) => (
                  <option key={unit} value={unit} />
                ))}
              </datalist>
            </Field>

            <Field
              label="Reorder level"
              htmlFor="i-reorder"
              required
              hint="Below this, the item is flagged low."
            >
              <input
                id="i-reorder"
                name="reorderLevel"
                inputMode="decimal"
                defaultValue={state.values?.reorderLevel ?? '0'}
                className="field-sm w-full"
              />
            </Field>

            <Field
              label="Reorder quantity"
              htmlFor="i-reorder-qty"
              required
              hint="How much to buy — not the shortfall."
            >
              <input
                id="i-reorder-qty"
                name="reorderQuantity"
                inputMode="decimal"
                defaultValue="0"
                className="field-sm w-full"
              />
            </Field>

            <Field
              label="Shelf life (months)"
              htmlFor="i-shelf"
              hint="Minimum life demanded on receipt. Blank means no rule."
            >
              <input
                id="i-shelf"
                name="shelfLifeMonths"
                type="number"
                min={1}
                max={120}
                className="field-sm w-full"
              />
            </Field>

            <Field label="HSN code" htmlFor="i-hsn">
              <input id="i-hsn" name="hsnCode" maxLength={16} className="field-sm w-full" />
            </Field>

            <Field
              label="GST %"
              htmlFor="i-gst"
              hint="Read straight off the item when invoicing. Without it the item cannot be invoiced."
            >
              <input id="i-gst" name="gstRate" inputMode="decimal" className="field-sm w-full" />
            </Field>

            <Field label="Schedule" htmlFor="i-schedule">
              <select
                id="i-schedule"
                name="scheduleClassification"
                defaultValue="NONE"
                className="field-sm w-full"
              >
                {SCHEDULE_CLASSIFICATIONS.map((schedule) => (
                  <option key={schedule} value={schedule}>
                    {SCHEDULE_LABELS[schedule]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <p className="text-xs text-slate-500">
            Every material is batch tracked: a vendor batch number and expiry are mandatory on
            receipt, and that is derived from the item type rather than set here.
          </p>

          <SubmitButton pendingLabel="Saving…">Add item</SubmitButton>
        </form>
      )}
    </Disclosure>
  );
}

/**
 * A production plan and the components its run consumes.
 *
 * Three component rows, fixed. A dynamic add-a-row control needs client state
 * and buys little here: a plan with more components is edited in the
 * Production module when that exists, and three covers the common case of an
 * API plus primary and secondary packaging.
 */
function AddProductionPlan({ items, boms }: { items: readonly ItemSummary[]; boms: readonly BomSummary[] }) {
  const [state, formAction] = useAction(createProductionPlanAction);

  const finishedGoods = items.filter((item) => item.type === 'FINISHED_GOOD');

  return (
    <Disclosure label="New production plan" title="Production plan">
      {() => (
        <form action={formAction} className="w-[min(38rem,85vw)] space-y-3">
          <ActionMessage state={state} />

          {finishedGoods.length === 0 && (
            <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              No finished goods exist yet. Add an item of type &ldquo;finished good&rdquo; first —
              a plan makes a product.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Finished product" htmlFor="p-product" required>
              <select
                id="p-product"
                name="finishedProductId"
                required
                defaultValue=""
                className="field-sm w-full"
              >
                <option value="">Choose a product</option>
                {finishedGoods.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} — {item.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Pack variant" htmlFor="p-variant">
              <input
                id="p-variant"
                name="packVariant"
                maxLength={128}
                placeholder="10x10 blister"
                className="field-sm w-full"
              />
            </Field>

            <Field label="Planned quantity" htmlFor="p-qty" required>
              <input
                id="p-qty"
                name="plannedQuantity"
                required
                inputMode="decimal"
                className="field-sm w-full"
              />
            </Field>

            <Field label="Planned date" htmlFor="p-date">
              <input id="p-date" name="plannedDate" type="date" className="field-sm w-full" />
            </Field>
          </div>

          <Field
            label="Bill of material"
            htmlFor="p-bom"
            hint="The formulation this run follows. Its lines are the component list — the plan keeps none of its own."
          >
            <select id="p-bom" name="bomId" defaultValue="" className="field-sm w-full">
              <option value="">Not specified</option>
              {boms.map((bom) => (
                <option key={bom.id} value={bom.id}>
                  {bom.product.code} v{bom.version}
                  {bom.isActive ? ' (active)' : ''}
                </option>
              ))}
            </select>
          </Field>

          <SubmitButton pendingLabel="Saving…">Create plan</SubmitButton>
        </form>
      )}
    </Disclosure>
  );
}

/** A requisition raised by a person: always against a production plan. */
function RaiseManualRequisition({
  items,
  vendors,
  plans,
}: {
  items: readonly ItemSummary[];
  vendors: readonly PartySummary[];
  plans: readonly ProductionPlanSummary[];
}) {
  const [state, formAction] = useAction(createRequisitionAction);

  return (
    <Disclosure label="Raise requisition" title="Manual requisition">
      {() => (
        <form action={formAction} className="w-[min(32rem,80vw)] space-y-3">
          <ActionMessage state={state} />

          {plans.length === 0 && (
            <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              A manual requisition must cite a production plan. Create one first — an auto-reorder
              requisition needs no plan, and the reorder check raises those.
            </p>
          )}

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

          <Field label="Production plan" htmlFor="r-plan" required>
            <select
              id="r-plan"
              name="productionPlanId"
              required
              defaultValue=""
              className="field-sm w-full"
            >
              <option value="">Choose a plan</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.number} — {plan.finishedProduct.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Required quantity"
              htmlFor="r-qty"
              hint="Blank uses the item's reorder quantity."
            >
              <input
                id="r-qty"
                name="requiredQuantity"
                inputMode="decimal"
                defaultValue={state.values?.requiredQuantity ?? ''}
                className="field-sm w-full"
              />
            </Field>

            <Field label="Preferred vendor" htmlFor="r-vendor">
              <select
                id="r-vendor"
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

          <SubmitButton pendingLabel="Raising…">Raise requisition</SubmitButton>
        </form>
      )}
    </Disclosure>
  );
}

/**
 * Issues usable stock out of inventory.
 *
 * Consumption normally comes from production, which is not built yet — but
 * the reorder trigger is only meaningful if stock can fall. This is a real
 * inventory operation with a mandatory reason, picking FEFO, and the API runs
 * the reorder check straight after it.
 */
function IssueStock({ items }: { items: readonly ItemSummary[] }) {
  const [state, formAction] = useAction(consumeStockAction);

  return (
    <Disclosure label="Issue stock" title="Issue or write off stock">
      {() => (
        <form action={formAction} className="w-[min(30rem,80vw)] space-y-3">
          <ActionMessage state={state} />

          <p className="text-xs text-slate-600">
            Consumes usable stock earliest-expiry-first and posts a ledger entry. Anything that
            falls below its reorder level is requisitioned automatically.
          </p>

          <Field label="Item" htmlFor="c-item" required>
            <select id="c-item" name="itemId" required defaultValue="" className="field-sm w-full">
              <option value="">Choose an item</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Quantity" htmlFor="c-qty" required>
              <input
                id="c-qty"
                name="quantity"
                required
                inputMode="decimal"
                defaultValue={state.values?.quantity ?? ''}
                className="field-sm w-full"
              />
            </Field>

            <Field label="Reason" htmlFor="c-reason" required>
              <input
                id="c-reason"
                name="reason"
                required
                maxLength={500}
                placeholder="Issued to production"
                defaultValue={state.values?.reason ?? ''}
                className="field-sm w-full"
              />
            </Field>
          </div>

          <SubmitButton pendingLabel="Issuing…">Issue stock</SubmitButton>
        </form>
      )}
    </Disclosure>
  );
}
