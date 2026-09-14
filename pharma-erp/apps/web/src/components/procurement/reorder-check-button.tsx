'use client';

import { runReorderCheckAction } from '@/app/(app)/workflows/procure-to-pay/actions';

import { ActionMessage, SubmitButton, useAction } from './form-kit';

/**
 * Runs the reorder check.
 *
 * The check also runs automatically after any stock movement, so this button
 * is a manual re-run rather than the only way to trigger it — useful after
 * changing an item's reorder level, when nothing moved but the threshold did.
 *
 * Idempotent: an item that already has an open or approved requisition is
 * skipped, so pressing it twice raises nothing the second time. That property
 * is what makes it safe to expose as a button at all.
 *
 * It respects Auto Creation. With the switch off the API raises nothing and
 * says so, and the caller passes a pending count of zero, so the button reads
 * as a check rather than promising to create something it will not.
 */
export function ReorderCheckButton({ pendingCount }: { pendingCount: number }) {
  const [state, action] = useAction(runReorderCheckAction);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="max-w-[22rem] text-left">
        <ActionMessage state={state} />
      </div>

      <form action={action}>
        <SubmitButton variant={pendingCount > 0 ? 'primary' : 'secondary'} pendingLabel="Checking…">
          {pendingCount > 0
            ? `Run reorder check (${pendingCount} to raise)`
            : 'Run reorder check'}
        </SubmitButton>
      </form>
    </div>
  );
}
