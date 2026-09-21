'use client';

import {
  BILLING_MODEL_LABELS,
  INVOICE_BASIS_FOR_BILLING_MODEL,
  JOB_WORK_INVOICE_BASIS_LABELS,
  STOCK_BUCKET_FOR_BILLING_MODEL,
  JOB_WORK_MATERIAL_KIND_LABELS,
  JOB_WORK_RECEIPT_STATUS_LABELS,
  STOCK_OWNERSHIP_LABELS,
  type JobWorkDispatchableBatch,
  type JobWorkMaterialReadiness,
  type JobWorkMaterialReceiptView,
  type JobWorkOrderablePrincipal,
  type JobWorkOrderMaterial,
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

import {
  createJobWorkDispatchAction,
  createJobWorkOrderAction,
  createJobWorkProductionOrderAction,
  createJobWorkReceiptAction,
  loadJobWorkMaterialsAction,
  loadJobWorkReadinessAction,
  updateJobWorkOrderAction,
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
                  emptyLabel="Select principal"
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
                  emptyLabel={principal ? 'Select product' : 'Select a principal first'}
                  className="field h-10"
                />
              </Field>

              {principal && (
                <>
                  <Derived
                    label="Billing model"
                    value={BILLING_MODEL_LABELS[principal.billingModel]}
                    badge="AUTO-INHERITED"
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

          <Derived label="Order no." value={order.orderNumber} badge="SYSTEM-SET" />
          <Derived label="Principal" value={order.principalName} badge="READ-ONLY" />

          <Derived
            label="Agreement"
            value={order.agreementReference ?? 'No reference'}
            badge="READ-ONLY"
          />

          <Derived
            label="Billing model"
            value={BILLING_MODEL_LABELS[order.billingModel]}
            badge="AUTO-INHERITED"
          />

          <Derived
            label="Product"
            value={`${order.product.productName} (${order.product.productCode})`}
            badge="READ-ONLY"
          />

          <Derived
            label="Principal's brand"
            value={order.product.principalBrandName}
            badge="READ-ONLY"
          />

          <Derived
            label="Stock bucket"
            value={STOCK_OWNERSHIP_LABELS[order.stockBucket]}
            badge="SYSTEM-DERIVED"
          />

          <Derived
            label="Material received"
            value={`${order.materialReceivedQuantity} ${order.product.uom}`}
            badge="AUTO-DERIVED"
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
}: {
  receipt: JobWorkMaterialReceiptView;
}) {
  return (
    <Disclosure
      label="View"
      title={`Receipt ${receipt.receiptNumber}`}
      subtitle={`Challan ${receipt.deliveryChallanNumber} from ${receipt.principalName}`}
      width="60rem"
    >
      {(close) => (
        <div className="flex grow flex-col gap-4">
          {/* THREE COLUMNS, because the header is nine short read-only values
              and stacking them two-up would push the material — the part
              somebody opened this to see — below the fold. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Derived label="Receipt no." value={receipt.receiptNumber} badge="SYSTEM-SET" />
            <Derived label="Principal" value={receipt.principalName} badge="READ-ONLY" />
            <Derived
              label="Job-work order"
              value={receipt.jobWorkOrderNumber}
              badge="READ-ONLY"
            />

            <Derived
              label="Delivery challan"
              value={receipt.deliveryChallanNumber}
              badge="READ-ONLY"
              hint="The principal\u2019s own document. Not a purchase invoice."
            />
            <Derived label="Challan date" value={receipt.receiptDate} badge="READ-ONLY" />
            <Derived
              label="Recorded"
              value={`${receipt.receivedAt.slice(0, 10)}${
                receipt.receivedBy ? ` by ${receipt.receivedBy}` : ''
              }`}
              badge="SYSTEM-SET"
            />

            <Derived
              label="Incoming QC"
              value={receipt.qcRequired ? 'Required' : 'Not required'}
              badge="READ-ONLY"
            />
            <Derived
              label="Status"
              value={JOB_WORK_RECEIPT_STATUS_LABELS[receipt.status]}
              badge="AUTO-DERIVED"
              hint="Follows the lots below."
            />
            <Derived
              label="Stock ownership"
              value={STOCK_OWNERSHIP_LABELS.PRINCIPAL_OWNED}
              badge="SYSTEM-SET"
            />
          </div>

          {MATERIAL_SECTIONS.map(({ kind, title }) => {
            // The line has no kind of its own — it is a material, and what
            // kind it is follows from the item master. Read here rather than
            // stored, so an item reclassified later reads correctly.
            const lines = receipt.lines.filter((line) =>
              kind === 'PACKING'
                ? line.item.type === 'PACKING_MATERIAL'
                : line.item.type !== 'PACKING_MATERIAL',
            );

            if (lines.length === 0) return null;

            return (
              <fieldset key={kind} className="rounded-md border border-slate-200 p-4">
                <legend className="px-1 text-sm font-medium text-slate-700">
                  {title} ({lines.length})
                </legend>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[42rem] text-left text-xs">
                    <thead>
                      <tr className="uppercase tracking-wide text-slate-500">
                        <th className="py-1 pr-3 font-medium">Material</th>
                        <th className="py-1 pr-3 font-medium">Batch / lot</th>
                        <th className="py-1 pr-3 text-right font-medium">Received</th>
                        <th className="py-1 pr-3 font-medium">MFG</th>
                        <th className="py-1 pr-3 font-medium">Expiry</th>
                        <th className="py-1 pr-3 font-medium">Lot</th>
                        <th className="py-1 font-medium">QC</th>
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
                          <td className="py-1.5 pr-3 font-mono text-slate-700">
                            {line.batchNumber}
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-slate-900">
                            {line.receivedQuantity} {line.item.uom}
                          </td>
                          <td className="py-1.5 pr-3 tabular-nums text-slate-600">
                            {line.manufacturingDate ?? '—'}
                          </td>
                          <td className="py-1.5 pr-3 tabular-nums text-slate-600">
                            {line.expiryDate ?? '—'}
                          </td>
                          <td className="py-1.5 pr-3 font-mono text-slate-600">
                            {line.lotNumber ?? '—'}
                          </td>
                          <td className="py-1.5 text-slate-700">
                            {!receipt.qcRequired
                              ? 'Not required'
                              : line.lotStatus === 'USABLE'
                                ? 'Released'
                                : line.lotStatus === 'QUARANTINE'
                                  ? 'Pending'
                                  : line.lotStatus === 'ON_HOLD'
                                    ? 'On hold'
                                    : line.lotStatus === 'REJECTED'
                                      ? 'Rejected'
                                      : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </fieldset>
            );
          })}

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
                badge="SYSTEM-SET"
              />

              {/* A DECISION ABOUT THE CONSIGNMENT, not about any one drum on
                  it, and the same gate purchased material passes through.
                  Ticked by default: a receipt does not make material usable,
                  incoming QC does. Untick it only where the principal ships
                  under an agreed quality arrangement — the choice is recorded
                  on the receipt and audited. */}
              <div className="sm:col-span-2">
                <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                  <input
                    type="checkbox"
                    name="qcRequired"
                    value="true"
                    defaultChecked
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    <span className="font-medium text-slate-900">
                      Hold for incoming QC before this material may be issued
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-600">
                      Every material on this challan lands in quarantine and is released by a
                      Quality Officer on <strong>Incoming QC</strong>. Clear this only if the
                      consignment is accepted on the principal&rsquo;s own certificate.
                    </span>
                  </span>
                </label>
              </div>

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
  const [checking, setChecking] = useState(false);

  const principalOwned = order.stockBucket === 'PRINCIPAL_OWNED';

  const openForm = (next: boolean) => {
    setOpen(next);

    // Asked each time it opens rather than cached: material moves, QC decisions
    // are taken, and a stale "Ready" is the failure this table exists to stop.
    if (!next) return;

    setChecking(true);

    startTransition(async () => {
      setReadiness(await loadJobWorkReadinessAction(order.id));
      setChecking(false);
    });
  };

  return (
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

          <Derived label="Principal" value={order.principalName} badge="READ-ONLY" />

          <Derived
            label="Agreement"
            value={order.agreementReference ?? 'No reference'}
            badge="READ-ONLY"
          />

          <Derived label="Job-work order" value={order.orderNumber} badge="READ-ONLY" />

          <Derived
            label="Billing model"
            value={BILLING_MODEL_LABELS[order.billingModel]}
            badge="AUTO-INHERITED"
          />

          <Derived
            label="Product"
            value={`${order.product.productName} (${order.product.productCode})`}
            badge="READ-ONLY"
            hint={`Sold as ${order.product.principalBrandName}`}
          />

          <Derived
            label="Stock bucket"
            value={STOCK_OWNERSHIP_LABELS[order.stockBucket]}
            badge="SYSTEM-DERIVED"
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

          <div className="sm:col-span-2">
            {checking ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Checking what material is available for this order…
              </p>
            ) : (
              <MaterialReadinessTable readiness={readiness} principalOwned={principalOwned} />
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
                  badge="AUTO-DERIVED"
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
