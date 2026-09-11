'use client';

import { PROCUREMENT_ROUTES, type PurchaseInvoiceListItem } from '@pharma-erp/types';

import { changeInvoiceStatusAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, SubmitButton, useAction } from './form-kit';

/**
 * Row actions for a purchase invoice.
 *
 * THERE IS NO APPROVE BUTTON, and its absence is deliberate. US-PUR-05 gives
 * the invoice three states — Booked, Partially Paid, Paid — all driven by
 * payment progress. An invoice is payable from the moment it is booked, so
 * the only action that leads anywhere is recording what has been paid.
 *
 * Cancel remains, because a vendor invoice can be wrong. The API refuses it
 * once payments exist: cancelling a partly-paid invoice would orphan the money
 * and leave the vendor ledger claiming it went somewhere it did not.
 *
 * The action state is held here rather than in the buttons: recording a
 * payment moves the row to Paid and replaces them, and a message owned by a
 * vanished button would vanish with it.
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
      ) : invoice.status === 'PAID' ? (
        <span className="text-xs font-medium text-green-800">Settled in full</span>
      ) : (
        <>
          <a
            href={`${PROCUREMENT_ROUTES.payments}?search=${invoice.number}`}
            className="text-xs font-medium text-sky-800 underline decoration-sky-300 underline-offset-2"
          >
            Record payment →
          </a>

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
