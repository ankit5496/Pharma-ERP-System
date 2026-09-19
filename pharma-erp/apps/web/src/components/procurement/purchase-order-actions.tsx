'use client';

import {
  PROCUREMENT_ROUTES,
  type PartySummary,
  type PurchaseOrderListItem,
} from '@pharma-erp/types';
import { startTransition, useState } from 'react';

import { submitDraftPurchaseOrderAction } from '@/app/(app)/workflows/procure-to-pay/actions';
import { RowActionMenu, type RowAction } from '@/components/row-action-menu';

import { EditPurchaseOrderButton } from './edit-dialogs';
import { ActionMessage, useAction } from './form-kit';

/**
 * Everything that can be done to a purchase order, behind one menu.
 *
 * ONE TRIGGER, NOT THREE BUTTONS. The row used to carry Edit, Create GRN and —
 * on a draft — Place this order, side by side. Three controls per row across a
 * page of orders is a column of buttons competing with the data, and the widths
 * differed by status so no two rows lined up. The menu is the same width on
 * every row whatever it contains.
 *
 * WHAT IS OFFERED IS DECIDED BY THE ORDER, not by the menu:
 *
 *  - EDIT is always there. It opens the record — terms and status together —
 *    and the dialog itself decides which fields are still editable.
 *  - CREATE GRN appears while anything is outstanding, INCLUDING on a closed
 *    order: whether material can be received is decided by the pending
 *    quantity, not by the status, so a closed order with a balance still
 *    accepts the rest if it turns up. It is absent on a draft, which cannot be
 *    received against, and on a cancelled one.
 *  - PLACE THIS ORDER is a draft's own action. It is not a status transition —
 *    placing a draft also converts the requisitions behind it — so it has its
 *    own endpoint and belongs here rather than in the status field.
 *
 * An action that cannot be taken is listed with the reason rather than hidden,
 * so the menu is the same shape on every row and nothing appears to be missing.
 */
export function PurchaseOrderActions({
  order,
  vendors = [],
}: {
  order: PurchaseOrderListItem;
  /** Offered on the edit form while the order is still draft or open. */
  vendors?: readonly PartySummary[];
}) {
  const [submitState, submitAction, submitting] = useAction(submitDraftPurchaseOrderAction);
  const [editing, setEditing] = useState(false);

  const isDraft = order.status === 'DRAFT';
  const cancelled = order.status === 'CANCELLED';
  const pending = order.lines.some((line) => line.quantityPending !== '0');

  const receiptReason = isDraft
    ? 'Place this order first — a draft cannot receive material.'
    : cancelled
      ? 'This order was cancelled.'
      : !pending
        ? 'Every line has been received in full.'
        : null;

  const actions: RowAction[] = [
    { label: 'Edit', onSelect: () => setEditing(true) },
    {
      label: 'Create GRN',
      href: `${PROCUREMENT_ROUTES.goodsReceipts}?purchaseOrderId=${order.id}`,
      disabledReason: receiptReason,
    },
  ];

  if (isDraft) {
    actions.push({
      label: 'Place this order',
      onSelect: () => {
        const form = new FormData();

        form.set('id', order.id);

        // In a transition for the same reason as the draft menu: a dispatch
        // outside one leaves isPending stuck false.
        startTransition(() => submitAction(form));
      },
    });
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <ActionMessage state={submitState} />

      <RowActionMenu label={order.number} actions={actions} busy={submitting} />

      {/* No trigger of its own: the menu entry above opens it. */}
      <EditPurchaseOrderButton
        order={order}
        vendors={vendors}
        isOpen={editing}
        onOpenChange={setEditing}
      />
    </div>
  );
}
