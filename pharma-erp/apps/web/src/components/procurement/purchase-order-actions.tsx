'use client';

import type { PurchaseOrderListItem } from '@pharma-erp/types';

import { changePurchaseOrderStatusAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, SubmitButton, useAction } from './form-kit';

/**
 * Status actions for a purchase order.
 *
 * PARTIALLY_RECEIVED and FULLY_RECEIVED are never offered as buttons: they are
 * consequences of booking a GRN, not decisions anyone makes. Showing them
 * would invite someone to mark an order received when nothing arrived.
 *
 * The action state is held here rather than in each button, because a
 * successful status change removes the button that caused it — issuing an
 * order replaces "Issue to vendor" with "Close" — and a message owned by the
 * vanished button would vanish with it.
 */
export function PurchaseOrderActions({ order }: { order: PurchaseOrderListItem }) {
  const [state, action] = useAction(changePurchaseOrderStatusAction);

  const actions: { status: string; label: string; variant: 'primary' | 'secondary' }[] = [];

  if (order.status === 'DRAFT') {
    actions.push({ status: 'ISSUED', label: 'Issue to vendor', variant: 'primary' });
    actions.push({ status: 'CANCELLED', label: 'Cancel', variant: 'secondary' });
  } else if (order.status === 'ISSUED' || order.status === 'PARTIALLY_RECEIVED') {
    actions.push({ status: 'CLOSED', label: 'Close', variant: 'secondary' });
    actions.push({ status: 'CANCELLED', label: 'Cancel', variant: 'secondary' });
  } else if (order.status === 'FULLY_RECEIVED') {
    actions.push({ status: 'CLOSED', label: 'Close', variant: 'secondary' });
  }

  if (actions.length === 0 && state.status === 'idle') return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="max-w-[20rem] text-left">
        <ActionMessage state={state} />
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {actions.map((entry) => (
          <form key={entry.status} action={action}>
            <input type="hidden" name="id" value={order.id} />
            <input type="hidden" name="status" value={entry.status} />
            <SubmitButton variant={entry.variant} pendingLabel="…">
              {entry.label}
            </SubmitButton>
          </form>
        ))}
      </div>
    </div>
  );
}
