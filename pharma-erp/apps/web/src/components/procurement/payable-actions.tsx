'use client';

import type { PurchaseInvoiceListItem, VendorPayableRow } from '@pharma-erp/types';
import { useState } from 'react';

import { RowActionMenu, type RowAction } from '@/components/row-action-menu';

import { EditInvoiceButton, EditPaymentButton } from './edit-dialogs';

/**
 * Row actions for the Vendor payables ledger.
 *
 * EACH ROW IS AN INVOICE, so Edit is the invoice edit — the same dialog the
 * Purchase invoices tab opens, not a second form that would be a second place
 * to fix.
 *
 * THE PAYMENT EDITS LIVE HERE TOO, one entry per payment, and that is why they
 * are labelled with the payment number rather than just "Edit payment": a row
 * can carry several payments against one invoice, and an unlabelled entry would
 * leave the reader guessing which one they were about to change. They used to
 * sit inline in the Payments column, which put an edit control inside what is
 * otherwise a list of facts.
 *
 * THE INVOICE IS PASSED IN, not derived from the payables row. A
 * `VendorPayableRow` carries what an ageing ledger needs — numbers, dates,
 * balances — and none of what the edit form needs: the lines, the tax split,
 * the goods receipt it bills. The page fetches the invoices alongside the
 * payables and hands the matching one down. When there is no match (the invoice
 * is outside the current page of results) the entry is disabled and says so,
 * which is better than opening a form with half a record in it.
 *
 * RECORD PAYMENT IS NOT DUPLICATED HERE. It already has its own column on this
 * table, and that column is left exactly as it was.
 */
export function PayableActions({
  row,
  invoice,
}: {
  row: VendorPayableRow;
  /** The full invoice behind this row, when it is on the current page. */
  invoice: PurchaseInvoiceListItem | undefined;
}) {
  const [editingInvoice, setEditingInvoice] = useState(false);

  // Which payment's dialog is open, by id. One piece of state rather than one
  // flag per payment: only one dialog can be open at a time, and a flag each
  // would let two of them be true.
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);

  const actions: RowAction[] = [
    {
      label: 'Edit',
      onSelect: () => setEditingInvoice(true),
      disabledReason: !invoice
        ? 'This invoice is not on the current page of the invoice register — open it from the Purchase invoices tab.'
        : invoice.status === 'CANCELLED'
          ? 'A cancelled invoice cannot be edited.'
          : null,
    },
    ...row.payments.map((payment) => ({
      label: `Edit ${payment.number}`,
      onSelect: () => setEditingPaymentId(payment.id),
      disabledReason: null,
    })),
  ];

  return (
    // CENTRED IN THE COLUMN. A flex container ignores `text-align`, so the
    // table-wide centring does not reach the contents of an action cell —
    // `justify-center` is what actually centres the control under its header.
    <div className="flex items-center justify-center gap-2">
      <RowActionMenu label={row.invoiceNumber} actions={actions} />

      {/* None of these render a trigger of their own: the menu entries above
          open them. */}
      {invoice && (
        <EditInvoiceButton
          invoice={invoice}
          isOpen={editingInvoice}
          onOpenChange={setEditingInvoice}
        />
      )}

      {row.payments.map((payment) => (
        <EditPaymentButton
          key={payment.id}
          payment={payment}
          isOpen={editingPaymentId === payment.id}
          onOpenChange={(open) => setEditingPaymentId(open ? payment.id : null)}
        />
      ))}
    </div>
  );
}
