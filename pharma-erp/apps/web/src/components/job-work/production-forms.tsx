'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import type {
  JobWorkBatchView,
  JobWorkEligibleReceipt,
  JobWorkIssuePlan,
  JobWorkMaterialSource,
  JobWorkMaterialSufficiency,
  JobWorkOrderSummary,
  JobWorkProductionOrderView,
} from '@pharma-erp/types';
import { BILLING_MODEL_LABELS, JOB_WORK_MATERIAL_KIND_LABELS } from '@pharma-erp/types';

import { IDLE, type ActionState } from '@/components/procurement/action-state';
import {
  Disclosure,
  Field,
  FormFooter,
  SubmitButton,
  useAction,
} from '@/components/procurement/form-kit';
import { useIsInsideRegister } from '@/components/production/register';
import { ExpiryHint, Quantity } from '@/components/production/shared';
import { SavedDialog } from '@/components/saved-dialog';
import { SearchableSelect } from '@/components/searchable-select';
import { useActionToast } from '@/components/toast';

import {
  decideJobWorkBatchAction,
  jobWorkIssuePlanAction,
  loadJobWorkMaterialSufficiencyAction,
  nextJobWorkNumberAction,
  raiseJobWorkProductionOrderAction,
  recordJobWorkBatchAction,
  recordJobWorkIssueAction,
  recordJobWorkPackingAction,
} from './actions';

/**
 * The four Job Work forms, built to the Production & Quality Gate pattern.
 *
 * SAME SHAPE, SAME BEHAVIOUR: a read-only field for the number the record is
 * about to take, a searchable picker for what it is against, a plan or a
 * preview of what the save will produce, and a modal that closes on success.
 * The helpers that make that work — `Disclosure`, `Field`, `FormFooter`,
 * `SubmitButton`, `useAction`, `SearchableSelect` — are the requisition form's
 * own, imported rather than reimplemented.
 *
 * WHAT DIFFERS is what the material is. The internal issue form dispenses
 * company stock against a formulation; this one dispenses the drums a principal
 * sent, against the same formulation. Under pure conversion there is no other
 * pool to fall back on, which is why the plan names the challan each drum
 * arrived on.
 */

// ---------------------------------------------------------------------------
// Shared with ./forms in components/production — same classes, same reasons
// ---------------------------------------------------------------------------

const FIELD =
  'mt-1.5 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900';

const LABEL = 'block text-xs font-medium uppercase tracking-wide text-slate-600';

/**
 * DECIMAL(14,3), as the API's own `QUANTITY` expression spells it.
 *
 * Named rather than repeated inline so the browser's check and the server's
 * cannot drift apart — a box that accepts four decimals only to have the save
 * refused is worse than one that never accepted them.
 */
const QUANTITY_PATTERN = '\\d{1,11}(\\.\\d{1,3})?';


/**
 * Announces a finished submission.
 *
 * A FAILURE goes to the toast, beside a form still open with what was typed in
 * it. A SUCCESS is the confirmation dialog — raised by the REGISTER where one
 * is listening, because it also has to close the drawer, and directly here
 * where none is (the packing form, inline on a batch card, and the release
 * form, whose drawer belongs to the pending list rather than a register).
 */
function Result({ state, pending }: { state: ActionState; pending: boolean }) {
  const confirmedByRegister = useIsInsideRegister();

  useActionToast(pending, 'error', state.status === 'error' ? state.message : undefined);

  const [saved, setSaved] = useState<string | null>(null);

  /**
   * A SUBMISSION THIS COMPONENT WATCHED FINISH — not merely a success sitting
   * in `state`.
   *
   * `useActionState` holds the last result for the life of the form, so a
   * success stays in `state` long after it was announced. Announcing off the
   * message alone meant the confirmation reappeared every time this component
   * was mounted afresh against that old result: pressing Edit on a packing
   * record, pressing Cancel, or switching to another batch and back all
   * replayed "Packing recorded" as though it had just happened.
   *
   * Keying on the pending flag going true and then false fixes it at the
   * source. A fresh mount has watched nothing, so it says nothing; a real save
   * is announced exactly once, however many times the tree is rebuilt
   * afterwards. It is the same rule `useAction` uses to decide when to
   * refresh.
   */
  const watchedSubmit = useRef(false);

  useEffect(() => {
    if (pending) {
      watchedSubmit.current = true;
      return;
    }

    if (!watchedSubmit.current) return;

    watchedSubmit.current = false;

    if (confirmedByRegister) return;
    if (state.status === 'success' && state.message) setSaved(state.message);
  }, [pending, state, confirmedByRegister]);

  if (!saved) return null;

  return <SavedDialog message={saved} onDismiss={() => setSaved(null)} />;
}

/**
 * A field the system fills in, shown but not editable.
 *
 * NOT a `<input readOnly>`: a read-only input still looks like somewhere to
 * type, still takes focus, and still submits a value the server would have to
 * ignore or — worse — trust. This is a plain value, so there is nothing to
 * submit and nothing to spoof.
 */
function ReadOnlyField({
  label,
  value,
  hint,
  placeholder = 'Assigned automatically',
}: {
  label: string;
  value?: React.ReactNode;
  hint?: string;
  placeholder?: string;
}) {
  const isEmpty = value === undefined || value === null || value === '';

  return (
    <div>
      <span className={LABEL}>{label}</span>

      <p
        className={`mt-1.5 flex min-h-[2.625rem] items-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm ${
          isEmpty ? 'italic text-slate-400' : 'text-slate-800'
        }`}
      >
        {isEmpty ? placeholder : value}
      </p>

      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** The number a form is about to take, fetched once when it opens. */
function useNextNumber(document: 'production-order' | 'issue' | 'batch') {
  const [number, setNumber] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void nextJobWorkNumberAction(document).then((next) => {
      if (!cancelled) setNumber(next);
    });

    return () => {
      cancelled = true;
    };
  }, [document]);

  return number;
}

// ---------------------------------------------------------------------------
// 1. Raising a production order
// ---------------------------------------------------------------------------

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

/**
 * New Job Work Production Order.
 *
 * BUILT ON THE PURCHASE REQUISITION FORM'S KIT — `Disclosure`, `Field`,
 * `FormFooter`, `SubmitButton`, `useAction` and the `field-sm` control size —
 * so the modal width and padding, the close cross, the Cancel at bottom-left
 * and the primary action at bottom-right are that form's, not a second set of
 * conventions that drift from it.
 *
 * THE QUANTITY IS NOT A FIELD. It is the quantity the job-work order already
 * agreed with the principal, shown read-only and never submitted: the API reads
 * it from the order and rejects the field outright, so there is no way — form
 * or otherwise — to commit to a different batch size from the one on the order.
 *
 * THE MATERIAL CHECK IS THE POINT OF THE LOWER HALF. Raw and packing are listed
 * separately with required against received, and the button is refused while
 * anything is short. The API re-computes all of it and refuses too; this only
 * means nobody is surprised by that refusal.
 */
export function RaiseJobWorkProductionOrderForm({
  orders,
  receiptsByOrder,
}: {
  /** Job-work orders with at least one approved consignment. Never empty. */
  orders: JobWorkOrderSummary[];
  /** The approved receipts per job-work order id. */
  receiptsByOrder: Record<string, JobWorkEligibleReceipt[]>;
}) {
  const [state, formAction] = useAction(raiseJobWorkProductionOrderAction);

  const orderNumber = useNextNumber('production-order');

  const [jobWorkOrderId, setJobWorkOrderId] = useState(orders[0]?.id ?? '');

  const receipts = receiptsByOrder[jobWorkOrderId] ?? [];

  // One approved consignment is the ordinary case; choosing it saves a click
  // without hiding that a choice exists.
  const [receiptId, setReceiptId] = useState(receipts[0]?.id ?? '');

  // Following the order, not stored beside it: picking a different job-work
  // order changes which consignments are on offer, and keeping the old id would
  // post a receipt belonging to somebody else.
  useEffect(() => {
    setReceiptId(receiptsByOrder[jobWorkOrderId]?.[0]?.id ?? '');
  }, [jobWorkOrderId, receiptsByOrder]);

  const chosen = orders.find((candidate) => candidate.id === jobWorkOrderId);

  // THE BILLING MODEL COMES OFF THE CHOSEN ORDER, never from this form. It is
  // inherited from the agreement and frozen there, and it decides everything
  // below: whether a consignment is named at all, and which pool the material
  // check measures against.
  const fromConsignment = chosen?.billingModel === 'PURE_CONVERSION';

  const [check, setCheck] = useState<{
    loading: boolean;
    error: string | null;
    data: JobWorkMaterialSufficiency | null;
  }>({ loading: false, error: null, data: null });

  useEffect(() => {
    // Own procurement has no consignment to name, so the check runs on the
    // order alone; pure conversion waits until one is chosen.
    if (!jobWorkOrderId || (fromConsignment && !receiptId)) {
      setCheck({ loading: false, error: null, data: null });
      return;
    }

    setCheck((current) => ({ ...current, loading: true, error: null }));

    let cancelled = false;

    void loadJobWorkMaterialSufficiencyAction(
      jobWorkOrderId,
      fromConsignment ? receiptId : undefined,
    ).then((result) => {
      // The guard matters: the two selects can change in quick succession, and
      // a stale answer overwriting a fresh one would show one consignment's
      // shortfall under another's number.
      if (cancelled) return;

      setCheck(
        result.ok
          ? { loading: false, error: null, data: result.data }
          : { loading: false, error: result.message, data: null },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [jobWorkOrderId, receiptId, fromConsignment]);

  const order = chosen;
  const sufficiency = check.data;

  // Refused only on a KNOWN shortage. While the check is in flight, or if it
  // could not run at all, the button stays live and the server decides — a form
  // that locks itself because a preview call failed is one nobody can use when
  // that endpoint is down.
  const blocked = sufficiency !== null && !sufficiency.sufficient;

  if (orders.length === 0) {
    return (
      <p className="px-1 py-4 text-sm text-slate-600">
        No job-work order is ready to manufacture. A pure-conversion order needs a consignment
        that has passed Quality check; an own-procurement order needs only to exist, since we buy
        its material ourselves.
      </p>
    );
  }

  return (
    <Disclosure
      label="New Job Work Production Order"
      title="New Job Work Production Order"
      subtitle="The billing model, the product and the quantity all come from the job-work order."
      closeWhen={state.status === 'success'}
    >
      {(close) => (
        <form action={formAction} className="w-full space-y-4">
          <input type="hidden" name="jobWorkOrderId" value={jobWorkOrderId} />
          {/* SENT ONLY UNDER PURE CONVERSION. The API rejects the field on an
              own-procurement order rather than ignoring it, so posting a blank
              would be a 400 for a form that was filled in correctly. */}
          {fromConsignment && (
            <input type="hidden" name="materialReceiptId" value={receiptId} />
          )}

          {/* What the system fills in. Stated once, plainly — the same strip
              the requisition form opens with. */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-white p-3 text-xs sm:grid-cols-4">
            <SystemField label="Production order no." value={orderNumber ?? 'Generated on save'} />
            <SystemField label="Principal" value={order?.principalName ?? '—'} />
            <SystemField
              label="Billing model"
              value={order ? BILLING_MODEL_LABELS[order.billingModel] : '—'}
            />
            <SystemField label="Status" value="Draft" />
          </dl>

          <Section title="What to make">
            <Field
              label="Job-work order"
              htmlFor="jwpo-order"
              required
              hint="Pure-conversion orders with an approved consignment, and every own-procurement order."
            >
              <SearchableSelect
                id="jwpo-order"
                options={orders.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.orderNumber,
                  hint: candidate.principalName,
                }))}
                required
                value={jobWorkOrderId}
                onChange={setJobWorkOrderId}
                emptyLabel="Select job-work order"
              />
            </Field>

            {/* ONE FIELD, TWO MEANINGS, decided by the model. Pure conversion
                picks which approved consignment the batch consumes; own
                procurement has none to pick, and says where the material comes
                from instead. */}
            {fromConsignment ? (
              <Field
                label="Material receipt"
                htmlFor="jwpo-receipt"
                required
                hint="The consignment this batch will be made from."
              >
                <SearchableSelect
                  id="jwpo-receipt"
                  options={receipts.map((candidate) => ({
                    value: candidate.id,
                    label: candidate.receiptNumber,
                    hint: `${candidate.rawMaterialCount} raw · ${candidate.packingMaterialCount} packing`,
                  }))}
                  required
                  disabled={receipts.length === 0}
                  value={receiptId}
                  onChange={setReceiptId}
                  emptyLabel="Select consignment"
                />
              </Field>
            ) : (
              <Field
                label="Material source"
                htmlFor="jwpo-source"
                hint="Bought through Procure-to-Pay, so no consignment and no incoming check."
              >
                <input
                  id="jwpo-source"
                  value="Our own inventory"
                  readOnly
                  disabled
                  className="field-sm w-full bg-slate-100 text-slate-600"
                />
              </Field>
            )}

            {/* NOT AN INPUT. The quantity is the job-work order's, and the API
                will not accept another — so there is nothing here to type into
                and nothing submitted. */}
            <Field label="Planned quantity" htmlFor="jwpo-qty" hint="From the job-work order.">
              <input
                id="jwpo-qty"
                value={
                  order ? `${order.quantity} ${order.product.uom}` : ''
                }
                readOnly
                disabled
                className="field-sm w-full bg-slate-100 text-slate-600"
              />
            </Field>

            <Field label="Product" htmlFor="jwpo-product">
              <input
                id="jwpo-product"
                value={order ? `${order.product.productName} (${order.product.productCode})` : ''}
                readOnly
                disabled
                className="field-sm w-full bg-slate-100 text-slate-600"
              />
            </Field>

            <Field label="Brand" htmlFor="jwpo-brand" hint="The principal's own brand name.">
              <input
                id="jwpo-brand"
                value={order?.product.principalBrandName ?? ''}
                readOnly
                disabled
                className="field-sm w-full bg-slate-100 text-slate-600"
              />
            </Field>

            <Field label="Agreement" htmlFor="jwpo-agreement">
              <input
                id="jwpo-agreement"
                value={order?.agreementReference ?? 'No reference'}
                readOnly
                disabled
                className="field-sm w-full bg-slate-100 text-slate-600"
              />
            </Field>
          </Section>

          <Section title="When">
            <Field label="Planned start" htmlFor="jwpo-start">
              <input
                id="jwpo-start"
                name="plannedStartOn"
                type="date"
                className="field-sm w-full"
              />
            </Field>

            <Field label="Planned completion" htmlFor="jwpo-completion">
              <input
                id="jwpo-completion"
                name="plannedCompletionOn"
                type="date"
                className="field-sm w-full"
              />
            </Field>

            <Field label="Notes" htmlFor="jwpo-notes">
              <input
                id="jwpo-notes"
                name="notes"
                maxLength={1000}
                className="field-sm w-full"
              />
            </Field>
          </Section>

          <MaterialSufficiency
            state={check}
            source={fromConsignment ? 'PRINCIPAL_CONSIGNMENT' : 'OWN_INVENTORY'}
          />

          <FormFooter onCancel={close}>
            <SubmitButton pendingLabel="Raising…" disabled={blocked}>
              {blocked ? 'Material short' : 'Raise production order'}
            </SubmitButton>
          </FormFooter>
        </form>
      )}
    </Disclosure>
  );
}

/**
 * Required against received, raw and packing separately.
 *
 * SEPARATELY BECAUSE THEY ARE CHASED FROM DIFFERENT PEOPLE: a batch short of
 * cartons is a different phone call from one short of API, and a single merged
 * table makes somebody read the Kind column to work out which.
 */
function MaterialSufficiency({
  state,
  source,
}: {
  state: { loading: boolean; error: string | null; data: JobWorkMaterialSufficiency | null };
  /** Known before the answer arrives, so even "checking…" can say which pool. */
  source: JobWorkMaterialSource;
}) {
  if (state.loading) {
    return (
      <p className="text-xs text-slate-500">
        {source === 'OWN_INVENTORY'
          ? 'Checking what is in stock…'
          : 'Checking what the principal has sent…'}
      </p>
    );
  }

  if (state.error) {
    return (
      <p role="alert" className="text-xs text-red-700">
        Could not check the material received: {state.error}
      </p>
    );
  }

  if (!state.data) return null;

  const { data } = state;

  if (data.blockedReason) {
    return (
      <p
        role="alert"
        className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
      >
        {data.blockedReason}
      </p>
    );
  }

  return (
    <div
      className={`rounded-md border ${
        data.sufficient ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/40'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-inherit px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {data.materialSource === 'PRINCIPAL_CONSIGNMENT'
            ? `Received from the principal · ${data.receiptNumber}`
            : 'From our own inventory'}{' '}
          · for {data.plannedQuantity} {data.product.uom}
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${
            data.sufficient
              ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
              : 'bg-red-50 text-red-800 ring-red-200'
          }`}
        >
          {data.sufficient
            ? data.materialSource === 'PRINCIPAL_CONSIGNMENT'
              ? 'Material received'
              : 'Stock available'
            : 'Material short'}
        </span>
      </div>

      {/* THE COLUMN IS HEADED FOR THE POOL IT MEASURED. "Received" is what the
          principal sent; "Available" is what is on our own shelf, less what
          other open orders have already spoken for. */}
      <SufficiencyTable title="Raw materials" lines={data.raw} source={data.materialSource} />
      <SufficiencyTable title="Packing materials" lines={data.packing} source={data.materialSource} />

      {!data.sufficient && (
        <p className="border-t border-inherit px-4 py-2.5 text-xs text-red-800">
          {data.materialSource === 'PRINCIPAL_CONSIGNMENT' ? (
            <>
              A production order cannot be raised until every required material has been received
              and approved. Record the rest of the principal&rsquo;s delivery under Material
              received from principal, send it for approval, and approve it.
            </>
          ) : (
            <>
              A production order cannot be raised until every required material is in stock. Only
              company-owned stock released by incoming QC counts, less what other open work orders
              have already spoken for — buy the shortfall through Procure-to-Pay first.
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** One half of the comparison — the required against the received. */
function SufficiencyTable({
  title,
  lines,
  source,
}: {
  title: string;
  lines: JobWorkMaterialSufficiency['raw'];
  source: JobWorkMaterialSufficiency['materialSource'];
}) {
  return (
    <div className="border-t border-inherit first:border-t-0">
      <p className="px-4 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </p>

      {lines.length === 0 ? (
        <p className="px-4 pb-2.5 pt-1 text-xs text-slate-500">
          The formulation calls for none.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                <th scope="col" className="px-4 py-2 font-medium">
                  Material
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Required
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  {source === 'PRINCIPAL_CONSIGNMENT' ? 'Received' : 'Available'}
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Short
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70">
              {lines.map((line) => (
                <tr key={line.item.id} className={line.sufficient ? undefined : 'bg-red-50/60'}>
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs text-slate-700">{line.item.code}</span>{' '}
                    <span className="text-slate-600">{line.item.name}</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {line.requiredQuantity}{' '}
                    <span className="text-xs text-slate-500">{line.item.uom}</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {line.suppliedQuantity}{' '}
                    <span className="text-xs text-slate-500">{line.item.uom}</span>
                  </td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums ${
                      line.sufficient ? 'text-slate-400' : 'font-semibold text-red-800'
                    }`}
                  >
                    {line.sufficient ? '—' : `${line.shortQuantity} ${line.item.uom}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Material issue
// ---------------------------------------------------------------------------

/**
 * Dispensing the principal's material to a job-work production order.
 *
 * THIS SCREEN DISPENSES; IT DOES NOT VALIDATE THE CONSIGNMENT. Whether enough
 * material was received was settled when the production order was raised — the
 * order could not exist otherwise — so repeating the comparison here would be
 * asking the same question twice and inviting two answers.
 *
 * What it still checks is what dispensing always checks: the drum belongs to
 * this order's consignment, it has passed Quality check, and it holds what is
 * being drawn. The API decides all three.
 *
 * Built on the requisition form's kit, like the production-order form above.
 */
export function IssueJobWorkMaterialForm({
  orders,
  initialPlan = null,
}: {
  /** Every production order material can still be issued to. Never empty. */
  orders: JobWorkProductionOrderView[];
  /** The plan for the first order, computed by the server so the form opens full. */
  initialPlan?: JobWorkIssuePlan | null;
}) {
  const [state, formAction] = useAction(recordJobWorkIssueAction);

  const issueNumber = useNextNumber('issue');

  const [orderId, setOrderId] = useState(orders[0]?.id ?? '');

  const [planState, setPlanState] = useState<{
    loading: boolean;
    error: string | null;
    data: JobWorkIssuePlan | null;
  }>({ loading: false, error: null, data: initialPlan });

  useEffect(() => {
    // The preloaded plan already matches the order the form opened on, so the
    // first render asks for nothing.
    if (!orderId || planState.data?.productionOrderId === orderId) return;

    setPlanState((current) => ({ ...current, loading: true, error: null }));

    let cancelled = false;

    void jobWorkIssuePlanAction(orderId).then((result) => {
      if (cancelled) return;

      setPlanState(
        result.ok
          ? { loading: false, error: null, data: result.data }
          : { loading: false, error: result.message, data: null },
      );
    });

    return () => {
      cancelled = true;
    };
    // `planState.data` is deliberately not a dependency: this effect writes it,
    // and reading it here would re-run the effect with every answer it stores.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const plan = planState.data;
  const order = orders.find((candidate) => candidate.id === orderId);

  return (
    <Disclosure
      label="Dispense material"
      title="Dispense material"
      subtitle="From the consignment already approved for this production order."
      closeWhen={state.status === 'success'}
      // Wider than the requisition form's default: the plan is a table of every
      // material with the drum it comes from, and at 48rem those columns wrap.
      width="60rem"
    >
      {(close) => (
        <form action={formAction} className="w-full space-y-4">
          <input type="hidden" name="jobWorkProductionOrderId" value={orderId} />

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-white p-3 text-xs sm:grid-cols-4">
            <SystemField label="Issue no." value={issueNumber ?? 'Generated on save'} />
            <SystemField label="Principal" value={order?.principalName ?? '—'} />
            <SystemField
              label="Material source"
              value={order?.materialReceipt?.receiptNumber ?? 'Our own inventory'}
            />
            <SystemField label="Issued by" value="You, on save" />
          </dl>

          <Section title="What to dispense against">
            <Field
              label="Production order"
              htmlFor="jwmi-order"
              required
              hint="Orders still open for issue."
            >
              <SearchableSelect
                id="jwmi-order"
                options={orders.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.orderNumber,
                  hint: `${candidate.product.code} · ${candidate.principalName}`,
                }))}
                required
                value={orderId}
                onChange={setOrderId}
                emptyLabel="Select production order"
              />
            </Field>

            <Field label="Product" htmlFor="jwmi-product">
              <input
                id="jwmi-product"
                value={order ? `${order.product.name} (${order.product.code})` : ''}
                readOnly
                disabled
                className="field-sm w-full bg-slate-100 text-slate-600"
              />
            </Field>

            <Field label="Planned quantity" htmlFor="jwmi-planned">
              <input
                id="jwmi-planned"
                value={order ? `${order.plannedQuantity} ${order.product.uom}` : ''}
                readOnly
                disabled
                className="field-sm w-full bg-slate-100 text-slate-600"
              />
            </Field>
          </Section>

          {planState.loading && <p className="text-sm text-slate-500">Working out the plan…</p>}

          {planState.error && (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              Could not work out what this order would consume: {planState.error}
            </p>
          )}

          {plan && plan.lines.length > 0 && <JobWorkIssuePlanTable plan={plan} />}

          <FormFooter onCancel={close}>
            <SubmitButton pendingLabel="Dispensing…" disabled={!plan || plan.lines.length === 0}>
              Dispense material
            </SubmitButton>
          </FormFooter>
        </form>
      )}
    </Disclosure>
  );
}

/**
 * What issuing would consume, out of which drums, with the quantity to take.
 *
 * THE QUANTITY BOXES OPEN ON THE PLAN'S OWN FIGURES, so the common case —
 * dispensing exactly what was suggested — needs no typing. Editing one is how a
 * storekeeper departs from it, and the API re-derives the shortfall either way.
 */
function JobWorkIssuePlanTable({ plan }: { plan: JobWorkIssuePlan }) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full min-w-[54rem] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <th scope="col" className="px-4 py-2.5 font-medium">
              Material
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Required
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Lot / batch
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Expiry
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Issue
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Short
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {plan.lines.map((line) => (
            <tr key={line.item.id} className="align-top">
              <td className="px-4 py-3">
                <span className="font-mono text-xs text-slate-700">{line.item.code}</span>
                <div className="text-slate-800">{line.item.name}</div>
                <span className="mt-1 inline-block rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                  {JOB_WORK_MATERIAL_KIND_LABELS[line.kind]}
                </span>
              </td>

              <td className="px-4 py-3 text-right">
                <Quantity value={line.quantityRequired} uom={line.item.uom} />
              </td>

              <td className="px-4 py-3">
                {line.allocations.length === 0 ? (
                  <span className="text-red-700">Nothing usable received</span>
                ) : (
                  <ul className="space-y-1.5">
                    {line.allocations.map((allocation) => (
                      <li key={allocation.lotId}>
                        <span className="font-mono text-xs text-slate-700">
                          {allocation.lotNumber}
                        </span>
                        <div className="text-[11px] text-slate-500">
                          {allocation.batchNumber}
                          {allocation.deliveryChallanNumber &&
                            ` · challan ${allocation.deliveryChallanNumber}`}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </td>

              <td className="px-4 py-3">
                <ul className="space-y-1.5">
                  {line.allocations.map((allocation) => (
                    <li key={allocation.lotId} className="flex items-center gap-x-2">
                      {allocation.expiryDate ? (
                        <>
                          <span className="text-xs text-slate-500">{allocation.expiryDate}</span>
                          <ExpiryHint date={allocation.expiryDate} />
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">no expiry</span>
                      )}
                    </li>
                  ))}
                </ul>
              </td>

              {/* One box per drum, opening on what the plan proposed. The field
                  name carries the lot id, which is what the action posts. */}
              <td className="px-4 py-3 text-right">
                <ul className="space-y-1.5">
                  {line.allocations.map((allocation) => (
                    <li key={allocation.lotId}>
                      <label htmlFor={`qty-${allocation.lotId}`} className="sr-only">
                        Quantity of {line.item.code} from lot {allocation.lotNumber}
                      </label>
                      <input
                        id={`qty-${allocation.lotId}`}
                        name={`quantity:${allocation.lotId}`}
                        defaultValue={allocation.quantity}
                        inputMode="decimal"
                        pattern="\d{1,11}(\.\d{1,3})?"
                        title="A positive number, up to 3 decimal places"
                        className="block w-32 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                      />
                      <span className="mt-0.5 block text-[10px] text-slate-500">
                        {allocation.quantityAvailable} {line.item.uom} on the drum
                      </span>
                    </li>
                  ))}
                </ul>
              </td>

              <td className="px-4 py-3 text-right">
                {line.quantityShort === '0' ? (
                  <span className="text-slate-300">—</span>
                ) : (
                  <span className="font-semibold text-red-700">
                    {line.quantityShort} {line.item.uom}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Batch record
// ---------------------------------------------------------------------------

/**
 * Expiry as the server will compute it — manufacturing date plus shelf life.
 *
 * Mirrors `addMonths` in the API's production mappers, including the clamp to
 * the end of the target month: 31 August plus six months is 28 February, not
 * 3 March, and a preview that disagreed with what is printed on the carton
 * would be worse than showing nothing.
 */
function previewExpiry(manufacturedOn: string, shelfLifeMonths: number | null): string | null {
  if (!manufacturedOn || shelfLifeMonths === null) return null;

  const start = new Date(`${manufacturedOn}T00:00:00.000Z`);

  if (Number.isNaN(start.getTime())) return null;

  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + shelfLifeMonths;
  const day = start.getUTCDate();
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return new Date(Date.UTC(year, month, Math.min(day, lastDayOfTargetMonth)))
    .toISOString()
    .slice(0, 10);
}

/**
 * New Batch Record.
 *
 * Built on the Purchase Requisition form's kit, like the production-order and
 * material-issue forms above it: the same modal width and padding, the same
 * close cross, Cancel bottom-left, the primary action bottom-right, `field-sm`
 * controls and three-across sections.
 */
export function RecordJobWorkBatchForm({ orders }: { orders: JobWorkProductionOrderView[] }) {
  const [state, formAction] = useAction(recordJobWorkBatchAction);

  const batchNumber = useNextNumber('batch');

  const [orderId, setOrderId] = useState(orders[0]?.id ?? '');
  const [manufacturedOn, setManufacturedOn] = useState(new Date().toISOString().slice(0, 10));

  const order = orders.find((candidate) => candidate.id === orderId) ?? orders[0];
  const expiry = order ? previewExpiry(manufacturedOn, order.product.shelfLifeMonths) : null;

  // THE BUTTON IS ALWAYS OFFERED, even with nothing waiting — the same call
  // the internal register makes. A trigger that disappears reads as the
  // feature being missing rather than the prerequisite being unmet, and leaves
  // nowhere to find out what to do about it. So the dialog opens and says so.
  //
  // ONE Disclosure FOR BOTH CASES, and that matters more than it looks. It was
  // two, and saving a batch record made the last order disappear from
  // `orders` — so the component swapped to the other Disclosure, React kept
  // the OPEN state because it is the same component in the same position, and
  // the dialog that had just been submitted came back holding "nothing is
  // waiting". That is the second dialog that appeared after every successful
  // save. With one Disclosure there is nothing to swap to, and `closeWhen`
  // still applies.
  // NOT WHILE A SAVE IS BEING CONFIRMED. Recording the last waiting order's
  // batch empties this list, and the dialog stays on screen for the moment it
  // takes the confirmation to be read — so without this guard the form someone
  // just submitted would be replaced, in front of them, by "nothing is
  // waiting". Which reads as the save having gone somewhere it should not.
  const nothingWaiting = orders.length === 0 && state.status !== 'success';

  return (
    <Disclosure
      label="New batch"
      title="New Batch Record"
      subtitle="What was made against a production order material has been issued to."
      closeWhen={state.status === 'success'}
    >
      {(close) =>
        nothingWaiting ? (
          <div className="flex grow flex-col gap-4">
            <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              No production order is waiting for a batch record. A batch record traces what went
              into the batch, so the principal&rsquo;s material has to be issued against an order
              before one can be opened.
            </p>

            <FormFooter onCancel={close} />
          </div>
        ) : (
        <form action={formAction} className="w-full space-y-4">
          <input type="hidden" name="jobWorkProductionOrderId" value={orderId} />

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-white p-3 text-xs sm:grid-cols-4">
            <SystemField label="Batch no." value={batchNumber ?? 'Generated on save'} />
            <SystemField label="Principal" value={order?.principalName ?? '—'} />
            <SystemField label="Brand" value={order?.principalBrandName ?? '—'} />
            <SystemField label="Release status" value="Pending" />
          </dl>

          <Section title="What was made">
            <Field
              label="Production order"
              htmlFor="jwb-order"
              required
              hint="Orders with material already issued."
            >
              <SearchableSelect
                id="jwb-order"
                options={orders.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.orderNumber,
                  hint: `${candidate.product.code} · ${candidate.principalName}`,
                }))}
                required
                value={orderId}
                onChange={setOrderId}
                emptyLabel="Select production order"
              />
            </Field>

            <Field label="Product" htmlFor="jwb-product">
              <input
                id="jwb-product"
                value={order ? `${order.product.name} (${order.product.code})` : ''}
                readOnly
                disabled
                className="field-sm w-full bg-slate-100 text-slate-600"
              />
            </Field>

            <Field label="Planned quantity" htmlFor="jwb-planned" hint="From the production order.">
              <input
                id="jwb-planned"
                value={order ? `${order.plannedQuantity} ${order.product.uom}` : ''}
                readOnly
                disabled
                className="field-sm w-full bg-slate-100 text-slate-600"
              />
            </Field>

            <Field
              label="Actual quantity manufactured"
              htmlFor="jwb-actual"
              hint="Leave blank while the run is still going."
            >
              <input
                id="jwb-actual"
                name="actualQuantity"
                inputMode="decimal"
                pattern="\d{1,11}(\.\d{1,3})?"
                title="A positive number, up to 3 decimal places"
                className="field-sm w-full"
              />
            </Field>

            <Field label="Manufacturing date" htmlFor="jwb-mfg" required>
              <input
                id="jwb-mfg"
                name="manufacturedOn"
                type="date"
                required
                value={manufacturedOn}
                onChange={(event) => setManufacturedOn(event.target.value)}
                className="field-sm w-full"
              />
            </Field>

            <Field
              label="Expiry date"
              htmlFor="jwb-expiry"
              required
              hint={
                order && order.product.shelfLifeMonths !== null
                  ? `Manufacturing date plus ${order.product.shelfLifeMonths} months.`
                  : 'The product has no shelf life on file, so this one has to be entered.'
              }
            >
              <input
                id="jwb-expiry"
                name="expiryDate"
                type="date"
                required
                defaultValue={expiry ?? ''}
                className="field-sm w-full"
              />
            </Field>
          </Section>

          <Field label="Notes" htmlFor="jwb-notes">
            <input id="jwb-notes" name="notes" maxLength={1000} className="field-sm w-full" />
          </Field>

          <FormFooter onCancel={close}>
            <SubmitButton pendingLabel="Recording…">Open batch record</SubmitButton>
          </FormFooter>
        </form>
        )
      }
    </Disclosure>
  );
}

/**
 * One presentation of a product, and what a pack of it is made of.
 *
 * Flattened from PackagingRequirementView by the panel, exactly as the
 * internal batch record flattens it: the form needs the components by name,
 * not the requirement levels and scaling bases the specification screen exists
 * to edit.
 */
export type JobWorkPackSpecification = {
  id: string;
  packVariant: string;
  unitsPerPack: string;
  components: { id: string; code: string; name: string; uom: string }[];
};

/**
 * The packing record for a job-work batch — the second half of the record.
 *
 * THE SAME RECORD THE INTERNAL BATCH KEEPS, over job work's own tables:
 *
 *   REJECTS, because packed alone always ties back to the bulk batch and the
 *   losses simply go unrecorded. Packed plus rejected is what the API
 *   reconciles against what was made.
 *
 *   PACK VARIANT, chosen from the product's own specifications where it has
 *   them rather than typed, because a typed variant that matches none of them
 *   names a pack nobody specified — and the variant is what says the
 *   components below are the right ones.
 *
 *   COMPONENT CONSUMPTION, because a recall asks which carton lot went onto
 *   which batch, and a packed quantity alone cannot answer that. A job-work
 *   batch goes back to the principal, so that trail matters here at least as
 *   much as it does on our own stock.
 *
 * The expected quantities are NOT pre-filled from the specification. What a
 * pack should consume and what it did consume differ in normal operation —
 * that difference is the wastage this record exists to capture — and a
 * pre-filled figure is one somebody confirms without counting.
 */
export function RecordJobWorkPackingForm({
  batch,
  packSpecifications = [],
}: {
  batch: JobWorkBatchView;
  /** The product's active specifications. Empty for a product with none. */
  packSpecifications?: JobWorkPackSpecification[];
}) {
  const [state, action, pending] = useActionState(recordJobWorkPackingAction, IDLE);

  // WHAT WAS RECORDED, or nothing chosen. Never the first specification by
  // default: with several variants on file the one that happens to sort first
  // is as likely to be wrong as right, and the component rows below key off
  // this, so a variant standing there unasked would also decide which
  // components got counted.
  const [variant, setVariant] = useState(batch.packVariant ?? '');

  const specification = packSpecifications.find((entry) => entry.packVariant === variant);

  /**
   * What was counted for one component last time, or '' if nothing was.
   *
   * BY ITEM ID rather than by row position: the rows come from the pack
   * specification and the stored figures are keyed by item, so matching on
   * order would put a carton count in the leaflet box the moment a
   * specification changed.
   */
  const consumedFor = (itemId: string) =>
    batch.packagingConsumed.find((entry) => entry.itemId === itemId)?.quantityConsumed ?? '';

  /**
   * Whether packing has been recorded. `packedQuantity` is the signal because
   * it is the one field the record cannot exist without — rejects, the variant
   * and the date are all optional.
   */
  const recorded = batch.packedQuantity !== null;

  /**
   * A RECORD ONCE SAVED, a form only while being changed.
   *
   * A completed packing record left sitting as an open form reads as unsaved
   * work: every figure in an input box, a Save button underneath, and nothing
   * saying the entry had already been accepted. Correcting one is still
   * allowed until the quality gate rules — it is now a deliberate act rather
   * than the default state.
   */
  const [editing, setEditing] = useState(false);

  /** For Cancel on a first entry, which clears the boxes rather than closing. */
  const formRef = useRef<HTMLFormElement>(null);

  // Back to the record after a successful save. `state.status` alone is not
  // enough of a guard elsewhere, but here the idle state is neither success
  // nor error, so it cannot close a form the moment it opens.
  const savedMessage = state.status === 'success' ? state.message : undefined;

  useEffect(() => {
    if (savedMessage) setEditing(false);
  }, [savedMessage]);

  if (recorded && !editing) {
    return (
      <>
        {/* ONE Result, in the SAME POSITION in both branches, so React keeps
            the one instance across the switch between record and form rather
            than unmounting and remounting it. It no longer MATTERS for
            correctness — Result only speaks for a submission it watched finish
            — but an instance that survives the switch is also one that cannot
            have its confirmation taken off screen before it is read. */}
        <Result state={state} pending={pending} />

        <JobWorkPackingRecordSummary
          packedQuantity={batch.packedQuantity!}
          rejectedQuantity={batch.rejectedQuantity}
          packVariant={batch.packVariant}
          packedOn={batch.packedOn}
          consumed={batch.packagingConsumed.map((entry) => {
            const component = specification?.components.find((item) => item.id === entry.itemId);

            return {
              // The item id is a UUID and means nothing on screen, so it is the
              // fallback only — reached when the specification has changed
              // since the record was entered and no longer names this
              // component.
              label: component ? `${component.code} ${component.name}` : entry.itemId,
              quantity: component
                ? `${entry.quantityConsumed} ${component.uom}`
                : entry.quantityConsumed,
            };
          })}
          onEdit={() => setEditing(true)}
        />
      </>
    );
  }

  return (
    <>
      {/* FIRST CHILD OF A FRAGMENT, exactly as in the branch above: React
          matches children by position, so keeping this in slot 0 of both
          returns is what makes it the same instance either side of the
          switch. */}
      <Result state={state} pending={pending} />

      <form ref={formRef} action={action} className="space-y-3 rounded-md bg-slate-50 p-4">
      {/* NOT name="id". A control called "id" shadows the form element's own
          `id` property, and React's server-action serialisation then drops the
          submitter's name and value — which is how a release decision came to
          post its reason and no decision. */}
      <input type="hidden" name="batchId" value={batch.id} />

      <div className="grid items-end gap-3 sm:grid-cols-3">
        <ReadOnlyField
          label="Linked batch record"
          value={<span className="font-mono">{batch.batchNumber}</span>}
        />

        <div>
          <label htmlFor={`jwp-actual-${batch.id}`} className={LABEL}>
            Quantity manufactured
          </label>
          <input
            id={`jwp-actual-${batch.id}`}
            name="actualQuantity"
            defaultValue={batch.actualQuantity ?? ''}
            inputMode="decimal"
            pattern="\d{1,11}(\.\d{1,3})?"
            title="A positive number, up to 3 decimal places"
            className={FIELD}
          />
        </div>

        <div>
          <label htmlFor={`jwp-packed-${batch.id}`} className={LABEL}>
            Finished pack quantity
          </label>
          <input
            id={`jwp-packed-${batch.id}`}
            name="packedQuantity"
            required
            defaultValue={batch.packedQuantity ?? ''}
            inputMode="decimal"
            pattern="\d{1,11}(\.\d{1,3})?"
            title="A positive number, up to 3 decimal places"
            className={FIELD}
          />
        </div>
      </div>

      <div className="grid items-end gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`jwp-rejected-${batch.id}`} className={LABEL}>
            Rejects <span className="font-normal normal-case text-slate-400">(optional)</span>
          </label>
          <input
            id={`jwp-rejected-${batch.id}`}
            name="rejectedQuantity"
            defaultValue={batch.rejectedQuantity}
            inputMode="decimal"
            placeholder="0"
            pattern="\d{1,11}(\.\d{1,3})?"
            title="A number, up to 3 decimal places"
            className={FIELD}
          />
        </div>

        <div>
          {/* REQUIRED when there are specifications to choose from, optional
              when there are none. The variant decides which components the
              "Packaging consumed" rows below offer, so saving without one
              stores a record whose consumption cannot be reconstructed — and
              the rows somebody had just filled in are refused on the way. With
              no specification on file there is nothing to pick and the run
              still has to be recorded, so there it stays free text. */}
          <label htmlFor={`jwp-variant-${batch.id}`} className={LABEL}>
            Pack variant
            {packSpecifications.length === 0 ? (
              <span className="font-normal normal-case text-slate-400"> (optional)</span>
            ) : (
              <span className="ml-0.5 text-red-600">*</span>
            )}
          </label>

          {packSpecifications.length === 0 ? (
            <input
              id={`jwp-variant-${batch.id}`}
              name="packVariant"
              defaultValue={batch.packVariant ?? ''}
              maxLength={128}
              placeholder="10 x 10 blister carton"
              className={FIELD}
            />
          ) : (
            <select
              id={`jwp-variant-${batch.id}`}
              name="packVariant"
              required
              value={variant}
              onChange={(event) => setVariant(event.target.value)}
              className={FIELD}
            >
              {/* A real, selectable row rather than a `disabled` one. A select
                  whose value is '' with no empty option to hold it displays the
                  first entry instead, so the control would read as a variant
                  chosen while nothing had been. */}
              <option value="">--None--</option>
              {packSpecifications.map((entry) => (
                <option key={entry.id} value={entry.packVariant}>
                  {entry.packVariant} — {entry.unitsPerPack} per pack
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label htmlFor={`jwp-on-${batch.id}`} className={LABEL}>
            Packed on <span className="font-normal normal-case text-slate-400">(optional)</span>
          </label>
          <input
            id={`jwp-on-${batch.id}`}
            name="packedOn"
            type="date"
            defaultValue={batch.packedOn ?? ''}
            className={FIELD}
          />
        </div>
      </div>

      {specification && specification.components.length > 0 && (
        <fieldset className="rounded-md border border-slate-200 bg-white p-3">
          <legend className="px-1 text-xs font-medium tracking-wide text-slate-600">
            Packaging consumed
          </legend>

          <div className="space-y-2">
            {specification.components.map((component, index) => (
              // Keyed by specification as well as component, so switching
              // variant clears quantities counted against the old one rather
              // than carrying them over on a shared component.
              <div
                key={`${specification.id}-${component.id}`}
                className="flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name={`component.${index}.itemId`} value={component.id} />

                <div className="min-w-0 flex-1">
                  <span className="font-mono text-xs text-slate-700">{component.code}</span>{' '}
                  <span className="text-sm text-slate-600">{component.name}</span>
                </div>

                <div className="w-40">
                  <label htmlFor={`jwp-consumed-${batch.id}-${index}`} className="sr-only">
                    {component.code} consumed
                  </label>
                  <input
                    // KEYED ON THE STORED FIGURE, so the control is remounted
                    // when it changes: React 19 resets the form once the action
                    // resolves and an input re-reads `defaultValue` only at
                    // mount, so without this an amendment would show the value
                    // from the previous render.
                    key={`consumed-${consumedFor(component.id)}`}
                    id={`jwp-consumed-${batch.id}-${index}`}
                    name={`component.${index}.quantityConsumed`}
                    defaultValue={consumedFor(component.id)}
                    inputMode="decimal"
                    placeholder={`0 ${component.uom}`}
                    pattern={QUANTITY_PATTERN}
                    title="A positive number, up to 3 decimal places"
                    className={FIELD}
                  />
                </div>
              </div>
            ))}
          </div>

          <p className="mt-2 text-xs text-slate-500">
            What was actually used, counted — not what the specification expects. The difference
            between the two is the packing wastage, and each line here is the recall trail from a
            carton lot to this batch.
          </p>
        </fieldset>
      )}

      <div>
        <label htmlFor={`jwp-notes-${batch.id}`} className={LABEL}>
          Notes <span className="font-normal normal-case text-slate-400">(optional)</span>
        </label>
        <input
          id={`jwp-notes-${batch.id}`}
          name="notes"
          defaultValue={batch.notes ?? ''}
          maxLength={1000}
          className={FIELD}
        />
      </div>

      <p className="text-xs text-slate-500">
        The packed quantity — not the manufactured yield — is what goes back to{' '}
        {batch.principalName} if {batch.batchNumber} is released. It cannot exceed what the batch
        made.
      </p>

      {/* THE REQUISITION FORM'S FOOTER: a rule across the width, Cancel at the
          left, the primary action at the right. It used to put Record packing
          first and Cancel beside it, both hard left — the opposite order to
          every dialog on these screens, on the one form where the primary
          action writes a GMP record.

          CANCEL DOES DIFFERENT THINGS IN THE TWO STATES, and both are real.
          Amending, it abandons the correction and returns to the record. On a
          first entry there is no record to return to, so it clears what has
          been typed — which is what someone who has just realised they are on
          the wrong batch actually wants. */}
      <FormFooter
        onCancel={() => {
          if (recorded) {
            setEditing(false);
            return;
          }

          formRef.current?.reset();
        }}
      >
        <SubmitButton pendingLabel="Recording…">Record packing</SubmitButton>
      </FormFooter>
      </form>
    </>
  );
}

/**
 * A packing record that has been entered, shown as a record rather than a form.
 *
 * The figures only — no inputs, no Save. What was packed is a fact once it is
 * stored, and presenting it in boxes with a submit button underneath made a
 * saved record look like unsaved work.
 *
 * Edit is offered while the API still allows an amendment; once the quality
 * gate has ruled it is omitted, and the sentence at the foot says why rather
 * than leaving the record to simply stop.
 */
export function JobWorkPackingRecordSummary({
  packedQuantity,
  rejectedQuantity,
  packVariant,
  packedOn,
  consumed = [],
  onEdit,
}: {
  packedQuantity: string;
  rejectedQuantity: string | null;
  packVariant: string | null;
  packedOn: string | null;
  /**
   * What the pack consumed, ready to display. Empty when nothing was counted,
   * and the section is then left out rather than shown with no rows.
   */
  consumed?: { label: string; quantity: string }[];
  /** Omitted once the batch has been decided: the API refuses an amendment then. */
  onEdit?: () => void;
}) {
  return (
    <div className="space-y-3 rounded-md bg-slate-50 p-4">
      <div className="grid gap-4 text-sm sm:grid-cols-4">
        <dl className="contents">
          <div>
            <dt className={LABEL}>Finished pack quantity</dt>
            <dd className="mt-1.5 text-slate-900">{packedQuantity}</dd>
          </div>

          <div>
            <dt className={LABEL}>Pack variant</dt>
            <dd className="mt-1.5 text-slate-900">
              {packVariant ?? <span className="text-slate-400">Not recorded</span>}
            </dd>
          </div>

          <div>
            <dt className={LABEL}>Rejects</dt>
            {/* A recorded zero is a real answer — nothing was rejected — and
                differs from never having been asked. */}
            <dd className="mt-1.5 text-slate-900">
              {rejectedQuantity ?? <span className="text-slate-400">Not recorded</span>}
            </dd>
          </div>

          <div>
            <dt className={LABEL}>Packed on</dt>
            <dd className="mt-1.5 text-slate-900">
              {packedOn ?? <span className="text-slate-400">Not recorded</span>}
            </dd>
          </div>
        </dl>
      </div>

      {/* THE RECALL TRAIL, which the figures above do not carry: what went into
          this batch, from which component. Shown on the record rather than only
          inside the form, so reading a finished batch does not mean opening it
          for editing to see what it consumed. */}
      {consumed.length > 0 && (
        <div className="border-t border-slate-200 pt-3">
          <h5 className={LABEL}>Packaging consumed</h5>
          <ul className="mt-2 space-y-1">
            {consumed.map((entry) => (
              <li key={entry.label} className="flex justify-between gap-4 text-sm">
                <span className="text-slate-600">{entry.label}</span>
                <span className="tabular-nums text-slate-900">{entry.quantity}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {onEdit ? (
        <div className="border-t border-slate-200 pt-3">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Edit
          </button>
        </div>
      ) : (
        <p className="border-t border-slate-200 pt-3 text-xs text-slate-500">
          This batch has been through the quality gate, so its packing record can no longer be
          changed.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. The quality gate
// ---------------------------------------------------------------------------

/**
 * Release, hold or reject, with the consequence of each spelled out beside it.
 *
 * THREE SEPARATE SUBMIT BUTTONS rather than a dropdown: the decision is
 * irreversible, and a select whose default is "Released" would make releasing
 * the thing that happens when someone stops paying attention.
 *
 * HOLD AND REJECT ARE DIFFERENT DECISIONS. A batch held for a repeat assay may
 * still be released next week; a rejected one never will. Both refuse dispatch
 * back to the principal, and both need a reason.
 */
export function JobWorkReleaseDecisionForm({ batch }: { batch: JobWorkBatchView }) {
  const [state, action, pending] = useActionState(decideJobWorkBatchAction, IDLE);

  // Tracked so the two blocking buttons can honour the "(required)" their own
  // labels promise. The API refuses a reasonless hold regardless — this is
  // about saying so before the round trip rather than after it.
  const [notes, setNotes] = useState('');
  const canBlock = notes.trim().length > 0;

  return (
    <form action={action} className="space-y-3">
      {/* See the packing form above: never name a control "id". */}
      <input type="hidden" name="batchId" value={batch.id} />

      <Result state={state} pending={pending} />

      <div>
        <label htmlFor={`jwbr-notes-${batch.id}`} className={LABEL}>
          Reason / test reference{' '}
          <span className="font-normal normal-case text-slate-400">
            (required to hold or reject)
          </span>
        </label>
        <textarea
          id={`jwbr-notes-${batch.id}`}
          name="notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className={FIELD}
          placeholder="e.g. Assay 99.2%, dissolution complies. QC report QC-2026-0142."
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          name="decision"
          value="RELEASED"
          disabled={pending || batch.actualQuantity === null}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {pending ? 'Saving…' : 'Release'}
        </button>

        <button
          type="submit"
          name="decision"
          value="ON_HOLD"
          disabled={pending || !canBlock}
          title={canBlock ? undefined : 'Give a reason above before holding this batch.'}
          className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {pending ? 'Saving…' : 'Hold'}
        </button>

        <button
          type="submit"
          name="decision"
          value="REJECTED"
          disabled={pending || !canBlock}
          title={canBlock ? undefined : 'Give a reason above before rejecting this batch.'}
          className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {pending ? 'Saving…' : 'Reject'}
        </button>
      </div>

      <p className="text-xs text-slate-600">
        {batch.actualQuantity === null ? (
          <>
            Nothing is recorded as manufactured yet, so there is no quantity to release. Record
            what the batch made under Batch record first.
          </>
        ) : (
          <>
            Releasing clears {batch.batchNumber} to go back to {batch.principalName} under Outward
            dispatch. Holding withholds it pending further testing; rejecting withholds it for
            good. None of the three can be undone here.
          </>
        )}
        {!canBlock && (
          <>
            {' '}
            A batch that did not pass, with no recorded reason, is the first thing an inspector
            asks about — so holding and rejecting both need the box above filled in.
          </>
        )}
      </p>
    </form>
  );
}
