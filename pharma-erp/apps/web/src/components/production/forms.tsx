'use client';

import { useActionState } from 'react';
import type { ItemSummary, MaterialIssuePlan, ProductionOrderSummary } from '@pharma-erp/types';

import {
  createProductionOrderAction,
  issueMaterialAction,
  recordBatchAction,
  recordPackingAction,
  releaseBatchAction,
  type ActionResult,
} from '@/app/(app)/workflows/production-actions';

const IDLE: ActionResult = { ok: true };

/**
 * The result banner every form on this workflow shares.
 *
 * `ok: true` with no message is the idle state, so a fresh form shows nothing
 * rather than a green "success" for something that never happened.
 */
function Result({ state }: { state: ActionResult }) {
  if (!state.message) return null;

  return (
    <div
      role={state.ok ? 'status' : 'alert'}
      className={`rounded-md border p-3 text-sm ${
        state.ok
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : 'border-red-200 bg-red-50 text-red-800'
      }`}
    >
      {state.message}
    </div>
  );
}

const FIELD =
  'mt-1.5 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900';

const LABEL = 'block text-xs font-medium uppercase tracking-wide text-slate-600';

const BUTTON =
  'rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400';

// ---------------------------------------------------------------------------
// 2. Production orders
// ---------------------------------------------------------------------------

export function CreateProductionOrderForm({ products }: { products: ItemSummary[] }) {
  const [state, action, pending] = useActionState(createProductionOrderAction, IDLE);

  if (products.length === 0) {
    return (
      <p className="px-6 py-5 text-sm text-slate-600">
        No finished products with an active formulation. Add one under Formulations first — a work
        order needs a recipe to issue material against.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4 px-6 py-5">
      <Result state={state} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="productId" className={LABEL}>
            Product
          </label>
          <select id="productId" name="productId" required className={FIELD}>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.code} — {product.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="plannedQuantity" className={LABEL}>
            Quantity to make
          </label>
          <input
            id="plannedQuantity"
            name="plannedQuantity"
            required
            inputMode="decimal"
            placeholder="100000"
            // Sent as a string all the way to the Decimal column; see the note
            // at the top of packages/types/src/production.ts.
            pattern="\d{1,11}(\.\d{1,3})?"
            title="A positive number, up to 3 decimal places"
            className={FIELD}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="plannedStartOn" className={LABEL}>
            Planned start <span className="font-normal normal-case text-slate-400">(optional)</span>
          </label>
          <input id="plannedStartOn" name="plannedStartOn" type="date" className={FIELD} />
        </div>
      </div>

      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? 'Raising…' : 'Raise work order'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 3. Material issue
// ---------------------------------------------------------------------------

export function IssueMaterialForm({ plan }: { plan: MaterialIssuePlan }) {
  const [state, action, pending] = useActionState(issueMaterialAction, IDLE);

  return (
    <form action={action} className="space-y-4 border-t border-slate-200 px-6 py-5">
      <input type="hidden" name="orderId" value={plan.productionOrderId} />

      <Result state={state} />

      {!plan.canIssue && (
        <p className="text-sm text-amber-800">
          This plan cannot be issued as it stands — either material has already been dispensed
          against the order, or one or more lines are short. Dispensing is refused rather than
          part-filled: a batch made from an incomplete charge is a deviation, not a shortfall.
        </p>
      )}

      <button type="submit" disabled={pending || !plan.canIssue} className={BUTTON}>
        {pending ? 'Dispensing…' : `Dispense against ${plan.orderNumber}`}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 4. Batch record
// ---------------------------------------------------------------------------

export function RecordBatchForm({ orders }: { orders: ProductionOrderSummary[] }) {
  const [state, action, pending] = useActionState(recordBatchAction, IDLE);

  if (orders.length === 0) {
    return (
      <p className="px-6 py-5 text-sm text-slate-600">
        No work order is waiting for a batch record. Issue material against an order first — a batch
        record with no traceable inputs is not a batch record.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4 px-6 py-5">
      <Result state={state} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="productionOrderId" className={LABEL}>
            Work order
          </label>
          <select id="productionOrderId" name="productionOrderId" required className={FIELD}>
            {orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.orderNumber} — {order.product.code}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="actualQuantity" className={LABEL}>
            Quantity manufactured
          </label>
          <input
            id="actualQuantity"
            name="actualQuantity"
            required
            inputMode="decimal"
            pattern="\d{1,11}(\.\d{1,3})?"
            title="A positive number, up to 3 decimal places"
            className={FIELD}
          />
        </div>

        <div>
          <label htmlFor="manufacturedOn" className={LABEL}>
            Manufactured on{' '}
            <span className="font-normal normal-case text-slate-400">(defaults to today)</span>
          </label>
          <input id="manufacturedOn" name="manufacturedOn" type="date" className={FIELD} />
        </div>
      </div>

      <p className="text-xs text-slate-500">
        The batch number and expiry date are assigned automatically — expiry from the product&apos;s
        shelf life, fixed at this moment because it is printed on the carton.
      </p>

      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? 'Recording…' : 'Open batch record'}
      </button>
    </form>
  );
}

export function RecordPackingForm({
  batchId,
  batchNumber,
}: {
  batchId: string;
  batchNumber: string;
}) {
  const [state, action, pending] = useActionState(recordPackingAction, IDLE);

  return (
    <form action={action} className="space-y-3 rounded-md bg-slate-50 p-4">
      <input type="hidden" name="batchId" value={batchId} />

      <Result state={state} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`packed-${batchId}`} className={LABEL}>
            Quantity packed
          </label>
          <input
            id={`packed-${batchId}`}
            name="packedQuantity"
            required
            inputMode="decimal"
            pattern="\d{1,11}(\.\d{1,3})?"
            title="A positive number, up to 3 decimal places"
            className={FIELD}
          />
        </div>

        <div>
          <label htmlFor={`notes-${batchId}`} className={LABEL}>
            Notes <span className="font-normal normal-case text-slate-400">(optional)</span>
          </label>
          <input id={`notes-${batchId}`} name="notes" className={FIELD} />
        </div>
      </div>

      <p className="text-xs text-slate-500">
        The packed quantity — not the manufactured yield — is what becomes sellable stock if{' '}
        {batchNumber} is released.
      </p>

      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? 'Recording…' : 'Record packing'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 7. The quality gate
// ---------------------------------------------------------------------------

/**
 * Release or block, with the consequence of each spelled out next to it.
 *
 * Two separate submit buttons rather than a dropdown: the decision is
 * irreversible, and a select whose default is "Released" would make releasing
 * the thing that happens when someone stops paying attention.
 */
export function ReleaseDecisionForm({
  batchId,
  batchNumber,
  packedQuantity,
  uom,
}: {
  batchId: string;
  batchNumber: string;
  packedQuantity: string | null;
  uom: string;
}) {
  const [state, action, pending] = useActionState(releaseBatchAction, IDLE);

  return (
    <form action={action} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
      <input type="hidden" name="batchId" value={batchId} />

      <Result state={state} />

      <div>
        <label htmlFor={`release-notes-${batchId}`} className={LABEL}>
          Reason / test reference{' '}
          <span className="font-normal normal-case text-slate-400">(required to block)</span>
        </label>
        <textarea
          id={`release-notes-${batchId}`}
          name="notes"
          rows={2}
          className={FIELD}
          placeholder="e.g. Assay 99.2%, dissolution complies. QC report QC-2026-0142."
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          name="decision"
          value="RELEASED"
          disabled={pending || packedQuantity === null}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {pending ? 'Saving…' : 'Release'}
        </button>

        <button
          type="submit"
          name="decision"
          value="BLOCKED"
          disabled={pending}
          className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {pending ? 'Saving…' : 'Block'}
        </button>

        <p className="text-xs text-slate-600">
          {packedQuantity === null ? (
            <>No packing record yet, so there is no quantity to release into stock.</>
          ) : (
            <>
              Releasing adds <strong>{packedQuantity}</strong> {uom} of {batchNumber} to sellable
              stock. Blocking withholds it permanently. Neither can be undone here.
            </>
          )}
        </p>
      </div>
    </form>
  );
}
