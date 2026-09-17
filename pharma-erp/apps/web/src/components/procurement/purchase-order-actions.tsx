'use client';

import { PROCUREMENT_ROUTES, type PurchaseOrderListItem } from '@pharma-erp/types';

import { submitDraftPurchaseOrderAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { EditPurchaseOrderButton } from './edit-dialogs';
import { ActionMessage, SubmitButton, useAction } from './form-kit';

/**
 * The actions on one purchase-order row.
 *
 * THE STATUS CONTROL IS GONE FROM HERE. The row used to carry a status pill in
 * one column and a status dropdown in this one — two controls reporting the
 * same fact, leaving the reader to work out which was authoritative. The pill
 * in the Status column now reports it and the Edit dialog changes it, so there
 * is exactly one of each.
 *
 * WHAT IS LEFT IS NOT A STATUS CHANGE UNDER ANOTHER NAME:
 *
 *  - EDIT opens the record — terms and status together.
 *  - PLACE THIS ORDER is offered on a draft because it is NOT a transition the
 *    status rules allow: placing a draft also converts the requisitions behind
 *    it, which is a different operation with its own endpoint.
 *  - CREATE GRN is navigation, not an edit. It is offered while anything is
 *    still outstanding — including on a CLOSED order, because whether material
 *    can be received is decided by the PENDING QUANTITY and not by the status.
 *    A closed order with a balance still accepts the rest if it turns up.
 */
export function PurchaseOrderActions({ order }: { order: PurchaseOrderListItem }) {
  const [submitState, submitAction] = useAction(submitDraftPurchaseOrderAction);

  const isDraft = order.status === 'DRAFT';
  const cancelled = order.status === 'CANCELLED';
  const pending = order.lines.some((line) => line.quantityPending !== '0');

  return (
    <div className="flex flex-col items-start gap-1.5">
      <ActionMessage state={submitState} />

      <EditPurchaseOrderButton order={order} />

      {isDraft && (
        <form action={submitAction}>
          <input type="hidden" name="id" value={order.id} />
          <SubmitButton variant="secondary" pendingLabel="Placing…">
            Place this order
          </SubmitButton>
        </form>
      )}

      {pending && !cancelled && !isDraft && (
        <a
          href={`${PROCUREMENT_ROUTES.goodsReceipts}?purchaseOrderId=${order.id}`}
          className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Create GRN
        </a>
      )}
    </div>
  );
}
