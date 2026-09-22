'use client';

import { useActionState, useEffect, useState } from 'react';
import type {
  JobWorkBatchView,
  JobWorkIssuePlan,
  JobWorkMaterialReceiptView,
  JobWorkOrderSummary,
  JobWorkProductionOrderView,
} from '@pharma-erp/types';
import { BILLING_MODEL_LABELS, JOB_WORK_MATERIAL_KIND_LABELS } from '@pharma-erp/types';

import { IDLE, type ActionState } from '@/components/procurement/action-state';
import { useIsInsideRegister, useReportSaved } from '@/components/production/register';
import { ExpiryHint, Quantity } from '@/components/production/shared';
import { SavedDialog } from '@/components/saved-dialog';
import { SearchableSelect } from '@/components/searchable-select';
import { useActionToast } from '@/components/toast';

import {
  decideJobWorkBatchAction,
  jobWorkIssuePlanAction,
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
 * preview of what the save will produce, and a register that closes the drawer
 * and confirms. The helpers that make that work — `useReportSaved`,
 * `useIsInsideRegister`, `SearchableSelect`, `SavedDialog`, `useActionToast` —
 * are the application's own, imported rather than reimplemented.
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

const BUTTON =
  'rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400';

/**
 * Hands a finished save to the register, which closes the drawer and confirms.
 *
 * THE MESSAGE IS WHAT MAKES IT A SUCCESS, not the status alone — the idle state
 * carries no message, so testing anything weaker would fire the moment the form
 * mounted and every form would close as soon as it opened.
 */
function useReportOnSaved(state: ActionState) {
  const reportSaved = useReportSaved();
  const message = state.status === 'success' ? state.message : undefined;

  useEffect(() => {
    if (!message) return;

    reportSaved(message);
  }, [message, reportSaved]);
}

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
  const message = state.status === 'success' ? state.message : undefined;

  useEffect(() => {
    if (confirmedByRegister || !message) return;

    setSaved(message ?? null);
  }, [confirmedByRegister, message]);

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

/**
 * Raising a job-work production order against an approved consignment.
 *
 * THE CONSIGNMENT IS THE CHOICE, where the internal form chooses a product: the
 * product, the principal, the agreement and the billing model all follow from
 * the job-work order, and letting a form name its own would be a way to raise
 * an order for one principal against another's material.
 *
 * The material table below is the approved receipt's own lines — the raw and
 * packing materials the principal actually sent — so what the batch will be
 * made from is visible before the order exists.
 */
export function RaiseJobWorkProductionOrderForm({
  orders,
  receiptsByOrder,
}: {
  /** Job-work orders with at least one approved consignment. Never empty. */
  orders: JobWorkOrderSummary[];
  /** The approved receipts per job-work order id. */
  receiptsByOrder: Record<string, JobWorkMaterialReceiptView[]>;
}) {
  const [state, action, pending] = useActionState(raiseJobWorkProductionOrderAction, IDLE);

  useReportOnSaved(state);

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

  const order = orders.find((candidate) => candidate.id === jobWorkOrderId);
  const receipt = receipts.find((candidate) => candidate.id === receiptId) ?? null;

  if (orders.length === 0) {
    return (
      <p className="px-6 py-5 text-sm text-slate-600">
        No job-work order has a consignment that has passed Quality check. Record what the
        principal sent, send it for approval, and approve it first — a production order with no
        approved material behind it is one nothing can be issued against.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4 px-6 py-5">
      <Result state={state} pending={pending} />

      <input type="hidden" name="jobWorkOrderId" value={jobWorkOrderId} />
      <input type="hidden" name="materialReceiptId" value={receiptId} />

      {/* Ordered as the record reads: the number and the order it is against,
          then what follows from that order, then the consignment. */}
      <div className="grid items-end gap-4 sm:grid-cols-2">
        <ReadOnlyField
          label="Production order no."
          value={orderNumber ? <span className="font-mono">{orderNumber}</span> : undefined}
          placeholder="…"
        />

        <div>
          <label htmlFor="jwpo-order" className={LABEL}>
            Job-work order
          </label>
          <SearchableSelect
            id="jwpo-order"
            options={orders.map((candidate) => ({
              value: candidate.id,
              label: `${candidate.orderNumber} — ${candidate.principalName}`,
            }))}
            required
            value={jobWorkOrderId}
            onChange={setJobWorkOrderId}
          />
        </div>
      </div>

      {/* Everything the order decides. Read-only because it IS decided: a
          control here would be a way to contradict the agreement. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <ReadOnlyField label="Principal" value={order?.principalName} />
        <ReadOnlyField
          label="Agreement"
          value={order?.agreementReference ?? undefined}
          placeholder="No reference"
        />
        <ReadOnlyField
          label="Billing model"
          value={order ? BILLING_MODEL_LABELS[order.billingModel] : undefined}
        />

        <ReadOnlyField
          label="Product"
          value={
            order ? `${order.product.productName} (${order.product.productCode})` : undefined
          }
        />
        <ReadOnlyField label="Brand" value={order?.product.principalBrandName} />
        <ReadOnlyField label="UOM" value={order?.product.uom} />
      </div>

      <div className="grid items-end gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="jwpo-receipt" className={LABEL}>
            Material receipt
          </label>
          <SearchableSelect
            id="jwpo-receipt"
            options={receipts.map((candidate) => ({
              value: candidate.id,
              label: candidate.receiptNumber,
              hint: `${candidate.rawMaterialCount} raw · ${candidate.packingMaterialCount} packing · ${candidate.deliveryChallanNumbers.join(', ')}`,
            }))}
            required
            disabled={receipts.length === 0}
            value={receiptId}
            onChange={setReceiptId}
          />
          <p className="mt-1 text-xs text-slate-500">
            Only consignments that have passed Quality check are offered.
          </p>
        </div>

        <div>
          <label htmlFor="jwpo-quantity" className={LABEL}>
            Planned quantity{' '}
            <span className="font-normal normal-case text-slate-400">(optional)</span>
          </label>
          <input
            id="jwpo-quantity"
            name="plannedQuantity"
            inputMode="decimal"
            placeholder={order?.quantity ?? '100000'}
            pattern="\d{1,11}(\.\d{1,3})?"
            title="A positive number, up to 3 decimal places"
            className={FIELD}
          />
          <p className="mt-1 text-xs text-slate-500">
            Defaults to what the job-work order asked for.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="jwpo-start" className={LABEL}>
            Planned start{' '}
            <span className="font-normal normal-case text-slate-400">(optional)</span>
          </label>
          <input id="jwpo-start" name="plannedStartOn" type="date" className={FIELD} />
        </div>

        <div>
          <label htmlFor="jwpo-completion" className={LABEL}>
            Planned completion{' '}
            <span className="font-normal normal-case text-slate-400">(optional)</span>
          </label>
          <input
            id="jwpo-completion"
            name="plannedCompletionOn"
            type="date"
            className={FIELD}
          />
        </div>
      </div>

      {receipt && <ReceiptMaterialGrid receipt={receipt} />}

      <div>
        <label htmlFor="jwpo-notes" className={LABEL}>
          Notes <span className="font-normal normal-case text-slate-400">(optional)</span>
        </label>
        <input id="jwpo-notes" name="notes" maxLength={1000} className={FIELD} />
      </div>

      <button type="submit" disabled={pending || !receiptId} className={BUTTON}>
        {pending ? 'Raising…' : 'Raise production order'}
      </button>
    </form>
  );
}

/**
 * What the principal sent on this consignment, raw and packing.
 *
 * The receipt's OWN lines, rendered from the record rather than restated: this
 * is the same data the Material received from principal tab shows, and a second
 * copy is how two accounts of one delivery come to disagree.
 */
function ReceiptMaterialGrid({ receipt }: { receipt: JobWorkMaterialReceiptView }) {
  const raw = receipt.lines.filter((line) => line.kind === 'RAW');
  const packing = receipt.lines.filter((line) => line.kind === 'PACKING');

  return (
    <div className="rounded-md border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Received from the principal · {receipt.receiptNumber}
        </span>
        <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-800 ring-1 ring-inset ring-violet-200">
          {raw.length} raw · {packing.length} packing
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-500">
              <th scope="col" className="px-4 py-2 font-medium">
                Material
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Kind
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Batch / challan
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Expiry
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Received
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/70">
            {[...raw, ...packing].map((line) => (
              <tr key={line.id}>
                <td className="px-4 py-2">
                  <span className="font-mono text-xs text-slate-700">{line.item.code}</span>{' '}
                  <span className="text-slate-600">{line.item.name}</span>
                </td>
                <td className="px-4 py-2 text-xs text-slate-600">
                  {JOB_WORK_MATERIAL_KIND_LABELS[line.kind]}
                </td>
                <td className="px-4 py-2">
                  <span className="text-xs text-slate-700">{line.batchNumber}</span>
                  {line.deliveryChallanNumber && (
                    <div className="text-[11px] text-slate-500">
                      challan {line.deliveryChallanNumber}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-slate-600">
                  {line.expiryDate ?? 'no expiry'}
                </td>
                <td className="px-4 py-2 text-right">
                  <Quantity value={line.receivedQuantity} uom={line.item.uom} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Material issue
// ---------------------------------------------------------------------------

/**
 * Dispensing the principal's material against a job-work production order.
 *
 * THE PLAN IS THE FORM. It states what the formulation calls for and which
 * drums would cover it, nearest expiry first — and the quantity boxes open on
 * exactly that, so dispensing the suggestion is a single click and departing
 * from it is a deliberate edit.
 *
 * NO COMPANY STOCK APPEARS, ever. Under pure conversion the only material that
 * may go into this batch is what the principal sent, and the API refuses a lot
 * from any other consignment.
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
  const [state, action, pending] = useActionState(recordJobWorkIssueAction, IDLE);

  useReportOnSaved(state);

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
    <form action={action} className="space-y-4 px-6 py-5">
      <Result state={state} pending={pending} />

      <input type="hidden" name="jobWorkProductionOrderId" value={orderId} />

      <div className="grid items-end gap-4 sm:grid-cols-2">
        <ReadOnlyField
          label="Issue no."
          value={issueNumber ? <span className="font-mono">{issueNumber}</span> : undefined}
          placeholder="…"
        />

        <div>
          <label htmlFor="jwmi-order" className={LABEL}>
            Production order
          </label>
          <SearchableSelect
            id="jwmi-order"
            options={orders.map((candidate) => ({
              value: candidate.id,
              label: `${candidate.orderNumber} — ${candidate.product.code}`,
              hint: candidate.principalName,
            }))}
            required
            value={orderId}
            onChange={setOrderId}
          />
        </div>
      </div>

      {order && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <span className="font-mono font-semibold">{order.orderNumber}</span> ·{' '}
          {order.product.name} · for {order.principalName} · planned{' '}
          <Quantity value={order.plannedQuantity} uom={order.product.uom} /> · from{' '}
          <span className="font-mono text-xs">{order.materialReceipt.receiptNumber}</span>
        </div>
      )}

      {planState.loading && <p className="text-sm text-slate-500">Working out the plan…</p>}

      {planState.error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          Could not work out what this order would consume: {planState.error}
        </p>
      )}

      {plan?.blockedReason && (
        <p
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {plan.blockedReason}
        </p>
      )}

      {plan && plan.lines.length > 0 && <JobWorkIssuePlanTable plan={plan} />}

      {plan && plan.lines.length > 0 && !plan.canIssue && (
        <p className="text-sm text-amber-800">
          The principal has not sent enough to cover this batch. Only material received against{' '}
          {plan.jobWorkOrderNumber} and cleared by Quality check counts — company stock cannot be
          used on a pure-conversion order. Record the rest of their delivery, or reduce the
          planned quantity.
        </p>
      )}

      <button type="submit" disabled={pending || !plan || plan.lines.length === 0} className={BUTTON}>
        {pending ? 'Dispensing…' : plan ? `Dispense against ${plan.orderNumber}` : 'Dispense'}
      </button>
    </form>
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

/** Opening the batch record against an order material has gone to. */
export function RecordJobWorkBatchForm({ orders }: { orders: JobWorkProductionOrderView[] }) {
  const [state, action, pending] = useActionState(recordJobWorkBatchAction, IDLE);

  useReportOnSaved(state);

  const batchNumber = useNextNumber('batch');

  const [orderId, setOrderId] = useState(orders[0]?.id ?? '');
  const [manufacturedOn, setManufacturedOn] = useState(new Date().toISOString().slice(0, 10));

  const order = orders.find((candidate) => candidate.id === orderId) ?? orders[0];
  const expiry = order ? previewExpiry(manufacturedOn, order.product.shelfLifeMonths) : null;

  if (orders.length === 0) {
    return (
      <p className="px-6 py-5 text-sm text-slate-600">
        No production order is waiting for a batch record. Issue the principal’s material against
        an order first — a batch record with no traceable inputs is not a batch record.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4 px-6 py-5">
      <Result state={state} pending={pending} />

      <input type="hidden" name="jobWorkProductionOrderId" value={orderId} />

      {/* `items-end` so the CONTROLS line up along one baseline however tall
          each label turns out to be. */}
      <div className="grid items-end gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="jwb-order" className={LABEL}>
            Production order
          </label>
          <SearchableSelect
            id="jwb-order"
            options={orders.map((candidate) => ({
              value: candidate.id,
              label: `${candidate.orderNumber} — ${candidate.product.code}`,
              hint: candidate.principalName,
            }))}
            required
            value={orderId}
            onChange={setOrderId}
          />
        </div>

        <div>
          <label htmlFor="jwb-actual" className={LABEL}>
            Actual quantity manufactured{' '}
            <span className="font-normal normal-case text-slate-400">(optional)</span>
          </label>
          <input
            id="jwb-actual"
            name="actualQuantity"
            inputMode="decimal"
            pattern="\d{1,11}(\.\d{1,3})?"
            title="A positive number, up to 3 decimal places"
            className={FIELD}
          />
        </div>

        <div>
          <label htmlFor="jwb-mfg" className={LABEL}>
            Manufacturing date
          </label>
          <input
            id="jwb-mfg"
            name="manufacturedOn"
            type="date"
            required
            value={manufacturedOn}
            onChange={(event) => setManufacturedOn(event.target.value)}
            className={FIELD}
          />
        </div>
      </div>

      {/* The system's three, shown rather than described: the expiry is about
          to be printed on a carton, and the moment to check it is before the
          record is opened, not after. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <ReadOnlyField
          label="Batch no."
          value={batchNumber ? <span className="font-mono">{batchNumber}</span> : undefined}
          hint="Per the company numbering convention."
          placeholder="…"
        />

        <ReadOnlyField
          label="Planned quantity"
          value={
            order ? (
              <>
                {order.plannedQuantity}
                <span className="ml-1 text-xs text-slate-500">{order.product.uom}</span>
              </>
            ) : undefined
          }
          hint="Carried from the production order."
        />

        <ReadOnlyField
          label="Principal"
          value={order?.principalName}
          hint={order ? `Sold as ${order.principalBrandName}.` : undefined}
        />
      </div>

      <div className="grid items-end gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="jwb-expiry" className={LABEL}>
            Expiry date
          </label>
          <input
            id="jwb-expiry"
            name="expiryDate"
            type="date"
            required
            defaultValue={expiry ?? ''}
            className={FIELD}
          />
          <p className="mt-1 text-xs text-slate-500">
            {order && order.product.shelfLifeMonths !== null
              ? `Manufacturing date plus ${order.product.shelfLifeMonths} months, from the product master. Change it if the principal's specification differs.`
              : 'The product has no shelf life on file, so this one has to be entered.'}
          </p>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="jwb-notes" className={LABEL}>
            Notes <span className="font-normal normal-case text-slate-400">(optional)</span>
          </label>
          <input id="jwb-notes" name="notes" maxLength={1000} className={FIELD} />
        </div>
      </div>

      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? 'Recording…' : 'Open batch record'}
      </button>
    </form>
  );
}

/**
 * The packing record for a job-work batch — the second half of the record.
 *
 * REJECTS ARE ASKED FOR, because packed alone always ties back to the bulk
 * batch and the losses simply go unrecorded. Packed plus rejected is what the
 * API reconciles against what was made.
 */
export function RecordJobWorkPackingForm({ batch }: { batch: JobWorkBatchView }) {
  const [state, action, pending] = useActionState(recordJobWorkPackingAction, IDLE);

  return (
    <form action={action} className="space-y-3 rounded-md bg-slate-50 p-4">
      {/* NOT name="id". A control called "id" shadows the form element's own
          `id` property, and React's server-action serialisation then drops the
          submitter's name and value — which is how a release decision came to
          post its reason and no decision. */}
      <input type="hidden" name="batchId" value={batch.id} />

      <Result state={state} pending={pending} />

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
          <label htmlFor={`jwp-variant-${batch.id}`} className={LABEL}>
            Pack variant{' '}
            <span className="font-normal normal-case text-slate-400">(optional)</span>
          </label>
          <input
            id={`jwp-variant-${batch.id}`}
            name="packVariant"
            defaultValue={batch.packVariant ?? ''}
            maxLength={128}
            placeholder="10 x 10 blister carton"
            className={FIELD}
          />
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

      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? 'Recording…' : 'Record packing'}
      </button>
    </form>
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
