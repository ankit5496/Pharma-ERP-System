'use client';

import { useState, useTransition } from 'react';
import type { DispatchListItem } from '@pharma-erp/types';

import {
  confirmDispatchAction,
  createDispatchAction,
  markDeliveredAction,
  updateDispatchAction,
} from './actions';
import { EditButton, EditDialog } from './edit-kit';
import { SearchableSelect } from './searchable-select';
import { Note, PRIMARY_BUTTON, SECONDARY_BUTTON } from './ui';

/** One allocated batch with stock still to ship. */
export interface ReadyLine {
  batchAllocationId: string;
  itemCode: string;
  itemName: string;
  batchNumber: string;
  expiryDate: string;
  quantityToShip: string;
}

/** An order with allocations waiting to leave. */
export interface ReadyOrder {
  salesOrderId: string;
  orderNumber: string;
  customerName: string;
  lines: ReadyLine[];
}

/**
 * Records a dispatch against an order's ALLOCATIONS.
 *
 * Ships everything still reserved on the order. The transport fields are the
 * only free input, because they are the only facts this document adds that are
 * not already determined by the allocation — quantities come from the
 * reservation, which is what makes "cannot dispatch more than allocated"
 * structural rather than a validation rule someone could get around.

 */
export function NewDispatchForm({
  orders,
  ordersError,
  inDialog = false,
}: {
  orders: readonly ReadyOrder[];
  ordersError: string | null;
  /**
   * Rendered inside the panel's create dialog, which already supplies the
   * title, the description and a way out — so the trigger card and the
   * internal header are suppressed rather than drawn twice.
   */
  inDialog?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [salesOrderId, setSalesOrderId] = useState('');
  const [dispatchDate, setDispatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = orders.find((order) => order.salesOrderId === salesOrderId) ?? null;

  if (!inDialog && !open) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div>
          <p className="text-sm font-medium text-slate-900">Dispatch an allocated order</p>
          <p className="mt-0.5 text-sm text-slate-600">
            {orders.length === 0
              ? 'No order currently has stock allocated and waiting to ship. Reserve batches on the Allocation tab first.'
              : `${orders.length} order${orders.length === 1 ? '' : 's'} with stock reserved. Recording a dispatch reduces finished-goods stock; the invoice is raised afterwards.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={orders.length === 0}
          className={PRIMARY_BUTTON}
        >
          New dispatch
        </button>
      </div>
    );
  }

  return (
    <div className={inDialog ? '' : 'rounded-lg border border-slate-200 bg-white p-6 shadow-sm'}>
      {!inDialog && (
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">New dispatch</h3>
          <p className="mt-1 text-sm text-slate-600">
            Ships exactly what is still allocated on the order. Stock is reduced when the dispatch
            is confirmed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setMessage(null);
          }}
          className={SECONDARY_BUTTON}
        >
          Cancel
        </button>
      </div>
      )}

      {ordersError && (
        <div className="mt-5">
          <Note tone="red">Could not load allocations: {ordersError}</Note>
        </div>
      )}

      {message && (
        <div className="mt-5">
          {message.kind === 'error' ? (
            <Note tone="red">
              <p className="font-semibold">Not dispatched</p>
              <p className="mt-1">{message.text}</p>
            </Note>
          ) : (
            <Note tone="blue">{message.text}</Note>
          )}
        </div>
      )}

      <form
        className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        action={(formData) => {
          if (!selected) {
            setMessage({ kind: 'error', text: 'Choose an order.' });
            return;
          }

          const text = (key: string): string | undefined => {
            const value = formData.get(key);
            if (typeof value !== 'string') return undefined;
            return value.trim() || undefined;
          };

          setMessage(null);

          startTransition(async () => {
            const result = await createDispatchAction({
              dispatchDate,
              lines: selected.lines.map((line) => ({
                batchAllocationId: line.batchAllocationId,
                quantityDispatched: line.quantityToShip,
              })),
              transporterName: text('transporterName'),
              vehicleNumber: text('vehicleNumber'),
              lrNumber: text('lrNumber'),
              ewayBillNumber: text('ewayBillNumber'),
              notes: text('notes'),
            });

            if (result.ok) {
              setMessage({
                kind: 'success',
                text: `Dispatch ${result.data?.dispatchNumber ?? ''} created as a draft. Confirm it in the table below to reduce stock — the invoice becomes available after that.`,
              });
              setSalesOrderId('');
            } else {
              setMessage({ kind: 'error', text: result.error ?? 'That did not work.' });
            }
          });
        }}
      >
        <div>
          <label htmlFor="dsp-order" className="field-label">
            Order <span className="text-red-600">*</span>
          </label>
          <div className="mt-1.5">
            <SearchableSelect
              id="dsp-order"
              value={salesOrderId}
              onChange={setSalesOrderId}
              placeholder="Search by order number or customer…"
              options={orders.map((order) => ({
                value: order.salesOrderId,
                label: `${order.orderNumber} — ${order.customerName}`,
                hint: `${order.lines.length} line${order.lines.length === 1 ? '' : 's'}`,
              }))}
            />
          </div>
        </div>

        <div>
          <label htmlFor="dsp-date" className="field-label">
            Dispatch date <span className="text-red-600">*</span>
          </label>
          <input
            id="dsp-date"
            type="date"
            value={dispatchDate}
            onChange={(event) => setDispatchDate(event.target.value)}
            className="field mt-1.5 h-10"
          />
        </div>

        <div>
          <label htmlFor="transporterName" className="field-label">
            Transporter
          </label>
          <input
            id="transporterName"
            name="transporterName"
            maxLength={255}
            autoComplete="off"
            className="field mt-1.5 h-10"
          />
        </div>

        <div>
          <label htmlFor="vehicleNumber" className="field-label">
            Vehicle number
          </label>
          <input
            id="vehicleNumber"
            name="vehicleNumber"
            maxLength={32}
            autoComplete="off"
            className="field mt-1.5 h-10"
          />
        </div>

        <div>
          <label htmlFor="lrNumber" className="field-label">
            LR / consignment number
          </label>
          <input
            id="lrNumber"
            name="lrNumber"
            maxLength={64}
            autoComplete="off"
            className="field mt-1.5 h-10"
          />
        </div>

        <div>
          <label htmlFor="ewayBillNumber" className="field-label">
            E-way bill number
          </label>
          <input
            id="ewayBillNumber"
            name="ewayBillNumber"
            maxLength={32}
            autoComplete="off"
            className="field mt-1.5 h-10"
          />
        </div>

        <div>
          <label htmlFor="dsp-notes" className="field-label">
            Notes
          </label>
          <input
            id="dsp-notes"
            name="notes"
            maxLength={1000}
            autoComplete="off"
            className="field mt-1.5 h-10"
          />
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <button
            type="submit"
            disabled={pending || !salesOrderId}
            className={PRIMARY_BUTTON}
          >
            {pending ? 'Recording…' : 'Create dispatch'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Confirm, then mark delivered.
 *
 * Two steps because they are two events: confirming is the stock leaving, and
 * delivery is the customer receiving it, often days apart. Confirming is also
 * what makes the invoice available, so it is the one that has to be explicit.
 */
export function DispatchRowActions({ dispatch }: { dispatch: DispatchListItem }) {
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? 'That did not work.');
    });
  };

  if (dispatch.status !== 'DRAFT' && dispatch.status !== 'DISPATCHED') {
    return <span className="text-xs text-slate-400">—</span>;
  }

  return (
    <div className="min-w-[8rem]">
      {/* DRAFT only: once confirmed the stock has left and the note records a
          movement rather than a plan. */}
      {dispatch.status === 'DRAFT' && (
        <div className="mb-1.5">
          <EditButton onClick={() => setEditing(true)} />
        </div>
      )}

      {dispatch.status === 'DRAFT' ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => confirmDispatchAction(dispatch.id))}
          className={PRIMARY_BUTTON}
        >
          {pending ? 'Confirming…' : 'Confirm & reduce stock'}
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => markDeliveredAction(dispatch.id))}
          className={SECONDARY_BUTTON}
        >
          {pending ? 'Saving…' : 'Mark delivered'}
        </button>
      )}

      {editing && (
        <EditDialog
          title={`Edit ${dispatch.dispatchNumber}`}
          description={`${dispatch.orderNumber} · ${dispatch.customerName}`}
          note="What ships is what allocation reserved, so the lines are not editable here. To ship different quantities, release the allocation and allocate again."
          fields={[
            { name: 'dispatchDate', label: 'Dispatch date', value: dispatch.dispatchDate, type: 'date' },
            { name: 'transporterName', label: 'Transporter', value: dispatch.transporterName ?? '' },
            { name: 'vehicleNumber', label: 'Vehicle number', value: dispatch.vehicleNumber ?? '' },
            { name: 'lrNumber', label: 'LR / consignment number', value: dispatch.lrNumber ?? '' },
            { name: 'ewayBillNumber', label: 'E-way bill number', value: dispatch.ewayBillNumber ?? '' },
            { name: 'notes', label: 'Notes', value: '', wide: true },
          ]}
          onClose={() => setEditing(false)}
          onSave={(patch) => updateDispatchAction(dispatch.id, patch)}
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
