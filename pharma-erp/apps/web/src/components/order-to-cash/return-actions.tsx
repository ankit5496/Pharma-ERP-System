'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  RETURNED_STOCK_DISPOSITIONS,
  RETURNED_STOCK_DISPOSITION_LABELS,
  RETURN_REASONS,
  RETURN_REASON_LABELS,
  type SalesInvoiceDetail,
  type SalesReturnListItem,
} from '@pharma-erp/types';

import { createSalesReturnAction, updateSalesReturnAction } from './actions';
import { EditButton, EditDialog } from './edit-kit';
import { SearchableSelect } from './searchable-select';
import { Note, PRIMARY_BUTTON, SECONDARY_BUTTON, formatDate, formatQuantity } from './ui';

interface DraftReturnLine {
  quantity: string;
  reason: string;
  disposition: string;
}

/**
 * Records a return against an invoice.
 *
 * Lines are chosen from the INVOICE's own lines, each showing what shipped and
 * what has already come back. That is the only honest way to present it: the
 * quantity is capped per line, and offering a free product picker would mean
 * letting someone enter a return the API is bound to refuse.
 *
 * Disposition defaults to QUARANTINE on every line and the alternative is
 * spelled out rather than abbreviated, because "return to saleable stock" is a
 * decision with consequences and a three-letter option in a dropdown does not
 * read like one.
 */
export function NewReturnForm({
  invoices,
  invoicesError,
}: {
  invoices: readonly SalesInvoiceDetail[];
  invoicesError: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [invoiceId, setInvoiceId] = useState('');
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState<string>('DAMAGED');
  const [reasonNotes, setReasonNotes] = useState('');
  const [lines, setLines] = useState<Record<string, DraftReturnLine>>({});
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const invoice = invoices.find((candidate) => candidate.id === invoiceId) ?? null;

  const returnableLines = useMemo(
    () =>
      (invoice?.items ?? []).filter(
        (line) => Number(line.quantity) > Number(line.quantityReturned),
      ),
    [invoice],
  );

  const reset = () => {
    setInvoiceId('');
    setLines({});
    setReasonNotes('');
  };

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div>
          <p className="text-sm font-medium text-slate-900">Record a return</p>
          <p className="mt-0.5 text-sm text-slate-600">
            {invoices.length === 0
              ? 'No issued invoice currently has anything that could be returned.'
              : 'Choose the invoice the goods went out on, then the lines coming back.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={invoices.length === 0}
          className={PRIMARY_BUTTON}
        >
          + New return
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">New return</h3>
          <p className="mt-1 text-sm text-slate-600">
            Priced from the invoice, so the credit note mirrors what was charged.
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
              <p className="font-semibold">Return not recorded</p>
              <p className="mt-1">{message.text}</p>
            </Note>
          ) : (
            <Note tone="blue">{message.text}</Note>
          )}
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label htmlFor="ret-invoice" className="field-label">
            Invoice <span className="text-red-600">*</span>
          </label>
          <div className="mt-1.5">
            <SearchableSelect
              id="ret-invoice"
              value={invoiceId}
              onChange={(next) => {
                setInvoiceId(next);
                setLines({});
              }}
              placeholder="Search by invoice number or customer…"
              options={invoices.map((candidate) => ({
                value: candidate.id,
                label: `${candidate.invoiceNumber} — ${candidate.customerName}`,
              }))}
            />
          </div>
        </div>

        <div>
          <label htmlFor="ret-date" className="field-label">
            Return date <span className="text-red-600">*</span>
          </label>
          <input
            id="ret-date"
            type="date"
            value={returnDate}
            onChange={(event) => setReturnDate(event.target.value)}
            className="field mt-1.5"
          />
        </div>

        <div>
          <label htmlFor="ret-reason" className="field-label">
            Overall reason <span className="text-red-600">*</span>
          </label>
          <select
            id="ret-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="field mt-1.5"
          >
            {RETURN_REASONS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {RETURN_REASON_LABELS[candidate]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {invoice && (
        <div className="mt-6">
          <h4 className="text-sm font-semibold text-slate-900">Lines coming back</h4>
          <p className="mt-1 text-xs text-slate-500">
            Leave a quantity blank to exclude the line. Each is capped at what shipped, less
            anything already returned.
          </p>

          {returnableLines.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
              Every line on this invoice has already been fully returned.
            </p>
          ) : (
            <div className="mt-3 space-y-2.5">
              {returnableLines.map((line) => {
                const shipped = Number(line.quantity);
                const returned = Number(line.quantityReturned);
                const available = shipped - returned;
                const draft = lines[line.id];

                return (
                  <div
                    key={line.id}
                    className="grid gap-2.5 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-12"
                  >
                    <div className="sm:col-span-4">
                      <p className="text-sm text-slate-800">{line.description}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                        Batch {line.batchNumber} · exp {formatDate(line.expiryDate)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {formatQuantity(line.quantity)} shipped
                        {returned > 0 ? `, ${formatQuantity(line.quantityReturned)} returned` : ''}{' '}
                        — up to {formatQuantity(available.toFixed(3))} available
                      </p>
                    </div>

                    <div className="sm:col-span-2">
                      <input
                        aria-label={`Quantity returned for ${line.description}`}
                        inputMode="decimal"
                        placeholder="Qty"
                        value={draft?.quantity ?? ''}
                        onChange={(event) =>
                          setLines((current) => ({
                            ...current,
                            [line.id]: {
                              quantity: event.target.value,
                              reason: current[line.id]?.reason ?? reason,
                              disposition: current[line.id]?.disposition ?? 'QUARANTINE',
                            },
                          }))
                        }
                        className="field-sm w-full"
                      />
                    </div>

                    <div className="sm:col-span-3">
                      <select
                        aria-label={`Reason for ${line.description}`}
                        value={draft?.reason ?? reason}
                        onChange={(event) =>
                          setLines((current) => ({
                            ...current,
                            [line.id]: {
                              quantity: current[line.id]?.quantity ?? '',
                              reason: event.target.value,
                              disposition: current[line.id]?.disposition ?? 'QUARANTINE',
                            },
                          }))
                        }
                        className="field-sm w-full"
                      >
                        {RETURN_REASONS.map((candidate) => (
                          <option key={candidate} value={candidate}>
                            {RETURN_REASON_LABELS[candidate]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="sm:col-span-3">
                      <select
                        aria-label={`Disposition for ${line.description}`}
                        value={draft?.disposition ?? 'QUARANTINE'}
                        onChange={(event) =>
                          setLines((current) => ({
                            ...current,
                            [line.id]: {
                              quantity: current[line.id]?.quantity ?? '',
                              reason: current[line.id]?.reason ?? reason,
                              disposition: event.target.value,
                            },
                          }))
                        }
                        className="field-sm w-full"
                      >
                        {RETURNED_STOCK_DISPOSITIONS.map((candidate) => (
                          <option key={candidate} value={candidate}>
                            {RETURNED_STOCK_DISPOSITION_LABELS[candidate]}
                          </option>
                        ))}
                      </select>
                      {draft?.disposition === 'RESTOCK' && (
                        <p className="mt-1 text-[11px] text-amber-700">
                          Refused unless the batch is still released and unexpired.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="mt-5">
        <label htmlFor="ret-notes" className="field-label">
          Notes
        </label>
        <textarea
          id="ret-notes"
          rows={2}
          maxLength={2000}
          value={reasonNotes}
          onChange={(event) => setReasonNotes(event.target.value)}
          className="field mt-1.5"
        />
      </div>

      <div className="mt-5">
        <button
          type="button"
          disabled={pending || !invoiceId}
          onClick={() => {
            setMessage(null);

            const items = Object.entries(lines)
              .filter(([, draft]) => draft.quantity.trim() !== '')
              .map(([salesInvoiceItemId, draft]) => ({
                salesInvoiceItemId,
                quantity: draft.quantity.trim(),
                reason: draft.reason,
                disposition: draft.disposition,
              }));

            if (items.length === 0) {
              setMessage({ kind: 'error', text: 'Enter a quantity on at least one line.' });
              return;
            }

            startTransition(async () => {
              const result = await createSalesReturnAction({
                salesInvoiceId: invoiceId,
                returnDate,
                reason,
                reasonNotes: reasonNotes.trim() || undefined,
                items,
              });

              if (result.ok) {
                setMessage({
                  kind: 'success',
                  text: `Return ${result.data?.returnNumber ?? ''} recorded. Stock has been received into quarantine and the customer credited.`,
                });
                reset();
              } else {
                setMessage({ kind: 'error', text: result.error ?? 'That did not work.' });
              }
            });
          }}
          className={PRIMARY_BUTTON}
        >
          {pending ? 'Recording…' : 'Record return & credit'}
        </button>
      </div>
    </div>
  );
}

/**
 * Row actions for a sales return.
 *
 * DRAFT only. Once received, the stock has been put somewhere — quarantined,
 * destroyed or restocked — and once credited the customer's ledger has moved;
 * neither is undone by editing a form, and the API refuses both.
 */
export function SalesReturnRowActions({ salesReturn }: { salesReturn: SalesReturnListItem }) {
  const [editing, setEditing] = useState(false);

  if (salesReturn.status !== 'DRAFT') {
    return <span className="text-xs text-slate-400">—</span>;
  }

  return (
    <div className="min-w-[5rem]">
      <EditButton onClick={() => setEditing(true)} />

      {editing && (
        <EditDialog
          title={`Edit ${salesReturn.returnNumber}`}
          description={`${salesReturn.customerName} · ${salesReturn.invoiceNumber}`}
          note="Returned quantities are not editable here — they have already been counted against the invoice lines. A wrong line is cancelled and re-raised rather than changed underneath the invoice."
          fields={[
            { name: 'returnDate', label: 'Return date', value: salesReturn.returnDate, type: 'date' },
            {
              name: 'reason',
              label: 'Reason',
              value: salesReturn.reason,
              options: RETURN_REASONS.map((reason) => ({
                value: reason,
                label: RETURN_REASON_LABELS[reason],
              })),
            },
            { name: 'reasonNotes', label: 'Reason notes', value: '', wide: true },
            { name: 'notes', label: 'Notes', value: '', wide: true },
          ]}
          onClose={() => setEditing(false)}
          onSave={(patch) => updateSalesReturnAction(salesReturn.id, patch)}
        />
      )}
    </div>
  );
}
