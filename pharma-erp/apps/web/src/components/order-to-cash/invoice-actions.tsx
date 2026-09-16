'use client';

import { useState, useTransition } from 'react';
import type { SalesInvoiceListItem } from '@pharma-erp/types';

import { cancelInvoiceAction, issueInvoiceAction } from './actions';
import { DANGER_BUTTON, Note, PRIMARY_BUTTON } from './ui';

/**
 * Issues the tax invoice for an order's reserved batches.
 *
 * Takes only the order id — see InvoicesPanel for why there is no line picker.
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
            const result = await issueInvoiceAction({ salesOrderId });

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
        <div className="mt-2 max-w-md text-left">
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
  const [pending, startTransition] = useTransition();

  const settled = invoice.paymentStatus !== 'UNPAID' || invoice.amountCredited !== '0.00';
  const canCancel = invoice.status === 'ISSUED' && !settled;

  if (invoice.status === 'CANCELLED') {
    return <span className="text-xs text-slate-400">Cancelled</span>;
  }

  if (!canCancel) {
    return (
      <span className="text-xs text-slate-400" title="Raise a sales return against this invoice">
        Return only
      </span>
    );
  }

  return (
    <div className="min-w-[7rem]">
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
    </div>
  );
}
