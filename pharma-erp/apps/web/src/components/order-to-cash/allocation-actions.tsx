'use client';

import { useState, useTransition } from 'react';
import type { AllocationRow } from '@pharma-erp/types';

import {
  allocateOrderAction,
  releaseAllocationAction,
  updateAllocationAction,
} from './actions';
import { EditButton, EditDialog } from './edit-kit';
import { DANGER_BUTTON, PRIMARY_BUTTON } from './ui';

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

  return (
    <div className="text-right">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await allocateOrderAction(salesOrderId);

            setMessage(
              result.ok
                ? { kind: 'info', text: `Stock reserved for ${orderNumber}, nearest expiry first.` }
                : { kind: 'error', text: result.error ?? 'That did not work.' },
            );
          });
        }}
        className={PRIMARY_BUTTON}
      >
        {pending ? 'Allocating…' : 'Allocate (FEFO)'}
      </button>

      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`mt-2 max-w-xs text-xs ${
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
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const canRelease = ['ALLOCATED', 'PARTIALLY_DISPATCHED'].includes(allocation.status);
  // ALLOCATED only: once any part has shipped the row records a movement.
  const canEdit = allocation.status === 'ALLOCATED';

  return (
    <div className="min-w-[9rem]">
      <div className="flex flex-wrap gap-1.5">
        {canEdit && <EditButton onClick={() => setEditing(true)} />}

        {canRelease && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (
                !window.confirm(
                  `Release batch ${allocation.batchNumber} back to free stock?\n\n` +
                    `Anything already dispatched stays dispatched — only the undispatched ` +
                    `remainder is returned.`,
                )
              ) {
                return;
              }

              setError(null);
              startTransition(async () => {
                const result = await releaseAllocationAction(allocation.id);
                if (!result.ok) setError(result.error ?? 'That did not work.');
              });
            }}
            className={DANGER_BUTTON}
          >
            Release
          </button>
        )}

        {!canEdit && !canRelease && <span className="text-xs text-slate-400">—</span>}
      </div>

      {editing && (
        <EditDialog
          title={`Adjust ${allocation.itemCode} on ${allocation.orderNumber}`}
          description={`Batch ${allocation.batchNumber} · expires ${allocation.expiryDate}`}
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
    </div>
  );
}
