'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatUom, type PartySummary, type RequisitionListItem } from '@pharma-erp/types';

import { createPurchaseOrderAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import {
  ActionMessage,
  DialogCloseButton,
  Field,
  FormFooter,
  SubmitButton,
  useAction,
} from './form-kit';
import { noWheelChange } from '@/lib/number-input';
import { SearchableSelect } from './searchable-select';

/**
 * Create Purchase Order, opened from a requisition.
 *
 * A NATIVE <dialog>, not a div pretending to be one. The element gives focus
 * trapping, Escape-to-close, inertness of the page behind it and the top-layer
 * stacking for free — all of which a hand-rolled overlay has to reimplement,
 * and usually reimplements incompletely.
 *
 * EVERYTHING KNOWN FROM THE REQUISITION IS FILLED IN and stays editable: the
 * item and quantity it asked for, and its preferred vendor when it named one.
 * What a requisition cannot know — the rate, the GST, the delivery date — is
 * left empty, because those are the buyer's to negotiate and a plausible
 * default would be a figure nobody checked.
 *
 * TWO WAYS TO SAVE, and the distinction matters. "Save as draft" records the
 * order without placing it: nothing can be received or invoiced against a
 * draft, it stays editable, and the requisition is NOT yet marked converted.
 * "Create purchase order" places it. Cancel closes and writes nothing at all.
 */
export function CreatePoDialog({
  requisition,
  vendors,
}: {
  requisition: RequisitionListItem;
  vendors: readonly PartySummary[];
}) {
  const [state, formAction] = useAction(createPurchaseOrderAction);

  /**
   * The chosen vendor, which the lookup posts through a hidden input.
   *
   * Seeded from the requisition's preferred vendor when it named one — the
   * common case for an auto-reorder — and from the last attempt when a
   * submit was refused, so a rejected order does not lose the choice.
   */
  const [vendorId, setVendorId] = useState(
    state.values?.vendorId ?? requisition.preferredVendor?.id ?? '',
  );

  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  // Opened with showModal() rather than the `open` attribute: only the former
  // puts the dialog in the top layer and makes the rest of the page inert.
  useEffect(() => {
    const element = dialog.current;

    if (element && !element.open) element.showModal();
  }, []);

  // Closing clears the query parameter, so a refresh or a Back does not
  // reopen a dialog the user deliberately dismissed.
  //
  // Wrapped in useCallback because the success effect below depends on it, and
  // a function rebuilt on every render would restart that effect's timer on
  // every render with it.
  const close = useCallback(() => {
    dialog.current?.close();
    router.replace(window.location.pathname);
  }, [router]);

  // A placed or drafted order means this dialog has done its job. The pause is
  // deliberate: closing the instant the action returns would take the
  // confirmation off the screen before it could be read.
  useEffect(() => {
    if (state.status !== 'success') return undefined;

    const timer = setTimeout(close, 1200);

    return () => clearTimeout(timer);
  }, [state.status, close]);

  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        // Escape fires `cancel`; intercepting it keeps the URL cleanup in one
        // place rather than leaving a stale parameter behind.
        event.preventDefault();
        close();
      }}
      className="w-[min(46rem,92vw)] rounded-lg border border-slate-200 p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <form action={formAction} className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Create purchase order</h2>
            <p className="mt-0.5 text-sm text-slate-600">
              From requisition{' '}
              <span className="font-mono text-slate-800">{requisition.number}</span>
            </p>
          </div>

          <DialogCloseButton onClose={close} />
        </div>

        <ActionMessage state={state} />

        {/* Carried from the requisition and not editable here: changing what
            was requested is an edit to the requisition, not to the order
            raised from it. Both are submitted as hidden fields. */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="font-medium uppercase tracking-wide text-slate-500">Requisition</dt>
            <dd className="mt-0.5 font-mono text-slate-800">{requisition.number}</dd>
          </div>
          <div>
            <dt className="font-medium uppercase tracking-wide text-slate-500">Item</dt>
            <dd className="mt-0.5 text-slate-800">{requisition.item.name}</dd>
          </div>
          <div>
            <dt className="font-medium uppercase tracking-wide text-slate-500">Code</dt>
            <dd className="mt-0.5 font-mono text-slate-800">{requisition.item.code}</dd>
          </div>
          <div>
            <dt className="font-medium uppercase tracking-wide text-slate-500">Raised by</dt>
            <dd className="mt-0.5 text-slate-800">{requisition.requestedBy ?? 'System'}</dd>
          </div>
        </dl>

        <input type="hidden" name="requisitionId" value={requisition.id} />
        <input type="hidden" name="itemId" value={requisition.item.id} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vendor" htmlFor="po-vendor" required hint="From the party master.">
            <SearchableSelect
              id="po-vendor"
              name="vendorId"
              required
              options={vendors.map((vendor) => ({
                value: vendor.id,
                label: vendor.name,
                hint: vendor.code,
              }))}
              value={vendorId}
              onChange={setVendorId}
              emptyLabel="Select vendor"
              className="field-sm w-full"
            />
          </Field>

          <Field
            label="Quantity"
            htmlFor="po-quantity"
            required
            hint={`Requisition asked for ${requisition.requiredQuantity} ${formatUom(requisition.item.uom)}.`}
          >
            <input
              id="po-quantity"
              name="quantity"
              required
              inputMode="decimal"
              defaultValue={state.values?.quantity ?? requisition.requiredQuantity}
              className="field-sm w-full"
            />
          </Field>

          <Field
            label="Rate per unit"
            htmlFor="po-rate"
            required
            hint="A requisition does not carry a price — this is the negotiated rate."
          >
            <input
              id="po-rate"
              name="rate"
              required
              inputMode="decimal"
              defaultValue={state.values?.rate ?? ''}
              className="field-sm w-full"
            />
          </Field>

          {/* NOT AN INPUT, AND NOT POSTED. The order service reads the rate
              off the item master — the same place the invoice raised against
              this order reads it — so a box here would be one whose contents
              are discarded, which is worse than no box. Shown because a buyer
              needs to see the tax they are committing to.

              An item with no rate is refused when the order is placed, not
              billed at zero: a missing input-tax figure is a filing error. It
              is stated here so that refusal is not a surprise. */}
          <Field
            label="GST %"
            htmlFor="po-tax"
            hint={
              requisition.item.gstRate
                ? 'From the item master. Change it there, not here.'
                : 'Set a GST rate on this item before placing the order.'
            }
          >
            <input
              id="po-tax"
              disabled
              readOnly
              value={
                requisition.item.gstRate !== null && requisition.item.gstRate !== undefined
                  ? `${requisition.item.gstRate}%`
                  : 'No rate on the item master'
              }
              className={`field-sm w-full ${
                requisition.item.gstRate === null || requisition.item.gstRate === undefined
                  ? 'text-red-700'
                  : ''
              }`}
            />
          </Field>

          <Field label="Expected delivery" htmlFor="po-eta">
            <input
              id="po-eta"
              name="expectedDeliveryDate"
              type="date"
              className="field-sm w-full"
            />
          </Field>

          <Field
            label="Payment terms (days)"
            htmlFor="po-terms"
            hint="Blank uses the vendor's agreed terms."
          >
            <input
              id="po-terms"
              name="paymentTermsDays"
              type="number"
              min={0}
              max={365}
              {...noWheelChange}
              className="field-sm w-full"
            />
          </Field>
        </div>

        <Field label="Notes" htmlFor="po-notes">
          <input id="po-notes" name="notes" maxLength={1000} className="field-sm w-full" />
        </Field>

        {/* Cancel, then the two ways to save. All three at the bottom and
            left-aligned, so the choice between them is made in one place
            instead of diagonally across the dialog. */}
        <FormFooter onCancel={close}>
          {/* Two submits on one form. `formAction` is not used — both post to
              the same action and the pressed button's own name/value tells the
              server which was chosen, which is what a plain form submission
              already does correctly. */}
          {/* A DRAFT DEMANDS NOTHING. The fields below are marked required
              because a PLACED order needs them, and that is still true — this
              button steps around the browser's checks, and the API applies the
              same distinction from `saveAsDraft` rather than trusting it. */}
          <SubmitButton
            variant="secondary"
            pendingLabel="Saving…"
            name="saveAsDraft"
            value="true"
            formNoValidate
          >
            Save as draft
          </SubmitButton>

          <SubmitButton variant="primary" pendingLabel="Creating…" name="saveAsDraft" value="false">
            Create purchase order
          </SubmitButton>
        </FormFooter>
      </form>
    </dialog>
  );
}
