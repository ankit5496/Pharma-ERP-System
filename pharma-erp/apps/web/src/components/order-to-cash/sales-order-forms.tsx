'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  SCHEDULE_CATEGORY_LABELS,
  type CustomerListItem,
  type ItemListItem,
  type SalesOrderListItem,
} from '@pharma-erp/types';

import { RowActionMenu, type RowAction } from '@/components/row-action-menu';

import {
  cancelSalesOrderAction,
  createSalesOrderAction,
  updateSalesOrderAction,
  type NewOrderLine,
} from './actions';
import { EditDialog } from './edit-kit';
import { SearchableSelect } from './searchable-select';
import { DialogFooter } from './modal';
import {
  Badge,
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
 * A blank line.
 *
 * The form OPENS with one of these. An order always has at least one line — the
 * API refuses an empty `items` array — so starting at zero made the first
 * action on every order the same click, and "No lines yet" read like a state
 * someone had to repair rather than a form waiting to be filled in.
 */
const blankLine = (): DraftLine => ({
  key: nextKey++,
  itemId: '',
  quantityOrdered: '',
  unitPrice: '',
  discountPercent: '',
});

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
  inDialog = false,
}: {
  customers: readonly CustomerListItem[];
  items: readonly ItemListItem[];
  customersError: string | null;
  itemsError: string | null;
  /**
   * Rendered inside the panel's create dialog, which already supplies the
   * title, the description and a way out — so the trigger card and the
   * internal header are suppressed rather than drawn twice.
   */
  inDialog?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine()]);
  // Only failures are surfaced. A created-and-allocated order says so by
  // appearing in the list below with its status; repeating that in a banner
  // over an empty form is noise.
  const [error, setError] = useState<string | null>(null);
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

  const addLine = () => setLines((current) => [...current, blankLine()]);

  const reset = () => {
    setCustomerId('');
    setLines([blankLine()]);
    setNotes('');
    setRequestedDeliveryDate('');
  };

  if (!inDialog && !open) {
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
          New sales order
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
    <div className={inDialog ? '' : 'rounded-lg border border-slate-200 bg-white p-6 shadow-sm'}>
      {!inDialog && (
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
            setError(null);
          }}
          className={SECONDARY_BUTTON}
        >
          Cancel
        </button>
      </div>
      )}

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

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label htmlFor="so-customer" className="field-label">
            Customer <span className="text-red-600">*</span>
          </label>
          <div className="mt-1.5">
            <SearchableSelect
              id="so-customer"
              value={customerId}
              onChange={setCustomerId}
              placeholder="Search by code or name…"
              options={customers.map((candidate) => ({
                value: candidate.id,
                label: candidate.name,
                hint: candidate.hasValidLicence ? undefined : 'no valid licence',
                keywords: candidate.code,
              }))}
            />
          </div>

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
            className="field mt-1.5 h-10"
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
            className="field mt-1.5 h-10"
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
                  className="grid gap-2.5 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[2.5fr_1fr_1fr_1fr_auto]"
                >
                  <div>
                    <SearchableSelect
                      small
                      ariaLabel="Product"
                      value={line.itemId}
                      onChange={(itemId) =>
                        setLines((current) =>
                          current.map((candidate) =>
                            candidate.key === line.key ? { ...candidate, itemId } : candidate,
                          ),
                        )
                      }
                      placeholder="Search by code or name…"
                      options={items.map((candidate) => ({
                        value: candidate.id,
                        label: `${candidate.code} — ${candidate.name}`,
                        hint: `${candidate.availableQuantity} saleable`,
                      }))}
                    />

                    {item && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        <span
                          title={
                            `${item.quantityOnHand} on hand from released batches, ` +
                            `${item.quantityReserved} already reserved for other orders.`
                          }
                        >
                          <span
                            className={
                              item.availableQuantity === '0.000'
                                ? 'font-semibold text-red-700'
                                : undefined
                            }
                          >
                            {item.availableQuantity} saleable
                          </span>
                          {/* Shown whenever stock is held: the batch-release
                              screen reports on-hand, so without this the two
                              screens disagree with no explanation. */}
                          {item.quantityReserved !== '0.000' && (
                            <> ({item.quantityOnHand} on hand − {item.quantityReserved} reserved)</>
                          )}{' '}
                          · GST {item.gstRatePercent ?? '0'}%
                        </span>
                        {item.scheduleCategory !== 'NONE' && (
                          <Badge
                            tone="slate"
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

                  <div>
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
                      className="field-sm h-9 w-full"
                    />
                  </div>

                  <div>
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
                      className="field-sm h-9 w-full"
                    />
                  </div>

                  <div>
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
                      className="field-sm h-9 w-full"
                    />
                  </div>

                  <div className="flex items-start">
                    {lines.length > 1 && (
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
                    )}
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

      <DialogFooter className="flex gap-2">
        <button
          type="button"
          disabled={pending || !customerId || lines.length === 0}
          onClick={() => {
            setError(null);

            const payload: NewOrderLine[] = [];

            for (const line of lines) {
              if (!line.itemId) {
                setError('Every line needs a product.');
                return;
              }

              if (!line.quantityOrdered.trim()) {
                setError('Every line needs a quantity.');
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
                const order = result.data;
                const allocated =
                  order?.status === 'ALLOCATED' || order?.status === 'PARTIALLY_ALLOCATED';

                reset();

                // Silent when the order was created AND allocated — it is in
                // the list below, with its status, which says it better.
                //
                // NOT silent when the gate blocked it. The request succeeded,
                // but the order is sitting BLOCKED with no stock reserved, and
                // swallowing that would leave someone believing an order is on
                // its way when nothing has been set aside for it.
                setError(
                  allocated
                    ? null
                    : `Order ${order?.orderNumber ?? ''} was created but NOT allocated — ${
                        order?.checkFailureReason ?? 'the licence or credit check did not pass'
                      }`,
                );
              } else {
                setError(result.error ?? 'That did not work.');
              }
            });
          }}
          className={PRIMARY_BUTTON}
        >
          {pending ? 'Checking stock…' : 'Create order'}
        </button>
      </DialogFooter>

      {/* The ONLY message this form shows, and only on failure. It sits beside
          the button because a stock refusal names a quantity the user must now
          correct, and it is no use to them off-screen. Form values survive —
          only a successful create resets them. */}
      {error && (
        <p role="alert" className="mt-3 max-w-2xl text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Row actions: edit a draft, cancel.
 *
 * "Run check" used to live here. The licence and credit gate now runs
 * automatically as part of creating the order, so a separate button would only
 * re-ask a question already answered. The rules themselves are unchanged — the
 * verdict and its figures are still recorded on the order, and the list shows
 * them in the licence and credit columns.
 *
 * `POST :id/check` is deliberately left on the API: re-testing a BLOCKED order
 * after a limit is raised or a payment lands is a real need, and removing the
 * endpoint would take that away as well as the button.
 */
export function SalesOrderRowActions({ order }: { order: SalesOrderListItem }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canCancel = !['COMPLETED', 'CANCELLED'].includes(order.status);

  const cancel = () => {
    const reason = window.prompt(`Cancel ${order.orderNumber}? Reason (optional):`);

    // `prompt` returns null when dismissed and '' when submitted empty. Only
    // null means "changed my mind".
    if (reason === null) return;

    setError(null);
    startTransition(async () => {
      const result = await cancelSalesOrderAction(order.id, reason || undefined);
      if (!result.ok) setError(result.error ?? 'That did not work.');
    });
  };

  const actions: RowAction[] = [
    {
      label: 'Edit',
      onSelect: () => setEditing(true),
      // DRAFT only: once the gate has run the order carries a verdict, and once
      // allocated it has stock reserved. The API refuses either.
      disabledReason:
        order.status === 'DRAFT'
          ? null
          : 'Only a draft order can be edited. This one has been checked or has stock allocated.',
    },
    {
      label: 'Cancel',
      onSelect: cancel,
      disabledReason: canCancel ? null : 'This order is already completed or cancelled.',
    },
  ];

  return (
    <>
      <RowActionMenu label={order.orderNumber} actions={actions} busy={pending} />

      {editing && (
        <EditDialog
          title={`Edit ${order.orderNumber}`}
          description={order.customerName}
          note="Lines and pricing are not edited here — changing them re-opens the credit gate. Cancel and raise a new order to re-price."
          fields={[
            { name: 'orderDate', label: 'Order date', value: order.orderDate, type: 'date' },
            {
              name: 'requestedDeliveryDate',
              label: 'Requested delivery',
              value: order.requestedDeliveryDate ?? '',
              type: 'date',
            },
            { name: 'notes', label: 'Notes', value: '', wide: true },
          ]}
          onClose={() => setEditing(false)}
          onSave={(patch) => updateSalesOrderAction(order.id, patch)}
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
