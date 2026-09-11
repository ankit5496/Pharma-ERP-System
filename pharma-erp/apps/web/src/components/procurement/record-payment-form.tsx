'use client';

import type { VendorPayableRow } from '@pharma-erp/types';

import { recordPaymentAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, Disclosure, Field, SubmitButton, useAction } from './form-kit';

/**
 * Records a payment against one invoice.
 *
 * The amount defaults to the full outstanding balance, which is what is paid
 * in the overwhelming majority of cases; a part payment is then a deliberate
 * edit. The API refuses anything above the outstanding balance, so an
 * overpayment cannot be recorded by typo.
 */
export function RecordPaymentForm({ payable }: { payable: VendorPayableRow }) {
  const [state, formAction] = useAction(recordPaymentAction);

  // The settled branch lives here, not in the page. Clearing the balance
  // revalidates the row, and a branch one level up would unmount this
  // component at exactly the moment it has something to say.
  if (payable.outstandingAmount === '0.00') {
    return (
      <div className="space-y-2">
        <ActionMessage state={state} />
        <span className="text-xs font-medium text-green-800">Settled</span>
      </div>
    );
  }

  return (
    <Disclosure
      label="Pay"
      title={`Payment against ${payable.invoiceNumber}`}
      openLabel={`Record a payment against ${payable.invoiceNumber}`}
    >
      {() => (
        <form action={formAction} className="w-[min(26rem,80vw)] space-y-3">
          <ActionMessage state={state} />

          <input type="hidden" name="purchaseInvoiceId" value={payable.invoiceId} />

          <p className="text-xs text-slate-600">
            {payable.vendor.name} · outstanding{' '}
            <span className="font-semibold text-slate-900">₹{payable.outstandingAmount}</span>
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Amount"
              htmlFor={`pay-amount-${payable.invoiceId}`}
              required
              hint="Defaults to the full outstanding balance."
            >
              <input
                id={`pay-amount-${payable.invoiceId}`}
                name="amount"
                required
                inputMode="decimal"
                defaultValue={state.values?.amount ?? payable.outstandingAmount}
                className="field-sm w-full"
              />
            </Field>

            <Field label="Payment date" htmlFor={`pay-date-${payable.invoiceId}`}>
              <input
                id={`pay-date-${payable.invoiceId}`}
                name="paymentDate"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="field-sm w-full"
              />
            </Field>

            <Field label="Method" htmlFor={`pay-method-${payable.invoiceId}`}>
              <select
                id={`pay-method-${payable.invoiceId}`}
                name="method"
                defaultValue="NEFT"
                className="field-sm w-full"
              >
                <option value="NEFT">NEFT</option>
                <option value="RTGS">RTGS</option>
                <option value="UPI">UPI</option>
                <option value="Cheque">Cheque</option>
                <option value="Cash">Cash</option>
              </select>
            </Field>

            <Field
              label="Reference"
              htmlFor={`pay-ref-${payable.invoiceId}`}
              hint="UTR or cheque number."
            >
              <input
                id={`pay-ref-${payable.invoiceId}`}
                name="reference"
                maxLength={64}
                defaultValue={state.values?.reference ?? ''}
                className="field-sm w-full"
              />
            </Field>
          </div>

          <Field label="Notes" htmlFor={`pay-notes-${payable.invoiceId}`}>
            <input
              id={`pay-notes-${payable.invoiceId}`}
              name="notes"
              maxLength={500}
              className="field-sm w-full"
            />
          </Field>

          <SubmitButton pendingLabel="Recording…">Record payment</SubmitButton>
        </form>
      )}
    </Disclosure>
  );
}
