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
 * THE DROPDOWN LISTS ALL FIVE STATUSES AND DISABLES THE UNREACHABLE ONES, with
 * the reason attached. Listing them all makes the control read as a status
 * field rather than a menu of actions, and answering "why not?" in place beats
 * an error after the fact.
 *
 * PARTIALLY RECEIVED IS THE ONLY ONE NEVER SELECTABLE. It is a fact about what
 * turned up, computed from the line quantities on every receipt — offering it
 * would let an order claim a delivery that never happened, and the next GRN
 * would overwrite the claim anyway. Everything else is a decision somebody is
 * entitled to make.
 *
 * CLOSING AN ORDER WITH MATERIAL STILL DUE IS ALLOWED, and no longer does any
 * harm: whether an order appears for goods receipt is decided by its PENDING
 * QUANTITY, not by its status. A closed order with a balance outstanding stays
 * in the GRN picker and accepts the rest if it turns up — which is the defect
 * this replaced, where closing hid it permanently.
 */
export function PurchaseOrderActions({ order }: { order: PurchaseOrderListItem }) {
  const [state, action] = useAction(changePurchaseOrderStatusAction);

  const pendingLines = order.lines.filter((line) => line.quantityPending !== '0');
  const pending = pendingLines.length > 0;
  const cancelled = order.status === 'CANCELLED';

  // Mirrors ALLOWED_TRANSITIONS in purchase-orders.service.ts. The server list
  // is the one that decides; this only decides what to draw.
  const blockedBecause = (status: PurchaseOrderStatus): string | null => {
    if (status === order.status) return null;

    switch (status) {
      case 'APPROVED':
        return order.status === 'OPEN' ? null : 'Only an open order can be approved.';
      case 'OPEN':
        return order.status === 'APPROVED' ? null : 'Set from what has been received.';
      case 'PARTIALLY_RECEIVED':
        return 'Set automatically when material is received.';
      // Both always available: closing early is a judgement the buyer is
      // entitled to make, and it no longer locks the order out of receiving.
      case 'CLOSED':
      case 'CANCELLED':
        return null;
      default:
        return null;
    }
  };

  // A cancelled order is finished in every sense; a closed one has nowhere left
  // to go. Neither offers a control rather than offering one that only refuses.
  const settled = cancelled || order.status === 'CLOSED';

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="max-w-[22rem] text-left">
        <ActionMessage state={state} />
      </div>

      {settled ? (
        <p className="text-xs text-slate-500">{PURCHASE_ORDER_STATUS_LABELS[order.status]}</p>
      ) : (
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
            {PURCHASE_ORDER_STATUSES_IN_ORDER.map((status) => {
              const blocked = blockedBecause(status);

              return (
                <option
                  key={status}
                  value={status}
                  disabled={blocked !== null}
                  title={blocked ?? undefined}
                >
                  {PURCHASE_ORDER_STATUS_LABELS[status]}
                  {blocked ? ` — ${blocked}` : ''}
                </option>
              );
            })}
          </select>

          <SubmitButton variant="secondary" pendingLabel="…">
            Update
          </SubmitButton>
        </form>
      )}

      {/* What is still owed, so the status above reads as a consequence rather
          than as something somebody typed. Shown even on a closed order,
          because a closed order with a balance can still be received against. */}
      {pending && !cancelled && (
        <p className="text-[11px] tabular-nums text-amber-800">
          {pendingLines.length} line{pendingLines.length === 1 ? '' : 's'} still pending
        </p>
      )}

      {pending && !cancelled && (
        <a
          href={`${PROCUREMENT_ROUTES.goodsReceipts}?purchaseOrderId=${order.id}`}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Create GRN
        </a>
      )}
    </div>
  );
}

/** Listed in workflow order, which is how a reader expects to scan them. */
const PURCHASE_ORDER_STATUSES_IN_ORDER: readonly PurchaseOrderStatus[] = [
  'OPEN',
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'CLOSED',
  'CANCELLED',
];
