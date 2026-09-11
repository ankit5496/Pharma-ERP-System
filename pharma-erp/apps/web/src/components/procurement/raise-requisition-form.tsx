'use client';

import { type ItemSummary, type PartySummary } from '@pharma-erp/types';

import { createRequisitionAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, Disclosure, Field, SubmitButton, useAction } from './form-kit';
import { Pill } from './ui';

/**
 * Raises a requisition for one low-stock item.
 *
 * The quantity is pre-filled with the shortfall, which is the smallest order
 * that clears it and therefore the right starting point — the buyer usually
 * rounds up to a pack size, and starting from the real number makes that a
 * deliberate decision rather than a guess.
 *
 * THE "ALREADY REQUISITIONED" BRANCH IS INSIDE THIS COMPONENT, not in the
 * parent that renders it, and that placement is load-bearing. A successful
 * submit revalidates the page, which flips `hasOpenRequisition` to true. If
 * the parent chose between a pill and this form, this component would unmount
 * at that moment and take its `useActionState` with it — the action would
 * succeed and the user would see no confirmation at all. Keeping the branch
 * here means the component survives the swap and can still show what happened.
 */
export function RaiseRequisitionForm({
  item,
  suggestedQuantity,
  vendors,
  hasOpenRequisition,
}: {
  item: ItemSummary;
  suggestedQuantity: string;
  vendors: readonly PartySummary[];
  /** True when a draft, pending or approved requisition already covers this item. */
  hasOpenRequisition: boolean;
}) {
  // Called before any branch: hooks must run unconditionally, and this state
  // is exactly what has to outlive the branch changing.
  const [state, formAction] = useAction(createRequisitionAction);

  if (hasOpenRequisition) {
    return (
      <div className="flex flex-col items-start gap-1">
        <ActionMessage state={state} />
        {/* Flagged rather than hidden: the shortage is still real, and the
            buyer needs to know it is in hand instead of raising a duplicate. */}
        <Pill tone="info">Requisition open</Pill>
      </div>
    );
  }

  return (
    <Disclosure label="Raise requisition" title={`Requisition for ${item.name}`}>
      {() => (
        <form action={formAction} className="space-y-3">
          <ActionMessage state={state} />

          <input type="hidden" name="itemId" value={item.id} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={`Required quantity (${item.uom})`}
              htmlFor={`qty-${item.id}`}
              required
              hint="Pre-filled with the shortfall."
            >
              <input
                id={`qty-${item.id}`}
                name="requiredQuantity"
                required
                inputMode="decimal"
                defaultValue={state.values?.requiredQuantity ?? suggestedQuantity}
                className="field-sm w-full"
              />
            </Field>

            <Field label="Preferred vendor" htmlFor={`vendor-${item.id}`}>
              <select
                id={`vendor-${item.id}`}
                name="preferredVendorId"
                className="field-sm w-full"
                defaultValue=""
              >
                <option value="">Not specified</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Required by" htmlFor={`by-${item.id}`}>
              <input
                id={`by-${item.id}`}
                name="requiredByDate"
                type="date"
                className="field-sm w-full"
              />
            </Field>

            <Field label="Notes" htmlFor={`notes-${item.id}`}>
              <input
                id={`notes-${item.id}`}
                name="notes"
                maxLength={1000}
                defaultValue={state.values?.notes ?? ''}
                className="field-sm w-full"
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pendingLabel="Raising…">Submit for approval</SubmitButton>

            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" name="asDraft" className="rounded border-slate-300" />
              Save as draft instead
            </label>
          </div>
        </form>
      )}
    </Disclosure>
  );
}
