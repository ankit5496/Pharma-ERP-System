'use client';

import { useState, useTransition } from 'react';
import type { SalesInvoiceListItem } from '@pharma-erp/types';

import { cancelInvoiceAction, issueInvoiceAction, updateInvoiceAction } from './actions';
import { EditButton, EditDialog } from './edit-kit';
import { DANGER_BUTTON, Note, PRIMARY_BUTTON } from './ui';

/**
 * Issues the tax invoice for a confirmed dispatch.
 *
 * Takes the DISPATCH id, because that is what the API bills — the lines come
 * from what actually shipped, not from what was reserved. `dispatchId` is null
 * when the order has no confirmed dispatch yet; the button then says so instead
 * of posting a request the API would refuse.
 *
 * The error display is the interesting part. Three distinct refusals reach this
 * button and each needs different action from the user:
 *
 *   a DPCO/NLEM ceiling breach  → correct the price, or the ceiling
 *   a missing company GSTIN     → an admin has to set it before ANY invoice
 *   a missing HSN code          → the item master needs completing
 *
 * The API phrases each one specifically, so this renders the message as given
 * rather than flattening all three into "could not issue invoice".
 */
export function IssueInvoiceButton({
  dispatchId,
  orderNumber,
}: {
  dispatchId: string | null;
  orderNumber: string;
}) {
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // Nothing to bill yet. Said here rather than left to the API, because the
  // next step is on another tab and a validation error would not name it.
  // The Dispatch column beside this already says what is missing, so the button
  // only needs to be visibly unavailable. Repeating the sentence in every row
  // would push the table sideways for something the eye reads once.
  if (!dispatchId) {
    return (
      <button
        type="button"
        disabled
        title={`Confirm a dispatch for ${orderNumber} first — an invoice bills what shipped, not what is reserved.`}
        className={`${PRIMARY_BUTTON} opacity-40`}
      >
        Raise invoice
      </button>
    );
  }

  return (
    <div className="text-right">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await issueInvoiceAction({ dispatchId });

            setMessage(
              result.ok
                ? {
                    kind: 'info',
                    text: `Invoice ${result.data?.invoiceNumber ?? ''} issued. The receivable has been posted.`,
                  }
                : { kind: 'error', text: result.error ?? 'That did not work.' },
            );
          });
        }}
        className={PRIMARY_BUTTON}
      >
        {pending ? 'Issuing…' : 'Raise invoice'}
      </button>

      {message && (
        <div className="mt-2 max-w-xs text-left">
          {message.kind === 'error' ? (
            <Note tone="red">
              <p className="font-semibold">Invoice not issued for {orderNumber}</p>
              <p className="mt-1">{message.text}</p>
            </Note>
          ) : (
            <p role="status" className="text-xs text-slate-600">
              {message.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Cancel is offered only where the API would allow it — an unpaid, undispatched,
 * issued invoice. Once money has arrived or goods have shipped the instrument is
 * a sales return, and the button says so instead of failing on click.
 */
export function InvoiceRowActions({ invoice }: { invoice: SalesInvoiceListItem }) {
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const settled = invoice.paymentStatus !== 'UNPAID' || invoice.amountCredited !== '0.00';
  const canCancel = invoice.status === 'ISSUED' && !settled;

  // A cancelled invoice is finished — nothing on it is amendable.
  if (invoice.status === 'CANCELLED') {
    return <span className="text-xs text-slate-400">Cancelled</span>;
  }

  // Once money has been received the invoice can no longer be cancelled, but
  // its note is still correctable and the dialog says which fields are closed.
  const editDialog = editing ? (
    <EditDialog
      title={`Edit ${invoice.invoiceNumber}`}
      description={invoice.customerName}
      note="A tax invoice is a statutory document: amounts, lines, batches, addresses, GSTIN, the invoice date and the tax split are all fixed at issue and are not editable. Correcting any of those is a cancellation and a reissue. The due date can only change while nothing has been paid."
      fields={[
        {
          name: 'dueDate',
          label: 'Due date',
          value: invoice.dueDate ?? '',
          type: 'date',
          hint: settled ? 'Locked — money has been received against this invoice.' : undefined,
        },
        { name: 'notes', label: 'Internal note', value: '', wide: true },
      ]}
      onClose={() => setEditing(false)}
      onSave={(patch) => updateInvoiceAction(invoice.id, patch)}
    />
  ) : null;

  if (!canCancel) {
    return (
      <div className="min-w-[8rem]">
        <EditButton onClick={() => setEditing(true)} />
        <p
          className="mt-1 text-[11px] text-slate-400"
          title="Raise a sales return against this invoice"
        >
          Return only
        </p>
        {editDialog}
      </div>
    );
  }

  return (
    <div className="min-w-[7rem]">
      <div className="mb-1.5">
        <EditButton onClick={() => setEditing(true)} />
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const reason = window.prompt(
            `Cancel invoice ${invoice.invoiceNumber}?\n\n` +
              `The number stays used and the receivable is reversed with a visible ` +
              `adjustment — nothing is deleted. Reason (optional):`,
          );

          if (reason === null) return;

          setError(null);
          startTransition(async () => {
            const result = await cancelInvoiceAction(invoice.id, reason || undefined);
            if (!result.ok) setError(result.error ?? 'That did not work.');
          });
        }}
        className={DANGER_BUTTON}
      >
        Cancel
      </button>

      {error && (
        <p role="alert" className="mt-2 max-w-xs text-xs text-red-700">
          {error}
        </p>
      )}

      {editDialog}
    </div>
  );
}
