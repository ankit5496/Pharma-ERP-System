'use client';

import { PROCUREMENT_ROUTES, type PurchaseInvoiceListItem } from '@pharma-erp/types';
import { useRef, useState } from 'react';

import { changeInvoiceStatusAction } from '@/app/(app)/workflows/procure-to-pay/actions';
import { RowActionMenu, type RowAction } from '@/components/row-action-menu';

import { EditInvoiceButton } from './edit-dialogs';
import { ActionMessage, useAction } from './form-kit';

/**
 * Row actions for a purchase invoice, behind one menu.
 *
 * ALL THREE ACTIONS MOVED INTO THE MENU — Edit, Cancel and Record payment used
 * to sit in the cell as a stack of controls, which made the Actions column the
 * tallest thing in every row and put a destructive action (Cancel) permanently
 * one stray click away. This is the same treatment purchase orders and
 * requisitions already had; the invoices screen was the one left out.
 *
 * THERE IS STILL NO APPROVE ACTION, and its absence is deliberate. US-PUR-05
 * gives the invoice three states — Booked, Partially Paid, Paid — all driven by
 * payment progress. An invoice is payable from the moment it is booked, so the
 * only action that leads anywhere is recording what has been paid.
 *
 * WHY CANCEL GOES THROUGH A HIDDEN FORM rather than calling the action
 * directly: the server action is bound to a form by `useAction`, which is what
 * gives it pending state and the toast on completion. A menu item is a button
 * in a different subtree, so it asks the form to submit itself —
 * `requestSubmit()` rather than `submit()`, because only the former runs the
 * submit handler React has attached.
 */
export function InvoiceActions({ invoice }: { invoice: PurchaseInvoiceListItem }) {
  const [state, action] = useAction(changeInvoiceStatusAction);
  const [editing, setEditing] = useState(false);
  const cancelForm = useRef<HTMLFormElement>(null);

  const isCancelled = invoice.status === 'CANCELLED';
  const isPaid = invoice.status === 'PAID';

  // Mirrors what the API will say, so a greyed entry explains itself rather
  // than leaving the reader to click and find out. The API is what enforces
  // each of these; none of it rests on the menu.
  const actions: RowAction[] = [
    {
      label: 'Edit',
      onSelect: () => setEditing(true),
      disabledReason: isCancelled
        ? 'A cancelled invoice cannot be edited.'
        : null,
    },
    {
      label: 'Record payment',
      // A link, not a button: it carries the user to the payments register with
      // this invoice in hand, and a link keeps middle-click and "open in new
      // tab" working.
      href: `${PROCUREMENT_ROUTES.payments}?search=${invoice.number}`,
      disabledReason: isCancelled
        ? 'A cancelled invoice cannot be paid.'
        : isPaid
          ? 'This invoice is settled in full.'
          : null,
    },
    {
      label: 'Cancel invoice',
      tone: 'danger',
      onSelect: () => cancelForm.current?.requestSubmit(),
      disabledReason: isCancelled
        ? 'Already cancelled.'
        : invoice.status === 'PARTIALLY_PAID' || isPaid
          ? 'Payments have been recorded against this invoice. Cancelling it would orphan the money on the vendor ledger.'
          : null,
    },
  ];

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="max-w-[16rem]">
        <ActionMessage state={state} />
      </div>

      <RowActionMenu label={invoice.number} actions={actions} />

      {/* No trigger of its own: the menu entry above opens it. */}
      <EditInvoiceButton invoice={invoice} isOpen={editing} onOpenChange={setEditing} />

      {/* Submitted by the menu, never shown. The status the API is being asked
          for is fixed here rather than passed in, so the only thing this form
          can ever do is cancel this invoice. */}
      <form ref={cancelForm} action={action} className="hidden">
        <input type="hidden" name="id" value={invoice.id} />
        <input type="hidden" name="status" value="CANCELLED" />
      </form>
    </div>
  );
}
