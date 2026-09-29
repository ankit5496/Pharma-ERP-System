'use client';

import { useState, useTransition } from 'react';

import type { SalesOrderListItem } from '@pharma-erp/types';

import { pushToast } from '@/components/toast';

import { updateSalesOrderAction } from './actions';
import { DialogFooter, Modal, useDialogClose } from './modal';
import { CustomerPanels } from './sales-order-panels';
import { formatMoney, PRIMARY_BUTTON } from './ui';

/**
 * Amending a sales order, in the same shape as raising one.
 *
 * THE SAME SECTIONS AS THE NEW ORDER FORM — Customer, Product, Billing, Notes —
 * because it is the same document. An edit screen laid out differently from the
 * form that created the record makes people hunt for the field they just filled
 * in, and the two drift apart every time one of them is changed.
 *
 * ONLY WHAT THE API WILL ACCEPT IS EDITABLE. The service allows the header —
 * dates, the order's own terms, the charge and the remarks — until the order is
 * completed or cancelled, and refuses the LINES once stock is reserved against
 * them, because reservations point at those lines. So the lines and the totals
 * are shown here as the record of what was agreed, not as inputs: a box that
 * looks editable and is then refused by the server is worse than a figure that
 * plainly is not.
 */
export function EditSalesOrderForm({
  order,
  onClose,
}: {
  order: SalesOrderListItem;
  onClose: () => void;
}) {
  return (
    <Modal
      title={`Edit ${order.orderNumber}`}
      description={order.customerName}
      wide
      onClose={onClose}
    >
      <EditFields order={order} />
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group/outer rounded-lg border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-4 w-4 shrink-0 text-slate-400 transition group-open/outer:rotate-180"
          fill="currentColor"
        >
          <path d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </summary>
      <div className="border-t border-slate-200 px-4 py-4">{children}</div>
    </details>
  );
}

/** A figure the order already carries. Shown, never typed — see the class note. */
function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="field-label">{label}</p>
      <input
        readOnly
        disabled
        value={value}
        className="field mt-1.5 h-10 w-full text-right tabular-nums"
      />
    </div>
  );
}

const GRID = 'grid gap-4 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]';

function EditFields({ order }: { order: SalesOrderListItem }) {
  const closeDialog = useDialogClose();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [orderDate, setOrderDate] = useState(order.orderDate);
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState(
    order.requestedDeliveryDate ?? '',
  );
  const [customerPoNumber, setCustomerPoNumber] = useState(order.customerPoNumber ?? '');
  const [shippingTerms, setShippingTerms] = useState(order.shippingTerms ?? '');
  const [insurance, setInsurance] = useState(order.insurance ?? '');
  const [transportName, setTransportName] = useState(order.transportName ?? '');
  const [processingCharges, setProcessingCharges] = useState(order.processingCharges);
  const [notes, setNotes] = useState(order.notes ?? '');

  const save = () => {
    setError(null);

    startTransition(async () => {
      const result = await updateSalesOrderAction(order.id, {
        orderDate,
        requestedDeliveryDate: requestedDeliveryDate || undefined,
        customerPoNumber: customerPoNumber.trim(),
        shippingTerms: shippingTerms.trim(),
        insurance: insurance.trim(),
        transportName: transportName.trim(),
        processingCharges: processingCharges.trim() || '0',
        notes: notes.trim(),
      });

      if (!result.ok) {
        setError(result.error ?? 'That did not work.');
        return;
      }

      pushToast('success', `${order.orderNumber} updated.`);
      closeDialog?.();
    });
  };

  return (
    <div className="space-y-4">
      {/* The header, as on the new-order form: the number and the customer are
          the order's identity and are not amendable — changing either would
          make it a different order rather than a corrected one. */}
      <div className={`${GRID} rounded-md border border-slate-200 bg-slate-50/60 p-4`}>
        <div>
          <p className="field-label">Sales Order No.</p>
          <input readOnly disabled value={order.orderNumber} className="field mt-1.5 h-10 w-full" />
        </div>

        <div>
          <label htmlFor="eso-po" className="field-label">
            Customer PO No.
          </label>
          <input
            id="eso-po"
            value={customerPoNumber}
            onChange={(event) => setCustomerPoNumber(event.target.value)}
            maxLength={64}
            autoComplete="off"
            className="field mt-1.5 h-10"
          />
        </div>

        <div>
          <label htmlFor="eso-date" className="field-label">
            Date <span className="text-red-600">*</span>
          </label>
          <input
            id="eso-date"
            type="date"
            required
            value={orderDate}
            onChange={(event) => setOrderDate(event.target.value)}
            className="field mt-1.5 h-10"
          />
        </div>
      </div>

      <div className={GRID}>
        <div>
          <label htmlFor="eso-shipping-terms" className="field-label">
            Shipping Terms
          </label>
          <input
            id="eso-shipping-terms"
            value={shippingTerms}
            onChange={(event) => setShippingTerms(event.target.value)}
            maxLength={255}
            autoComplete="off"
            className="field mt-1.5 h-10"
          />
        </div>

        <div>
          <label htmlFor="eso-transport" className="field-label">
            Transport Name
          </label>
          <input
            id="eso-transport"
            value={transportName}
            onChange={(event) => setTransportName(event.target.value)}
            maxLength={255}
            autoComplete="off"
            className="field mt-1.5 h-10"
          />
        </div>

        <div>
          <label htmlFor="eso-insurance" className="field-label">
            Insurance
          </label>
          <input
            id="eso-insurance"
            value={insurance}
            onChange={(event) => setInsurance(event.target.value)}
            maxLength={255}
            autoComplete="off"
            className="field mt-1.5 h-10"
          />
        </div>
      </div>

      <Section title="Customer Information">
        <div className={GRID}>
          <div>
            <p className="field-label">Customer</p>
            <input
              readOnly
              disabled
              value={order.customerName}
              className="field mt-1.5 h-10 w-full"
            />
          </div>

          <div>
            <label htmlFor="eso-delivery" className="field-label">
              Wanted By
            </label>
            <input
              id="eso-delivery"
              type="date"
              value={requestedDeliveryDate}
              onChange={(event) => setRequestedDeliveryDate(event.target.value)}
              className="field mt-1.5 h-10"
            />
          </div>
        </div>

        <div className="mt-4">
          <CustomerPanels customerId={order.customerId} />
        </div>
      </Section>

      <Section title="Product Information">
        <div className={GRID}>
          <Reading label="Product" value={order.productSummary || '—'} />
          <Reading label="Lines" value={String(order.itemCount)} />
          <Reading label="Quantity" value={order.totalQuantity} />
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Lines are not amended here. Stock may already be reserved against them, and the
          reservations point at the lines — release the allocation and raise a new order to
          re-price.
        </p>
      </Section>

      <Section title="Billing Information">
        <div className={GRID}>
          <div>
            <label htmlFor="eso-charges" className="field-label">
              Processing Charges
            </label>
            <input
              id="eso-charges"
              inputMode="decimal"
              value={processingCharges}
              onChange={(event) => setProcessingCharges(event.target.value)}
              className="field mt-1.5 h-10"
            />
            <p className="field-hint">Taxed with the goods, at the lines&rsquo; own GST rates.</p>
          </div>
        </div>

        <div className={`${GRID} mt-4`}>
          <Reading label="Goods Value" value={formatMoney(order.subtotal)} />
          <Reading label="SGST Amount" value={formatMoney(order.sgstAmount)} />
          <Reading label="CGST Amount" value={formatMoney(order.cgstAmount)} />
          <Reading label="IGST Amount" value={formatMoney(order.igstAmount)} />
        </div>

        <div className={`${GRID} mt-4`}>
          <Reading label="Grand Total" value={formatMoney(order.grandTotal)} />
          <Reading label="Round Off" value={formatMoney(order.roundOff)} />
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Recomputed by the API when the charge changes; these are the figures as last saved.
        </p>
      </Section>

      <Section title="Notes">
        <label htmlFor="eso-notes" className="sr-only">
          Notes
        </label>
        <textarea
          id="eso-notes"
          rows={3}
          maxLength={2000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="field"
        />
      </Section>

      {error && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      <DialogFooter>
        <button type="button" disabled={pending} onClick={save} className={PRIMARY_BUTTON}>
          {pending ? 'Saving…' : 'Save changes'}
        </button>
      </DialogFooter>
    </div>
  );
}
