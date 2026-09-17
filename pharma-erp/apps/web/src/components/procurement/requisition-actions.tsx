'use client';

import {
  PROCUREMENT_ROUTES,
  REQUISITION_STATUSES,
  REQUISITION_STATUS_LABELS,
  type PartySummary,
  type RequisitionListItem,
  type RequisitionStatus,
} from '@pharma-erp/types';
import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { changeRequisitionStatusAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { RowActionMenu, type RowAction } from '@/components/row-action-menu';

import { EditRequisitionButton } from './edit-dialogs';
import { ActionMessage, useAction } from './form-kit';

/**
 * Why a requisition cannot move to a given status, or null when it can.
 *
 * Mirrors the transitions the requisition service enforces. The server list is
 * the one that decides; this only decides what to draw, and attaches the reason
 * to the option so "why can I not approve this?" is answered in place rather
 * than by an error after the fact.
 *
 * CONVERTED TO PO IS NEVER SELECTABLE. It is a consequence of placing an order,
 * not a decision: the purchase-order service sets it in the same transaction
 * that makes the order live, and choosing it here would claim an order that
 * does not exist.
 */
function blockedBecause(current: RequisitionStatus, target: RequisitionStatus): string | null {
  if (target === current) return null;

  switch (target) {
    case 'OPEN':
      // Not reachable from anywhere. Approving is a signature, and unsigning it
      // by picking Open would leave no record that it ever happened.
      return 'Set when the requisition is raised.';
    case 'APPROVED':
      return current === 'OPEN' ? null : 'Only an open requisition can be approved.';
    case 'CONVERTED_TO_PO':
      return 'Set automatically when a purchase order is placed.';
    case 'CANCELLED':
      return current === 'OPEN' || current === 'APPROVED'
        ? null
        : 'A requisition with an order against it cannot be cancelled.';
    default:
      return null;
  }
}

/**
 * The requisition's status, in the Status column, as the control that changes
 * it.
 *
 * NO UPDATE BUTTON. The dropdown used to sit in the actions cell beside an
 * Update button, so changing a status took two deliberate acts and the row
 * carried two controls for one field. Choosing a value IS the change now: the
 * select submits its own form.
 *
 * A REFUSAL PUTS THE OLD VALUE BACK. The select holds what was picked, but a
 * rejected change means the record did not move — leaving the new value on
 * screen would have the column reporting a status the database does not have.
 * The error itself is announced by the centred toast, like every other failure.
 *
 * THE COLUMN SAYS ONLY THE STATUS. It used to append who approved it, which put
 * a person's name in a column headed Status and made two rows of different
 * heights out of one field. Who raised the requisition has its own column; the
 * approver is on the record itself.
 */
export function RequisitionStatusSelect({ requisition }: { requisition: RequisitionListItem }) {
  const [state, action] = useAction(changeRequisitionStatusAction);
  const form = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState<string>(requisition.status);

  // The server re-render after a successful change brings the new status down
  // as a prop; this is what keeps the control in step with it.
  useEffect(() => {
    setValue(requisition.status);
  }, [requisition.status]);

  useEffect(() => {
    if (state.status === 'error') setValue(requisition.status);
  }, [state.status, requisition.status]);

  // Settled requisitions have nowhere left to go — cancelled is final, and
  // converted is owned by the order. A control that could only refuse is worse
  // than no control, so the status is stated instead.
  const settled = requisition.status === 'CANCELLED' || requisition.status === 'CONVERTED_TO_PO';

  if (settled) {
    return (
      <div className="flex flex-col gap-1">
        <ActionMessage state={state} />
        <span
          className="text-xs font-medium text-slate-600"
          title={REQUISITION_STATUS_LABELS[requisition.status]}
        >
          {REQUISITION_STATUS_LABELS[requisition.status]}
        </span>
      </div>
    );
  }

  return (
    <form action={action} ref={form} className="flex flex-col gap-1">
      <ActionMessage state={state} />

      <input type="hidden" name="id" value={requisition.id} />

      <label className="sr-only" htmlFor={`pr-status-${requisition.id}`}>
        Status for {requisition.number}
      </label>

      <StatusControl
        id={`pr-status-${requisition.id}`}
        value={value}
        current={requisition.status}
        onPick={(next) => {
          setValue(next);
          // requestSubmit rather than submit: it runs the form's action the way
          // a real submit does, which is what React needs to see.
          form.current?.requestSubmit();
        }}
      />

    </form>
  );
}

/**
 * Separate from the form above because `useFormStatus` only reports on a form
 * its component is rendered INSIDE — called alongside the `<form>` it would
 * always say idle, and the control would stay live through its own submit.
 */
function StatusControl({
  id,
  value,
  current,
  onPick,
}: {
  id: string;
  value: string;
  current: RequisitionStatus;
  onPick: (next: string) => void;
}) {
  const { pending } = useFormStatus();

  return (
    <select
      id={id}
      name="status"
      value={value}
      disabled={pending}
      onChange={(event) => onPick(event.target.value)}
      // The full label on hover, because the box is deliberately too narrow to
      // hold the longest of them.
      title={REQUISITION_STATUS_LABELS[value as RequisitionStatus]}
      className="field-sm w-32 truncate disabled:opacity-60"
    >
      {REQUISITION_STATUSES.map((status) => {
        const blocked = blockedBecause(current, status);

        return (
          <option
            key={status}
            value={status}
            disabled={blocked !== null}
            title={blocked ?? REQUISITION_STATUS_LABELS[status]}
          >
            {REQUISITION_STATUS_LABELS[status]}
          </option>
        );
      })}
    </select>
  );
}

/** Why this requisition can no longer be edited, by the status it reached. */
const NOT_EDITABLE: Record<RequisitionStatus, string> = {
  OPEN: '',
  APPROVED: 'An approved requisition can no longer be edited.',
  CONVERTED_TO_PO: 'An ordered requisition can no longer be edited.',
  CANCELLED: 'A cancelled requisition can no longer be edited.',
};

/**
 * What can be done with a requisition, beyond changing its status.
 *
 * THE STATUS CONTROL IS NOT HERE ANY MORE. It lives in the Status column, which
 * is where a reader looks for a status; keeping a copy here would be two
 * controls for one field.
 *
 * CONVERT TO PO IS NOT A STATUS CHANGE. It carries the user to the Purchase
 * orders tab with this requisition in hand, and the order is built there — this
 * screen's job is requisitions. The status becomes Converted as a consequence
 * of that order being placed, which is why it is never selectable above.
 */
export function RequisitionActions({
  requisition,
  vendors,
}: {
  requisition: RequisitionListItem;
  vendors: readonly PartySummary[];
}) {
  const [editing, setEditing] = useState(false);

  // The API accepts an edit only while the requisition is Open. Past that it
  // has been approved, ordered against or withdrawn, and the document is no
  // longer this screen's to rewrite.
  const editable = requisition.status === 'OPEN';

  // CONVERSION IS GATED ON APPROVED, and the same rule is enforced by the API —
  // `assertRequisitionConvertible` refuses anything else and refuses a second
  // order against a requisition that already has one. Greying the entry here
  // saves a round trip and says why; it is not what makes the rule hold, which
  // is why editing the page's state cannot get past it.
  const convertReason =
    requisition.status === 'APPROVED'
      ? requisition.linkedPurchaseOrders.length > 0
        ? `${requisition.linkedPurchaseOrders[0]!.number} already covers this requisition.`
        : null
      : 'Only an approved requisition can be converted to a purchase order.';

  const actions: RowAction[] = [
    {
      label: 'Edit',
      onSelect: () => setEditing(true),
      disabledReason: editable ? null : NOT_EDITABLE[requisition.status],
    },
    {
      label: 'Convert to PO',
      href: `${PROCUREMENT_ROUTES.purchaseOrders}?fromRequisition=${requisition.id}`,
      disabledReason: convertReason,
    },
  ];

  return (
    <div className="flex flex-col items-start gap-1.5">
      <RowActionMenu label={requisition.number} actions={actions} />

      {/* No trigger of its own: the menu entry above opens it. */}
      <EditRequisitionButton
        requisition={requisition}
        vendors={vendors}
        isOpen={editing}
        onOpenChange={setEditing}
      />
    </div>
  );
}
