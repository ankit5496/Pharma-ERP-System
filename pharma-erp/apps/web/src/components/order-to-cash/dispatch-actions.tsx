'use client';

import { useState, useTransition } from 'react';
import type { DispatchListItem, SalesInvoiceListItem } from '@pharma-erp/types';

import { createDispatchAction, markDeliveredAction } from './actions';
import { Money, Note, PRIMARY_BUTTON, SECONDARY_BUTTON } from './ui';

/**
 * Records a dispatch against an issued invoice.
 *
 * Ships everything the invoice reserved. The transport fields are the only free
 * input, because they are the only facts this document adds that are not already
 * determined by the invoice and its allocations — quantities come from the
 * reservation, which is what makes "cannot dispatch more than allocated"
 * structural rather than a validation rule someone could get around.
 */
export function NewDispatchForm({
  invoices,
  invoicesError,
}: {
  invoices: readonly SalesInvoiceListItem[];
  invoicesError: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [salesInvoiceId, setSalesInvoiceId] = useState('');
  const [dispatchDate, setDispatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div>
          <p className="text-sm font-medium text-slate-900">Dispatch an invoice</p>
          <p className="mt-0.5 text-sm text-slate-600">
            {invoices.length === 0
              ? 'No issued invoice is currently awaiting dispatch.'
              : `${invoices.length} invoice${invoices.length === 1 ? '' : 's'} awaiting dispatch. Recording one reduces finished-goods stock.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={invoices.length === 0}
          className={PRIMARY_BUTTON}
        >
          + New dispatch
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">New dispatch</h3>
          <p className="mt-1 text-sm text-slate-600">
            Ships exactly what the invoice reserved. Stock is reduced as this is saved.
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

      {invoicesError && (
        <div className="mt-5">
          <Note tone="red">Could not load invoices: {invoicesError}</Note>
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
          if (!salesInvoiceId) {
            setMessage({ kind: 'error', text: 'Choose an invoice.' });
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
              salesInvoiceId,
              dispatchDate,
              transporterName: text('transporterName'),
              vehicleNumber: text('vehicleNumber'),
              lrNumber: text('lrNumber'),
              ewayBillNumber: text('ewayBillNumber'),
              notes: text('notes'),
            });

            if (result.ok) {
              setMessage({
                kind: 'success',
                text: `Dispatch ${result.data?.dispatchNumber ?? ''} recorded. Finished-goods stock has been reduced and the movement written to the inventory ledger.`,
              });
              setSalesInvoiceId('');
            } else {
              setMessage({ kind: 'error', text: result.error ?? 'That did not work.' });
            }
          });
        }}
      >
        <div className="lg:col-span-2">
          <label htmlFor="dsp-invoice" className="field-label">
            Invoice <span className="text-red-600">*</span>
          </label>
          <select
            id="dsp-invoice"
            value={salesInvoiceId}
            onChange={(event) => setSalesInvoiceId(event.target.value)}
            className="field mt-1.5"
          >
            <option value="">Choose an invoice…</option>
            {invoices.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {invoice.invoiceNumber} — {invoice.customerName} ({invoice.grandTotal})
              </option>
            ))}
          </select>
          {salesInvoiceId && (
            <p className="field-hint">
              Everything reserved for this invoice will be shipped.{' '}
              {(() => {
                const invoice = invoices.find((candidate) => candidate.id === salesInvoiceId);
                return invoice ? (
                  <>
                    Value <Money value={invoice.grandTotal} />.
                  </>
                ) : null;
              })()}
            </p>
          )}
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
            className="field mt-1.5"
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
            className="field mt-1.5"
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
            className="field mt-1.5"
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
            className="field mt-1.5"
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
            className="field mt-1.5"
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="dsp-notes" className="field-label">
            Notes
          </label>
          <input
            id="dsp-notes"
            name="notes"
            maxLength={2000}
            autoComplete="off"
            className="field mt-1.5"
          />
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <button type="submit" disabled={pending || !salesInvoiceId} className={PRIMARY_BUTTON}>
            {pending ? 'Recording…' : 'Record dispatch & reduce stock'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function DispatchRowActions({ dispatch }: { dispatch: DispatchListItem }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (dispatch.status !== 'DISPATCHED') {
    return <span className="text-xs text-slate-400">—</span>;
  }

  return (
    <div className="min-w-[7rem]">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await markDeliveredAction(dispatch.id);
            if (!result.ok) setError(result.error ?? 'That did not work.');
          });
        }}
        className={SECONDARY_BUTTON}
      >
        {pending ? 'Saving…' : 'Mark delivered'}
      </button>

      {error && (
        <p role="alert" className="mt-2 max-w-xs text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
