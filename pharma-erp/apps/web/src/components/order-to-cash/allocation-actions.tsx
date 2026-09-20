'use client';

import { RowActionMenu, type RowAction } from '@/components/row-action-menu';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { AllocationRow } from '@pharma-erp/types';

import {
  allocateOrderAction,
  releaseAllocationAction,
  updateAllocationAction,
} from './actions';
import { ConfirmDialog } from './confirm-dialog';
import { EditDialog } from './edit-kit';
import { formatDate, PRIMARY_BUTTON } from './ui';

/**
 * Commits the FEFO allocation for one order.
 *
 * Sends nothing but the order id. The batches, the quantities and the order they
 * are drawn in are all decided server-side — there is no payload here that could
 * nominate a batch, which is what keeps the expiry rule and the release-status
 * rule from being negotiable.
 *
 * A shortfall comes back as a SUCCESS with less allocated than asked for, not as
 * an error, so the message distinguishes "allocated" from "partly allocated".
 */
export function AllocateOrderButton({
  salesOrderId,
  orderNumber,
}: {
  salesOrderId: string;
  orderNumber: string;
}) {
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * `revalidatePath` in the action marks the server's copy stale; it does not
   * guarantee the tab you are looking at re-renders, because the client router
   * holds its own cache of this route keyed by its query string — the search
   * term, the filters and the page number this screen writes there. Asking the
   * router to refresh after the write is what puts the new reservation in the
   * table you are already looking at, rather than on your next visit.
   */
  const router = useRouter();

  return (
    // Centred under the Actions heading. It was `text-right` for the stacked
    // list this button used to sit in, where it hugged the row's right edge —
    // and that beat the cell's own alignment once the list became a table.
    <div className="text-center">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await allocateOrderAction(salesOrderId);

            if (!result.ok) {
              setMessage({ kind: 'error', text: result.error ?? 'That did not work.' });
              return;
            }

            // Names the batches it took. They are the newest rows in the
            // Reservations table below — which is ordered newest first — so
            // this says what to look for rather than only that something
            // happened.
            // The endpoint answers with every reservation the order holds, not
            // only the ones just made, so this reads as a statement of where
            // the order now stands.
            const reserved = result.data ?? [];
            const picks = reserved
              .map(
                (row) =>
                  `${row.quantityAllocated} from ${row.batchNumber} (expires ${formatDate(
                    row.expiryDate,
                  )})`,
              )
              .join(', ');

            setMessage({
              kind: 'info',
              text: picks
                ? `${orderNumber} now holds ${picks}. Nearest expiry first — the rows are at the top of Reservations below.`
                : `Stock reserved for ${orderNumber}, nearest expiry first.`,
            });

            router.refresh();
          });
        }}
        className={PRIMARY_BUTTON}
      >
        {pending ? 'Allocating…' : 'Allocate (FEFO)'}
      </button>

      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`mx-auto mt-2 max-w-xs text-xs ${
            message.kind === 'error' ? 'text-red-700' : 'text-slate-600'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

/**
 * Per-reservation actions: record the schedule re-check, or hand the stock back.
 *
 * The re-check button appears only where one is actually required and
 * outstanding. Offering it everywhere would turn a compliance step into UI
 * furniture, and the whole value of the step is that its presence means
 * something.
 */
export function AllocationRowActions({ allocation }: { allocation: AllocationRow }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const canRelease = ['ALLOCATED', 'PARTIALLY_DISPATCHED'].includes(allocation.status);
  // ALLOCATED only: once any part has shipped the row records a movement.
  const canEdit = allocation.status === 'ALLOCATED';

  const release = () => {
    setError(null);
    startTransition(async () => {
      const result = await releaseAllocationAction(allocation.id);
      if (!result.ok) setError(result.error ?? 'That did not work.');
      else {
        setConfirming(false);
        router.refresh();
      }
    });
  };

  const actions: RowAction[] = [
    {
      label: 'Edit',
      onSelect: () => setEditing(true),
      disabledReason: canEdit
        ? null
        : 'Part of this allocation has shipped, so the row records a movement.',
    },
    {
      label: 'Release',
      onSelect: () => setConfirming(true),
      disabledReason: canRelease ? null : 'Nothing is reserved on this row to release.',
    },
  ];

  return (
    <>
      <RowActionMenu
        label={`${allocation.itemCode} on ${allocation.orderNumber}`}
        actions={actions}
        busy={pending}
      />

      {confirming && (
        <ConfirmDialog
          title={`Release batch ${allocation.batchNumber}?`}
          description="The undispatched quantity returns to free stock and can be allocated to another order. Anything already dispatched stays dispatched."
          details={[
            { label: 'Order', value: `${allocation.orderNumber} · ${allocation.customerName}` },
            { label: 'Product', value: `${allocation.itemName} (${allocation.itemCode})` },
            { label: 'Reserved', value: allocation.quantityAllocated },
            { label: 'Already dispatched', value: allocation.quantityDispatched },
          ]}
          confirmLabel="Release to free stock"
          pending={pending}
          onConfirm={release}
          onClose={() => setConfirming(false)}
        />
      )}

      {editing && (
        <EditDialog
          title={`Edit ${allocation.orderNumber}`}
          // The product moves down here with the batch it was picked from, so
          // the heading reads like every other Edit dialog in the module.
          description={`${allocation.itemCode} · batch ${allocation.batchNumber} · expires ${formatDate(
            allocation.expiryDate,
          )}`}
          note="The batch cannot be changed — FEFO picked it. To reserve a different batch, release this allocation and allocate again."
          fields={[
            {
              name: 'quantityAllocated',
              label: 'Quantity allocated',
              value: allocation.quantityAllocated,
              hint: `Ordered ${allocation.quantityOrdered}; ${allocation.quantityDispatched} already dispatched.`,
            },
            { name: 'notes', label: 'Note', value: '', wide: true },
          ]}
          onClose={() => setEditing(false)}
          onSave={(patch) => updateAllocationAction(allocation.id, patch)}
        />
      )}

      {error && (
        <p role="alert" className="mt-2 max-w-xs text-xs text-red-700">
          {error}
        </p>
      )}
    </>
  );
}
