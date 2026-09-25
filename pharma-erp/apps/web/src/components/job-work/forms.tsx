'use client';

import {
  BILLING_MODEL_LABELS,
  CONVERSION_RATE_BASIS_LABELS,
  INVOICE_BASIS_FOR_BILLING_MODEL,
  JOB_WORK_INVOICE_BASIS_LABELS,
  STOCK_BUCKET_FOR_BILLING_MODEL,
  JOB_WORK_MATERIAL_KIND_LABELS,
  JOB_WORK_PRODUCTION_STATUSES,
  JOB_WORK_PRODUCTION_STATUS_LABELS,
  JOB_WORK_RECEIPT_STATUS_LABELS,
  STOCK_OWNERSHIP_LABELS,
  type JobWorkDispatchableBatch,
  type JobWorkInvoiceView,
  type JobWorkMaterialReadiness,
  type JobWorkMaterialReceiptView,
  type JobWorkOrderablePrincipal,
  type JobWorkOrderMaterial,
  type JobWorkProductionOrderView,
  type JobWorkOrderSummary,
} from '@pharma-erp/types';
import { startTransition, useMemo, useState } from 'react';

import {
  Disclosure,
  Field,
  FormFooter,
  SubmitButton,
  useAction,
} from '@/components/procurement/form-kit';
import { SearchableSelect } from '@/components/procurement/searchable-select';
import { RowActionMenu } from '@/components/row-action-menu';

import {
  createJobWorkDispatchAction,
  createJobWorkOrderAction,
  createJobWorkProductionOrderAction,
  createJobWorkReceiptAction,
  decideJobWorkReceiptAction,
  loadJobWorkMaterialsAction,
  loadEligibleReceiptsAction,
  loadJobWorkReadinessAction,
  loadJobWorkReceiptsAction,
  raiseJobWorkProductionOrderAction,
  submitJobWorkReceiptAction,
  updateJobWorkProductionOrderAction,
  updateJobWorkOrderAction,
} from './actions';

/**
 * The Job Work forms.
 *
 * SECTION 17 OF THE BRIEF IS THE ORGANISING IDEA HERE: a value the system
 * decides is shown, not hidden. So the billing model appears on the order form
 * the moment a principal is chosen — as a read-only value, never as a select.
 * The stock bucket and the invoice basis are shown the same way.
 *
 * Section 17 also asked for a badge on each of them naming the kind of
 * decision. Those were withdrawn at the product owner's request; the values,
 * and the fact that none of them takes input, are unchanged.
 *
 * None of that is what ENFORCES anything. Every rule is re-decided by the API
 * (section 20); these controls exist so a user is not surprised by a refusal
 * they could have seen coming.
 */

/**
 * A value the system decided, shown but not editable.
 *
 * THE SHADED BOX IS THE WHOLE MESSAGE. It used to carry a badge as well —
 * SYSTEM-DERIVED, AUTO-INHERITED and so on — naming which kind of decision had
 * fixed the value. Withdrawn at the product owner's request: the field is
 * already visibly not an input, and the badge restated that in vocabulary only
 * the people who built it use.
 *
 * Nothing else changed. These values are still derived exactly as they were,
 * still not submitted, and still re-decided by the API.
 */
function Derived({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <span className="field-label">{label}</span>
      <div className="mt-1.5 flex min-h-[2.5rem] flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <span className="text-sm font-medium text-slate-800">{value}</span>
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// US-JW-01 — raise a job-work order
// ---------------------------------------------------------------------------

/**
 * The order form.
 *
 * Choosing a principal loads their agreement's products and shows the billing
 * model it will inherit — US-JW-01's "Important behavior", steps 1 to 6, in the
 * order it states them. Step 6 ("make Billing Model read-only") is honoured by
 * there being no input for it at all: the value is text, and the form has no
 * field named `billingModel` to submit.
 */
export function CreateJobWorkOrderButton({
  principals,
}: {
  principals: readonly JobWorkOrderablePrincipal[];
}) {
  const [state, formAction] = useAction(createJobWorkOrderAction);
  const [principalId, setPrincipalId] = useState('');
  const [mappingId, setMappingId] = useState('');

  const principal = useMemo(
    () => principals.find((entry) => entry.principalId === principalId),
    [principals, principalId],
  );

  const today = new Date().toISOString().slice(0, 10);

  /**
   * What the agreement fixes, once a principal is chosen.
   *
   * Null before then — and the three boxes below still render, saying what
   * will fill them. THE WHOLE FORM IS ON SCREEN FROM THE MOMENT IT OPENS: it
   * used to draw two lookups and hide everything else until a principal was
   * picked, which left most of the dialog empty and gave no way to see what
   * the form was going to ask for.
   */
  const terms = principal
    ? {
        billingModel: BILLING_MODEL_LABELS[principal.billingModel],
        stockBucket: STOCK_OWNERSHIP_LABELS[STOCK_BUCKET_FOR_BILLING_MODEL[principal.billingModel]],
        invoiceBasis:
          JOB_WORK_INVOICE_BASIS_LABELS[INVOICE_BASIS_FOR_BILLING_MODEL[principal.billingModel]],
      }
    : null;

  return (
    <Disclosure
      // THE BUTTON SAYS WHAT THE DIALOG IS CALLED. It read "Create job-work
      // order" while the dialog it opened was headed "New Job Work Order" —
      // two names for one thing, and neither matching the register beside it,
      // where the production-order trigger already reads "New Job Work
      // Production Order".
      label="New Job Work Order"
      title="New Job Work Order"
      subtitle="Raised against a principal's agreement. The billing model comes from that agreement and cannot be changed here."
      closeWhen={state.status === 'success'}
      // NO `minHeight`. One was set to give the lookups room to drop their
      // lists, and with most of the form hidden it simply became white space
      // under four controls. The form now fills the dialog on its own, which
      // is the requisition form's arrangement too.
      width="44rem"
    >
      {(close) => (
        // The requisition form's shape, field for field: one column of
        // sections, `space-y-4` between them, `field-sm` controls three
        // across, and the footer at the foot.
        <form action={formAction} className="w-full space-y-4">
          {principals.length === 0 && (
            // CONTROL 1, stated where it can be acted on. An empty select with
            // no explanation reads as a loading failure.
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              No principal currently holds an agreement that is in force, so no job-work order can
              be raised. Record or renew an agreement under Master Data first.
            </p>
          )}

          {/* What the system fills in. Stated once, plainly. */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-white p-3 text-xs sm:grid-cols-4">
            <SystemField label="Order no." value="Generated on save" />
            <SystemField label="Date" value={today} />
            <SystemField label="Principal code" value={principal?.principalCode ?? '—'} />
            <SystemField label="Status" value="Placed" />
          </dl>

          <Section title="Who it is for">
            <Field label="Principal" htmlFor="jw-principalId" required hint="Agreements in force.">
              <SearchableSelect
                id="jw-principalId"
                name="principalId"
                required
                options={principals.map((entry) => ({
                  value: entry.principalId,
                  label: entry.principalName,
                  hint: entry.principalCode,
                }))}
                value={principalId}
                onChange={(next) => {
                  setPrincipalId(next);
                  // The old product belongs to the old agreement.
                  setMappingId('');
                }}
                emptyLabel="Select principal"
              />
            </Field>

            <Field
              label="Product and brand"
              htmlFor="jw-mappingId"
              required
              hint="From the principal's agreement."
            >
              <SearchableSelect
                id="jw-mappingId"
                name="mappingId"
                required
                disabled={!principal}
                options={(principal?.products ?? []).map((product) => ({
                  value: product.mappingId,
                  label: product.principalBrandName,
                  hint: `${product.productName} (${product.productCode})`,
                }))}
                value={mappingId}
                onChange={setMappingId}
                emptyLabel={principal ? 'Select product' : 'Select a principal first'}
              />
            </Field>

            <Field label="Product code" htmlFor="jw-productCode">
              <input
                id="jw-productCode"
                value={
                  principal?.products.find((product) => product.mappingId === mappingId)
                    ?.productCode ?? ''
                }
                readOnly
                disabled
                placeholder="Follows the product"
                className="field-sm w-full bg-slate-100 text-slate-600"
              />
            </Field>
          </Section>

          {/* THE AGREEMENT'S TERMS, shown from the start rather than appearing
              once a principal is picked. Three boxes that say what will fill
              them beat three boxes that are not there: the form no longer
              changes height under the hand that is filling it in, and what the
              order will inherit is readable before anything is chosen. */}
          <Section title="From the agreement">
            <Derived
              label="Billing model"
              value={terms?.billingModel ?? 'Set by the principal'}
              hint="Read-only. It comes from the agreement in force."
            />

            <Derived
              label="Stock bucket production will use"
              value={terms?.stockBucket ?? 'Follows the billing model'}
            />

            <Derived
              label="Invoice basis"
              value={terms?.invoiceBasis ?? 'Follows the billing model'}
            />
          </Section>

          <Section title="What to make">
            <Field label="Quantity" htmlFor="jw-quantity" required hint="Up to 3 decimal places.">
              <input
                id="jw-quantity"
                name="quantity"
                type="text"
                inputMode="decimal"
                required
                placeholder="0.000"
                className="field-sm w-full"
              />
            </Field>

            <Field label="Delivery date" htmlFor="jw-deliveryDate" required>
              <input
                id="jw-deliveryDate"
                name="deliveryDate"
                type="date"
                required
                className="field-sm w-full"
              />
            </Field>

            <Field label="Notes" htmlFor="jw-notes" hint="Optional.">
              <input id="jw-notes" name="notes" maxLength={1000} className="field-sm w-full" />
            </Field>
          </Section>

          {/* OUTSIDE the branch above: a form with nothing to fill in still
              needs a way out that is not the X. Only the submit depends on
              there being something to submit. */}
          <FormFooter onCancel={close}>
            {principals.length > 0 && (
              <SubmitButton pendingLabel="Creating…">Create job work order</SubmitButton>
            )}
          </FormFooter>
        </form>
      )}
    </Disclosure>
  );
}

/** One system-filled value in the summary strip. Matches the requisition form. */
function SystemField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{value}</dd>
    </div>
  );
}

/** A titled group of fields, three across. Matches the requisition form. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Editing an order, and reading a receipt
// ---------------------------------------------------------------------------

/**
 * Change what can legitimately change about a placed order.
 *
 * THREE FIELDS, AND THE REST STATED. Quantity, delivery date and notes are
 * what the API accepts and what actually moves after an order is placed — a
 * principal asks for more, or a later date. Everything else follows from the
 * agreement: the principal, the product, the brand and the billing model are
 * not editable anywhere, so they are shown read-only rather than hidden. The
 * point of an edit dialog is that you can read the whole record from it.
 */
export function EditJobWorkOrderButton({ order }: { order: JobWorkOrderSummary }) {
  const [state, formAction] = useAction(updateJobWorkOrderAction);

  return (
    <Disclosure
      label="Edit"
      title={`Edit ${order.orderNumber}`}
      subtitle="Quantity, delivery date and notes. Everything else follows from the agreement."
      closeWhen={state.status === 'success'}
      width="46rem"
    >
      {(close) => (
        <form action={formAction} className="grid gap-4 sm:grid-cols-2">
          {/* `id`, which is what updateJobWorkOrderAction reads. The other
              forms in this file post `jobWorkOrderId` because they are
              creating something AGAINST an order; this one is editing the
              order itself. */}
          <input type="hidden" name="id" value={order.id} />

          <Derived label="Order no." value={order.orderNumber} />
          <Derived label="Principal" value={order.principalName} />

          <Derived
            label="Agreement"
            value={order.agreementReference ?? 'No reference'}
          />

          <Derived
            label="Billing model"
            value={BILLING_MODEL_LABELS[order.billingModel]}
          />

          <Derived
            label="Product"
            value={`${order.product.productName} (${order.product.productCode})`}
          />

          <Derived
            label="Principal's brand"
            value={order.product.principalBrandName}
          />

          <Derived
            label="Stock bucket"
            value={STOCK_OWNERSHIP_LABELS[order.stockBucket]}
          />

          <Derived
            label="Material received"
            value={`${order.materialReceivedQuantity} ${order.product.uom}`}
          />

          <Field label="Quantity" htmlFor="jw-edit-quantity" required>
            <input
              id="jw-edit-quantity"
              name="quantity"
              type="text"
              inputMode="decimal"
              required
              defaultValue={order.quantity}
              className="field h-10"
            />
          </Field>

          <Field label="Delivery date" htmlFor="jw-edit-delivery">
            <input
              id="jw-edit-delivery"
              name="deliveryDate"
              type="date"
              defaultValue={order.deliveryDate ?? ''}
              className="field h-10"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Notes" htmlFor="jw-edit-notes">
              <textarea
                id="jw-edit-notes"
                name="notes"
                rows={2}
                defaultValue={order.notes ?? ''}
                className="field"
              />
            </Field>
          </div>

          <FormFooter onCancel={close} className="sm:col-span-2">
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          </FormFooter>
        </form>
      )}
    </Disclosure>
  );
}

/**
 * The receipt as a document, with its material under it.
 *
 * The register lists one row per material, which is the right shape for
 * "have we got the lactose". This is the other question — "what came in on
 * that challan" — and it is the only place the parent record is legible as a
 * whole: the challan and its date, whether it was inspected and where that
 * got to, and the two kinds of material grouped as they arrived.
 *
 * READ-ONLY, deliberately. A receipt has already created stock lots and
 * ledger entries, and may since have been inspected, issued or consumed —
 * so correcting one is a stock adjustment rather than a form edit, and the
 * API offers no update for exactly that reason.
 */
export function ViewJobWorkReceiptButton({
  receipt,
  isOpen,
  onOpenChange,
}: {
  receipt: JobWorkMaterialReceiptView;
  /** Passed by a row's Actions menu, which is then the trigger. */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Disclosure
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label="View"
      title={`Receipt ${receipt.receiptNumber}`}
      subtitle={`${receipt.principalName} · ${receipt.jobWorkOrderNumber}`}
      width="60rem"
    >
      {(close) => (
        <div className="flex grow flex-col gap-4">
          {/* THREE COLUMNS, because the header is nine short read-only values
              and stacking them two-up would push the material — the part
              somebody opened this to see — below the fold. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Derived label="Receipt no." value={receipt.receiptNumber} />
            <Derived label="Principal" value={receipt.principalName} />
            <Derived
              label="Job-work order"
              value={receipt.jobWorkOrderNumber}
            />

            {/* The product this consignment is for. One order, one product —
                so it identifies the receipt as surely as the order number,
                and it is what a quality user recognises the job by. */}
            <Derived
              label="Product"
              value={receipt.productName + ' (' + receipt.productCode + ')'}
              hint={'Sold as ' + receipt.principalBrandName}
            />

            <Derived
              label="Delivery challans"
              value={receipt.deliveryChallanNumbers.join(', ') || '—'}
              hint="The principal&rsquo;s own documents. Not purchase invoices."
            />
            <Derived label="Receipt date" value={receipt.receiptDate} />
            <Derived
              label="Recorded"
              value={`${receipt.receivedAt.slice(0, 10)}${
                receipt.receivedBy ? ` by ${receipt.receivedBy}` : ''
              }`}
            />

            <Derived
              label="Status"
              value={JOB_WORK_RECEIPT_STATUS_LABELS[receipt.status]}
            />
            <Derived
              label="Approval"
              value={
                receipt.decidedAt
                  ? `${receipt.decidedAt.slice(0, 10)}${
                      receipt.decidedBy ? ` by ${receipt.decidedBy}` : ''
                    }`
                  : receipt.submittedAt
                    ? 'Waiting on Quality check'
                    : 'Not sent for approval yet'
              }
              hint={receipt.decisionNotes ?? undefined}
            />
            <Derived
              label="Stock ownership"
              value={STOCK_OWNERSHIP_LABELS.PRINCIPAL_OWNED}
            />
          </div>

          {/* The same tables the quality decision and the work-order form
              show. Three spellings of "what did the principal send" is how
              three screens come to disagree about it. */}
          <ReceiptMaterialTables receipt={receipt} />

          {receipt.notes && (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {receipt.notes}
            </p>
          )}

          <FormFooter onCancel={close} />
        </div>
      )}
    </Disclosure>
  );
}

// ---------------------------------------------------------------------------
// US-JW-02 — record the principal's material
// ---------------------------------------------------------------------------

/**
 * Asks for the receipt to be approved.
 *
 * DELIBERATELY NOT CALLED "APPROVE". This is the store saying the delivery is
 * completely recorded; the quality decision belongs to somebody else, on the
 * Quality check tab. A single button doing both would let whoever booked the
 * material also clear it for production.
 *
 * Confirmed rather than fired on one click, because it closes the receipt to
 * further material: anything arriving afterwards opens a fresh draft.
 */
export function SendForApprovalButton({
  receipt,
  isOpen,
  onOpenChange,
}: {
  receipt: JobWorkMaterialReceiptView;
  /** Passed by a row's Actions menu, which is then the trigger. */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [state, formAction] = useAction(submitJobWorkReceiptAction);

  return (
    <Disclosure
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label="Send for approval"
      title={`Send ${receipt.receiptNumber} for approval`}
      subtitle="The quality decision is taken separately, on Quality check."
      closeWhen={state.status === 'success'}
      width="34rem"
    >
      {(close) => (
        <form action={formAction} className="flex grow flex-col gap-4">
          <input type="hidden" name="receiptId" value={receipt.id} />

          <p className="text-sm text-slate-700">
            This says the delivery is completely recorded — {receipt.rawMaterialCount} raw and{' '}
            {receipt.packingMaterialCount} packing material
            {receipt.rawMaterialCount + receipt.packingMaterialCount === 1 ? '' : 's'} on{' '}
            {receipt.deliveryChallanNumbers.length} challan
            {receipt.deliveryChallanNumbers.length === 1 ? '' : 's'}.
          </p>

          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Once sent, no more material can be added to this receipt. Anything that arrives later
            for this order opens a new one. The material stays quarantined until a quality user
            approves it.
          </p>

          <FormFooter onCancel={close}>
            <SubmitButton pendingLabel="Sending…">Send for approval</SubmitButton>
          </FormFooter>
        </form>
      )}
    </Disclosure>
  );
}

/**
 * The actions on one row of the Inward materials register, behind one trigger.
 *
 * ONE MENU, NOT TWO BUTTONS. The cell used to render View and Send for
 * approval side by side, so the column's width — and whether a row had one
 * control or two — changed with the status of each receipt. Every other
 * register on these screens puts its row actions behind a single Actions
 * button, and Quality check next door already does exactly this.
 *
 * SEND FOR APPROVAL STAYS VISIBLE once it no longer applies, with the reason
 * on it. An entry that disappears leaves somebody wondering whether they
 * misremembered it; an entry that says "already with Quality check" answers the
 * question it raises.
 */
export function JobWorkInwardRowActions({
  receipt,
}: {
  receipt: JobWorkMaterialReceiptView;
}) {
  const [viewing, setViewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isDraft = receipt.status === 'DRAFT';

  return (
    <>
      <RowActionMenu
        label={`${receipt.receiptNumber} from ${receipt.principalName}`}
        actions={[
          { label: 'View', onSelect: () => setViewing(true) },
          {
            label: 'Send for approval',
            onSelect: () => setSubmitting(true),
            // Only a draft can be sent. A receipt already with the quality user
            // is theirs to decide, and one already decided is finished.
            disabledReason: isDraft
              ? null
              : `This consignment is already ${JOB_WORK_RECEIPT_STATUS_LABELS[
                  receipt.status
                ].toLowerCase()}, so it cannot be sent again.`,
          },
        ]}
      />

      <ViewJobWorkReceiptButton receipt={receipt} isOpen={viewing} onOpenChange={setViewing} />

      {/* Mounted only while open, so the dialog starts fresh each time rather
          than holding the previous row's state. */}
      {submitting && (
        <SendForApprovalButton
          receipt={receipt}
          isOpen={submitting}
          onOpenChange={setSubmitting}
        />
      )}
    </>
  );
}

/**
 * The quality decision on a consignment.
 *
 * ONE DECISION FOR THE WHOLE RECEIPT, and every lot under it follows. A reason
 * is required for anything but an approval — a hold or a rejection has
 * consequences for the principal, and the point of decision is the only time
 * anyone reliably writes down why.
 */
export function DecideJobWorkReceiptButton({
  receipt,
  isOpen,
  onOpenChange,
}: {
  receipt: JobWorkMaterialReceiptView;
  /** Passed by a row's Actions menu, which is then the trigger. */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [state, formAction] = useAction(decideJobWorkReceiptAction);
  const [decision, setDecision] = useState('APPROVED');

  return (
    <Disclosure
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label="Record decision"
      title={`Quality check — ${receipt.receiptNumber}`}
      subtitle={`${receipt.principalName} · ${receipt.jobWorkOrderNumber}`}
      closeWhen={state.status === 'success'}
      width="52rem"
    >
      {(close) => (
        <form action={formAction} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="receiptId" value={receipt.id} />

          <Derived label="Receipt no." value={receipt.receiptNumber} />
          <Derived label="Principal" value={receipt.principalName} />
          <Derived label="Job-work order" value={receipt.jobWorkOrderNumber} />
          <Derived
            label="Sent for approval"
            value={
              receipt.submittedAt
                ? `${receipt.submittedAt.slice(0, 10)}${
                    receipt.submittedBy ? ` by ${receipt.submittedBy}` : ''
                  }`
                : 'Not yet submitted'
            }
          />

          {/* WHAT IS BEING DECIDED ABOUT. A decision taken without seeing the
              material is a signature, not a quality check. */}
          <div className="sm:col-span-2">
            <ReceiptMaterialTables receipt={receipt} />
          </div>

          <Field label="Decision" htmlFor="jw-decision" required>
            <select
              id="jw-decision"
              name="decision"
              required
              value={decision}
              onChange={(event) => setDecision(event.target.value)}
              className="field h-10"
            >
              <option value="APPROVED">Approve — release to production</option>
              <option value="ON_HOLD">Hold — keep quarantined</option>
              <option value="REJECTED">Reject — cannot be used</option>
            </select>
          </Field>

          <Field label="COA / test reference" htmlFor="jw-testReference">
            <input
              id="jw-testReference"
              name="testReference"
              type="text"
              maxLength={64}
              className="field h-10"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field
              label="Remarks"
              htmlFor="jw-decision-notes"
              required={decision !== 'APPROVED'}
              hint={
                decision === 'APPROVED'
                  ? 'Optional.'
                  : 'Required — the principal will be told why.'
              }
            >
              <textarea
                id="jw-decision-notes"
                name="notes"
                rows={2}
                required={decision !== 'APPROVED'}
                className="field"
              />
            </Field>
          </div>

          <FormFooter onCancel={close} className="sm:col-span-2">
            <SubmitButton pendingLabel="Recording…">Record decision</SubmitButton>
          </FormFooter>
        </form>
      )}
    </Disclosure>
  );
}

/**
 * The actions on one Quality Check row.
 *
 * ONE CONTROL, not a button per action. The two dialogs are rendered here and
 * opened by the menu entries; Disclosure drops its own trigger when it is
 * handed an open state, so there is exactly one way into each.
 *
 * RECORD DECISION IS OFFERED ONLY ONCE. A consignment already approved, held or
 * rejected is a quality record, and the entry says why it is unavailable rather
 * than disappearing — an action that vanishes leaves somebody wondering whether
 * they misremembered it.
 */
export function JobWorkQualityCheckRowActions({
  receipt,
}: {
  receipt: JobWorkMaterialReceiptView;
}) {
  const [viewing, setViewing] = useState(false);
  const [deciding, setDeciding] = useState(false);

  const pending = receipt.status === 'PENDING_APPROVAL';

  return (
    <>
      <RowActionMenu
        label={`${receipt.receiptNumber} from ${receipt.principalName}`}
        actions={[
          { label: 'View', onSelect: () => setViewing(true) },
          {
            label: 'Record decision',
            onSelect: () => setDeciding(true),
            disabledReason: pending
              ? null
              : `This consignment is already ${
                  JOB_WORK_RECEIPT_STATUS_LABELS[receipt.status].toLowerCase()
                }. A quality decision is taken once.`,
          },
        ]}
      />

      <ViewJobWorkReceiptButton receipt={receipt} isOpen={viewing} onOpenChange={setViewing} />

      {/* Mounted only while open so the form starts empty each time rather than
          holding the previous row's typing. */}
      {deciding && (
        <DecideJobWorkReceiptButton
          receipt={receipt}
          isOpen={deciding}
          onOpenChange={setDeciding}
        />
      )}
    </>
  );
}

/**
 * A receipt's material, in the two sections it is read in.
 *
 * Shared by the quality decision, the record view and the work-order form —
 * all three answer "what did the principal actually send", and three
 * spellings of that table is how they come to disagree.
 */
export function ReceiptMaterialTables({
  receipt,
}: {
  receipt: JobWorkMaterialReceiptView;
}) {
  return (
    <div className="space-y-3">
      {(['RAW', 'PACKING'] as const).map((kind) => {
        const lines = receipt.lines.filter((line) => line.kind === kind);

        if (lines.length === 0) return null;

        return (
          <fieldset key={kind} className="rounded-md border border-slate-200 p-3">
            <legend className="px-1 text-sm font-medium text-slate-700">
              {JOB_WORK_MATERIAL_KIND_LABELS[kind]} ({lines.length})
            </legend>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-left text-xs">
                <thead>
                  <tr className="uppercase tracking-wide text-slate-500">
                    <th className="py-1 pr-3 font-medium">Material</th>
                    <th className="py-1 pr-3 font-medium">Batch / lot</th>
                    <th className="py-1 pr-3 text-right font-medium">Received</th>
                    <th className="py-1 pr-3 font-medium">UOM</th>
                    <th className="py-1 pr-3 font-medium">MFG</th>
                    <th className="py-1 pr-3 font-medium">Expiry</th>
                    <th className="py-1 font-medium">Challan</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-t border-slate-100">
                      <td className="py-1.5 pr-3">
                        <span className="block text-slate-800">{line.item.name}</span>
                        <span className="block font-mono text-[10px] text-slate-500">
                          {line.item.code}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-slate-700">{line.batchNumber}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-slate-900">
                        {line.receivedQuantity}
                      </td>
                      <td className="py-1.5 pr-3 text-slate-600">{line.item.uom}</td>
                      <td className="py-1.5 pr-3 tabular-nums text-slate-600">
                        {line.manufacturingDate ?? '—'}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums text-slate-600">
                        {line.expiryDate ?? '—'}
                      </td>
                      <td className="py-1.5 font-mono text-[11px] text-slate-500">
                        {line.deliveryChallanNumber}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/**
 * The material receipt form.
 *
 * Offered only for PURE_CONVERSION orders — under own-procurement the material
 * is bought through the normal purchase flow, and the API refuses a receipt
 * against such an order. The caller filters the list; this form states the
 * ownership tag it will set, as read-only.
 *
 * THE ORDER CHOOSES THE MATERIALS. Picking a job-work order lays out one row
 * per material in the formulation behind it, each with its own batch marking,
 * dates and received quantity. Nothing is typed twice and nothing is guessed:
 * the material list is the BOM the order was raised against, fetched from the
 * API rather than assembled here.
 */
export function CreateJobWorkReceiptButton({
  orders,
  ownProcurementOrderCount = 0,
}: {
  orders: readonly JobWorkOrderSummary[];
  /**
   * How many job-work orders exist on the OTHER billing model.
   *
   * Only used to tell two empty states apart: a company with no job-work orders
   * at all needs to raise one, whereas a company whose orders are all
   * own-procurement is not missing anything — this screen simply does not apply
   * to them, and saying so stops them hunting for a fault.
   */
  ownProcurementOrderCount?: number;
}) {
  const [state, formAction] = useAction(createJobWorkReceiptAction);

  // Nothing is preselected: which order the challan belongs to is a deliberate
  // choice, and everything else on the form follows from it.
  const [receiptOrderId, setReceiptOrderId] = useState('');

  /**
   * The chosen order's materials, fetched when it is chosen.
   *
   * Not brought with the page: the form needs one order's list and the page
   * would have had to load every order's to have it ready, which is what made
   * this screen take thirty-four seconds to draw.
   */
  const [materials, setMaterials] = useState<readonly JobWorkOrderMaterial[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(false);

  const orderChosen = receiptOrderId.length > 0;

  const chooseOrder = (id: string) => {
    setReceiptOrderId(id);
    setMaterials([]);

    if (!id) return;

    setLoadingMaterials(true);

    // The lookup is synchronous to the user; the fetch settles behind it. A
    // second choice made while the first is in flight wins, because the state
    // it sets is the state the last call writes.
    startTransition(async () => {
      const loaded = await loadJobWorkMaterialsAction(id);

      setMaterials(loaded);
      setLoadingMaterials(false);
    });
  };

  return (
    <Disclosure
      label="Record material receipt"
      title="Material received from principal"
      subtitle="Against the principal's delivery challan. This is not a purchase: no purchase order and no purchase invoice is created."
      closeWhen={state.status === 'success'}
      width="52rem"
    >
      {(close) => (
        <form action={formAction} className="grid gap-4 sm:grid-cols-2">
          {orders.length === 0 ? (
            <div className="sm:col-span-2 space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {ownProcurementOrderCount > 0 ? (
                <>
                  <p>
                    <strong>Nothing to record here.</strong>{' '}
                    {ownProcurementOrderCount === 1
                      ? 'Your only job-work order is'
                      : `All ${ownProcurementOrderCount} of your job-work orders are`}{' '}
                    on the <strong>own-procurement</strong> billing model, where you buy the
                    material yourself — so the principal ships you nothing to receive.
                  </p>
                  <p>
                    Buy it through <strong>Procure to Pay</strong> instead: requisition, purchase
                    order, goods receipt and incoming QC. It becomes your own stock, which is what
                    an own-procurement order must consume.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <strong>No pure-conversion job-work order to receive against.</strong> Material
                    arrives free of cost only on that billing model.
                  </p>
                  <p>
                    Set one up first: a <strong>pure-conversion agreement</strong> with the
                    principal under <strong>Principals &amp; agreements</strong>, then a{' '}
                    <strong>job-work order</strong> under it. The billing model is inherited from
                    the agreement, so it has to be right there.
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              <Field label="Job-work order" htmlFor="jw-jobWorkOrderId">
                <SearchableSelect
                  id="jw-jobWorkOrderId"
                  name="jobWorkOrderId"
                  required
                  options={orders.map((order) => ({
                    value: order.id,
                    label: order.orderNumber,
                    hint: `${order.principalName} (${order.product.principalBrandName})`,
                  }))}
                  value={receiptOrderId}
                  onChange={chooseOrder}
                  emptyLabel="Select job-work order"
                  className="field h-10"
                />
              </Field>

              <Field label="Delivery challan no." htmlFor="jw-deliveryChallanNumber">
                <input
                  id="jw-deliveryChallanNumber"
                  name="deliveryChallanNumber"
                  type="text"
                  required
                  maxLength={64}
                  className="field h-10"
                />
              </Field>

              <Field label="Challan date" htmlFor="jw-receiptDate">
                <input
                  id="jw-receiptDate"
                  name="receiptDate"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className="field h-10"
                />
              </Field>

              <Derived
                label="Stock ownership"
                value={STOCK_OWNERSHIP_LABELS.PRINCIPAL_OWNED}
              />

              <div className="sm:col-span-2">
                <Field label="Notes" htmlFor="jw-notes">
                  <textarea id="jw-notes" name="notes" rows={2} className="field" />
                </Field>
              </div>

              {/* The materials the chosen order expects, one row each. */}
              {!orderChosen ? (
                <p className="sm:col-span-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Choose the job-work order above and its materials will be listed here.
                </p>
              ) : loadingMaterials ? (
                <p className="sm:col-span-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Loading the materials for that order…
                </p>
              ) : materials.length === 0 ? (
                <div className="sm:col-span-2 space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p>
                    <strong>This order has no formulation behind it.</strong> There is no list of
                    materials to receive against, so a receipt cannot be recorded.
                  </p>
                  <p>
                    Add a bill of materials for the product under <strong>Master data</strong>, and
                    map it on the agreement, then come back to this challan.
                  </p>
                </div>
              ) : (
                <>
                  {/* TWO SECTIONS, ONE RECEIPT. The index passed to each row is
                      its position in the WHOLE list, not within its section —
                      that is what keeps `lines.0`, `lines.1` … contiguous
                      across both, so the action reads them as one challan. */}
                  {MATERIAL_SECTIONS.map(({ kind, title, blurb }) => {
                    const inSection = materials
                      .map((material, index) => ({ material, index }))
                      .filter(({ material }) => material.kind === kind);

                    if (inSection.length === 0) return null;

                    return (
                      <fieldset
                        key={kind}
                        className="sm:col-span-2 space-y-3 rounded-md border border-slate-200 p-4"
                      >
                        <legend className="px-1 text-sm font-medium text-slate-700">
                          {title}
                        </legend>

                        <p className="text-xs text-slate-500">{blurb}</p>

                        {inSection.map(({ material, index }) => (
                          <MaterialReceiptRow
                            key={material.item.id}
                            index={index}
                            material={material}
                          />
                        ))}
                      </fieldset>
                    );
                  })}
                </>
              )}
            </>
          )}

          <FormFooter onCancel={close} className="sm:col-span-2">
            {orders.length > 0 && (
              <SubmitButton pendingLabel="Recording…">Record receipt</SubmitButton>
            )}
          </FormFooter>
        </form>
      )}
    </Disclosure>
  );
}

/**
 * The two kinds of material a principal ships, and where each list comes from.
 *
 * Declared beside the form rather than derived from the labels map so the
 * ORDER is fixed: raw material first, because that is the order a challan is
 * read in and the order the pack is built in.
 */
const MATERIAL_SECTIONS = [
  {
    kind: 'RAW' as const,
    title: JOB_WORK_MATERIAL_KIND_LABELS.RAW,
    blurb: "From the formulation behind this order's product.",
  },
  {
    kind: 'PACKING' as const,
    title: JOB_WORK_MATERIAL_KIND_LABELS.PACKING,
    blurb: "From the product's active packaging requirement.",
  },
];

/**
 * One material of the formulation, as it arrived.
 *
 * THE QUANTITY IS THE ONE THAT ARRIVED, not the one the BOM asks for. The
 * formulation figure is shown beside the field as a reference, because a store
 * officer checking a challan wants to know what was expected — and left out of
 * the input, because prefilling it would turn a count into a formality.
 *
 * The material itself is stated, never selected: it comes from the order, and
 * the API refuses any line naming something the formulation does not list.
 */
function MaterialReceiptRow({
  index,
  material,
}: {
  index: number;
  material: JobWorkOrderMaterial;
}) {
  const prefix = `lines.${index}`;

  return (
    <div className="grid gap-3 border-t border-slate-100 pt-3 first:border-0 first:pt-0 sm:grid-cols-4">
      <input type="hidden" name={`${prefix}.itemId`} value={material.item.id} />

      <div className="sm:col-span-4">
        <p className="text-sm font-medium text-slate-900">{material.item.name}</p>
        <p className="text-xs text-slate-500">
          {material.item.code} · calls for {material.quantityPerBatch} {material.item.uom}{' '}
          {material.quantityBasis}
        </p>
      </div>

      <Field label="Batch / lot number" htmlFor={`jw-batch-${index}`}>
        <input
          id={`jw-batch-${index}`}
          name={`${prefix}.batchNumber`}
          type="text"
          maxLength={64}
          className="field h-10"
        />
      </Field>

      <Field label={`Received quantity (${material.item.uom})`} htmlFor={`jw-qty-${index}`}>
        <input
          id={`jw-qty-${index}`}
          name={`${prefix}.receivedQuantity`}
          type="text"
          inputMode="decimal"
          placeholder="0.0000"
          className="field h-10"
        />
      </Field>

      <Field label="Manufacturing date" htmlFor={`jw-mfg-${index}`}>
        <input
          id={`jw-mfg-${index}`}
          name={`${prefix}.manufacturingDate`}
          type="date"
          className="field h-10"
        />
      </Field>

      <Field label="Expiry date" htmlFor={`jw-expiry-${index}`}>
        <input
          id={`jw-expiry-${index}`}
          name={`${prefix}.expiryDate`}
          type="date"
          className="field h-10"
        />
      </Field>
    </div>
  );
}
// ---------------------------------------------------------------------------
// US-JW-03 — raise the EXISTING work order against this job-work order
// ---------------------------------------------------------------------------

/**
 * Raise the work order, with the reason it will or will not be accepted.
 *
 * EVERYTHING THE ORDER ALREADY KNOWS IS STATED, not asked: the principal,
 * the agreement, the billing model, the product and the bucket all follow from
 * the job-work order and none of them is a field. What is left to decide is
 * the batch size and when it starts.
 *
 * THE MATERIAL READINESS TABLE IS THE POINT OF THE FORM. It is the same
 * arithmetic the API refuses on — asked of the API, not computed here — so a
 * shortage is visible before the button is pressed rather than afterwards as a
 * sentence. The button follows it; the API re-checks anyway, because a disabled
 * control is a courtesy and not a rule.
 *
 * FETCHED WHEN THE FORM OPENS. The answer costs several round trips to the
 * database, and the list used to ask for one per row — sixty-one of them to
 * draw a page, which took the screen forty-four seconds. It is asked once, for
 * the order somebody is actually looking at.
 */
export function RaiseJobWorkProductionButton({ order }: { order: JobWorkOrderSummary }) {
  const [state, formAction] = useAction(createJobWorkProductionOrderAction);

  const [open, setOpen] = useState(false);
  const [readiness, setReadiness] = useState<JobWorkMaterialReadiness | null>(null);
  const [receipts, setReceipts] = useState<readonly JobWorkMaterialReceiptView[]>([]);
  const [checking, setChecking] = useState(false);

  const principalOwned = order.stockBucket === 'PRINCIPAL_OWNED';

  const openForm = (next: boolean) => {
    setOpen(next);

    // Asked each time it opens rather than cached: material moves, QC decisions
    // are taken, and a stale "Ready" is the failure this table exists to stop.
    if (!next) return;

    setChecking(true);

    startTransition(async () => {
      const [check, received] = await Promise.all([
        loadJobWorkReadinessAction(order.id),
        // WHAT THE PRINCIPAL ACTUALLY SENT, read from the receipts rather than
        // recomputed: the popup shows the material it will consume, and the
        // only honest source for that is the record of its arrival.
        loadJobWorkReceiptsAction(order.id),
      ]);

      setReadiness(check);
      setReceipts(received);
      setChecking(false);
    });
  };

  const alreadyRaised = order.productionOrderCount > 0;

  return (
    <span className="flex flex-wrap items-center gap-2">
      {/* THE TRIGGER, which controlled mode leaves to the caller. Without one
          this column rendered empty — the dialog had no way in at all. */}
      <button
        type="button"
        onClick={() => openForm(true)}
        className="h-9 whitespace-nowrap rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition hover:bg-slate-800"
      >
        Raise work order
      </button>

      {/* SAID, NOT PREVENTED. A second batch against one job-work order is
          ordinary — a principal orders 200,000 and the plant runs two of
          100,000 — so this reports what already exists rather than blocking a
          legitimate second run. What stops a DUPLICATE is the material: the
          first work order consumes it, and the readiness check inside refuses
          the second unless more has been received and approved. */}
      {alreadyRaised && (
        <span className="text-[11px] text-slate-500">
          {order.productionOrderCount} already raised
        </span>
      )}

    <Disclosure
      label="Raise work order"
      title={`Work order for ${order.orderNumber}`}
      subtitle="This raises the SAME production work order own-brand batches use, tagged to this principal. Material will be drawn from the bucket the billing model chose."
      closeWhen={state.status === 'success'}
      width="60rem"
      isOpen={open}
      onOpenChange={openForm}
    >
      {(close) => (
        <form action={formAction} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="jobWorkOrderId" value={order.id} />
          <input type="hidden" name="productId" value={order.product.productId} />

          <Derived label="Principal" value={order.principalName} />

          <Derived
            label="Agreement"
            value={order.agreementReference ?? 'No reference'}
          />

          <Derived label="Job-work order" value={order.orderNumber} />

          <Derived
            label="Billing model"
            value={BILLING_MODEL_LABELS[order.billingModel]}
          />

          <Derived
            label="Product"
            value={`${order.product.productName} (${order.product.productCode})`}
            hint={`Sold as ${order.product.principalBrandName}`}
          />

          <Derived
            label="Stock bucket"
            value={STOCK_OWNERSHIP_LABELS[order.stockBucket]}
          />

          <Field label="Batch size" htmlFor="jw-plannedQuantity">
            <input
              id="jw-plannedQuantity"
              name="plannedQuantity"
              type="text"
              inputMode="decimal"
              required
              defaultValue={order.quantity}
              className="field h-10"
            />
            <p className="field-hint">
              The figures below were worked out for{' '}
              {readiness?.batchSize ?? order.quantity} {order.product.uom}. Change this and the
              requirement changes with it — reopen the form to see it recalculated.
            </p>
          </Field>

          <Field label="Planned start" htmlFor="jw-plannedStartOn">
            <input id="jw-plannedStartOn" name="plannedStartOn" type="date" className="field h-10" />
          </Field>

          <div className="sm:col-span-2 space-y-4">
            {checking ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Checking what material is available for this order…
              </p>
            ) : (
              <>
                <MaterialReadinessTable readiness={readiness} principalOwned={principalOwned} />

                {/* WHAT THE PRINCIPAL ACTUALLY SENT — under pure conversion the
                    batch is made of these drums and no others, so the person
                    raising the order should see them, with their batch markings
                    and expiry dates, before committing to a batch size. */}
                {principalOwned &&
                  receipts
                    .filter((receipt) => receipt.status === 'APPROVED')
                    .map((receipt) => (
                      <fieldset
                        key={receipt.id}
                        className="rounded-md border border-slate-200 p-4"
                      >
                        <legend className="px-1 text-sm font-medium text-slate-700">
                          Received on {receipt.receiptNumber}
                        </legend>

                        <p className="mb-2 text-xs text-slate-500">
                          Challan{receipt.deliveryChallanNumbers.length === 1 ? '' : 's'}{' '}
                          {receipt.deliveryChallanNumbers.join(', ')} · approved
                          {receipt.decidedBy ? ` by ${receipt.decidedBy}` : ''}
                        </p>

                        <ReceiptMaterialTables receipt={receipt} />
                      </fieldset>
                    ))}

                {principalOwned &&
                  receipts.filter((receipt) => receipt.status === 'APPROVED').length === 0 && (
                    <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      No approved material receipt for this order yet. Record what the principal
                      sent under <strong>Material received from principal</strong>, send it for
                      approval, and have it approved on <strong>Quality check</strong>.
                    </p>
                  )}
              </>
            )}
          </div>

          <FormFooter onCancel={close} className="sm:col-span-2">
            <SubmitButton
              pendingLabel="Raising…"
              disabled={checking || (readiness ? !readiness.ready : false)}
            >
              Raise work order
            </SubmitButton>
          </FormFooter>
        </form>
      )}
    </Disclosure>
    </span>
  );
}

/**
 * What the formulation needs, and what there is.
 *
 * TWO SHAPES, ONE TABLE. Under pure conversion the question is "did the
 * principal send enough, and has it cleared QC" — so the columns are received,
 * eligible and shortage. Under own procurement it is "have we got enough that
 * is not already promised elsewhere" — released stock, reserved, available to
 * issue. The same row shape answers both because the arithmetic is the same;
 * only which pool is counted differs.
 */
function MaterialReadinessTable({
  readiness,
  principalOwned,
}: {
  readiness: JobWorkMaterialReadiness | null;
  principalOwned: boolean;
}) {
  if (!readiness) {
    return (
      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        The material readiness check could not be loaded. The work order can still be raised —
        the API checks the same figures and will refuse if anything is short.
      </p>
    );
  }

  if (readiness.lines.length === 0) {
    return (
      <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <p className="font-medium">This order cannot be manufactured yet.</p>
        <p>{readiness.blockedReason ?? 'No formulation materials were found.'}</p>
      </div>
    );
  }

  return (
    <fieldset className="space-y-3 rounded-md border border-slate-200 p-4">
      <legend className="px-1 text-sm font-medium text-slate-700">Material readiness</legend>

      <p className="text-xs text-slate-600">
        Formulation <span className="font-mono">v{readiness.bomVersion}</span>, per{' '}
        {readiness.bomOutputQuantity} {readiness.product.uom}, scaled to a batch of{' '}
        <strong>{readiness.batchSize}</strong>.{' '}
        {principalOwned
          ? 'Only material the principal sent against this order counts.'
          : 'Only company-owned stock not already committed to another work order counts.'}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left text-xs">
          <thead>
            <tr className="uppercase tracking-wide text-slate-500">
              <th className="py-1 pr-3 font-medium">Material</th>
              <th className="py-1 pr-3 text-right font-medium">Required</th>
              <th className="py-1 pr-3 text-right font-medium">
                {principalOwned ? 'Received' : 'Released stock'}
              </th>
              {!principalOwned && (
                <th className="py-1 pr-3 text-right font-medium">Reserved</th>
              )}
              <th className="py-1 pr-3 text-right font-medium">
                {principalOwned ? 'Eligible' : 'Available to issue'}
              </th>
              <th className="py-1 pr-3 text-right font-medium">Shortage</th>
              <th className="py-1 pr-3 font-medium">QC</th>
              <th className="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {readiness.lines.map((line) => (
              <tr key={line.item.id} className="border-t border-slate-100">
                <td className="py-1.5 pr-3">
                  <span className="block text-slate-800">{line.item.name}</span>
                  <span className="block font-mono text-[10px] text-slate-500">
                    {line.item.code}
                  </span>
                </td>

                <td className="py-1.5 pr-3 text-right tabular-nums text-slate-800">
                  {line.requiredQuantity} {line.item.uom}
                </td>

                <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">
                  {principalOwned ? line.receivedQuantity : line.availableStock}
                </td>

                {!principalOwned && (
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">
                    {line.reservedQuantity}
                  </td>
                )}

                <td className="py-1.5 pr-3 text-right tabular-nums font-medium text-slate-900">
                  {line.eligibleQuantity}
                </td>

                <td
                  className={`py-1.5 pr-3 text-right tabular-nums ${
                    line.ready ? 'text-slate-400' : 'font-semibold text-red-700'
                  }`}
                >
                  {line.shortageQuantity}
                </td>

                <td className="py-1.5 pr-3 text-[11px] text-slate-600">
                  {/* WHY THE REST DOES NOT COUNT. Material can be present and
                      still ineligible, and "short 2 kg" with 5 kg sitting in
                      quarantine is a different problem from "short 2 kg" with
                      nothing on the shelf. */}
                  {Number(line.quantityAwaitingQc) > 0 && (
                    <span className="block text-amber-800">
                      {line.quantityAwaitingQc} awaiting QC
                    </span>
                  )}
                  {Number(line.quantityRejectedOrHeld) > 0 && (
                    <span className="block text-red-700">
                      {line.quantityRejectedOrHeld} rejected / held
                    </span>
                  )}
                  {Number(line.quantityExpired) > 0 && (
                    <span className="block text-red-700">{line.quantityExpired} expired</span>
                  )}
                  {Number(line.quantityAwaitingQc) === 0 &&
                    Number(line.quantityRejectedOrHeld) === 0 &&
                    Number(line.quantityExpired) === 0 && (
                      <span className="text-slate-400">Released</span>
                    )}
                </td>

                <td className="py-1.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      line.ready
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-red-50 text-red-700'
                    }`}
                  >
                    {line.ready ? 'Ready' : 'Short'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!readiness.ready && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <strong>Cannot raise the work order.</strong>{' '}
          {principalOwned
            ? 'Record the principal\u2019s delivery challan for the short materials, release them through incoming QC, or reduce the batch size.'
            : 'Buy the short materials through Procure to Pay, or reduce the batch size.'}
        </p>
      )}
    </fieldset>
  );
}
// ---------------------------------------------------------------------------
// Job-work production orders — the module's own manufacturing record
// ---------------------------------------------------------------------------

/**
 * Raises the production order for a job-work order.
 *
 * EVERYTHING IT CAN KNOW, IT KNOWS. The principal, agreement, billing model,
 * product and brand all follow from the job-work order and none of them is a
 * field — re-typing what the system already holds is how two records of one
 * job come to disagree. What is left to decide is which approved consignment
 * the batch is made from, how much, and when.
 *
 * THE CONSIGNMENT IS THE GATE. Only receipts that have passed Quality check
 * are offered, and the API refuses anything else — so an order cannot be
 * raised against material still in quarantine.
 */
export function RaiseJobWorkProductionOrderButton({
  order,
}: {
  order: JobWorkOrderSummary;
}) {
  const [state, formAction] = useAction(raiseJobWorkProductionOrderAction);

  const [open, setOpen] = useState(false);
  const [receipts, setReceipts] = useState<readonly JobWorkMaterialReceiptView[]>([]);
  const [receiptId, setReceiptId] = useState('');
  const [loading, setLoading] = useState(false);

  const openForm = (next: boolean) => {
    setOpen(next);

    if (!next) return;

    setLoading(true);

    startTransition(async () => {
      const eligible = await loadEligibleReceiptsAction(order.id);

      setReceipts(eligible);
      // One approved consignment is the ordinary case; choosing it for them
      // saves a click without hiding that a choice exists.
      setReceiptId(eligible.length === 1 ? (eligible[0]?.id ?? '') : '');
      setLoading(false);
    });
  };

  const chosen = receipts.find((receipt) => receipt.id === receiptId) ?? null;

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => openForm(true)}
        className="h-9 whitespace-nowrap rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition hover:bg-slate-800"
      >
        Raise production order
      </button>

      <Disclosure
        isOpen={open}
        onOpenChange={openForm}
        label="Raise production order"
        title={`Production order for ${order.orderNumber}`}
        subtitle="Made from an approved consignment of the principal’s material."
        closeWhen={state.status === 'success'}
        width="62rem"
      >
        {(close) => (
          <form action={formAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <input type="hidden" name="jobWorkOrderId" value={order.id} />

            {/* THREE COLUMNS: nine read-only values above the material tables,
                which are the part somebody opened this to see. Stacking them
                two-up would push the tables below the fold. */}
            <Derived label="Production order no." value="Generated on save" />
            <Derived label="Job-work order" value={order.orderNumber} />
            <Derived label="Principal" value={order.principalName} />

            <Derived
              label="Agreement"
              value={order.agreementReference ?? 'No reference'}
            />
            <Derived
              label="Billing model"
              value={BILLING_MODEL_LABELS[order.billingModel]}
            />
            <Derived
              label="Stock bucket"
              value={STOCK_OWNERSHIP_LABELS[order.stockBucket]}
            />

            <Derived
              label="Product"
              value={`${order.product.productName} (${order.product.productCode})`}
            />
            <Derived label="Brand" value={order.product.principalBrandName} />
            <Derived label="UOM" value={order.product.uom} />

            <Field label="Material receipt" htmlFor="jwpo-receipt" required>
              <SearchableSelect
                id="jwpo-receipt"
                name="materialReceiptId"
                required
                disabled={loading || receipts.length === 0}
                options={receipts.map((receipt) => ({
                  value: receipt.id,
                  label: receipt.receiptNumber,
                  hint: `${receipt.rawMaterialCount} raw · ${receipt.packingMaterialCount} packing · ${receipt.deliveryChallanNumbers.join(", ")}`,
                }))}
                value={receiptId}
                onChange={setReceiptId}
                emptyLabel={loading ? 'Loading…' : 'Select material receipt'}
                className="field h-10"
              />
            </Field>

            <Field label="Planned quantity" htmlFor="jwpo-quantity" required>
              <input
                id="jwpo-quantity"
                name="plannedQuantity"
                type="text"
                inputMode="decimal"
                required
                defaultValue={order.quantity}
                className="field h-10"
              />
            </Field>

            <Field label="Planned start" htmlFor="jwpo-start">
              <input id="jwpo-start" name="plannedStartOn" type="date" className="field h-10" />
            </Field>

            <Field label="Planned completion" htmlFor="jwpo-finish">
              <input
                id="jwpo-finish"
                name="plannedCompletionOn"
                type="date"
                className="field h-10"
              />
            </Field>

            <div className="sm:col-span-2 lg:col-span-3">
              <Field label="Notes" htmlFor="jwpo-notes">
                <textarea id="jwpo-notes" name="notes" rows={2} className="field" />
              </Field>
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              {loading ? (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Looking for approved consignments against this order…
                </p>
              ) : receipts.length === 0 ? (
                <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p className="font-medium">
                    No approved material receipt for this order.
                  </p>
                  <p>
                    Record what the principal sent under{' '}
                    <strong>Material received from principal</strong>, send it for approval, and
                    have it approved on <strong>Quality check</strong>. A production order cannot
                    be raised against material still in quarantine.
                  </p>
                </div>
              ) : chosen ? (
                <fieldset className="rounded-md border border-slate-200 p-4">
                  <legend className="px-1 text-sm font-medium text-slate-700">
                    Material on {chosen.receiptNumber}
                  </legend>

                  {/* REFERENCED, NOT COPIED. These are the receipt’s own child
                      records — the production order holds none of its own. */}
                  <ReceiptMaterialTables receipt={chosen} />
                </fieldset>
              ) : (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Choose the material receipt above and its materials will be listed here.
                </p>
              )}
            </div>

            <FormFooter onCancel={close} className="sm:col-span-2 lg:col-span-3">
              <SubmitButton pendingLabel="Raising…" disabled={loading || receipts.length === 0}>
                Raise production order
              </SubmitButton>
            </FormFooter>
          </form>
        )}
      </Disclosure>
    </span>
  );
}

/**
 * The production order as a record, and the plan as something to change.
 *
 * ONE COMPONENT FOR BOTH, because the two differ only in which fields take
 * input — and a view that omits the fields an edit shows is a view somebody
 * has to close and reopen in the other mode to read.
 */
export function JobWorkProductionOrderDialog({
  order,
  mode,
  isOpen,
  onOpenChange,
}: {
  order: JobWorkProductionOrderView;
  mode: 'view' | 'edit';
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [state, formAction] = useAction(updateJobWorkProductionOrderAction);

  const editing = mode === 'edit';

  return (
    <Disclosure
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label={editing ? 'Edit' : 'View'}
      title={`${order.orderNumber} — ${order.product.name}`}
      subtitle={`${order.principalName} · ${order.jobWorkOrderNumber}`}
      closeWhen={state.status === 'success'}
      width="62rem"
    >
      {(close) => (
        <form action={formAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <input type="hidden" name="id" value={order.id} />

          <Derived label="Production order no." value={order.orderNumber} />
          <Derived label="Job-work order" value={order.jobWorkOrderNumber} />
          <Derived label="Principal" value={order.principalName} />

          <Derived
            label="Agreement"
            value={order.agreementReference ?? 'No reference'}
          />
          <Derived
            label="Billing model"
            value={BILLING_MODEL_LABELS[order.billingModel]}
          />
          <Derived
            label="Product"
            value={`${order.product.name} (${order.product.code})`}
            hint={`Sold as ${order.principalBrandName}`}
          />

          {/* UNDER OWN PROCUREMENT there is neither: we bought the material
              through Procure-to-Pay, where it passed incoming QC on its own
              goods receipt. Showing an empty "Quality check" here would imply a
              step was skipped rather than that it does not apply. */}
          <Derived
            label="Material source"
            value={order.materialReceipt?.receiptNumber ?? 'Our own inventory'}
            hint={order.materialReceipt ? undefined : 'Bought through Procure-to-Pay.'}
          />
          <Derived
            label="Quality check"
            value={
              order.materialReceipt === null
                ? 'On the purchase'
                : order.materialReceipt.decidedAt
                  ? `Approved ${order.materialReceipt.decidedAt.slice(0, 10)}`
                  : 'Approved'
            }
            hint={order.materialReceipt?.decidedBy ?? undefined}
          />
          <Derived
            label="Raised"
            value={`${order.createdAt.slice(0, 10)}${
              order.createdBy ? ` by ${order.createdBy}` : ''
            }`}
          />

          {editing ? (
            <>
              <Field label="Planned quantity" htmlFor={`jwpo-q-${order.id}`} required>
                <input
                  id={`jwpo-q-${order.id}`}
                  name="plannedQuantity"
                  type="text"
                  inputMode="decimal"
                  required
                  defaultValue={order.plannedQuantity}
                  className="field h-10"
                />
              </Field>

              <Field label="Planned start" htmlFor={`jwpo-s-${order.id}`}>
                <input
                  id={`jwpo-s-${order.id}`}
                  name="plannedStartOn"
                  type="date"
                  defaultValue={order.plannedStartOn ?? ''}
                  className="field h-10"
                />
              </Field>

              <Field label="Planned completion" htmlFor={`jwpo-c-${order.id}`}>
                <input
                  id={`jwpo-c-${order.id}`}
                  name="plannedCompletionOn"
                  type="date"
                  defaultValue={order.plannedCompletionOn ?? ''}
                  className="field h-10"
                />
              </Field>
            </>
          ) : (
            <>
              <Derived
                label="Planned quantity"
                value={`${order.plannedQuantity} ${order.product.uom}`}
              />
              <Derived label="Planned start" value={order.plannedStartOn ?? '—'} />
              <Derived label="Planned completion" value={order.plannedCompletionOn ?? '—'} />
            </>
          )}

          {editing ? (
            <Field
              label="Stage"
              htmlFor={`jwpo-st-${order.id}`}
              hint="Only the next stage of the workflow is accepted."
            >
              <select
                id={`jwpo-st-${order.id}`}
                name="status"
                defaultValue={order.status}
                className="field h-10"
              >
                {JOB_WORK_PRODUCTION_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {JOB_WORK_PRODUCTION_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Derived
              label="Stage"
              value={JOB_WORK_PRODUCTION_STATUS_LABELS[order.status]}
            />
          )}

          <div className="sm:col-span-2 lg:col-span-3">
            {editing ? (
              <Field label="Notes" htmlFor={`jwpo-n-${order.id}`}>
                <textarea
                  id={`jwpo-n-${order.id}`}
                  name="notes"
                  rows={2}
                  defaultValue={order.notes ?? ''}
                  className="field"
                />
              </Field>
            ) : (
              order.notes && (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {order.notes}
                </p>
              )
            )}
          </div>

          {/* ONLY WHERE THERE IS A CONSIGNMENT. An own-procurement order's
              material is company stock and is not listed here — the drums it
              will actually draw on are chosen at Material issue, from the
              shelf, and naming them before that would be a guess. */}
          {order.materialReceipt && (
            <div className="sm:col-span-2 lg:col-span-3">
              <fieldset className="rounded-md border border-slate-200 p-4">
                <legend className="px-1 text-sm font-medium text-slate-700">
                  Material on {order.materialReceipt.receiptNumber}
                </legend>

                <ReceiptMaterialTables receipt={order.materialReceipt} />
              </fieldset>
            </div>
          )}

          <FormFooter onCancel={close} className="sm:col-span-2 lg:col-span-3">
            {editing && <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>}
          </FormFooter>
        </form>
      )}
    </Disclosure>
  );
}

/**
 * The actions on one job-work production order row.
 *
 * EDIT DISAPPEARS ONCE THE BATCH IS UNDER WAY, with the reason given rather
 * than the entry vanishing: after production starts the figures describe what
 * is happening on the floor, and editing them would rewrite history.
 */
export function JobWorkProductionRowActions({
  order,
}: {
  order: JobWorkProductionOrderView;
}) {
  const [viewing, setViewing] = useState(false);
  const [editing, setEditing] = useState(false);

  const planEditable = order.status === 'DRAFT' || order.status === 'READY_FOR_PRODUCTION';

  return (
    <>
      <RowActionMenu
        label={`${order.orderNumber} for ${order.principalName}`}
        actions={[
          { label: 'View', onSelect: () => setViewing(true) },
          {
            label: 'Edit',
            onSelect: () => setEditing(true),
            disabledReason: planEditable
              ? null
              : `This order is ${JOB_WORK_PRODUCTION_STATUS_LABELS[order.status].toLowerCase()}, so its plan can no longer be changed.`,
          },
        ]}
      />

      {viewing && (
        <JobWorkProductionOrderDialog
          order={order}
          mode="view"
          isOpen={viewing}
          onOpenChange={setViewing}
        />
      )}

      {editing && (
        <JobWorkProductionOrderDialog
          order={order}
          mode="edit"
          isOpen={editing}
          onOpenChange={setEditing}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// US-JW-05 — dispatch and invoice
// ---------------------------------------------------------------------------

/**
 * The dispatch form.
 *
 * THERE IS NO INVOICE-BASIS CONTROL, which is control 7 on the screen: the
 * basis is shown as derived text and the form has no field to submit. The
 * per-unit value appears only under own-procurement, because under pure
 * conversion the charge comes off the agreement and the raw-material value is
 * not invoiced at all.
 */
export function CreateJobWorkDispatchButton({
  order,
  batches,
}: {
  order: JobWorkOrderSummary;
  batches: readonly JobWorkDispatchableBatch[];
}) {
  const [state, formAction] = useAction(createJobWorkDispatchAction);

  /** The released batch being dispatched. */
  const [dispatchBatchId, setDispatchBatchId] = useState('');

  return (
    <Disclosure
      label="Dispatch & invoice"
      title={`Dispatch against ${order.orderNumber}`}
      subtitle="Only released batches can be sent. The invoice basis follows the agreement's billing model."
      closeWhen={state.status === 'success'}
      width="44rem"
    >
      {(close) => (
        <form action={formAction} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="jobWorkOrderId" value={order.id} />

          {/* NOT WHILE A SAVE IS BEING CONFIRMED. Dispatching the last
              available batch empties this list, and the dialog stays up for the
              moment it takes the confirmation to be read — so without the
              second half of this test, the form someone just submitted would be
              replaced in front of them by "no batch is released with stock
              remaining", which reads as the dispatch having failed. */}
          {batches.length === 0 && state.status !== 'success' ? (
            // CONTROL 6, said where it helps. "No batches" with no reason reads
            // as a bug; naming the gate tells them who to chase.
            <p className="sm:col-span-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              No batch made against this order is released with stock remaining. A batch can only be
              dispatched once the quality gate has released it — on-hold and rejected batches cannot
              leave.
            </p>
          ) : (
            <>
              <div className="sm:col-span-2">
                <Field label="Batch" htmlFor="jw-batchId">
                  <SearchableSelect
                    id="jw-batchId"
                    name="batchId"
                    required
                    options={batches.map((batch) => ({
                      value: batch.batchId,
                      label: batch.batchNumber,
                      hint: `${batch.quantityAvailable} available, expires ${batch.expiryDate}`,
                    }))}
                    value={dispatchBatchId}
                    onChange={setDispatchBatchId}
                    emptyLabel="Select released batch"
                    className="field h-10"
                  />
                </Field>
              </div>

              <Field label="Quantity dispatched" htmlFor="jw-dispatchedQuantity">
                <input
                  id="jw-dispatchedQuantity"
                  name="dispatchedQuantity"
                  type="text"
                  inputMode="decimal"
                  required
                  placeholder="0.000"
                  className="field h-10"
                />
              </Field>

              <Field label="Dispatch date" htmlFor="jw-dispatchDate">
                <input id="jw-dispatchDate"
                  name="dispatchDate" type="date" className="field h-10" />
              </Field>

              <div className="sm:col-span-2">
                <Derived
                  label="Invoice basis"
                  value={JOB_WORK_INVOICE_BASIS_LABELS[order.invoiceBasis]}
                />
              </div>

              {/* Own-procurement only. Under pure conversion the API REJECTS
                  this field rather than ignoring it, so the control must not
                  exist here either. */}
              {order.billingModel === 'OWN_PROCUREMENT' && (
                <Field
                  label="Finished-goods value per unit"
                  htmlFor="jw-unitValue"
                 
                >
                  <input
                    id="jw-unitValue"
                  name="unitValue"
                    type="text"
                    inputMode="decimal"
                    required
                    placeholder="0.0000"
                    className="field h-10"
                  />
                </Field>
              )}

              <div className="sm:col-span-2">
                <Field label="Notes" htmlFor="jw-notes">
                  <textarea id="jw-notes"
                  name="notes" rows={2} className="field" />
                </Field>
              </div>

            </>
          )}

          <FormFooter onCancel={close} className="sm:col-span-2">
            {batches.length > 0 && (
              <SubmitButton pendingLabel="Dispatching…">Dispatch & raise invoice</SubmitButton>
            )}
          </FormFooter>
        </form>
      )}
    </Disclosure>
  );
}

// ---------------------------------------------------------------------------
// US-JW-05 — the invoice, read back
// ---------------------------------------------------------------------------

/**
 * One job-work invoice in full, read-only.
 *
 * WHY IT EXISTS. The billing register is a wide table of figures and it still
 * could not answer "what is this invoice actually for" — the product is not on
 * it, the batch is a code, and the conversion basis that decided the rate was
 * a phrase in a narrow column. Every other register on these screens opens its
 * record; this one had nothing to open.
 *
 * THE SAME DIALOG THE RECEIPT VIEW USES — `Disclosure`, `Derived` boxes three
 * across, a section per part of the record — so a billing record reads the way
 * a consignment does rather than inventing a second way of showing a record.
 *
 * THE ORDER IS PASSED IN rather than fetched here: the product, the ordered
 * quantity and the delivery date live on the job-work order, and the panel has
 * that list already. It is optional, so an invoice whose order has since been
 * filtered out still opens — with those three boxes saying so instead of the
 * dialog failing.
 */
export function ViewJobWorkInvoiceButton({
  invoice,
  order,
  isOpen,
  onOpenChange,
}: {
  invoice: JobWorkInvoiceView;
  /** The order this invoice is against, where the panel has it. */
  order?: JobWorkOrderSummary;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const money = (amount: string) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(Number(amount));

  return (
    <Disclosure
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label="View"
      title={`Invoice ${invoice.invoiceNumber}`}
      subtitle={`${invoice.principalName} · ${invoice.jobWorkOrderNumber}`}
      width="60rem"
    >
      {(close) => (
        <div className="flex grow flex-col gap-5">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              What was billed
            </h3>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Derived label="Invoice no." value={invoice.invoiceNumber} />
              <Derived label="Job work order" value={invoice.jobWorkOrderNumber} />
              <Derived label="Principal" value={invoice.principalName} />

              <Derived
                label="Product"
                value={
                  order
                    ? `${order.product.productName} (${order.product.productCode})`
                    : 'Not on the current list'
                }
                hint={order ? `Sold as ${order.product.principalBrandName}` : undefined}
              />

              <Derived label="Batch" value={invoice.batchNumber} />

              <Derived
                label="Ordered quantity"
                value={order ? order.quantity : '—'}
                hint={order ? `Delivery ${order.deliveryDate}` : undefined}
              />
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              How it was charged
            </h3>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Derived
                label="Billing model"
                value={BILLING_MODEL_LABELS[invoice.billingModel]}
              />

              <Derived
                label="Invoice basis"
                value={JOB_WORK_INVOICE_BASIS_LABELS[invoice.invoiceBasis]}
                hint={
                  invoice.invoiceBasis === 'CONVERSION_CHARGE_ONLY'
                    ? 'Raw-material value is not invoiced — the principal supplied it.'
                    : undefined
                }
              />

              <Derived
                label="Conversion basis"
                value={
                  invoice.rateBasis
                    ? CONVERSION_RATE_BASIS_LABELS[invoice.rateBasis]
                    : 'Full finished-goods value'
                }
                hint="Snapshotted at dispatch, so a later change to the agreement cannot move this invoice."
              />

              <Derived label="Quantity dispatched" value={invoice.dispatchedQuantity} />
              <Derived label="Rate applied" value={money(invoice.rateApplied)} />
              <Derived label="Dispatch date" value={invoice.dispatchDate} />
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Amounts
            </h3>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Derived label="Taxable value" value={money(invoice.taxableValue)} />
              <Derived
                label="GST"
                value={money(invoice.gstAmount)}
                hint={`At ${invoice.gstRatePercent}%`}
              />
              <Derived label="Total value" value={money(invoice.totalValue)} />
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Record
            </h3>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* NOT A STORED FIELD. A job-work invoice has no lifecycle of its
                  own — it is raised by the dispatch that returns the batch and
                  is never amended — so the status is stated as what it is
                  rather than left off the dialog for somebody to wonder about. */}
              <Derived
                label="Billing status"
                value="Raised"
                hint="Raised by the dispatch that returned this batch."
              />

              <Derived label="Created" value={invoice.createdAt.slice(0, 10)} />
              <Derived label="Created by" value={invoice.createdBy ?? '—'} />

              <div className="sm:col-span-2 lg:col-span-3">
                <Derived label="Notes" value={invoice.notes ?? '—'} />
              </div>
            </div>
          </section>

          <FormFooter onCancel={close} />
        </div>
      )}
    </Disclosure>
  );
}
