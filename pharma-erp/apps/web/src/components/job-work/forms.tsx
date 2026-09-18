'use client';

import {
  BILLING_MODEL_LABELS,
  CONVERSION_RATE_BASIS_LABELS,
  INVOICE_BASIS_FOR_BILLING_MODEL,
  JOB_WORK_INVOICE_BASIS_LABELS,
  STOCK_BUCKET_FOR_BILLING_MODEL,
  STOCK_OWNERSHIP_LABELS,
  type ItemSummary,
  type JobWorkDispatchableBatch,
  type JobWorkOrderablePrincipal,
  type JobWorkOrderSummary,
} from '@pharma-erp/types';
import { useMemo, useState } from 'react';

import {
  Disclosure,
  Field,
  FormFooter,
  SubmitButton,
  useAction,
} from '@/components/procurement/form-kit';
import { SearchableSelect } from '@/components/procurement/searchable-select';

import {
  createJobWorkDispatchAction,
  createJobWorkOrderAction,
  createJobWorkProductionOrderAction,
  createJobWorkReceiptAction,
} from './actions';

/**
 * The Job Work forms.
 *
 * SECTION 17 OF THE BRIEF IS THE ORGANISING IDEA HERE: a value the system
 * decides is shown, not hidden, and shown with the badge that says why it
 * cannot be changed. So the billing model appears on the order form the moment
 * a principal is chosen — as text with an AUTO-INHERITED badge, never as a
 * select. The stock bucket and the invoice basis are shown the same way.
 *
 * None of that is what ENFORCES anything. Every rule is re-decided by the API
 * (section 20); these controls exist so a user is not surprised by a refusal
 * they could have seen coming.
 */

/** A value the system decided, with the badge saying which kind of decision. */
function Derived({
  label,
  value,
  badge,
  hint,
}: {
  label: string;
  value: string;
  badge: 'AUTO-INHERITED' | 'SYSTEM-DERIVED' | 'AUTO-DERIVED' | 'SYSTEM-SET' | 'READ-ONLY';
  hint?: string;
}) {
  return (
    <div>
      <span className="field-label">{label}</span>
      <div className="mt-1.5 flex min-h-[2.5rem] flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <span className="text-sm font-medium text-slate-800">{value}</span>
        <span className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {badge}
        </span>
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

  return (
    <Disclosure
      label="Create job-work order"
      title="New job-work order"
      subtitle="Raised against a principal's agreement. The billing model comes from that agreement and cannot be changed here."
      closeWhen={state.status === 'success'}
      width="44rem"
    >
      {(close) => (
        <form action={formAction} className="grid gap-4 sm:grid-cols-2">
          {principals.length === 0 ? (
            // CONTROL 1, stated where it can be acted on. An empty select with
            // no explanation reads as a loading failure.
            <p className="sm:col-span-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              No principal currently holds an agreement that is in force, so no job-work order can
              be raised. Record or renew an agreement under Master Data first.
            </p>
          ) : (
            <>
              <Field label="Principal" htmlFor="jw-principalId">
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
                  emptyLabel="Choose a principal…"
                  className="field h-10"
                />
              </Field>

              <Field label="Product and brand" htmlFor="jw-mappingId">
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
                  emptyLabel={principal ? 'Choose a product…' : 'Choose a principal first'}
                  className="field h-10"
                />
              </Field>

              {principal && (
                <>
                  <Derived
                    label="Billing model"
                    value={BILLING_MODEL_LABELS[principal.billingModel]}
                    badge="AUTO-INHERITED"
                    hint={`From ${principal.agreementReference ?? 'the agreement'}. It decides the stock bucket and the invoice basis, and cannot be changed on the order.`}
                  />

                  <Derived
                    label="Stock bucket production will use"
                    value={
                      STOCK_OWNERSHIP_LABELS[
                        STOCK_BUCKET_FOR_BILLING_MODEL[principal.billingModel]
                      ]
                    }
                    badge="SYSTEM-DERIVED"
                  />

                  <div className="sm:col-span-2">
                    <Derived
                      label="Invoice basis"
                      value={
                        JOB_WORK_INVOICE_BASIS_LABELS[
                          INVOICE_BASIS_FOR_BILLING_MODEL[principal.billingModel]
                        ]
                      }
                      badge="AUTO-DERIVED"
                      hint={
                        principal.billingModel === 'PURE_CONVERSION'
                          ? principal.conversionChargeRate
                            ? `Conversion charge ${principal.conversionChargeRate} ${principal.conversionRateBasis ? CONVERSION_RATE_BASIS_LABELS[principal.conversionRateBasis] : ''}. Raw-material value is not invoiced.`
                            : 'No conversion charge is recorded on this agreement yet, so a dispatch against it cannot be invoiced until one is.'
                          : 'The full finished-goods value is invoiced, entered per dispatch.'
                      }
                    />
                  </div>

                  <Field label="Quantity" htmlFor="jw-quantity">
                    <input
                      id="jw-quantity"
                  name="quantity"
                      type="text"
                      inputMode="decimal"
                      required
                      placeholder="0.000"
                      className="field h-10"
                    />
                  </Field>

                  <Field label="Delivery date" htmlFor="jw-deliveryDate">
                    <input id="jw-deliveryDate"
                  name="deliveryDate" type="date" required className="field h-10" />
                  </Field>

                  <div className="sm:col-span-2">
                    <Field label="Notes" htmlFor="jw-notes">
                      <textarea id="jw-notes"
                  name="notes" rows={2} className="field" />
                    </Field>
                  </div>

                </>
              )}
            </>
          )}

          {/* OUTSIDE the branch above: a form with nothing to fill in still
              needs a way out that is not the X. Only the submit depends on
              there being something to submit. */}
          <FormFooter onCancel={close} className="sm:col-span-2">
            {principals.length > 0 && (
              <SubmitButton pendingLabel="Creating…">Create job-work order</SubmitButton>
            )}
          </FormFooter>
        </form>
      )}
    </Disclosure>
  );
}

// ---------------------------------------------------------------------------
// US-JW-02 — record the principal's material
// ---------------------------------------------------------------------------

/**
 * The material receipt form.
 *
 * Offered only for PURE_CONVERSION orders — under own-procurement the material
 * is bought through the normal purchase flow, and the API refuses a receipt
 * against such an order. The caller filters the list; this form states the
 * ownership tag it will set, as read-only.
 */
export function CreateJobWorkReceiptButton({
  orders,
  items,
  ownProcurementOrderCount = 0,
}: {
  orders: readonly JobWorkOrderSummary[];
  items: readonly ItemSummary[];
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

  // What the two lookups on this form hold. Nothing is preselected: the order
  // and the material are both deliberate choices.
  const [receiptOrderId, setReceiptOrderId] = useState('');
  const [receiptItemId, setReceiptItemId] = useState('');

  return (
    <Disclosure
      label="Record material receipt"
      title="Material received from principal"
      subtitle="Against the principal's delivery challan. This is not a purchase: no purchase order and no purchase invoice is created."
      closeWhen={state.status === 'success'}
      width="46rem"
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
                  onChange={setReceiptOrderId}
                  emptyLabel="Choose an order…"
                  className="field h-10"
                />
              </Field>

              <Field
                label="Delivery challan no."
                htmlFor="jw-deliveryChallanNumber"
               
                hint="The principal's own document number. Not a purchase invoice."
              >
                <input
                  id="jw-deliveryChallanNumber"
                  name="deliveryChallanNumber"
                  type="text"
                  required
                  maxLength={64}
                  className="field h-10"
                />
              </Field>

              <Field label="Material" htmlFor="jw-itemId">
                <SearchableSelect
                  id="jw-itemId"
                  name="itemId"
                  required
                  options={items.map((item) => ({
                    value: item.id,
                    label: item.name,
                    hint: item.code,
                  }))}
                  value={receiptItemId}
                  onChange={setReceiptItemId}
                  emptyLabel="Choose the material…"
                  className="field h-10"
                />
              </Field>

              <Field label="Batch / lot number" htmlFor="jw-batchNumber">
                <input id="jw-batchNumber"
                  name="batchNumber" type="text" required maxLength={64} className="field h-10" />
              </Field>

              <Field label="Received quantity" htmlFor="jw-receivedQuantity">
                <input
                  id="jw-receivedQuantity"
                  name="receivedQuantity"
                  type="text"
                  inputMode="decimal"
                  required
                  placeholder="0.0000"
                  className="field h-10"
                />
              </Field>

              <Derived
                label="Stock ownership"
                value={STOCK_OWNERSHIP_LABELS.PRINCIPAL_OWNED}
                badge="SYSTEM-SET"
                hint="Held separately from company-owned stock and only consumable by this principal's job work."
              />

              <Field label="Manufacturing date" htmlFor="jw-manufacturingDate">
                <input id="jw-manufacturingDate"
                  name="manufacturingDate" type="date" className="field h-10" />
              </Field>

              <Field label="Expiry date" htmlFor="jw-expiryDate">
                <input id="jw-expiryDate"
                  name="expiryDate" type="date" className="field h-10" />
              </Field>

              <div className="sm:col-span-2">
                <Field label="Notes" htmlFor="jw-notes">
                  <textarea id="jw-notes"
                  name="notes" rows={2} className="field" />
                </Field>
              </div>

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

// ---------------------------------------------------------------------------
// US-JW-03 — raise the EXISTING work order against this job-work order
// ---------------------------------------------------------------------------

export function RaiseJobWorkProductionButton({ order }: { order: JobWorkOrderSummary }) {
  const [state, formAction] = useAction(createJobWorkProductionOrderAction);

  return (
    <Disclosure
      label="Raise work order"
      title={`Work order for ${order.orderNumber}`}
      subtitle="This raises the SAME production work order own-brand batches use, tagged to this principal. Material will be drawn from the bucket the billing model chose."
      closeWhen={state.status === 'success'}
      width="40rem"
    >
      {(close) => (
        <form action={formAction} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="jobWorkOrderId" value={order.id} />
          <input type="hidden" name="productId" value={order.product.productId} />

          <Derived
            label="Product"
            value={`${order.product.productName} (${order.product.productCode})`}
            badge="READ-ONLY"
            hint={`Sold as ${order.product.principalBrandName}.`}
          />

          <Derived
            label="Stock bucket"
            value={STOCK_OWNERSHIP_LABELS[order.stockBucket]}
            badge="SYSTEM-DERIVED"
            hint={
              order.stockBucket === 'PRINCIPAL_OWNED'
                ? 'Only material received against this order can be issued. Company-owned stock will be refused.'
                : 'Company-owned stock released by incoming QC.'
            }
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
          </Field>

          <Field label="Planned start" htmlFor="jw-plannedStartOn">
            <input id="jw-plannedStartOn"
                  name="plannedStartOn" type="date" className="field h-10" />
          </Field>

          <FormFooter onCancel={close} className="sm:col-span-2">
            <SubmitButton pendingLabel="Raising…">Raise work order</SubmitButton>
          </FormFooter>
        </form>
      )}
    </Disclosure>
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

          {batches.length === 0 ? (
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
                    emptyLabel="Choose a released batch…"
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
                  badge="AUTO-DERIVED"
                  hint={
                    order.billingModel === 'PURE_CONVERSION'
                      ? "From the agreement's billing model. Only the agreed conversion charge is invoiced; the raw-material value is not, because the principal supplied it."
                      : "From the agreement's billing model. The full finished-goods value is invoiced."
                  }
                />
              </div>

              {/* Own-procurement only. Under pure conversion the API REJECTS
                  this field rather than ignoring it, so the control must not
                  exist here either. */}
              {order.billingModel === 'OWN_PROCUREMENT' && (
                <Field
                  label="Finished-goods value per unit"
                  htmlFor="jw-unitValue"
                 
                  hint="The full product value. GST is calculated from the item master."
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
