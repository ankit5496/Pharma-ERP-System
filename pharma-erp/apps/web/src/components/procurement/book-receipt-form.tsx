'use client';

import { useState } from 'react';
import { formatUom, type PurchaseOrderListItem } from '@pharma-erp/types';

import { createGoodsReceiptAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import {
  ActionMessage,
  Disclosure,
  Field,
  FormFooter,
  SubmitButton,
  useAction,
} from './form-kit';
import { SearchableSelect } from './searchable-select';
import { noWheelChange } from '@/lib/number-input';

/**
 * Books a goods receipt against an open purchase order.
 *
 * NO ITEM IS ENTERED HERE. The lines are generated from the chosen order, so a
 * receipt can only ever be booked against something actually on order, against
 * items that already exist in the item master. Lines left blank are skipped — a
 * delivery rarely covers a whole order, and forcing a zero onto the others
 * would post movements that never happened.
 *
 * EACH LINE SHOWS FOUR QUANTITIES, which is what makes partial receiving
 * legible: what was ordered, what previous receipts already brought in, what
 * is therefore still outstanding, and what is being received now. Showing only
 * the last of those leaves the receiver doing arithmetic to answer "how much
 * am I allowed to take".
 *
 * THE FOUR BATCH FIELDS ARE MANDATORY PER LINE BEING RECEIVED — quantity,
 * batch number, manufacturing date and expiry — and they carry the required
 * marker to say so.
 *
 * They are NOT plain HTML `required`, and that is the whole difficulty: a
 * receipt usually covers some lines and not others, and `required` applies to
 * a row whether or not anything is being received on it, which would make a
 * partial receipt impossible to submit. So the rule is conditional: a line
 * nobody has touched is not part of this receipt, and the moment ANY of its
 * four fields is filled in, all four are required. `validate` below is that
 * rule, and it reports against the specific control rather than as one
 * sentence at the top of a long form.
 *
 * The API enforces the same four again for every line carrying a quantity,
 * which is what actually refuses a bad receipt — this is the courtesy that
 * answers without a round trip.
 *
 * The browser checks that do exist — the remaining-quantity ceiling — are a
 * courtesy that answers without a round trip. The API checks the same things
 * again against live figures, and that is what refuses a bad receipt.
 *
 * IT OPENS IN A DIALOG FROM THE GRN SCREEN rather than sitting above the list
 * of receipts. The form is long — a line per outstanding order line, four
 * fields each — and permanently expanded it pushed the receipts it produces
 * off the bottom of the screen. It opens by itself when the user arrived from
 * "Create GRN" on a purchase order, since that click was the request to fill
 * it in.
 */
export function BookReceiptForm({
  orders,
  preselectedOrderId,
  receivedBy,
}: {
  orders: readonly PurchaseOrderListItem[];
  /** Set when the user arrived from "Create GRN" on a purchase order. */
  preselectedOrderId?: string;
  receivedBy: string;
}) {
  const [state, formAction] = useAction(createGoodsReceiptAction);

  /** Field name -> what is wrong with it. Cleared on every submit attempt. */
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [orderId, setOrderId] = useState(
    // Falls back rather than showing an empty form if the order has since been
    // closed or fully received and is no longer in the receivable list.
    preselectedOrderId && orders.some((o) => o.id === preselectedOrderId)
      ? preselectedOrderId
      : (orders[0]?.id ?? ''),
  );

  const order = orders.find((candidate) => candidate.id === orderId) ?? orders[0];

  /**
   * Refuses a receipt that is missing something, before it is sent.
   *
   * Returns the errors by field name; an empty object means go ahead. A line is
   * "in scope" when any of its four fields has been filled — that is what keeps
   * partial receiving possible while still making all four mandatory on the
   * lines that are actually being received.
   */
  function validate(form: HTMLFormElement): Record<string, string> {
    const data = new FormData(form);
    const found: Record<string, string> = {};
    let linesInScope = 0;

    for (const line of openLines) {
      const names = {
        quantity: `quantityReceived_${line.id}`,
        batch: `vendorBatchNumber_${line.id}`,
        mfg: `manufacturingDate_${line.id}`,
        expiry: `expiryDate_${line.id}`,
      };

      const value = (name: string) => String(data.get(name) ?? '').trim();

      const quantity = value(names.quantity);
      const batch = value(names.batch);
      const mfg = value(names.mfg);
      const expiry = value(names.expiry);

      // Untouched line: not part of this receipt.
      if (!quantity && !batch && !mfg && !expiry) continue;

      linesInScope += 1;

      if (!quantity) {
        found[names.quantity] = 'Quantity is required.';
      } else if (!(Number(quantity) > 0)) {
        // Zero is the interesting case: it passes "is filled in" and means
        // nothing arrived, which is a line that should have been left blank.
        found[names.quantity] = 'Quantity must be greater than zero.';
      } else if (Number(quantity) > Number(line.quantityPending)) {
        found[names.quantity] =
          `Only ${line.quantityPending} ${formatUom(line.item.uom)} remain outstanding.`;
      }

      if (!batch) found[names.batch] = 'Batch Number is required.';
      if (!mfg) found[names.mfg] = 'Manufacturing Date is required.';
      if (!expiry) found[names.expiry] = 'Expiry Date is required.';

      // Both present: the expiry has to be after the date it was made. The API
      // applies the same comparison, plus the product's shelf life.
      if (mfg && expiry && expiry <= mfg) {
        found[names.expiry] = 'Expiry Date must be after the Manufacturing Date.';
      }
    }

    if (linesInScope === 0) {
      found.form = 'Enter a quantity on at least one line — a receipt with no lines records nothing.';
    }

    return found;
  }

  // Fully received lines are dropped: there is nothing left to receive on them
  // and the API would refuse an over-receipt anyway.
  const openLines = order?.lines.filter((line) => line.quantityPending !== '0') ?? [];

  return (
    <Disclosure
      label="Create GRN"
      title="Create goods receipt note"
      subtitle="Record material arriving against an issued purchase order. Each line creates a batch, in quarantine until incoming QC clears it."
      closeWhen={state.status === 'success'}
      defaultOpen={Boolean(preselectedOrderId)}
      width="46rem"
    >
      {(close) => (
        <form
          action={formAction}
          noValidate
          onSubmit={(event) => {
            const found = validate(event.currentTarget);

            setErrors(found);

            // preventDefault on the submit event stops the action from running,
            // so nothing is sent and nothing typed is lost.
            if (Object.keys(found).length > 0) event.preventDefault();
          }}
          className="space-y-4"
        >
          <ActionMessage state={state} />

          {errors.form && (
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {errors.form}
            </p>
          )}

          {/* What the system fills in, stated rather than presented as empty
          boxes someone might think they forgot. None of it is submitted: the
          API allocates the number, stamps the time and attributes the receipt
          to the signed-in user. */}
          <dl className="grid grid-cols-3 gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">GRN no.</dt>
              <dd className="mt-0.5 text-slate-800">Generated on save</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Linked PO</dt>
              <dd className="mt-0.5 font-mono text-slate-800">{order?.number ?? '—'}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-slate-500">Received by</dt>
              <dd className="mt-0.5 text-slate-800">{receivedBy}</dd>
            </div>
          </dl>

          <div className="grid gap-3">
            <Field label="Purchase order" htmlFor="grn-order" required>
              <SearchableSelect
                id="grn-order"
                name="purchaseOrderId"
                required
                options={orders.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.number,
                  hint: `${candidate.vendor.name} — ${
                    candidate.lines.filter((l) => l.quantityPending !== '0').length
                  } line(s) pending`,
                }))}
                value={orderId}
                onChange={setOrderId}
                emptyLabel="Choose an order"
              />
            </Field>
          </div>

          {openLines.length === 0 ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              Every line on this order has been received in full.
            </p>
          ) : (
            /* ONE CARD PER LINE, NOT A ROW OF INPUTS IN A TABLE. As a table
               every field was a column, so the form was far wider than the
               dialog and had to be filled in while scrolling sideways — and
               each input's label lived in a header row that scrolled out of
               view as soon as you reached the fields that needed it. A card
               keeps a line's fields under that line's own name, two to a row,
               with every label attached to the box it names. */
            <div className="space-y-3">
              {openLines.map((line) => {
                const tracked = line.item.requiresBatchTracking;

                return (
                  <fieldset key={line.id} className="rounded-md border border-slate-200 px-4 pb-4">
                    <input type="hidden" name="lineId" value={line.id} />

                    <legend className="flex flex-wrap items-center gap-2 px-1.5 text-sm">
                      <span className="font-medium text-slate-900">{line.item.name}</span>
                      <span className="font-mono text-xs text-slate-500">{line.item.code}</span>
                      {tracked && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                          batch tracked
                        </span>
                      )}
                    </legend>

                    {/* What is already true of this line, so the quantity typed
                        below has something to be judged against. Read-only:
                        these are facts about the order, not fields. */}
                    <dl className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
                      <div className="flex gap-1.5">
                        <dt>On order</dt>
                        <dd className="font-medium tabular-nums text-slate-800">
                          {line.quantity} {formatUom(line.item.uom)}
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt>Already received</dt>
                        <dd className="font-medium tabular-nums text-slate-800">
                          {line.quantityReceived} {formatUom(line.item.uom)}
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt>Remaining</dt>
                        <dd className="font-semibold tabular-nums text-slate-900">
                          {line.quantityPending} {formatUom(line.item.uom)}
                        </dd>
                      </div>
                    </dl>

                    <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                      <Field
                        label="Received quantity"
                        htmlFor={`recv-${line.id}`}
                        required
                        error={errors[`quantityReceived_${line.id}`]}
                        hint={`At most ${line.quantityPending} ${formatUom(line.item.uom)} remain.`}
                      >
                        {/* `noWheelChange`: a scroll over a focused number
                            input changes its value in every browser, so on a
                            form this long, passing the wheel over a received
                            quantity silently edits it.

                            `min` is above zero rather than at it: receiving
                            "0" of something is not a receipt, it is a line
                            that should have been left blank. The API checks
                            the ceiling again against the live figure, which is
                            what counts when two people receive at once. */}
                        <input
                          id={`recv-${line.id}`}
                          name={`quantityReceived_${line.id}`}
                          type="number"
                          step="any"
                          min="0"
                          max={line.quantityPending}
                          placeholder="0"
                          {...noWheelChange}
                          aria-invalid={Boolean(errors[`quantityReceived_${line.id}`])}
                          className="field"
                        />
                      </Field>

                      <Field
                        label="Vendor batch / lot no."
                        htmlFor={`batch-${line.id}`}
                        required
                        error={errors[`vendorBatchNumber_${line.id}`]}
                      >
                        <input
                          id={`batch-${line.id}`}
                          name={`vendorBatchNumber_${line.id}`}
                          maxLength={64}
                          aria-invalid={Boolean(errors[`vendorBatchNumber_${line.id}`])}
                          className="field"
                        />
                      </Field>

                      <Field
                        label="Manufacturing date"
                        htmlFor={`mfg-${line.id}`}
                        required
                        error={errors[`manufacturingDate_${line.id}`]}
                      >
                        <input
                          id={`mfg-${line.id}`}
                          name={`manufacturingDate_${line.id}`}
                          type="date"
                          aria-invalid={Boolean(errors[`manufacturingDate_${line.id}`])}
                          className="field"
                        />
                      </Field>

                      <Field
                        label="Expiry date"
                        htmlFor={`exp-${line.id}`}
                        required
                        error={errors[`expiryDate_${line.id}`]}
                      >
                        <input
                          id={`exp-${line.id}`}
                          name={`expiryDate_${line.id}`}
                          type="date"
                          aria-invalid={Boolean(errors[`expiryDate_${line.id}`])}
                          className="field"
                        />
                      </Field>
                    </div>
                  </fieldset>
                );
              })}
            </div>
          )}

          <FormFooter onCancel={close}>
            <SubmitButton pendingLabel="Creating…">Create GRN</SubmitButton>
          </FormFooter>
        </form>
      )}
    </Disclosure>
  );
}
