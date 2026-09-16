'use client';

import { useActionState, useEffect, useState } from 'react';
import type {
  ItemSummary,
  MaterialIssuePlan,
  ProductionOrderSummary,
  ProductionStockLot,
  WorkOrderFeasibility,
} from '@pharma-erp/types';

import {
  checkWorkOrderFeasibilityAction,
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
/**
 * Closes the drawer once a form has saved.
 *
 * Deliberately delayed. Closing the instant the action resolves takes the
 * confirmation with it — "B-2609-002 recorded" flashes and is gone — and the
 * register behind has not re-rendered yet, so for a moment nothing on screen
 * says anything happened. A second is long enough to read it and short enough
 * not to feel stuck.
 */
function useCloseOnSaved(state: ActionResult, onSaved?: () => void) {
  useEffect(() => {
    if (!state.ok || !onSaved) return;

    const timer = setTimeout(onSaved, 1_000);

    return () => clearTimeout(timer);
  }, [state.ok, state.message, onSaved]);
}

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

/**
 * What a batch would consume, and whether the stock is there — US-PROD-01.
 *
 * The grid is not decoration: the criterion is that the system BLOCKS a work
 * order when material is short, and blocking someone at the moment they press
 * Save, with no warning, is a worse version of the same rule. This shows the
 * answer while the quantity is still being typed.
 *
 * Every number comes from the server, from the same method the save checks
 * against. The form deliberately does no arithmetic of its own — a browser
 * computing its own requirement would eventually disagree with the server, and
 * the disagreement would surface as a save refused for reasons the page said
 * were fine.
 */
function FeasibilityGrid({
  state,
}: {
  state: { checking: boolean; error: string | null; data: WorkOrderFeasibility | null };
}) {
  if (state.checking) return <p className="text-xs text-slate-500">Checking stock…</p>;

  if (state.error) {
    return (
      <p role="alert" className="text-xs text-red-700">
        Could not check stock: {state.error}
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
        data.canRaise ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/40'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-inherit px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Material required · formulation v{data.bomVersion}
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${
            data.canRaise
              ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
              : 'bg-red-50 text-red-800 ring-red-200'
          }`}
        >
          {data.canRaise ? 'Stock available' : 'Insufficient stock'}
        </span>
      </div>

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
                Available
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Short
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/70">
            {data.lines.map((line) => (
              <tr key={line.itemId} className={line.isShort ? 'bg-red-50/60' : undefined}>
                <td className="px-4 py-2">
                  <span className="font-mono text-xs text-slate-700">{line.code}</span>{' '}
                  <span className="text-slate-600">{line.name}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {line.required} <span className="text-xs text-slate-500">{line.uom}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {line.available} <span className="text-xs text-slate-500">{line.uom}</span>
                </td>
                <td
                  className={`px-4 py-2 text-right tabular-nums ${
                    line.isShort ? 'font-semibold text-red-800' : 'text-slate-400'
                  }`}
                >
                  {line.isShort ? `${line.short} ${line.uom}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!data.canRaise && (
        <p className="border-t border-inherit px-4 py-2.5 text-xs text-red-800">
          Only stock released by incoming QC counts — quarantined and rejected lots are not
          available to production. Raise a purchase requisition, or reduce the batch size.
        </p>
      )}
    </div>
  );
}

export function CreateProductionOrderForm({
  products,
  onSaved,
}: {
  products: ItemSummary[];
  onSaved?: () => void;
}) {
  const [state, action, pending] = useActionState(createProductionOrderAction, IDLE);

  useCloseOnSaved(state, onSaved);

  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [feasibility, setFeasibility] = useState<{
    checking: boolean;
    error: string | null;
    data: WorkOrderFeasibility | null;
  }>({ checking: false, error: null, data: null });

  // Debounced, because this fires on every keystroke in the quantity box and
  // each call is a database round trip. 400ms is long enough that typing
  // "100000" asks once rather than six times, and short enough that the answer
  // arrives before anyone reaches for Save.
  useEffect(() => {
    if (!productId || !quantity.trim()) {
      setFeasibility({ checking: false, error: null, data: null });
      return;
    }

    setFeasibility((current) => ({ ...current, checking: true }));

    let cancelled = false;

    const timer = setTimeout(async () => {
      const result = await checkWorkOrderFeasibilityAction(productId, quantity.trim());

      // The guard matters: answers can arrive out of order when the quantity is
      // edited quickly, and a stale reply overwriting a fresh one would show a
      // verdict for a batch size nobody asked about.
      if (cancelled) return;

      setFeasibility(
        result.ok
          ? { checking: false, error: null, data: result.data }
          : { checking: false, error: result.message, data: null },
      );
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [productId, quantity]);

  if (products.length === 0) {
    return (
      <p className="px-6 py-5 text-sm text-slate-600">
        No finished products with an active formulation. Add one under Formulations first — a work
        order needs a recipe to issue material against.
      </p>
    );
  }

  // Disabled only on a KNOWN failure. While the check is in flight, or if it
  // could not run at all, the button stays live and the server decides — a form
  // that locks itself because a preview call failed is a form nobody can use
  // when the preview endpoint is down.
  const blockedByStock = feasibility.data !== null && !feasibility.data.canRaise;

  return (
    <form action={action} className="space-y-4 px-6 py-5">
      <Result state={state} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="productId" className={LABEL}>
            Product
          </label>
          <select
            id="productId"
            name="productId"
            required
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            className={FIELD}
          >
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
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
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

      <FeasibilityGrid state={feasibility} />

      <button type="submit" disabled={pending || blockedByStock} className={BUTTON}>
        {pending ? 'Raising…' : blockedByStock ? 'Not enough stock' : 'Raise work order'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 3. Material issue
// ---------------------------------------------------------------------------

/**
 * Dispensing against a work order — US-PROD-02.
 *
 * FEFO is the default and needs no input at all: the button dispenses exactly
 * what the plan above shows. The override block exists because the criterion
 * says a different lot may be chosen WITH A REASON, and a rule with no way to
 * depart from it gets departed from outside the system instead — on paper, or
 * by someone editing the plan until it proposes what they wanted.
 *
 * Overriding a material REPLACES the whole suggestion for it. The server
 * recomputes the shortfall from the lots named here and refuses the issue if
 * they do not cover the requirement, so a partial override is not a way to
 * dispense a partial charge.
 */
export function IssueMaterialForm({
  plan,
  lots = [],
  onSaved,
}: {
  plan: MaterialIssuePlan;
  /** Stock on hand, for the lot pickers. Only USABLE lots can be dispensed. */
  lots?: ProductionStockLot[];
  onSaved?: () => void;
}) {
  const [state, action, pending] = useActionState(issueMaterialAction, IDLE);

  useCloseOnSaved(state, onSaved);

  // itemId -> how many lot rows are open for it. Absent means "use FEFO",
  // which is why this is a map of the exceptions rather than a flag per line.
  const [rows, setRows] = useState<Record<string, number>>({});

  const overriding = Object.keys(rows).length > 0;

  // Why Number() on a decimal string, when this file otherwise never does
  // arithmetic on one: it decides whether to OFFER a lot, and no value derived
  // from it is sent anywhere. The quantity dispensed is the string the operator
  // types, untouched.
  const usableLotsFor = (itemId: string) =>
    lots.filter(
      (lot) =>
        lot.item.id === itemId && lot.status === 'USABLE' && Number(lot.quantityAvailable) > 0,
    );

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

      <details className="rounded-md border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-slate-700">
          Dispense a different lot
        </summary>

        <div className="space-y-4 border-t border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-500">
            The plan above suggests the nearest-expiry usable lot of each material. Picking lots
            yourself replaces that suggestion for the material entirely, so name enough to cover its
            full requirement. Quarantined and rejected stock cannot be dispensed by any route.
          </p>

          {plan.lines.map((line) => {
            const candidates = usableLotsFor(line.item.id);
            const suggested = new Set(line.allocations.map((allocation) => allocation.lotId));
            const open = rows[line.item.id] ?? 0;

            return (
              <div
                key={line.item.id}
                className="border-t border-slate-100 pt-3 first:border-0 first:pt-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-mono text-xs text-slate-700">{line.item.code}</span>{' '}
                    <span className="text-slate-600">{line.item.name}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      needs {line.quantityRequired} {line.item.uom}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setRows((current) => {
                        const next = { ...current };

                        if (open > 0) delete next[line.item.id];
                        else next[line.item.id] = 1;

                        return next;
                      })
                    }
                    disabled={candidates.length === 0}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {candidates.length === 0
                      ? 'No usable lots'
                      : open > 0
                        ? 'Use the suggestion'
                        : 'Choose lots myself'}
                  </button>
                </div>

                {open > 0 && (
                  <div className="mt-3 space-y-2">
                    {Array.from({ length: open }, (_, row) => (
                      <div key={row} className="flex flex-wrap items-end gap-2">
                        <div className="min-w-[16rem] flex-1">
                          <label htmlFor={`lot-${line.item.id}-${row}`} className="sr-only">
                            Lot of {line.item.code}
                          </label>
                          <select
                            id={`lot-${line.item.id}-${row}`}
                            name={`override.${line.item.id}.${row}.lotId`}
                            defaultValue=""
                            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                          >
                            <option value="">Select a lot…</option>
                            {candidates.map((lot) => (
                              <option key={lot.id} value={lot.id}>
                                {lot.lotNumber} · {lot.quantityAvailable} {line.item.uom} ·{' '}
                                {lot.expiryDate ? `exp ${lot.expiryDate}` : 'no expiry'}
                                {suggested.has(lot.id) ? ' · suggested' : ''}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="w-36">
                          <label htmlFor={`qty-${line.item.id}-${row}`} className="sr-only">
                            Quantity from this lot
                          </label>
                          <input
                            id={`qty-${line.item.id}-${row}`}
                            name={`override.${line.item.id}.${row}.quantity`}
                            inputMode="decimal"
                            placeholder={`0 ${line.item.uom}`}
                            pattern="\d{1,11}(\.\d{1,3})?"
                            title="A positive number, up to 3 decimal places"
                            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                          />
                        </div>

                        {row === open - 1 && candidates.length > open && (
                          <button
                            type="button"
                            onClick={() =>
                              setRows((current) => ({ ...current, [line.item.id]: open + 1 }))
                            }
                            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Add a lot
                          </button>
                        )}
                      </div>
                    ))}

                    <div>
                      <label htmlFor={`reason-${line.item.id}`} className="sr-only">
                        Why not the suggested lot for {line.item.code}
                      </label>
                      <input
                        id={`reason-${line.item.id}`}
                        name={`override.${line.item.id}.reason`}
                        // Deliberately not `required`: the field lives inside a
                        // <details> the operator can collapse, and a browser
                        // cannot focus a required control it is not showing —
                        // the submit then fails silently. The action checks it.
                        maxLength={500}
                        placeholder={`Why not the suggested lot of ${line.item.code}?`}
                        className="block w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </details>

      {/* Enabled while overriding even when the plan itself is short: FEFO
          leaves out lots that expire before the batch would, and naming one of
          those is exactly the departure an override is for. The server
          recomputes the shortfall and refuses if it is still not covered. */}
      <button
        type="submit"
        disabled={pending || (!plan.canIssue && !overriding)}
        className={BUTTON}
      >
        {pending ? 'Dispensing…' : `Dispense against ${plan.orderNumber}`}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 4. Batch record
// ---------------------------------------------------------------------------

export function RecordBatchForm({
  orders,
  onSaved,
}: {
  orders: ProductionOrderSummary[];
  onSaved?: () => void;
}) {
  const [state, action, pending] = useActionState(recordBatchAction, IDLE);

  useCloseOnSaved(state, onSaved);

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

/**
 * One presentation of a product, and what a pack of it is made of.
 *
 * Flattened from PackagingRequirementView by the panel: the form needs the
 * components by name, not the requirement levels and scaling bases that the
 * specification screen exists to edit.
 */
export type PackSpecification = {
  id: string;
  packVariant: string;
  unitsPerPack: string;
  components: { id: string; code: string; name: string; uom: string }[];
};

/**
 * The Batch Packing Record — US-PROD-04.
 *
 * Three things the criterion needs and the earlier form did not have:
 *
 *   REJECTS, because "finished pack quantities must tie back to the bulk
 *   batch" and packed alone always ties back — the losses simply went
 *   unrecorded. Packed PLUS rejected is what the server reconciles against the
 *   yield.
 *
 *   PACK VARIANT, so the line records which presentation was run. Chosen from
 *   the product's own specifications where it has them, because a typed
 *   variant that matches none of them names a pack nobody specified — and the
 *   variant is what says the components below are the right ones.
 *
 *   COMPONENT CONSUMPTION, because a recall asks which carton lot went onto
 *   which batch, and a packed quantity alone cannot answer that.
 *
 * The expected quantities are NOT pre-filled from the specification. What a
 * pack should consume and what it did consume differ in normal operation —
 * that difference is the wastage this record exists to capture — and a
 * pre-filled figure is one somebody confirms without counting.
 */
export function RecordPackingForm({
  batchId,
  batchNumber,
  packSpecifications = [],
}: {
  batchId: string;
  batchNumber: string;
  /** The product's active specifications. Empty for a product with none. */
  packSpecifications?: PackSpecification[];
}) {
  const [state, action, pending] = useActionState(recordPackingAction, IDLE);

  const [variant, setVariant] = useState(packSpecifications[0]?.packVariant ?? '');

  const specification = packSpecifications.find((entry) => entry.packVariant === variant);

  return (
    <form action={action} className="space-y-3 rounded-md bg-slate-50 p-4">
      <input type="hidden" name="batchId" value={batchId} />

      <Result state={state} />

      <div className="grid gap-3 sm:grid-cols-3">
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
          <label htmlFor={`rejected-${batchId}`} className={LABEL}>
            Rejects <span className="font-normal normal-case text-slate-400">(optional)</span>
          </label>
          <input
            id={`rejected-${batchId}`}
            name="rejectedQuantity"
            inputMode="decimal"
            placeholder="0"
            pattern="\d{1,11}(\.\d{1,3})?"
            title="A number, up to 3 decimal places"
            className={FIELD}
          />
        </div>

        <div>
          <label htmlFor={`variant-${batchId}`} className={LABEL}>
            Pack variant{' '}
            {packSpecifications.length === 0 && (
              <span className="font-normal normal-case text-slate-400">(optional)</span>
            )}
          </label>

          {packSpecifications.length === 0 ? (
            // No specification on file, so there is nothing to choose from and
            // the run still has to be recorded. Free text, and no component
            // rows — the form cannot invent which components a pack uses.
            <input
              id={`variant-${batchId}`}
              name="packVariant"
              placeholder="10 x 10 blister carton"
              className={FIELD}
            />
          ) : (
            <select
              id={`variant-${batchId}`}
              name="packVariant"
              value={variant}
              onChange={(event) => setVariant(event.target.value)}
              className={FIELD}
            >
              {packSpecifications.map((entry) => (
                <option key={entry.id} value={entry.packVariant}>
                  {entry.packVariant} — {entry.unitsPerPack} per pack
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {specification && specification.components.length > 0 && (
        <fieldset className="rounded-md border border-slate-200 bg-white p-3">
          <legend className="px-1 text-xs font-medium uppercase tracking-wide text-slate-600">
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
                  <label htmlFor={`consumed-${batchId}-${index}`} className="sr-only">
                    {component.code} consumed
                  </label>
                  <input
                    id={`consumed-${batchId}-${index}`}
                    name={`component.${index}.quantityConsumed`}
                    inputMode="decimal"
                    placeholder={`0 ${component.uom}`}
                    pattern="\d{1,11}(\.\d{1,3})?"
                    title="A positive number, up to 3 decimal places"
                    className="block w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
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
        <label htmlFor={`notes-${batchId}`} className={LABEL}>
          Notes <span className="font-normal normal-case text-slate-400">(optional)</span>
        </label>
        <input id={`notes-${batchId}`} name="notes" className={FIELD} />
      </div>

      <p className="text-xs text-slate-500">
        The packed quantity — not the manufactured yield — is what becomes sellable stock if{' '}
        {batchNumber} is released. Packed plus rejects cannot exceed what the batch made.
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
