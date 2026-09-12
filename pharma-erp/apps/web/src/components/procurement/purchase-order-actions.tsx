'use client';

import {
  PROCUREMENT_ROUTES,
  PURCHASE_ORDER_STATUS_LABELS,
  type PurchaseOrderListItem,
  type PurchaseOrderStatus,
} from '@pharma-erp/types';

import { changePurchaseOrderStatusAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, SubmitButton, useAction } from './form-kit';

/**
 * Status control and next action for a purchase order.
 *
 * THE DROPDOWN OFFERS ONLY WHAT THE ORDER CAN ACTUALLY BECOME. The API's state
 * machine allows Open -> Closed/Cancelled and Partially Received ->
 * Closed/Cancelled, and nothing at all out of a closed or cancelled order. The
 * list is built from that same rule, so the control cannot offer a change the
 * server will refuse. The server still validates: this list is a convenience,
 * not the enforcement.
 *
 * PARTIALLY RECEIVED IS NOT SELECTABLE, deliberately, and neither is returning
 * to Open. Those are CONSEQUENCES of booking a GRN — the receipt service
 * recomputes them from the total quantity received across every receipt on the
 * order. Offering them here would let someone mark an order received when
 * nothing arrived, and the next GRN would overwrite the claim anyway. The
 * current status is shown in the dropdown so it reads as a status field, but
 * choosing it again does nothing.
 *
 * Closing by hand is for short-closing an order the vendor will not complete.
 */
export function PurchaseOrderActions({ order }: { order: PurchaseOrderListItem }) {
  const [state, action] = useAction(changePurchaseOrderStatusAction);

  // Mirrors ALLOWED_TRANSITIONS in purchase-orders.service.ts.
  const selectable: PurchaseOrderStatus[] =
    order.status === 'OPEN' || order.status === 'PARTIALLY_RECEIVED'
      ? ['CLOSED', 'CANCELLED']
      : [];

  const receivable = order.status === 'OPEN' || order.status === 'PARTIALLY_RECEIVED';
  const outstanding = order.lines.some((line) => line.quantityPending !== '0');

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="max-w-[20rem] text-left">
        <ActionMessage state={state} />
      </div>

      {/* The next step in the workflow, offered where the order is rather than
          leaving the user to find the GRN tab and re-pick the order there. */}
      {receivable && outstanding && (
        <a
          href={`${PROCUREMENT_ROUTES.goodsReceipts}?purchaseOrderId=${order.id}`}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Create GRN
        </a>
      )}

      {selectable.length > 0 && (
        <form action={action} className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`po-status-${order.id}`}>
            Status for {order.number}
          </label>

          <input type="hidden" name="id" value={order.id} />

          <select
            id={`po-status-${order.id}`}
            name="status"
            defaultValue={order.status}
            className="field-sm"
          >
            {/* The current value first, as a no-op, so the control reads as
                "this order's status" rather than "pick a destructive action". */}
            <option value={order.status}>{PURCHASE_ORDER_STATUS_LABELS[order.status]}</option>
            {selectable.map((status) => (
              <option key={status} value={status}>
                {PURCHASE_ORDER_STATUS_LABELS[status]}
              </option>
            ))}
          </select>

          <SubmitButton variant="secondary" pendingLabel="…">
            Update
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
