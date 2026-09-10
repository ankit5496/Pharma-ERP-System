'use client';

import type { PartySummary, RequisitionListItem } from '@pharma-erp/types';

import {
  changeRequisitionStatusAction,
  convertRequisitionAction,
} from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, Disclosure, Field, SubmitButton, useAction } from './form-kit';

/**
 * Row actions for a requisition, offered strictly by status.
 *
 * The buttons mirror the API's state machine rather than showing everything
 * and letting the server refuse: an Approve button on a cancelled requisition
 * is a promise the system will not keep.
 *
 * BOTH ACTION STATES LIVE HERE, not in the buttons and forms below. Every one
 * of those disappears the moment its action succeeds — approving removes the
 * Approve button, converting removes the whole cell — so a `useActionState`
 * held inside them would unmount before it could report anything, and the user
 * would see a click that apparently did nothing. This component survives the
 * status change, so the message does too.
 */
export function RequisitionActions({
  requisition,
  vendors,
}: {
  requisition: RequisitionListItem;
  vendors: readonly PartySummary[];
}) {
  const [statusState, statusAction] = useAction(changeRequisitionStatusAction);
  const [convertState, convertAction] = useAction(convertRequisitionAction);

  const { status } = requisition;
  const terminal = status === 'CONVERTED_TO_PO' || status === 'CANCELLED';

  return (
    <div className="flex flex-col items-start gap-2">
      <ActionMessage state={statusState} />
      <ActionMessage state={convertState} />

      {terminal ? (
        <span className="text-xs text-slate-400">No actions</span>
      ) : (
        <>
          {status === 'DRAFT' && (
            <StatusButton id={requisition.id} status="PENDING" label="Submit" action={statusAction} />
          )}

          {status === 'PENDING' && (
            <StatusButton
              id={requisition.id}
              status="APPROVED"
              label="Approve"
              variant="primary"
              action={statusAction}
            />
          )}

          {status === 'APPROVED' && (
            <ConvertForm requisition={requisition} vendors={vendors} action={convertAction} />
          )}

          <StatusButton
            id={requisition.id}
            status="CANCELLED"
            label="Cancel"
            action={statusAction}
          />
        </>
      )}
    </div>
  );
}

function StatusButton({
  id,
  status,
  label,
  variant = 'secondary',
  action,
}: {
  id: string;
  status: string;
  label: string;
  variant?: 'primary' | 'secondary';
  action: (formData: FormData) => void;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton variant={variant} pendingLabel="…">
        {label}
      </SubmitButton>
    </form>
  );
}

/**
 * Approved requisition -> purchase order.
 *
 * Vendor, rate and GST are asked for here because a requisition does not carry
 * them: it says what is needed, not what it costs. The resulting order line
 * keeps a link back to this requisition, which is what makes the order
 * traceable to the shortage that caused it.
 */
function ConvertForm({
  requisition,
  vendors,
  action,
}: {
  requisition: RequisitionListItem;
  vendors: readonly PartySummary[];
  action: (formData: FormData) => void;
}) {
  return (
    <Disclosure
      label="Convert to PO"
      title={`Purchase order from ${requisition.number}`}
      openLabel={`Raise a purchase order for ${requisition.item.name}`}
    >
      {() => (
        <form action={action} className="w-[min(28rem,80vw)] space-y-3">
          <input type="hidden" name="id" value={requisition.id} />

          <p className="text-xs text-slate-600">
            {requisition.requiredQuantity} {requisition.item.uom.toLowerCase()} of{' '}
            <span className="font-medium">{requisition.item.name}</span>
          </p>

          <Field label="Vendor" htmlFor={`po-vendor-${requisition.id}`} required>
            <select
              id={`po-vendor-${requisition.id}`}
              name="vendorId"
              required
              defaultValue={requisition.preferredVendor?.id ?? ''}
              className="field-sm w-full"
            >
              <option value="">Choose a vendor</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Rate per unit" htmlFor={`po-rate-${requisition.id}`} required>
              <input
                id={`po-rate-${requisition.id}`}
                name="rate"
                required
                inputMode="decimal"
                className="field-sm w-full"
              />
            </Field>

            <Field label="GST %" htmlFor={`po-tax-${requisition.id}`}>
              <input
                id={`po-tax-${requisition.id}`}
                name="taxRatePercent"
                inputMode="decimal"
                defaultValue="12"
                className="field-sm w-full"
              />
            </Field>
          </div>

          <Field label="Expected delivery" htmlFor={`po-eta-${requisition.id}`}>
            <input
              id={`po-eta-${requisition.id}`}
              name="expectedDeliveryDate"
              type="date"
              className="field-sm w-full"
            />
          </Field>

          <SubmitButton pendingLabel="Creating…">Create purchase order</SubmitButton>
        </form>
      )}
    </Disclosure>
  );
}
