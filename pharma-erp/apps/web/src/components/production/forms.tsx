'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import type {
  ItemSummary,
  MaterialIssuePlan,
  ProductionOrderSummary,
  ProductionStockLot,
  WorkOrderFeasibility,
} from '@pharma-erp/types';

import { useActionToast } from '@/components/toast';
import { SearchableSelect } from '@/components/searchable-select';
import { SavedDialog } from '@/components/saved-dialog';

import {
  checkWorkOrderFeasibilityAction,
  createProductionOrderAction,
  issueMaterialAction,
  issuePlanAction,
  nextIssueNumberAction,
  nextWorkOrderNumberAction,
  recordBatchAction,
  recordPackingAction,
  releaseBatchAction,
  type ActionResult,
} from '@/app/(app)/workflows/production-actions';
import { useIsInsideRegister, useReportSaved } from '@/components/production/register';

import { ExpiryHint, Quantity } from './shared';

const IDLE: ActionResult = { ok: true };

/**
 * Hands a finished save to the register, which closes the drawer and confirms.
 *
 * The message travels with it: the register names what was saved in its
 * confirmation dialog, and only the form knows what the server said.
 *
 * THE MESSAGE IS WHAT MAKES IT A SUCCESS, not `ok` alone. The idle state is
 * `{ ok: true }` with nothing in it, so testing `state.ok` by itself matched
 * the moment the form MOUNTED — every form would close as soon as it opened.
 */
function useReportOnSaved(state: ActionResult) {
  // From context, not a prop: `form` is built by a server component, and a
  // server component cannot hand a function to a client one. See the note on
  // SavedContext in ./register. Outside a drawer this reports into nothing.
  const reportSaved = useReportSaved();
  const message = state.ok ? state.message : undefined;

  useEffect(() => {
    if (!message) return;

    reportSaved(message);
  }, [message, reportSaved]);
}

/**
 * Announces a finished submission.
 *
 * A FAILURE goes to the toast, beside a form that is still open with the
 * entered data in it. A SUCCESS is the confirmation dialog, everywhere — the
 * same card Master Data and the Production registers raise, so a save looks the
 * same wherever it was made.
 *
 * WHO RAISES THAT DIALOG depends on where the form is:
 *
 *   * Inside a register's drawer, the REGISTER does, because it also has to
 *     close the drawer — and the two are one step, so the form is never left
 *     standing open behind the confirmation.
 *   * Inline on a batch card — the packing and release forms — there is no
 *     drawer and no register listening, so this raises it directly.
 *
 * `useIsInsideRegister` tells the two apart, rather than a prop every caller
 * would have to set correctly. Without it both would fire and the dialogs
 * would stack.
 */
function Result({ state, pending }: { state: ActionResult; pending: boolean }) {
  const confirmedByRegister = useIsInsideRegister();

  // A FAILURE always goes to the toast: it belongs beside the form, which is
  // still open with the entered data in it.
  useActionToast(pending, 'error', state.ok ? undefined : state.message);

  // A SUCCESS is a dialog — the same one the registers raise, so every save in
  // Production confirms identically whether the form was in a drawer or not.
  // Only for a form NOT inside a register: there, the register is already
  // showing this message and a second dialog would stack on the first.
  const [saved, setSaved] = useState<string | null>(null);
  const message = state.ok ? state.message : undefined;

  useEffect(() => {
    if (confirmedByRegister || !message) return;

    setSaved(message);
  }, [confirmedByRegister, message]);

  if (!saved) return null;

  return <SavedDialog message={saved} onDismiss={() => setSaved(null)} />;
}

const FIELD =
  'mt-1.5 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900';

const LABEL = 'block text-xs font-medium uppercase tracking-wide text-slate-600';

const BUTTON =
  'rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400';

/**
 * A field the system fills in, shown but not editable.
 *
 * Every user story lists fields the form does not ask for — an auto-generated
 * number, a date the server sets, a value derived from two others — and leaving
 * them off the screen entirely was the wrong reading of "auto". Somebody
 * recording a batch wants to see the expiry date that is about to be printed on
 * the carton BEFORE they save, not after; a work order should show which
 * formulation it is about to be pinned to.
 *
 * NOT a `<input readOnly>`. A read-only input still looks like somewhere to
 * type, still takes focus, and still submits a value the server would then have
 * to ignore or — worse — trust. This is a plain value, so there is nothing to
 * submit and nothing to spoof: the server derives these regardless of anything
 * the browser sends.
 *
 * `pending` is for the values that cannot be known until the record is written.
 * "Assigned on save" is a truthful answer to "what will the batch number be";
 * an empty box is not.
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
  /** Shown while `value` is absent — still loading, or not derivable yet. */
  placeholder?: string;
}) {
  const isEmpty = value === undefined || value === null || value === '';

  return (
    <div>
      {/* The label reads exactly like an editable field's. What marks this one
          as the system's to fill is the dashed, greyed box below — the field is
          plainly not somewhere to type, so saying so in the label as well was
          repeating in words what the control already shows. */}
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

export function CreateProductionOrderForm({ products }: { products: ItemSummary[] }) {
  const [state, action, pending] = useActionState(createProductionOrderAction, IDLE);

  useReportOnSaved(state);

  // Newest first — see SearchableSelect for why the closed picklist offers the
  // most recent few rather than the whole register.
  const productOptions = useMemo(
    () =>
      [...products]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((product) => ({ value: product.id, label: `${product.code} — ${product.name}` })),
    [products],
  );

  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [feasibility, setFeasibility] = useState<{
    checking: boolean;
    error: string | null;
    data: WorkOrderFeasibility | null;
  }>({ checking: false, error: null, data: null });

  // The number this order would take. Asked once, when the form opens: it does
  // not depend on anything typed here, and nothing is reserved by asking.
  const [orderNumber, setOrderNumber] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void nextWorkOrderNumberAction().then((next) => {
      if (!cancelled) setOrderNumber(next);
    });

    return () => {
      cancelled = true;
    };
  }, []);

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
      <Result state={state} pending={pending} />

      {/* Ordered as the record reads, not as the inputs happen to be typed:
          the number and the date identify the order, then what it is for, then
          the formulation the requirement below is computed against. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <ReadOnlyField label="Work order no." value={orderNumber ?? undefined} placeholder="…" />

        <div>
          <label htmlFor="plannedStartOn" className={LABEL}>
            Planned start <span className="font-normal normal-case text-slate-400">(optional)</span>
          </label>
          <input id="plannedStartOn" name="plannedStartOn" type="date" className={FIELD} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="productId" className={LABEL}>
            Product
          </label>
          {/* Searchable, and offering the newest few before anything is typed:
              the item register grows without limit, and the product somebody
              is raising a work order for is often one just added.

              `placeholder={null}` because this field has no empty state — the
              form opens with the first product already chosen, and the
              feasibility check below is about whichever one that is. */}
          <SearchableSelect
            id="productId"
            options={productOptions}
            placeholder={null}
            value={productId}
            onChange={setProductId}
            required
          />
          <input type="hidden" name="productId" value={productId} />
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

      <ReadOnlyField
        label="BOM reference"
        value={
          feasibility.data
            ? `${feasibility.data.productCode} · formulation v${feasibility.data.bomVersion}`
            : undefined
        }
      />

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
 * what the plan shows. The override block exists because the criterion says a
 * different lot may be chosen WITH A REASON, and a rule with no way to depart
 * from it gets departed from outside the system instead — on paper, or by
 * someone editing the plan until it proposes what they wanted.
 *
 * Overriding a material REPLACES the whole suggestion for it. The server
 * recomputes the shortfall from the lots named here and refuses the issue if
 * they do not cover the requirement, so a partial override is not a way to
 * dispense a partial charge.
 *
 * THE WORK ORDER IS CHOSEN HERE, and it used not to be. The panel computed one
 * plan — for the oldest order awaiting material — and this form was wired to
 * that order alone, so an officer with three orders on the floor could dispense
 * against exactly one of them and nothing on screen explained why. The plan for
 * whichever order is picked is fetched on demand rather than precomputed for
 * all of them: a plan costs an allocation query per material.
 */
export function IssueMaterialForm({
  orders,
  initialPlan = null,
  lots = [],
}: {
  /** Every work order awaiting material. Never empty — the caller checks. */
  orders: ProductionOrderSummary[];
  /**
   * The plan for `orders.at(-1)`, computed by the server so the form opens with
   * something on screen. Null when that read failed; the form then fetches it.
   */
  initialPlan?: MaterialIssuePlan | null;
  /** Stock on hand, for the lot pickers. Only USABLE lots can be dispensed. */
  lots?: ProductionStockLot[];
}) {
  const [state, action, pending] = useActionState(issueMaterialAction, IDLE);

  useReportOnSaved(state);

  // Oldest first: the one most likely to be dispensed next, and the one the
  // server preloaded a plan for.
  const [orderId, setOrderId] = useState(orders.at(-1)?.id ?? '');

  const [planState, setPlanState] = useState<{
    loading: boolean;
    error: string | null;
    data: MaterialIssuePlan | null;
  }>({ loading: false, error: null, data: initialPlan });

  useEffect(() => {
    // The preloaded plan already matches the order the form opened on, so the
    // first render asks for nothing.
    if (!orderId || planState.data?.productionOrderId === orderId) return;

    setPlanState((current) => ({ ...current, loading: true, error: null }));

    let cancelled = false;

    void issuePlanAction(orderId).then((result) => {
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

  // The number this dispensing record would take. Asked once, when the form
  // opens: it depends on nothing chosen here, and nothing is reserved by asking.
  const [issueNumber, setIssueNumber] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void nextIssueNumberAction().then((next) => {
      if (!cancelled) setIssueNumber(next);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // itemId -> how many lot rows are open for it. Absent means "use FEFO",
  // which is why this is a map of the exceptions rather than a flag per line.
  const [rows, setRows] = useState<Record<string, number>>({});

  // `override.<itemId>.<row>.lotId` -> the lot currently chosen in that select.
  //
  // Tracked in state rather than read off the DOM because the Reason field's
  // visibility depends on it: US-PROD-02 wants a reason only when the actual
  // batch differs from the suggested one, so the form has to know what is
  // selected as it changes, not merely on submit.
  const [picked, setPicked] = useState<Record<string, string>>({});

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
      <input type="hidden" name="orderId" value={orderId} />

      <Result state={state} pending={pending} />

      {/* US-PROD-02's first two fields, plus the choice of what to dispense
          against. The work order is a PICKER now: this form used to be handed
          one order and no way to reach the others. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <ReadOnlyField
          label="Issue no."
          value={issueNumber ? <span className="font-mono">{issueNumber}</span> : undefined}
          placeholder="…"
        />

        <div>
          <label htmlFor="issue-order" className={LABEL}>
            Work order
          </label>
          {/* Already newest-first: the orders endpoint returns them that way,
              which is also the order somebody dispenses against. No sort here
              for that reason. */}
          <SearchableSelect
            id="issue-order"
            options={orders.map((candidate) => ({
              value: candidate.id,
              label: `${candidate.orderNumber} — ${candidate.product.code}`,
            }))}
            placeholder={null}
            value={orderId}
            onChange={setOrderId}
          />
        </div>
      </div>

      {order && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <span className="font-mono font-semibold">{order.orderNumber}</span> ·{' '}
          {order.product.name} · planned{' '}
          <Quantity value={order.plannedQuantity} uom={order.product.uom} />
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

      {plan && <IssuePlanTable plan={plan} />}

      {plan && !plan.canIssue && (
        <p className="text-sm text-amber-800">
          This plan cannot be issued as it stands — either material has already been dispensed
          against the order, or one or more lines are short. Dispensing is refused rather than
          part-filled: a batch made from an incomplete charge is a deviation, not a shortfall.
        </p>
      )}

      {/* What FEFO proposed, so the action can tell a departure from a
          confirmation without refetching the plan. Read-only information the
          server re-derives and re-checks for itself; this only decides which
          message the operator sees before the request is made. */}
      {plan?.lines.map((line) => (
        <input
          key={line.item.id}
          type="hidden"
          name={`suggested.${line.item.id}`}
          value={line.allocations.map((allocation) => allocation.lotId).join(',')}
        />
      ))}

      {plan && (
        <details className="rounded-md border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-slate-700">
            Dispense a different lot
          </summary>

          <div className="space-y-4 border-t border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-500">
              The plan above suggests the nearest-expiry usable lot of each material. Picking lots
              yourself replaces that suggestion for the material entirely, so name enough to cover
              its full requirement. Quarantined and rejected stock cannot be dispensed by any route.
            </p>

            {plan.lines.map((line) => {
              const candidates = usableLotsFor(line.item.id);
              const suggested = new Set(line.allocations.map((allocation) => allocation.lotId));
              const open = rows[line.item.id] ?? 0;

              // Whether any open row names a lot FEFO did not propose. This is
              // the "Actual Batch ≠ Suggested Batch" of US-PROD-02, and it is
              // what decides whether a reason is asked for — mirroring the same
              // comparison the API makes before it will accept the issue.
              const deviates = Array.from({ length: open }, (_, row) => {
                const chosen =
                  picked[`override.${line.item.id}.${row}.lotId`] ??
                  line.allocations[row]?.lotId ??
                  '';

                return chosen !== '' && !suggested.has(chosen);
              }).some(Boolean);

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
                      {Array.from({ length: open }, (_, row) => {
                        const field = `override.${line.item.id}.${row}.lotId`;
                        // The FEFO proposal for this row, which the select starts
                        // on — "Actual Batch Issued, manually confirmed, defaults
                        // to the suggestion". It used to start blank, so opening
                        // the panel discarded the suggestion and made every issue
                        // a from-scratch decision.
                        const fallback = line.allocations[row]?.lotId ?? '';
                        const current = picked[field] ?? fallback;

                        return (
                          <div key={row} className="flex flex-wrap items-end gap-2">
                            <div className="min-w-[16rem] flex-1">
                              <label htmlFor={`lot-${line.item.id}-${row}`} className="sr-only">
                                Lot of {line.item.code}
                              </label>
                              <select
                                id={`lot-${line.item.id}-${row}`}
                                name={field}
                                value={current}
                                onChange={(event) =>
                                  setPicked((now) => ({ ...now, [field]: event.target.value }))
                                }
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
                        );
                      })}

                      {/* US-PROD-02: the reason is asked for ONLY when a lot other
                        than the suggested one is actually chosen. It used to
                        appear the moment the panel opened, so confirming the
                        suggestion by hand demanded an explanation for agreeing
                        with it — and the line was then recorded as a deviation
                        that never happened. */}
                      {deviates && (
                        <div>
                          <label
                            htmlFor={`reason-${line.item.id}`}
                            className="mb-1 block text-xs font-medium text-amber-900"
                          >
                            Why not the suggested lot of {line.item.code}?
                          </label>
                          <input
                            id={`reason-${line.item.id}`}
                            name={`override.${line.item.id}.reason`}
                            // Deliberately not `required`: the field lives inside a
                            // <details> the operator can collapse, and a browser
                            // cannot focus a required control it is not showing —
                            // the submit then fails silently. The action checks it.
                            maxLength={500}
                            placeholder="Damaged container, retained sample, held for investigation…"
                            className="block w-full rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* Enabled while overriding even when the plan itself is short: FEFO
          leaves out lots that expire before the batch would, and naming one of
          those is exactly the departure an override is for. The server
          recomputes the shortfall and refuses if it is still not covered.
          Disabled outright with no plan — there is nothing to dispense yet. */}
      <button
        type="submit"
        disabled={pending || !plan || (!plan.canIssue && !overriding)}
        className={BUTTON}
      >
        {pending ? 'Dispensing…' : plan ? `Dispense against ${plan.orderNumber}` : 'Dispense'}
      </button>
    </form>
  );
}

/** What issuing the chosen order would consume, and out of which lots. */
function IssuePlanTable({ plan }: { plan: MaterialIssuePlan }) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full min-w-[48rem] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <th scope="col" className="px-4 py-2.5 font-medium">
              Material
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Required
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Lot
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Expiry
            </th>
            {/* The per-lot quantity, which is NOT a repeat of Required: a line
                short of one lot is filled from several, and those figures are
                what say how much comes out of each. It equals Required only in
                the common case where one lot covers the whole line. */}
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              From lot
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
              </td>
              <td className="px-4 py-3 text-right">
                <Quantity value={line.quantityRequired} uom={line.item.uom} />
              </td>
              {/* THREE COLUMNS, not one cell holding a run of text. The lot
                  number, its expiry and the amount taken from it used to sit on
                  one line — "TEST-PCM-600 exp 2028-09-17 24mo 0.4 KG" — which
                  read as a sentence and put a quantity under the "Lots" heading
                  where nothing lined up with anything.

                  Stacked within each cell when a line draws on several lots, so
                  the nth lot's expiry and quantity stay level with the nth lot
                  number. One row per allocation would have been tidier still,
                  but it means a rowSpan on Material, Required and Short, and a
                  line with no usable stock has no allocation row to hang them
                  from. */}
              <td className="px-4 py-3">
                {line.allocations.length === 0 ? (
                  <span className="text-red-700">No usable stock</span>
                ) : (
                  <ul className="space-y-1.5">
                    {line.allocations.map((allocation) => (
                      <li key={allocation.lotId} className="font-mono text-xs text-slate-700">
                        {allocation.lotNumber}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="px-4 py-3">
                <ul className="space-y-1.5">
                  {line.allocations.map((allocation) => (
                    <li key={allocation.lotId} className="flex items-center gap-x-2">
                      {/* A stock lot's expiry is optional — cartons and
                          leaflets usually have none. "no expiry" is the fact,
                          and it differs from a missing value: FEFO
                          deliberately keeps such lots until last. */}
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
              <td className="px-4 py-3 text-right">
                <ul className="space-y-1.5">
                  {line.allocations.map((allocation) => (
                    <li key={allocation.lotId}>
                      <Quantity value={allocation.quantity} uom={line.item.uom} />
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
// 4. Batch record
// ---------------------------------------------------------------------------

/**
 * Expiry as the server will compute it — manufacturing date plus shelf life.
 *
 * Mirrors `addMonths` in the API's production mappers, including the clamp to
 * the end of the target month: 31 August plus six months is 28 February, not
 * 3 March, and a preview that disagreed with the value actually printed on the
 * carton would be worse than showing nothing.
 *
 * Returns null when the product has no shelf life on file. The server falls
 * back to 24 months there, but guessing that number on screen would present a
 * default as though it were the product's own figure.
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

export function RecordBatchForm({ orders }: { orders: ProductionOrderSummary[] }) {
  const [state, action, pending] = useActionState(recordBatchAction, IDLE);

  useReportOnSaved(state);

  const [orderId, setOrderId] = useState(orders[0]?.id ?? '');
  // Empty means "today", which is what the server uses when the field is not
  // sent — so the expiry preview below has to assume the same thing.
  const [manufacturedOn, setManufacturedOn] = useState('');

  const order = orders.find((candidate) => candidate.id === orderId) ?? orders[0];
  const effectiveDate = manufacturedOn || new Date().toISOString().slice(0, 10);
  const expiry = order ? previewExpiry(effectiveDate, order.product.shelfLifeMonths) : null;

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
      <Result state={state} pending={pending} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="productionOrderId" className={LABEL}>
            Work order
          </label>
          <SearchableSelect
            id="productionOrderId"
            options={orders.map((candidate) => ({
              value: candidate.id,
              label: `${candidate.orderNumber} — ${candidate.product.code}`,
            }))}
            placeholder={null}
            value={orderId}
            onChange={setOrderId}
            required
          />
          <input type="hidden" name="productionOrderId" value={orderId} />
        </div>

        <div>
          <label htmlFor="actualQuantity" className={LABEL}>
            Actual quantity manufactured
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
            Manufacturing date{' '}
            <span className="font-normal normal-case text-slate-400">(defaults to today)</span>
          </label>
          <input
            id="manufacturedOn"
            name="manufacturedOn"
            type="date"
            value={manufacturedOn}
            onChange={(event) => setManufacturedOn(event.target.value)}
            className={FIELD}
          />
        </div>
      </div>

      {/* US-PROD-03 names these as fields of the BMR, and all three are the
          system's to supply. Shown rather than described in a sentence
          underneath: the expiry is about to be printed on a carton, and the
          moment to check it is before the record is opened, not after. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <ReadOnlyField label="Batch no." hint="Per the company numbering convention." />

        <ReadOnlyField
          label="Planned material use"
          value={
            order ? (
              <>
                {order.plannedQuantity}
                <span className="ml-1 text-xs text-slate-500">{order.product.uom}</span>
              </>
            ) : undefined
          }
          hint="Carried from the work order."
        />

        <ReadOnlyField
          label="Expiry date"
          value={expiry ?? undefined}
          hint={
            order && order.product.shelfLifeMonths !== null
              ? `Manufacturing date plus ${order.product.shelfLifeMonths} months.`
              : 'The product has no shelf life on file; the server applies its default.'
          }
        />
      </div>

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

      <Result state={state} pending={pending} />

      {/* Linked BMR, quantity and variant on one row — US-PROD-04 lists them
          together and they are read together: what this packing is against,
          how much came off the line, and which presentation was run. The BMR
          link is structural (this form only exists inside a batch that has
          one), but the story names it as a field and a packing record that
          does not say which batch it belongs to is one nobody can check. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <ReadOnlyField
          label="Linked BMR"
          value={<span className="font-mono">{batchNumber}</span>}
        />

        <div>
          <label htmlFor={`packed-${batchId}`} className={LABEL}>
            Finished pack quantity
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

      <div className="grid gap-3 sm:grid-cols-3">
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

  // Tracked so the Block button can honour the "(required to block)" its own
  // label promises. The API refuses a reasonless block regardless — this is
  // about saying so before the round trip rather than after it.
  const [notes, setNotes] = useState('');
  const canBlock = notes.trim().length > 0;

  return (
    <form action={action} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
      <input type="hidden" name="batchId" value={batchId} />

      <Result state={state} pending={pending} />

      <div>
        <label htmlFor={`release-notes-${batchId}`} className={LABEL}>
          Reason / test reference{' '}
          <span className="font-normal normal-case text-slate-400">(required to block)</span>
        </label>
        <textarea
          id={`release-notes-${batchId}`}
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
          disabled={pending || packedQuantity === null}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {pending ? 'Saving…' : 'Release'}
        </button>

        <button
          type="submit"
          name="decision"
          value="BLOCKED"
          disabled={pending || !canBlock}
          title={canBlock ? undefined : 'Give a reason above before blocking this batch.'}
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
          {!canBlock && (
            <>
              {' '}
              A blocked batch with no recorded reason is the first thing an inspector asks about, so
              blocking needs the box above filled in.
            </>
          )}
        </p>
      </div>
    </form>
  );
}
