'use client';

import { PROCUREMENT_ROUTES, type PurchaseInvoiceListItem } from '@pharma-erp/types';

import { changeInvoiceStatusAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, SubmitButton, useAction } from './form-kit';

/**
 * Approve or cancel an invoice.
 *
 * Approval is what puts the invoice on the payables ledger, so it stays a
 * deliberate action rather than something that happens on save — recording
 * what a vendor billed and agreeing to pay it are two different decisions,
 * often made by two different people.
 *
 * The action state is held at this level: approving replaces the buttons with
 * the "on the payables ledger" note, so a message owned by the button would
 * be unmounted before it could be read.
 */
export function InvoiceActions({ invoice }: { invoice: PurchaseInvoiceListItem }) {
  const [state, action] = useAction(changeInvoiceStatusAction);

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="max-w-[16rem]">
        <ActionMessage state={state} />
      </div>

      {invoice.status === 'CANCELLED' ? (
        <span className="text-xs text-slate-400">Cancelled</span>
      ) : invoice.status === 'APPROVED' ? (
        <>
          <span className="text-xs text-slate-500">On the payables ledger</span>
          {invoice.outstandingAmount !== '0.00' && (
            <a
              href={`${PROCUREMENT_ROUTES.payments}?search=${invoice.number}`}
              className="text-xs font-medium text-sky-800 underline decoration-sky-300 underline-offset-2"
            >
              Record payment →
            </a>
          )}
        </>
      ) : (
        <>
          <form action={action}>
            <input type="hidden" name="id" value={invoice.id} />
            <input type="hidden" name="status" value="APPROVED" />
            <SubmitButton variant="primary" pendingLabel="…">
              Approve
            </SubmitButton>
          </form>

          <form action={action}>
            <input type="hidden" name="id" value={invoice.id} />
            <input type="hidden" name="status" value="CANCELLED" />
            <SubmitButton variant="secondary" pendingLabel="…">
              Cancel
            </SubmitButton>
          </form>
        </>
      )}
    </div>
  );
}
