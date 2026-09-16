'use client';

import { useState, useTransition } from 'react';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type ReceiptListItem,
  type SalesInvoiceListItem,
} from '@pharma-erp/types';

import { bounceReceiptAction, createReceiptAction } from './actions';
import { DANGER_BUTTON, Money, Note, PRIMARY_BUTTON, SECONDARY_BUTTON, formatDate } from './ui';

/**
 * Records a payment against an invoice.
 *
 * Choosing the invoice pre-fills the amount with its outstanding balance,
 * because settling in full is the common case and retyping a figure that is
 * already on screen is how a transposed digit gets in. It stays editable for a
 * part payment, and the API caps it at the outstanding balance either way —
 * inside a transaction that locks the invoice, so two people entering the same
 * cheque cannot both fit under the limit.
 */
export function NewReceiptForm({
  invoices,
  invoicesError,
  totalOutstanding,
}: {
  invoices: readonly SalesInvoiceListItem[];
  invoicesError: string | null;
  totalOutstanding: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = invoices.find((invoice) => invoice.id === selectedId) ?? null;

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div>
          <p className="text-sm font-medium text-slate-900">Record a payment</p>
          <p className="mt-0.5 text-sm text-slate-600">
            {invoices.length === 0 ? (
              'Nothing is currently outstanding.'
            ) : (
              <>
                {invoices.length} invoice{invoices.length === 1 ? '' : 's'} outstanding, totalling{' '}
                <Money value={totalOutstanding} />.
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={invoices.length === 0}
          className={PRIMARY_BUTTON}
        >
          + New receipt
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">New receipt</h3>
          <p className="mt-1 text-sm text-slate-600">
            Applied to one invoice. The amount cannot exceed its outstanding balance.
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
          <Note tone="red">Could not load outstanding invoices: {invoicesError}</Note>
        </div>
      )}

      {message && (
        <div className="mt-5">
          {message.kind === 'error' ? (
            <Note tone="red">
              <p className="font-semibold">Payment not recorded</p>
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
          setMessage(null);
          startTransition(async () => {
            const result = await createReceiptAction(formData);

            if (result.ok) {
              setMessage({
                kind: 'success',
                text: `Receipt ${result.data?.receiptNumber ?? ''} recorded. The customer's outstanding balance and the invoice payment status have both been updated.`,
              });
              setSelectedId('');
              setAmount('');
            } else {
              setMessage({ kind: 'error', text: result.error ?? 'That did not work.' });
            }
          });
        }}
      >
        <div className="lg:col-span-2">
          <label htmlFor="rcp-invoice" className="field-label">
            Invoice <span className="text-red-600">*</span>
          </label>
          <select
            id="rcp-invoice"
            name="salesInvoiceId"
            required
            value={selectedId}
            onChange={(event) => {
              setSelectedId(event.target.value);
              const invoice = invoices.find((candidate) => candidate.id === event.target.value);
              // Pre-filled for the common case. Still editable.
              setAmount(invoice?.amountOutstanding ?? '');
            }}
            className="field mt-1.5"
          >
            <option value="">Choose an invoice…</option>
            {invoices.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {invoice.invoiceNumber} — {invoice.customerName} ({invoice.amountOutstanding} due)
              </option>
            ))}
          </select>

          {selected && (
            <p className="field-hint">
              Total <Money value={selected.grandTotal} />, paid{' '}
              <Money value={selected.amountPaid} />, outstanding{' '}
              <strong className="font-semibold text-slate-700">
                <Money value={selected.amountOutstanding} />
              </strong>
              {selected.dueDate ? ` · due ${formatDate(selected.dueDate)}` : ''}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="rcp-date" className="field-label">
            Receipt date <span className="text-red-600">*</span>
          </label>
          <input
            id="rcp-date"
            name="receiptDate"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="field mt-1.5"
          />
        </div>

        <div>
          <label htmlFor="rcp-amount" className="field-label">
            Amount <span className="text-red-600">*</span>
          </label>
          <input
            id="rcp-amount"
            name="amount"
            required
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="field mt-1.5"
          />
        </div>

        <div>
          <label htmlFor="rcp-method" className="field-label">
            Payment method <span className="text-red-600">*</span>
          </label>
          <select
            id="rcp-method"
            name="paymentMethod"
            required
            defaultValue="BANK_TRANSFER"
            className="field mt-1.5"
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="rcp-reference" className="field-label">
            Reference number
          </label>
          <input
            id="rcp-reference"
            name="referenceNumber"
            maxLength={64}
            autoComplete="off"
            className="field mt-1.5"
          />
          <p className="field-hint">UTR, cheque number or UPI reference.</p>
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <label htmlFor="rcp-notes" className="field-label">
            Notes
          </label>
          <input
            id="rcp-notes"
            name="notes"
            maxLength={2000}
            autoComplete="off"
            className="field mt-1.5"
          />
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {pending ? 'Recording…' : 'Record payment'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Marking a cheque bounced is the only row action.
 *
 * There is no edit and no delete, deliberately: a receipt is a record of money
 * that arrived, and a returned cheque is a second event rather than a correction
 * to the first. Bouncing it re-debits the customer and reduces the invoice's
 * paid-to-date, leaving both events visible.
 */
export function ReceiptRowActions({ receipt }: { receipt: ReceiptListItem }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (receipt.status === 'BOUNCED') {
    return <span className="text-xs text-slate-400">Reversed</span>;
  }

  if (receipt.status === 'CANCELLED') {
    return <span className="text-xs text-slate-400">—</span>;
  }

  return (
    <div className="min-w-[6rem]">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const reason = window.prompt(
            `Mark receipt ${receipt.receiptNumber} as bounced?\n\n` +
              `The amount goes back onto the customer's balance and the invoice reverts to ` +
              `unpaid or part paid. Reason (optional):`,
          );

          if (reason === null) return;

          setError(null);
          startTransition(async () => {
            const result = await bounceReceiptAction(receipt.id, reason || undefined);
            if (!result.ok) setError(result.error ?? 'That did not work.');
          });
        }}
        className={DANGER_BUTTON}
      >
        Bounced
      </button>

      {error && (
        <p role="alert" className="mt-2 max-w-xs text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
