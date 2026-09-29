'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  SCHEDULE_CATEGORY_LABELS,
  type CustomerListItem,
  type ItemListItem,
  type SalesOrderListItem,
} from '@pharma-erp/types';

import { RowActionMenu, type RowAction } from '@/components/row-action-menu';
import { pushToast } from '@/components/toast';


import {
  cancelSalesOrderAction,
  createSalesOrderAction,
  nextSalesOrderNumberAction,
  type NewOrderLine,
} from './actions';
import { ConfirmDialog } from './confirm-dialog';
import { EditSalesOrderForm } from './edit-sales-order-form';
import { CustomerPanels, ProductPanel, Section } from './sales-order-panels';
import { SearchableSelect } from './searchable-select';
import { DialogFooter, useDialogClose } from './modal';
import {
  Badge,
  Note,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  formatDate,
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
  const closeDialog = useDialogClose();
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState('');
  // The order's own terms. Free text: what was agreed for THIS order, which is
  // not something the party master can answer.
  const [customerPoNumber, setCustomerPoNumber] = useState('');
  const [shippingTerms, setShippingTerms] = useState('');
  const [insurance, setInsurance] = useState('');
  const [transportName, setTransportName] = useState('');
  const [processingCharges, setProcessingCharges] = useState('');
  // The number the order will take. A preview — it is allocated on save, so
  // opening the form consumes nothing.
  const [orderNumber, setOrderNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine()]);
  // Only failures are surfaced. A created-and-approved order says so by
  // appearing in the list below with its status; repeating that in a banner
  // over an empty form is noise.
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let current = true;

    void (async () => {
      const result = await nextSalesOrderNumberAction();
      if (current && result.ok) setOrderNumber(result.data?.number ?? '');
    })();

    return () => {
      current = false;
    };
  }, []);

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

    // Goods value + processing charges = taxable amount. The charge is spread
    // across the lines in proportion to their value and taxed at each line's
    // own rate — the same rule the API applies, so the preview and the saved
    // order agree instead of differing by the charge's tax.
    const charge = Number(processingCharges || '0');
    let chargeTax = 0;

    if (charge > 0 && taxable > 0) {
      for (const line of lines) {
        const item = itemsById.get(line.itemId);
        if (!item) continue;

        const quantity = Number(line.quantityOrdered || '0');
        const price = Number(line.unitPrice || item.mrp || '0');
        const discount = Number(line.discountPercent || '0');
        if (!Number.isFinite(quantity) || !Number.isFinite(price)) continue;

        const gross = quantity * price;
        const net = gross - (gross * discount) / 100;
        const share = (charge * net) / taxable;
        chargeTax += (share * Number(item.gstRatePercent ?? '0')) / 100;
      }
    }

    const taxableAmount = taxable + charge;
    const taxTotal = tax + chargeTax;
    // Round off to the rupee, the convention the document shows. Display only —
    // the API is the authority on what is stored.
    const beforeRounding = taxableAmount + taxTotal;
    const grand = Math.round(beforeRounding);

    return {
      goods: taxable,
      charge,
      taxable: taxableAmount,
      tax: taxTotal,
      roundOff: grand - beforeRounding,
      total: grand,
    };
  }, [lines, itemsById, processingCharges]);


  /**
   * The order's GST, grouped by rate.
   *
   * ONE ROW PER RATE PRESENT, because an order of 12% and 18% goods owes both
   * and a single total would hide which. The rate is the item master's; the
   * charge's share is apportioned by value, exactly as the API does it.
   *
   * INTRA-STATE IS ASSUMED FOR THE PREVIEW and said so underneath. Whether a
   * sale is inter-state is decided at invoicing from the place of supply — the
   * order has no invoice yet, so the split shown here is indicative and the
   * total, which does not depend on the split, is not.
   */
  const gstSummary = useMemo(() => {
    const byRate = new Map<string, { rate: string; basic: number; tax: number }>();

    const goods = lines.reduce((sum, line) => {
      const item = itemsById.get(line.itemId);
      if (!item) return sum;

      const quantity = Number(line.quantityOrdered || '0');
      const price = Number(line.unitPrice || item.mrp || '0');
      const discount = Number(line.discountPercent || '0');
      if (!Number.isFinite(quantity) || !Number.isFinite(price)) return sum;

      const gross = quantity * price;
      return sum + (gross - (gross * discount) / 100);
    }, 0);

    const charge = Number(processingCharges || '0');

    for (const line of lines) {
      const item = itemsById.get(line.itemId);
      if (!item) continue;

      const quantity = Number(line.quantityOrdered || '0');
      const price = Number(line.unitPrice || item.mrp || '0');
      const discount = Number(line.discountPercent || '0');
      if (!Number.isFinite(quantity) || !Number.isFinite(price)) continue;

      const gross = quantity * price;
      const net = gross - (gross * discount) / 100;
      if (net <= 0) continue;

      const rate = Number(item.gstRatePercent ?? '0');
      const share = goods > 0 ? (charge * net) / goods : 0;
      const basic = net + share;

      const key = rate.toFixed(2);
      const entry = byRate.get(key) ?? { rate: key, basic: 0, tax: 0 };

      byRate.set(key, {
        rate: key,
        basic: entry.basic + basic,
        tax: entry.tax + (basic * rate) / 100,
      });
    }

    return [...byRate.values()]
      .sort((a, b) => Number(a.rate) - Number(b.rate))
      .map((entry) => ({
        rate: entry.rate,
        basic: entry.basic,
        // Halved for the intra-state preview; IGST is what an inter-state sale
        // would carry instead, and invoicing decides which.
        sgst: entry.tax / 2,
        cgst: entry.tax / 2,
        igst: 0,
      }));
  }, [lines, itemsById, processingCharges]);

  const totalsByHead = useMemo(
    () => ({
      sgst: gstSummary.reduce((sum, row) => sum + row.sgst, 0),
      cgst: gstSummary.reduce((sum, row) => sum + row.cgst, 0),
      igst: gstSummary.reduce((sum, row) => sum + row.igst, 0),
    }),
    [gstSummary],
  );

  const addLine = () => setLines((current) => [...current, blankLine()]);

  const reset = () => {
    setCustomerId('');
    setLines([blankLine()]);
    setNotes('');
    setRequestedDeliveryDate('');
    setCustomerPoNumber('');
    setShippingTerms('');
    setInsurance('');
    setTransportName('');
    setProcessingCharges('');
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

      {/* The document's header. The number and the date are the system's to
          decide — the number is allocated from the document sequence on save
          and the date defaults to today — so neither is typed. */}
      <div className="mt-5 grid gap-4 rounded-md border border-slate-200 bg-slate-50/60 p-4 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]">
        <div>
          <p className="field-label">Sales Order No.</p>
          <input
            readOnly
            disabled
            value={orderNumber}
            placeholder="Allocating…"
            className="field mt-1.5 h-10 w-full"
          />
          <p className="field-hint">Allocated on save.</p>
        </div>

        <div>
          <label htmlFor="so-po" className="field-label">
            Customer PO No.
          </label>
          <input
            id="so-po"
            value={customerPoNumber}
            onChange={(event) => setCustomerPoNumber(event.target.value)}
            maxLength={64}
            autoComplete="off"
            className="field mt-1.5 h-10"
          />
        </div>

        <div>
          <label htmlFor="so-date" className="field-label">
            Date <span className="text-red-600">*</span>
          </label>
          <input
            id="so-date"
            type="date"
            required
            value={orderDate}
            onChange={(event) => setOrderDate(event.target.value)}
            className="field mt-1.5 h-10"
          />
        </div>
      </div>

      {/* Order-level terms. Agreed per order, so they are entered here rather
          than read from the party — the customer's standing payment terms are
          shown beside the customer instead. */}
      <div className="mt-4 grid gap-4 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]">
        <div>
          <label htmlFor="so-shipping-terms" className="field-label">
            Shipping Terms
          </label>
          <input
            id="so-shipping-terms"
            value={shippingTerms}
            onChange={(event) => setShippingTerms(event.target.value)}
            maxLength={255}
            autoComplete="off"
            className="field mt-1.5 h-10"
          />
        </div>

        <div>
          <label htmlFor="so-transport" className="field-label">
            Transport Name
          </label>
          <input
            id="so-transport"
            value={transportName}
            onChange={(event) => setTransportName(event.target.value)}
            maxLength={255}
            autoComplete="off"
            className="field mt-1.5 h-10"
          />
        </div>

        <div>
          <label htmlFor="so-insurance" className="field-label">
            Insurance
          </label>
          <input
            id="so-insurance"
            value={insurance}
            onChange={(event) => setInsurance(event.target.value)}
            maxLength={255}
            autoComplete="off"
            className="field mt-1.5 h-10"
          />
        </div>

      </div>

      {/* CUSTOMER INFORMATION: who the order is for, and the addresses and
          terms that follow from that. The addresses are sub-sections because
          they belong to the customer, not to the order. */}
      <div className="mt-4">
        <Section title="Customer Information">
          <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]">
        <div>
          <label htmlFor="so-customer" className="field-label">
            Customer <span className="text-red-600">*</span>
          </label>
          <div className="mt-1.5">
            <SearchableSelect
              id="so-customer"
              value={customerId}
              onChange={setCustomerId}
              // The shared lookup defaults to the COMPACT field, which left the
              // customer box visibly shorter than the plain inputs beside it.
              // Overridden here rather than in the shared component, which other
              // screens use at that size on purpose.
              className="field h-10 w-full"
              placeholder="Search by code or name…"
              options={customers.map((candidate) => ({
                value: candidate.id,
                label: candidate.name,
                hint: candidate.hasValidLicence ? undefined : 'no valid licence',
                keywords: candidate.code,
              }))}
            />
          </div>

          {/* ONLY THE REFUSALS REMAIN. A valid licence and a healthy credit
              limit are reported in Account information, and repeating them
              under the picker said twice what the gate never objects to. What
              is kept is what the gate WILL refuse, before twenty lines are
              entered against a customer it is going to block. */}
          {customer && (
            <div className="mt-2 space-y-1 text-xs">
              {!customer.hasValidLicence && (
                <p className="text-red-700">
                  No valid drug licence on file. The licence check will refuse this order.
                </p>
              )}
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
          <label htmlFor="so-delivery" className="field-label">
            Wanted By
          </label>
          <input
            id="so-delivery"
            type="date"
            value={requestedDeliveryDate}
            onChange={(event) => setRequestedDeliveryDate(event.target.value)}
            className="field mt-1.5 h-10"
          />
        </div>

        {/* The customer's standing terms, read from the party. Beside the
            customer because that is what it belongs to — the order does not
            set it, and there is nothing here to type. */}
        <div>
          <p className="field-label">Payment Terms</p>
          <input
            readOnly
            disabled
            value={customer ? `${customer.creditTermsDays ?? 0} days` : ''}
            placeholder="Choose a customer"
            className="field mt-1.5 h-10 w-full"
          />
        </div>
      </div>

          {/* Read from the masters and the receivable ledger — nothing typed. */}
          {customerId && (
            <div className="mt-4">
              <CustomerPanels customerId={customerId} />
            </div>
          )}
        </Section>
      </div>

      {/* PRODUCT INFORMATION: what is being sold. Each line carries its own
          Composition and packaging sub-sections, read from the masters. */}
      <div className="mt-4">
        <Section title="Product Information">
        <div className="flex items-center justify-end">
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
                      placeholder="Type to search…"
                      // Name first, code underneath — the arrangement the
                      // Procure-to-Pay item picker uses. The code is still
                      // typed more often than the name, so it stays matched.
                      options={items.map((candidate) => ({
                        value: candidate.id,
                        label: candidate.name,
                        hint: candidate.code,
                        keywords: candidate.code,
                      }))}
                    />

                    {item && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        {/* The saleable quantity and the GST rate are shown in
                            the picker's own list, against each product, so
                            repeating them under the chosen one said the same
                            thing twice. The badges below stay: they are
                            refusals and controls, not figures. */}
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
                      aria-label="Unit Price"
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
                      aria-label="Discount Percent"
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

                  {/* The product's own specification, from the item master and
                      the packaging register. Spans the row so it reads as
                      belonging to the line above it. */}
                  <div className="sm:col-span-full">
                    <ProductPanel itemId={line.itemId} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </Section>
      </div>

      {/* BILLING INFORMATION. Qty, price and discount are on the lines above;
          the charge is levied on the order as a whole, which is why it sits
          here and not on a line. */}
      <div className="mt-4">
        <Section title="Billing Information">
        <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]">
          <div>
            <label htmlFor="so-charges" className="field-label">
              Processing Charges
            </label>
            <input
              id="so-charges"
              inputMode="decimal"
              value={processingCharges}
              onChange={(event) => setProcessingCharges(event.target.value)}
              placeholder="0.00"
              className="field mt-1.5 h-10"
            />
            <p className="field-hint">Taxed with the goods, at the lines&rsquo; own GST rates.</p>
          </div>
        </div>

      {lines.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4 text-sm">
            {/* Boxes, like every other value on the form. Read-only and
                disabled: these are computed from the lines and the charge, and
                typing over a total would only make it disagree with them. */}
            <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]">
              {/* The rate bands first: Class names the band and Basic is its
                  taxable value, which is what the single totals below cannot
                  show on an order carrying more than one rate. */}
              {gstSummary.flatMap((row) => [
                <Total key={`${row.rate}-class`} label="Class" value={`GST ${row.rate}%`} />,
                <Total key={`${row.rate}-basic`} label="Basic" value={row.basic} />,
              ])}

              <Total label="Goods Value" value={preview.goods} />
              <Total label="Processing Charges" value={preview.charge} />
              <Total label="Taxable Amount" value={preview.taxable} />
              <Total label="SGST Amount" value={totalsByHead.sgst} />
              <Total label="CGST Amount" value={totalsByHead.cgst} />
              <Total label="IGST Amount" value={totalsByHead.igst} />
            </div>

            {/* Their own grid, so they actually fill the line.
                `auto-fit` collapses only tracks that are empty across the WHOLE
                grid — with ten boxes above them every column is occupied, so
                the last two sat in three columns' worth of space with a hole
                beside them. On a grid of their own there is no third column to
                leave empty, and the two stretch to the full width. */}
            <div className="mt-4 grid gap-4 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]">
              <Total label="Grand Total" value={preview.total} />
              <Total label="Round Off" value={preview.roundOff} />
            </div>

            <p className="mt-3 text-[11px] text-slate-500">
              Indicative only. The saved order is priced and taxed by the API from the item master,
              and the CGST/SGST against IGST split is settled at invoicing from the place of
              supply.
            </p>
          </div>
        </div>
      )}
        </Section>
      </div>

      {/* GRAND TOTAL, outside the section: it is the one figure somebody looks
          for before committing, and it should not be behind a heading that can
          be collapsed. */}
      {/* Last before the footer: notes about an order are written once its
          figures are settled, not before them. */}
      <div className="mt-4">
        <Section title="Notes">
          <label htmlFor="so-notes" className="sr-only">
            Notes
          </label>
          <textarea
            id="so-notes"
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="field"
          />
        </Section>
      </div>

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
                customerPoNumber: customerPoNumber.trim() || undefined,
                shippingTerms: shippingTerms.trim() || undefined,
                insurance: insurance.trim() || undefined,
                transportName: transportName.trim() || undefined,
                processingCharges: processingCharges.trim() || undefined,
                notes: notes.trim() || undefined,
                items: payload,
              });

              if (result.ok) {
                const order = result.data;
                // Stock is no longer reserved at creation, so "did it pass the
                // gate" is the only question left here.
                const approved = order?.status === 'APPROVED';

                reset();

                // Silent when the gate passed — the order is in the list
                // below, with its status, which says it better. It now waits
                // on the Allocation tab for stock to be reserved against it.
                //
                // NOT silent when the gate blocked it: the request succeeded,
                // but the order cannot go anywhere until a licence or a credit
                // decision changes, and that is worth saying out loud.
                setError(
                  approved
                    ? null
                    : `Order ${order?.orderNumber ?? ''} was created but BLOCKED — ${
                        order?.checkFailureReason ?? 'the licence or credit check did not pass'
                      }`,
                );

                pushToast(
                  approved ? 'success' : 'error',
                  approved
                    ? `Sales order ${order?.orderNumber ?? ''} created.`
                    : `Sales order ${order?.orderNumber ?? ''} created but BLOCKED — ${
                        order?.checkFailureReason ?? 'the licence or credit check did not pass'
                      }`,
                );

                // The order exists, so the dialog is done. The blocked case
                // loses nothing by closing: that row carries its status, both
                // check verdicts and the failure reason itself. Inline (no
                // dialog) this is null and the message above stays on screen.
                closeDialog?.();
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
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canCancel = !['COMPLETED', 'CANCELLED'].includes(order.status);

  const cancel = (reason?: string) => {
    setError(null);
    startTransition(async () => {
      const result = await cancelSalesOrderAction(order.id, reason);
      if (!result.ok) setError(result.error ?? 'That did not work.');
      else setConfirming(false);
    });
  };

  const actions: RowAction[] = [
    {
      label: 'Edit',
      onSelect: () => setEditing(true),
      // Editable until the order is closed. The API is the authority and
      // refuses the lines once stock is reserved against them; the dates and
      // the note stay correctable while the order is still in play.
      disabledReason: ['COMPLETED', 'CANCELLED'].includes(order.status)
        ? `This order is ${order.status.toLowerCase()}, so it can no longer be edited.`
        : null,
    },
    {
      label: 'Cancel',
      onSelect: () => setConfirming(true),
      disabledReason: canCancel ? null : 'This order is already completed or cancelled.',
    },
  ];

  return (
    <>
      <RowActionMenu label={order.orderNumber} actions={actions} busy={pending} />

      {confirming && (
        <ConfirmDialog
          title={`Cancel ${order.orderNumber}?`}
          description="The order is closed and anything reserved against it is released. Nothing is deleted — the order stays on the list as cancelled."
          details={[
            { label: 'Customer', value: order.customerName },
            { label: 'Order date', value: formatDate(order.orderDate) },
            { label: 'Value', value: formatMoney(order.grandTotal) },
            { label: 'Status', value: order.status.toLowerCase().replace(/_/g, ' ') },
          ]}
          reason={{ label: 'Reason', hint: 'Optional. Kept with the order.' }}
          confirmLabel="Cancel order"
          pending={pending}
          onConfirm={cancel}
          onClose={() => setConfirming(false)}
        />
      )}

      {editing && (
        <EditSalesOrderForm order={order} onClose={() => setEditing(false)} />
      )}

      {error && (
        <p role="alert" className="mt-2 max-w-xs text-xs text-red-700">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * One computed value, drawn as a read-only field.
 *
 * A number is formatted as money and right-aligned so a column of figures
 * lines up on the decimal point; a string — the GST class — is left as it is,
 * because "GST 5.00%" is a label rather than an amount.
 */
function Total({ label, value }: { label: string; value: number | string }) {
  const isAmount = typeof value === 'number';

  return (
    <div>
      <p className="field-label">{label}</p>
      <input
        readOnly
        disabled
        value={isAmount ? formatMoney(value.toFixed(2)) : value}
        // RIGHT-ALIGNED WHATEVER IT HOLDS. The GST class sits in the same
        // column as the figures it heads, and a label flush left above amounts
        // flush right made the block read as two different tables.
        className="field mt-1.5 h-10 w-full text-right tabular-nums"
      />
    </div>
  );
}
