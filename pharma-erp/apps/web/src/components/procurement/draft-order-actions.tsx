'use client';

import type { PartySummary, PurchaseOrderListItem } from '@pharma-erp/types';
import { startTransition, useState } from 'react';

import {
  discardDraftPurchaseOrderAction,
  submitDraftPurchaseOrderAction,
} from '@/app/(app)/workflows/procure-to-pay/actions';
import { RowActionMenu, type RowAction } from '@/components/row-action-menu';

import { EditPurchaseOrderButton } from './edit-dialogs';
import { ActionMessage, useAction } from './form-kit';

/**
 * What can be done with an unplaced draft.
 *
 * THREE ACTIONS, AND THEY ARE NOT THE SAME THREE A PLACED ORDER GETS. A draft
 * has never been sent to anybody, so it can be thrown away outright; a placed
 * order can only be cancelled, because somebody outside the building is acting
 * on it. Nothing can be received against a draft either, so Create GRN is
 * absent rather than greyed.
 *
 *  - EDIT reopens the same dialog the draft was written in, with everything
 *    that was filled in still there, and saves it as a draft again — no
 *    required fields, which is the point of a draft.
 *  - SUBMIT places the order, and THAT is where the real validation runs: the
 *    API refuses a draft with no lines and re-checks every requisition behind
 *    it, because a draft can sit for a week and the world moves on.
 *  - DISCARD asks first. It is soft in the database, but it is a one-way door
 *    from this screen, so it should be treated as one.
 */
export function DraftOrderActions({
  order,
  vendors = [],
}: {
  order: PurchaseOrderListItem;
  /** Offered on the edit form: an unplaced draft may still change vendor. */
  vendors?: readonly PartySummary[];
}) {
  const [submitState, submitAction, submitting] = useAction(submitDraftPurchaseOrderAction);
  const [discardState, discardAction, discarding] = useAction(discardDraftPurchaseOrderAction);
  const [editing, setEditing] = useState(false);

  /**
   * Dispatches one of the actions with just the order id.
   *
   * INSIDE startTransition, which is not optional. A `useActionState` dispatch
   * called outside one never flips the pending state, so `isPending` stays
   * false: the row shows nothing while the request is in flight, and
   * `useAction` — which raises its toast on the pending edge — announces the
   * result at the wrong moment or not at all. The request itself still goes,
   * which is exactly why the bug reads as "it works but feels broken".
   *
   * Everywhere else in the app the action is handed to a <form action={...}>,
   * and React wraps that in a transition itself. These menu entries have no
   * form, so they have to say it.
   */
  function run(action: (form: FormData) => void) {
    const form = new FormData();

    form.set('id', order.id);

    startTransition(() => action(form));
  }

  const actions: RowAction[] = [
    { label: 'Edit', onSelect: () => setEditing(true) },
    {
      label: 'Submit order',
      onSelect: () => run(submitAction),
      // Said here as well as by the API, because it is the one refusal a
      // person can act on without leaving the row.
      disabledReason:
        order.lines.length === 0 ? 'Add at least one line before placing this order.' : null,
    },
    {
      label: 'Discard draft',
      tone: 'danger',
      onSelect: () => {
        const confirmed = window.confirm(
          `Discard ${order.number}?\n\n` +
            'The draft and its lines go, and the requisitions behind it are free to be ' +
            'ordered again. Nothing was placed with the vendor, so nothing is withdrawn.',
        );

        if (confirmed) run(discardAction);
      },
    },
  ];

  return (
    <div className="flex flex-col items-center gap-1.5">
      <ActionMessage state={submitState} />
      <ActionMessage state={discardState} />

      <RowActionMenu label={order.number} actions={actions} busy={submitting || discarding} />

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
