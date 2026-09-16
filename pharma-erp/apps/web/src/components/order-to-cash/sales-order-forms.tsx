'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  SCHEDULE_CATEGORY_LABELS,
  requiresAllocationRecheck,
  type CustomerListItem,
  type ItemListItem,
  type OrderCheckResult,
  type SalesOrderListItem,
} from '@pharma-erp/types';

import {
  cancelSalesOrderAction,
  createSalesOrderAction,
  runOrderChecksAction,
  type NewOrderLine,
} from './actions';
import {
  Badge,
  DANGER_BUTTON,
  Money,
  Note,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  formatMoney,
} from './ui';

interface DraftLine {
  key: number;
  itemId: string;
  quantityOrdered: string;
  unitPrice: string;
  discountPercent: string;
}

let nextKey = 1;

/**
 * The new-order form.
 *
 * Lines are built in local state so several can be entered before anything is
 * posted — an order is one document and a half-saved one with two of its four
 * lines would be worse than none.
 *
 * The running total is a PREVIEW and is labelled as one. The authoritative
 * figures come back from the API, which prices from the item master and computes
 * the tax; this arithmetic exists so the person typing can sanity-check what
 * they are about to commit, not to be the number of record.
 */
export function NewSalesOrderForm({
  customers,
  items,
  customersError,
  itemsError,
}: {
  customers: readonly CustomerListItem[];
  items: readonly ItemListItem[];
  customersError: string | null;
  itemsError: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const customer = customers.find((candidate) => candidate.id === customerId) ?? null;

  const preview = useMemo(() => {
    let taxable = 0;
    let tax = 0;

    for (const line of lines) {
      const item = itemsById.get(line.itemId);
      if (!item) continue;

      const quantity = Number(line.quantityOrdered || '0');
      const price = Number(line.unitPrice || item.mrp || '0');
      const discount = Number(line.discountPercent || '0');

      if (!Number.isFinite(quantity) || !Number.isFinite(price)) continue;

      const gross = quantity * price;
      const net = gross - (gross * discount) / 100;
      taxable += net;
      tax += (net * Number(item.gstRatePercent ?? '0')) / 100;
    }

    return { taxable, tax, total: taxable + tax };
  }, [lines, itemsById]);

  const addLine = () =>
    setLines((current) => [
      ...current,
      { key: nextKey++, itemId: '', quantityOrdered: '', unitPrice: '', discountPercent: '' },
    ]);

  const reset = () => {
    setCustomerId('');
    setLines([]);
    setNotes('');
    setRequestedDeliveryDate('');
  };

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div>
          <p className="text-sm font-medium text-slate-900">Take an order</p>
          <p className="mt-0.5 text-sm text-slate-600">
            Priced from the item master. It starts as a draft — running the check is what approves
            it.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(true)} className={PRIMARY_BUTTON}>
          + New sales order
        </button>
      </div>
    );
  }

  const blockers: string[] = [];
  if (customers.length === 0) blockers.push('There are no active customers. Add one first.');
  if (items.length === 0) {
    blockers.push('There are no finished products on the item master, so nothing can be ordered.');
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">New sales order</h3>
          <p className="mt-1 text-sm text-slate-600">
            Enter every line before saving — an order is one document.
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

      {(customersError || itemsError) && (
        <div className="mt-5">
          <Note tone="red">
            {customersError && <p>Could not load customers: {customersError}</p>}
            {itemsError && <p>Could not load products: {itemsError}</p>}
          </Note>
        </div>
      )}

      {blockers.length > 0 && (
        <div className="mt-5">
          <Note tone="amber">
            {blockers.map((blocker) => (
              <p key={blocker}>{blocker}</p>
            ))}
          </Note>
        </div>
      )}

      {message && (
        <div
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`mt-5 rounded-md border p-3 text-sm ${
            message.kind === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-green-200 bg-green-50 text-green-900'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label htmlFor="so-customer" className="field-label">
            Customer <span className="text-red-600">*</span>
          </label>
          <select
            id="so-customer"
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
            className="field mt-1.5"
          >
            <option value="">Choose a customer…</option>
            {customers.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.code} — {candidate.name}
              </option>
            ))}
          </select>

          {/* Shown before the order is written, because it is what the gate will
              say afterwards. Not a substitute for the check — the API decides —
              but it stops someone entering twenty lines for a customer whose
              licence lapsed last month. */}
          {customer && (
            <div className="mt-2 space-y-1 text-xs">
              {!customer.hasValidLicence ? (
                <p className="text-red-700">
                  No valid drug licence on file. The licence check will refuse this order.
                </p>
              ) : (
                <p className="text-slate-500">
                  Licence {customer.primaryLicence?.licenceNumber} valid.
                </p>
              )}
              <p className="text-slate-500">
                Outstanding {formatMoney(customer.outstandingAmount)} of{' '}
                {formatMoney(customer.creditLimit)} limit —{' '}
                <strong className="font-semibold text-slate-700">
                  {formatMoney(customer.availableCredit)} available
                </strong>
                .
              </p>
              {preview.total > Number(customer.availableCredit) && (
                <p className="text-amber-700">
                  This order is larger than the available credit, so the credit check will refuse
                  it.
                </p>
              )}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="so-date" className="field-label">
            Order date <span className="text-red-600">*</span>
          </label>
          <input
            id="so-date"
            type="date"
            value={orderDate}
            onChange={(event) => setOrderDate(event.target.value)}
            className="field mt-1.5"
          />
        </div>

        <div>
          <label htmlFor="so-delivery" className="field-label">
            Wanted by
          </label>
          <input
            id="so-delivery"
            type="date"
            value={requestedDeliveryDate}
            onChange={(event) => setRequestedDeliveryDate(event.target.value)}
            className="field mt-1.5"
          />
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-900">Lines</h4>
          <button type="button" onClick={addLine} className={SECONDARY_BUTTON}>
            + Add line
          </button>
        </div>

        {lines.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
            No lines yet. Add one.
          </p>
        ) : (
          <div className="mt-3 space-y-2.5">
            {lines.map((line) => {
              const item = itemsById.get(line.itemId);

              return (
                <div
                  key={line.key}
                  className="grid gap-2.5 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-12"
                >
                  <div className="sm:col-span-5">
                    <select
                      aria-label="Product"
                      value={line.itemId}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((candidate) =>
                            candidate.key === line.key
                              ? { ...candidate, itemId: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                      className="field-sm w-full"
                    >
                      <option value="">Choose a product…</option>
                      {items.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.code} — {candidate.name}
                        </option>
                      ))}
                    </select>

                    {item && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        <span>
                          {item.availableQuantity} saleable · GST {item.gstRatePercent ?? '0'}%
                        </span>
                        {item.scheduleCategory !== 'NONE' && (
                          <Badge
                            tone={requiresAllocationRecheck(item.scheduleCategory) ? 'amber' : 'slate'}
                          >
                            {SCHEDULE_CATEGORY_LABELS[item.scheduleCategory]}
                          </Badge>
                        )}
                        {!item.hsnCode && (
                          <Badge tone="red" title="Invoicing will refuse a line with no HSN code">
                            No HSN
                          </Badge>
                        )}
                        {item.priceControlType !== 'NONE' && (
                          <Badge tone="blue">{item.priceControlType}</Badge>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="sm:col-span-2">
                    <input
                      aria-label="Quantity"
                      inputMode="decimal"
                      placeholder="Qty"
                      value={line.quantityOrdered}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((candidate) =>
                            candidate.key === line.key
                              ? { ...candidate, quantityOrdered: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                      className="field-sm w-full"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <input
                      aria-label="Unit price"
                      inputMode="decimal"
                      placeholder={item?.mrp ? `MRP ${item.mrp}` : 'Price'}
                      value={line.unitPrice}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((candidate) =>
                            candidate.key === line.key
                              ? { ...candidate, unitPrice: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                      className="field-sm w-full"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <input
                      aria-label="Discount percent"
                      inputMode="decimal"
                      placeholder="Disc %"
                      value={line.discountPercent}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((candidate) =>
                            candidate.key === line.key
                              ? { ...candidate, discountPercent: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                      className="field-sm w-full"
                    />
                  </div>

                  <div className="flex items-start sm:col-span-1">
                    <button
                      type="button"
                      onClick={() =>
                        setLines((current) =>
                          current.filter((candidate) => candidate.key !== line.key),
                        )
                      }
                      className="text-xs font-semibold text-red-700 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-5">
        <label htmlFor="so-notes" className="field-label">
          Notes
        </label>
        <textarea
          id="so-notes"
          rows={2}
          maxLength={2000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="field mt-1.5"
        />
      </div>

      {lines.length > 0 && (
        <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Estimate</p>
          <p className="mt-1 text-slate-700">
            Taxable {formatMoney(preview.taxable.toFixed(2))} + GST{' '}
            {formatMoney(preview.tax.toFixed(2))} ={' '}
            <strong className="font-semibold text-slate-900">
              {formatMoney(preview.total.toFixed(2))}
            </strong>
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Indicative only. The saved order is priced and taxed by the API from the item master.
          </p>
        </div>
      )}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          disabled={pending || !customerId || lines.length === 0}
          onClick={() => {
            setMessage(null);

            const payload: NewOrderLine[] = [];

            for (const line of lines) {
              if (!line.itemId) {
                setMessage({ kind: 'error', text: 'Every line needs a product.' });
                return;
              }

              if (!line.quantityOrdered.trim()) {
                setMessage({ kind: 'error', text: 'Every line needs a quantity.' });
                return;
              }

              payload.push({
                itemId: line.itemId,
                quantityOrdered: line.quantityOrdered.trim(),
                unitPrice: line.unitPrice.trim() || undefined,
                discountPercent: line.discountPercent.trim() || undefined,
              });
            }

            startTransition(async () => {
              const result = await createSalesOrderAction({
                customerId,
                orderDate,
                requestedDeliveryDate: requestedDeliveryDate || undefined,
                notes: notes.trim() || undefined,
                items: payload,
              });

              if (result.ok) {
                setMessage({
                  kind: 'success',
                  text: `Order ${result.data?.orderNumber ?? ''} created as a draft. Run the licence and credit check to approve it.`,
                });
                reset();
              } else {
                setMessage({ kind: 'error', text: result.error ?? 'That did not work.' });
              }
            });
          }}
          className={PRIMARY_BUTTON}
        >
          {pending ? 'Saving…' : 'Create order'}
        </button>
      </div>
    </div>
  );
}

/**
 * Row actions: run the gate, view its reasoning, cancel.
 *
 * "Run check" is offered on a blocked order too, and deliberately: the usual fix
 * is to raise the limit or take a payment and check again, and hiding the button
 * would leave no way to re-test from the screen.
 */
export function SalesOrderRowActions({ order }: { order: SalesOrderListItem }) {
  const [check, setCheck] = useState<OrderCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canCheck = !['ALLOCATED', 'PARTIALLY_ALLOCATED', 'DISPATCHED', 'COMPLETED', 'CANCELLED'].includes(
    order.status,
  );

  const canCancel = !['COMPLETED', 'CANCELLED'].includes(order.status);

  return (
    <div className="min-w-[10rem]">
      <div className="flex flex-wrap gap-1.5">
        {canCheck && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await runOrderChecksAction(order.id);

                if (result.ok) setCheck(result.data?.check ?? null);
                else setError(result.error ?? 'That did not work.');
              });
            }}
            className={SECONDARY_BUTTON}
          >
            {pending ? 'Checking…' : 'Run check'}
          </button>
        )}

        {canCancel && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const reason = window.prompt(`Cancel ${order.orderNumber}? Reason (optional):`);

              // `prompt` returns null when dismissed and '' when submitted
              // empty. Only null means "changed my mind".
              if (reason === null) return;

              setError(null);
              startTransition(async () => {
                const result = await cancelSalesOrderAction(order.id, reason || undefined);
                if (!result.ok) setError(result.error ?? 'That did not work.');
              });
            }}
            className={DANGER_BUTTON}
          >
            Cancel
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 max-w-xs text-xs text-red-700">
          {error}
        </p>
      )}

      {check && (
        <div className="mt-2 w-64 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
          <p className="font-semibold uppercase tracking-wide text-slate-500">Check result</p>

          <dl className="mt-2 space-y-1 text-slate-700">
            <div className="flex justify-between gap-2">
              <dt>Licence</dt>
              <dd className={check.licenceCheck === 'PASS' ? 'text-green-700' : 'text-red-700'}>
                {check.licenceCheck}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Credit</dt>
              <dd className={check.creditCheck === 'PASS' ? 'text-green-700' : 'text-red-700'}>
                {check.creditCheck}
              </dd>
            </div>
            {check.creditLimit && (
              <>
                <div className="flex justify-between gap-2">
                  <dt>Limit</dt>
                  <dd>
                    <Money value={check.creditLimit} />
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Outstanding</dt>
                  <dd>
                    <Money value={check.outstandingAmount ?? '0.00'} />
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Available</dt>
                  <dd>
                    <Money value={check.availableCredit ?? '0.00'} />
                  </dd>
                </div>
              </>
            )}
            {check.creditShortfall && (
              <div className="flex justify-between gap-2 font-semibold text-red-700">
                <dt>Over by</dt>
                <dd>
                  <Money value={check.creditShortfall} />
                </dd>
              </div>
            )}
          </dl>

          {check.failureReason && <p className="mt-2 text-red-700">{check.failureReason}</p>}

          <button
            type="button"
            onClick={() => setCheck(null)}
            className="mt-2 text-[11px] font-semibold text-slate-500 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
