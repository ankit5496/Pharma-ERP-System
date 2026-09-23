'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ItemSummary,
  MaterialIssuePlan,
  ProductionOrderSummary,
  ProductionStockLot,
  StockOwnership,
  WorkOrderFeasibility,
} from '@pharma-erp/types';
import { formatDateDMY } from '@pharma-erp/types';

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
 *   * Where no register is listening, this raises it directly. That is the
 *     packing form, inline on a batch card, and the release form — which does
 *     open in a drawer, but one PendingReleaseList opens for itself rather
 *     than a ProductionRegister, so there is no SavedContext above it. Its
 *     drawer closes when the decided batch drops out of the pending list.
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

  /**
   * Each result is announced ONCE.
   *
   * `useActionState` keeps the last result for as long as its form lives, so
   * `message` does not go back to undefined after a save — it sits there
   * holding "Packing recorded for B-2609-018." indefinitely. Without this, any
   * remount of this component re-runs the effect and raises the dialog for a
   * save that happened minutes ago.
   *
   * Compared by IDENTITY, not by text: two saves in a row produce the same
   * sentence, and comparing the strings would swallow the second confirmation.
   */
  const announced = useRef<ActionResult | null>(null);

  useEffect(() => {
    if (confirmedByRegister || !message) return;
    if (announced.current === state) return;

    announced.current = state;
    setSaved(message);
  }, [confirmedByRegister, message, state]);

  if (!saved) return null;

  return <SavedDialog message={saved} onDismiss={() => setSaved(null)} />;
}

const FIELD =
  'mt-1.5 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900';

const LABEL = 'block text-xs font-medium tracking-wide text-slate-600';

/**
 * An asterisk carries the meaning; the text makes it audible.
 *
 * The same marker the master-data form kit uses, repeated here rather than
 * imported: these forms build their own labels, and a required field that
 * looks different between two sections of the application is one somebody has
 * to learn twice.
 */
function RequiredMark() {
  return (
    <span className="text-red-600">
      {' '}
      *<span className="sr-only"> (required)</span>
    </span>
  );
}

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
        <span className="text-xs font-semibold tracking-wide text-slate-600">
          Material Required · Formulation v{data.bomVersion}
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
            <tr className="text-[11px] tracking-wide text-slate-500">
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

  // EMPTY, not the first product. Opening a form with a product already
  // chosen means the feasibility grid below is answering a question nobody
  // asked, and a work order raised in haste is raised against whatever
  // happened to sort first.
  const [productId, setProductId] = useState('');
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
      <div className="grid items-end gap-4 sm:grid-cols-2">
        <ReadOnlyField label="Work Order No." value={orderNumber ?? undefined} placeholder="…" />

        <div>
          <label htmlFor="plannedStartOn" className={LABEL}>
            Planned start <span className="font-normal normal-case text-slate-400">(optional)</span>
          </label>
          <input id="plannedStartOn" name="plannedStartOn" type="date" className={FIELD} />
        </div>
      </div>

      <div className="grid items-end gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="productId" className={LABEL}>
            Product
            <RequiredMark />
          </label>
          {/* Searchable, and offering the newest few before anything is typed:
              the item register grows without limit, and the product somebody
              is raising a work order for is often one just added.

              It opens on NO product. `emptyLabel` gives it a row to sit on and
              a word for the state — without one the box would be blank with no
              way back to it once a product had been picked. */}
          <SearchableSelect
            id="productId"
            options={productOptions}
            emptyLabel="--None--"
            value={productId}
            onChange={setProductId}
            // Matches the Quantity input beside it; see the note on the work
            // order field in RecordBatchForm.
            className={FIELD}
          />
          <input type="hidden" name="productId" value={productId} />
        </div>

        <div>
          <label htmlFor="plannedQuantity" className={LABEL}>
            Quantity
            <RequiredMark />
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
        label="BOM Reference"
        value={
          feasibility.data
            ? `${feasibility.data.productCode} · formulation v${feasibility.data.bomVersion}`
            : undefined
        }
      />

      <FeasibilityGrid state={feasibility} />

      {/* `!productId` because the picker now opens on nothing: the API would
          refuse an empty one anyway, and a round trip to be told so is a worse
          answer than a button that is plainly not ready yet. */}
      <button type="submit" disabled={pending || !productId || blockedByStock} className={BUTTON}>
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
   * The plan for `orders[0]` — the NEWEST — computed by the server so the form
   * opens with something on screen. Null when that read failed; the form then
   * fetches it.
   */
  initialPlan?: MaterialIssuePlan | null;
  /**
   * Stock on hand, for the lot pickers and for the figures the table shows
   * against a chosen lot. Only USABLE lots can be dispensed.
   */
  lots?: ProductionStockLot[];
}) {
  const [state, action, pending] = useActionState(issueMaterialAction, IDLE);

  useReportOnSaved(state);

  // THE NEWEST work order, which the orders endpoint returns first. It used to
  // open on `orders.at(-1)` — the oldest — on the reasoning that the longest-
  // waiting order is the one to dispense next. In practice somebody raises a
  // work order and goes straight to dispensing against it, so the one just
  // created is the one meant.
  //
  // Must stay in step with the plan the panel preloads, which is computed for
  // the same order; picking a different one here would show a plan for an
  // order the form is not on.
  const [orderId, setOrderId] = useState(orders[0]?.id ?? '');

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

  /**
   * itemId -> the lot rows open for it. Absent means "use FEFO", which is why
   * this is a map of the exceptions rather than a flag per line.
   *
   * A LIST OF ROW IDS, not a count. A count cannot express removing the middle
   * row of three: the rows are named `override.<itemId>.<n>.lotId`, so dropping
   * the count from 3 to 2 deletes the LAST row, and every value below the one
   * actually removed shifts up onto the wrong lot. Each row now carries an id
   * that never changes, so removing one takes its own quantity with it and
   * leaves the others where they were.
   */
  const [rows, setRows] = useState<Record<string, number[]>>({});

  // Ever-increasing, so a removed row's id is never reused — reusing one would
  // let a new row inherit the quantity left behind in `typed` under that key.
  const nextRowId = useRef(0);

  // `override.<itemId>.<rowId>.lotId` -> the lot currently chosen in that select.
  //
  // Tracked in state rather than read off the DOM because the Reason field's
  // visibility depends on it: US-PROD-02 wants a reason only when the actual
  // batch differs from the suggested one, so the form has to know what is
  // selected as it changes, not merely on submit.
  const [picked, setPicked] = useState<Record<string, string>>({});

  /**
   * `override.<itemId>.<rowId>.quantity` -> what is typed in that box.
   *
   * IN STATE because a row can now be removed. An uncontrolled input keeps its
   * value in the DOM against a name built from the row's position, so removing
   * a row re-numbers the survivors and each typed quantity lands on a different
   * lot than the one it was entered against — silently, and on a form that
   * decides what physically leaves the store.
   */
  const [typed, setTyped] = useState<Record<string, string>>({});

  const serverPlan = planState.data;

  /**
   * The plan as the table should CURRENTLY read it — the server's, with each
   * overridden material's allocations replaced by what is chosen below.
   *
   * WHY THIS EXISTS. The table at the top states what dispensing would consume:
   * which lot, its expiry, how much comes out of it. Picking a different lot in
   * the panel used to leave that table showing FEFO's proposal, so the two
   * halves of one screen disagreed about what was about to happen — and the
   * table is the half that looks authoritative.
   *
   * COMPUTED, NOT FETCHED. An earlier attempt refetched the plan behind a Save
   * button, which meant asking the server to re-derive something already known
   * here, and left a window where the panel and the table were out of step. The
   * override IS the answer; the table just has to show it.
   *
   * Only materials with rows open are touched. A line nobody has overridden
   * keeps the server's allocation exactly as computed, shortfall included.
   */
  const plan = useMemo(() => {
    if (!serverPlan) return null;

    const overridden = Object.keys(rows);

    if (overridden.length === 0) return serverPlan;

    const lotsById = new Map(lots.map((lot) => [lot.id, lot]));

    const lines = serverPlan.lines.map((line) => {
      const openRows = rows[line.item.id];

      if (!openRows || openRows.length === 0) return line;

      const allocations = openRows
        .map((rowId, row) => {
          const lotId =
            picked[`override.${line.item.id}.${rowId}.lotId`] ?? line.allocations[row]?.lotId ?? '';
          const lot = lotsById.get(lotId);

          if (!lot) return null;

          /**
           * What is TYPED, falling back to what FEFO proposed for this lot.
           *
           * THE FALLBACK IS THE POINT. An untouched box does not mean "dispense
           * nothing from this lot" — it means the suggestion still stands, and
           * reading it as zero made the From lot column drop to 0 the instant
           * somebody opened the panel or pressed Add a lot, before they had
           * typed anything at all. The table appeared to lose the plan merely
           * because it was being looked at.
           *
           * Matched by LOT, not by row position: a row whose dropdown has been
           * changed inherits the figure FEFO gave that same lot if it proposed
           * one, and nothing otherwise.
           */
          const entered = typed[`override.${line.item.id}.${rowId}.quantity`]?.trim();
          const suggestedQuantity = line.allocations.find(
            (allocation) => allocation.lotId === lot.id,
          )?.quantity;

          const quantity = entered === undefined || entered === '' ? suggestedQuantity : entered;

          return {
            lotId: lot.id,
            lotNumber: lot.lotNumber,
            expiryDate: lot.expiryDate,
            // A lot FEFO never proposed and nobody has given a figure for
            // contributes nothing yet — there is no number to show.
            quantity: quantity ?? '0',
            quantityAvailable: lot.quantityAvailable,
            // Marked against FEFO's own proposal for this line, which is what
            // decides whether a reason is asked for.
            isFefoOverride: !line.allocations.some((allocation) => allocation.lotId === lot.id),
          };
        })
        .filter((allocation): allocation is NonNullable<typeof allocation> => allocation !== null);

      const allocated = allocations.reduce(
        (total, allocation) => total + (Number(allocation.quantity) || 0),
        0,
      );
      const required = Number(line.quantityRequired) || 0;
      // Never negative: dispensing MORE than required is not a shortfall, and
      // "-2 KG short" would read as a deficit rather than a surplus.
      const short = Math.max(required - allocated, 0);

      return {
        ...line,
        allocations,
        quantityAllocated: String(allocated),
        // Matched to the '0' the server sends, which the table tests against
        // to decide between a dash and a red figure.
        quantityShort: short === 0 ? '0' : String(short),
      };
    });

    return {
      ...serverPlan,
      lines,
      // RECOMPUTED, not carried over. `canIssue` gates the shortfall warning
      // and the submit button, and the server's answer describes ITS FEFO plan
      // — keeping it would let the table show every line covered while the
      // warning above still said the issue was short, or the reverse. The
      // server decides for real when the form is submitted; this only keeps the
      // screen honest with itself.
      canIssue: lines.every((line) => line.quantityShort === '0'),
    };
  }, [serverPlan, rows, picked, typed, lots]);

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

  const overriding = Object.keys(rows).length > 0;

  /**
   * The ownership bucket this order may draw from.
   *
   * MIRRORS `stockBucketFor` ON THE API: a plain work order consumes company
   * stock, and a job-work order consumes whichever bucket its billing model
   * pins — PURE_CONVERSION the principal's own material, OWN_PROCUREMENT ours.
   *
   * Without it the panel listed every USABLE lot of the material, including
   * ones the order cannot touch. Picking one put it into the plan table above
   * as though FEFO had allocated it, and the save was then refused with "Lot …
   * is principal-owned stock" — a lot this screen had offered and displayed.
   */
  const bucket: StockOwnership =
    order?.jobWork?.billingModel === 'PURE_CONVERSION' ? 'PRINCIPAL_OWNED' : 'COMPANY_OWNED';

  /**
   * The lots this order could actually be dispensed from.
   *
   * Why Number() on a decimal string, when this file otherwise never does
   * arithmetic on one: it decides whether to OFFER a lot, and no value derived
   * from it is sent anywhere. The quantity dispensed is the string the operator
   * types, untouched.
   *
   * The ownership test is a CLIENT-SIDE MIRROR, not the enforcement. The API
   * narrows principal-owned stock further, to receipts against this specific
   * job-work order, which the lot view does not carry — so this can still
   * offer a lot the server refuses, with a message that says why. What it no
   * longer does is offer one that is refused for the ownership reason alone.
   */
  const usableLotsFor = (itemId: string, allocated: readonly string[] = []) => {
    const offered = lots.filter(
      (lot) =>
        lot.item.id === itemId &&
        lot.status === 'USABLE' &&
        lot.ownership === bucket &&
        Number(lot.quantityAvailable) > 0,
    );

    // ANYTHING THE PLAN ALREADY CHOSE IS OFFERED, whatever the filter makes of
    // it. The server decided that lot was dispensable, and a dropdown that
    // cannot show the row's own selected value falls back to `--None--` —
    // losing the suggestion and inventing a deviation nobody made. The filter
    // narrows what can be ADDED; it must never drop what is already proposed.
    const missing = allocated.filter((lotId) => !offered.some((lot) => lot.id === lotId));

    if (missing.length === 0) return offered;

    return [...offered, ...lots.filter((lot) => missing.includes(lot.id))];
  };

  return (
    <form action={action} className="space-y-4 border-t border-slate-200 px-6 py-5">
      <input type="hidden" name="orderId" value={orderId} />

      <Result state={state} pending={pending} />

      {/* US-PROD-02's first two fields, plus the choice of what to dispense
          against. The work order is a PICKER now: this form used to be handed
          one order and no way to reach the others. */}
      <div className="grid items-end gap-4 sm:grid-cols-2">
        <ReadOnlyField
          label="Issue No."
          value={issueNumber ? <span className="font-mono">{issueNumber}</span> : undefined}
          placeholder="…"
        />

        <div>
          <label htmlFor="issue-order" className={LABEL}>
            Work Order
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
            required
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
          message the operator sees before the request is made.

          FROM `serverPlan`, NOT `plan`. `plan` is the overlay that follows what
          is chosen below, so reading it here posted the operator's own picks as
          though FEFO had proposed them — every choice then looked like a
          confirmation, and the reason a departure requires was never asked for
          on either side. */}
      {serverPlan?.lines.map((line) => (
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
              /**
               * WHAT FEFO PROPOSED, from the server's plan rather than from
               * `line`.
               *
               * `line` belongs to the overlay, which is rebuilt from whatever
               * is chosen in this panel — so reading its allocations here meant
               * the suggestion became "whatever you just picked". Every lot
               * showed `· suggested` the moment it was selected, and
               * `deviates` below could never be true, so the reason field a
               * departure requires never appeared.
               */
              const proposed =
                serverPlan?.lines.find((entry) => entry.item.id === line.item.id)?.allocations ??
                [];
              const suggested = new Set(proposed.map((allocation) => allocation.lotId));

              const candidates = usableLotsFor(
                line.item.id,
                proposed.map((allocation) => allocation.lotId),
              );

              const openRows = rows[line.item.id] ?? [];

              // Whether any open row names a lot FEFO did not propose. This is
              // the "Actual Batch ≠ Suggested Batch" of US-PROD-02, and it is
              // what decides whether a reason is asked for — mirroring the same
              // comparison the API makes before it will accept the issue.
              //
              // The row's POSITION still picks the fallback suggestion, because
              // FEFO proposes an ordered list; its stable id only names the
              // field.
              const deviates = openRows
                .map((rowId, row) => {
                  const chosen =
                    picked[`override.${line.item.id}.${rowId}.lotId`] ?? proposed[row]?.lotId ?? '';

                  return chosen !== '' && !suggested.has(chosen);
                })
                .some(Boolean);

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

                    {/* Only the mode toggle sits by the material name. "Add a
                        lot" lives UNDER the rows instead — see below: it adds
                        to the bottom of the list, so that is where the eye
                        already is once the last row has been filled in. */}
                    <button
                      type="button"
                      onClick={() =>
                        setRows((current) => {
                          const next = { ...current };

                          if (openRows.length > 0) delete next[line.item.id];
                          else next[line.item.id] = [nextRowId.current++];

                          return next;
                        })
                      }
                      disabled={candidates.length === 0}
                      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {candidates.length === 0
                        ? 'No usable lots'
                        : openRows.length > 0
                          ? 'Use the suggestion'
                          : 'Choose lots myself'}
                    </button>
                  </div>

                  {openRows.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {openRows.map((rowId, row) => {
                        const field = `override.${line.item.id}.${rowId}.lotId`;
                        const quantityField = `override.${line.item.id}.${rowId}.quantity`;
                        // The FEFO proposal for this row, which the select starts
                        // on — "Actual Batch Issued, manually confirmed, defaults
                        // to the suggestion". It used to start blank, so opening
                        // the panel discarded the suggestion and made every issue
                        // a from-scratch decision.
                        const fallback = proposed[row]?.lotId ?? '';
                        const current = picked[field] ?? fallback;

                        // The quantity FEFO proposed FOR THE LOT NOW SHOWING,
                        // which the box starts on for the same reason the
                        // dropdown starts on the lot: confirming the suggestion
                        // should not mean retyping it. Matched by lot rather
                        // than by row, so changing the dropdown to another
                        // proposed lot brings that lot's figure with it.
                        const suggestedQuantity =
                          proposed.find((allocation) => allocation.lotId === current)?.quantity ??
                          '';

                        return (
                          <div key={rowId} className="flex flex-wrap items-end gap-2">
                            <div className="min-w-[16rem] flex-1">
                              <label htmlFor={`lot-${line.item.id}-${rowId}`} className="sr-only">
                                Lot of {line.item.code}
                              </label>
                              <select
                                id={`lot-${line.item.id}-${rowId}`}
                                name={field}
                                value={current}
                                onChange={(event) =>
                                  setPicked((now) => ({ ...now, [field]: event.target.value }))
                                }
                                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                              >
                                {/* `--None--`, the same word every other
                                    unchosen dropdown in the application uses.
                                    "Select a lot…" was an instruction where the
                                    rest of the forms state a value, so the one
                                    empty state looked different here. */}
                                <option value="">--None--</option>
                                {candidates.map((lot) => (
                                  <option key={lot.id} value={lot.id}>
                                    {lot.lotNumber} · {lot.quantityAvailable} {line.item.uom} ·{' '}
                                    {lot.expiryDate
                                      ? `exp ${formatDateDMY(lot.expiryDate)}`
                                      : 'no expiry'}
                                    {suggested.has(lot.id) ? ' · suggested' : ''}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="w-36">
                              <label htmlFor={`qty-${line.item.id}-${rowId}`} className="sr-only">
                                Quantity from this lot
                              </label>
                              <input
                                id={`qty-${line.item.id}-${rowId}`}
                                name={quantityField}
                                // Controlled, so removing a row takes this value
                                // with it — see the note on `typed`. Falls back
                                // to the suggestion until somebody types, so the
                                // box agrees with the From lot column above
                                // rather than sitting empty beside a figure the
                                // table is already showing. The posted value is
                                // whatever is displayed, fallback included.
                                value={typed[quantityField] ?? suggestedQuantity}
                                onChange={(event) =>
                                  setTyped((now) => ({
                                    ...now,
                                    [quantityField]: event.target.value,
                                  }))
                                }
                                inputMode="decimal"
                                placeholder={`0 ${line.item.uom}`}
                                pattern="\d{1,11}(\.\d{1,3})?"
                                title="A positive number, up to 3 decimal places"
                                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                              />
                            </div>

                            {/* REMOVE, on every row rather than only the last.
                                Taking a lot back out used to mean clearing the
                                whole material and starting again, because the
                                only way back was "Use the suggestion". The row's
                                own quantity and chosen lot go with it. */}
                            <button
                              type="button"
                              onClick={() => {
                                setRows((current) => {
                                  const left = (current[line.item.id] ?? []).filter(
                                    (id) => id !== rowId,
                                  );
                                  const next = { ...current };

                                  // The last row removed means "use the
                                  // suggestion again" — an open panel with no
                                  // rows in it would offer nothing to do.
                                  if (left.length === 0) delete next[line.item.id];
                                  else next[line.item.id] = left;

                                  return next;
                                });

                                setPicked((now) => {
                                  const next = { ...now };
                                  delete next[field];
                                  return next;
                                });

                                setTyped((now) => {
                                  const next = { ...now };
                                  delete next[quantityField];
                                  return next;
                                });
                              }}
                              className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}

                      {/* UNDER THE ROWS, because that is where the row it adds
                          will appear. It sat beside the material name for a
                          while, which put it above the list it extends — and
                          before that at the end of the last row, wedged between
                          a quantity box and Remove. Adding to the bottom of a
                          list belongs at the bottom of the list.

                          Hidden once every usable lot of this material is
                          already named: there would be nothing left to add. */}
                      {candidates.length > openRows.length && (
                        <button
                          type="button"
                          onClick={() =>
                            setRows((current) => ({
                              ...current,
                              [line.item.id]: [...openRows, nextRowId.current++],
                            }))
                          }
                          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Add a lot
                        </button>
                      )}

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

                          {/* WHY the reason is wanted, said HERE rather than in
                              the refusal. The error that fires when this is left
                              blank is now one short line — by the time somebody
                              reads a red banner they want the one thing to do,
                              not the rationale. The rationale belongs beside the
                              field, where it is read before the mistake. */}
                          <p className="mt-1 text-xs text-amber-800">
                            The suggestion is the nearest-expiry lot, so departing from it has to be
                            explainable later.
                          </p>
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
          <tr className="border-b border-slate-200 bg-slate-50 text-[11px] tracking-wide text-slate-500">
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
                    {/* KEYED BY POSITION, not by lot. The server never lists a
                        lot twice within a line, but the manual panel lets two
                        rows name the same one — and duplicate keys would make
                        React collapse them, throwing the three stacked columns
                        out of step with each other. Position is stable here:
                        these three lists are rendered from one array. */}
                    {line.allocations.map((allocation, index) => (
                      <li key={index} className="font-mono text-xs text-slate-700">
                        {allocation.lotNumber}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="px-4 py-3">
                <ul className="space-y-1.5">
                  {line.allocations.map((allocation, index) => (
                    <li key={index} className="flex items-center gap-x-2">
                      {/* A stock lot's expiry is optional — cartons and
                          leaflets usually have none. "no expiry" is the fact,
                          and it differs from a missing value: FEFO
                          deliberately keeps such lots until last. */}
                      {allocation.expiryDate ? (
                        <>
                          <span className="text-xs text-slate-500">
                            {formatDateDMY(allocation.expiryDate)}
                          </span>
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
                  {line.allocations.map((allocation, index) => (
                    <li key={index}>
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
  //
  // A NATIVE date input, which draws its placeholder and its picker in the
  // BROWSER's locale: on a machine set to US English it reads "mm/dd/yyyy",
  // and no attribute or stylesheet changes that. A typed DD-MM-YYYY box was
  // tried instead and reverted — it cost the calendar, the phone date wheel
  // and the browser's own validation to fix the label alone. Setting the
  // browser's language to English (India) fixes the display here and on the
  // twenty-odd other date fields at once.
  const [manufacturedOn, setManufacturedOn] = useState('');

  const order = orders.find((candidate) => candidate.id === orderId) ?? orders[0];
  const effectiveDate = manufacturedOn || new Date().toISOString().slice(0, 10);
  const expiry = order ? previewExpiry(effectiveDate, order.product.shelfLifeMonths) : null;

  // Reached whenever the button is pressed with nothing waiting — the register
  // offers it unconditionally, so this is the explanation rather than a case
  // that should never happen.
  if (orders.length === 0) {
    return (
      <div className="px-6 py-5">
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          There is no material issued record. A batch record traces what went into the batch, so
          material has to be dispensed against a work order before one can be opened.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4 px-6 py-5">
      <Result state={state} pending={pending} />

      {/* `items-end` so the CONTROLS line up along one baseline however tall
          each label turns out to be. "Actual quantity manufactured" wraps to
          two lines where "Work order" takes one, and without this the short
          labels left their inputs riding high above the long one's — three
          boxes at three different heights across one row. */}
      <div className="grid items-end gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="productionOrderId" className={LABEL}>
            Work Order
          </label>
          {/* `FIELD`, the same class the two inputs beside it use. Left to its
              own default this control is `field-sm` and carries no top margin,
              so it sat shorter than its neighbours and hard against its label
              while theirs had a gap — three boxes of two heights across one
              row. */}
          <SearchableSelect
            id="productionOrderId"
            options={orders.map((candidate) => ({
              value: candidate.id,
              label: `${candidate.orderNumber} — ${candidate.product.code}`,
            }))}
            required
            value={orderId}
            onChange={setOrderId}
            className={FIELD}
          />
          <input type="hidden" name="productionOrderId" value={orderId} />
        </div>

        <div>
          <label htmlFor="actualQuantity" className={LABEL}>
            Actual Quantity Manufactured
            <RequiredMark />
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
            Manufacturing Date{' '}
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
        <ReadOnlyField label="Batch No." hint="Per the company numbering convention." />

        <ReadOnlyField
          label="Planned Material Use"
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
          label="Expiry Date"
          value={expiry ? formatDateDMY(expiry) : undefined}
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
  packedQuantity = null,
  rejectedQuantity = null,
  packVariant = null,
  packagingConsumed = [],
}: {
  batchId: string;
  batchNumber: string;
  /** The product's active specifications. Empty for a product with none. */
  packSpecifications?: PackSpecification[];
  /**
   * WHAT IS ALREADY RECORDED, so the form shows it back.
   *
   * Packing can be entered, then corrected — the form stays on the batch until
   * the quality gate rules. It used to come back EMPTY after a save: the value
   * was stored and shown in the "Packed" figure above, but the box someone had
   * just typed it into was blank again, which reads as the entry having been
   * thrown away. Worse, the next save had to retype every field, and a blank
   * box beside a filled figure invites the two being made to disagree.
   */
  packedQuantity?: string | null;
  rejectedQuantity?: string | null;
  packVariant?: string | null;
  /**
   * What was counted per component last time, keyed by item id.
   *
   * Without this an amendment reopened with every component box EMPTY, and
   * saving from there wiped the figures — the API replaces the consumption
   * rows wholesale, so a blank box is not "unchanged", it is "none used".
   */
  packagingConsumed?: { itemId: string; quantityConsumed: string }[];
}) {
  const [state, action, pending] = useActionState(recordPackingAction, IDLE);

  // WHAT WAS RECORDED, or nothing chosen.
  //
  // It used to open on the first specification even for an unpacked batch,
  // which recorded a presentation nobody had picked — and with several variants
  // on file, the one that happened to sort first was as likely to be wrong as
  // right. The "Packaging consumed" rows below key off this, so a variant
  // standing there unasked also decided which components got counted.
  //
  // A batch that HAS been packed is different: its variant is a fact, and
  // showing it back is what makes a correction an edit rather than a re-entry.
  const [variant, setVariant] = useState(packVariant ?? '');

  const specification = packSpecifications.find((entry) => entry.packVariant === variant);

  /**
   * What was counted for one component last time, or '' if nothing was.
   *
   * BY ITEM ID rather than by row position: the rows are drawn from the pack
   * specification and the stored figures are keyed by item, so matching on
   * order would put a carton count in the leaflet box the moment a
   * specification changed.
   */
  const consumedFor = (itemId: string) =>
    packagingConsumed.find((entry) => entry.itemId === itemId)?.quantityConsumed ?? '';

  /**
   * Whether packing has been recorded for this batch.
   *
   * `packedQuantity` is the signal because it is the one field the record
   * cannot exist without — rejects and the variant are both optional.
   */
  const recorded = packedQuantity !== null;

  /**
   * A RECORD ONCE SAVED, a form only while being changed.
   *
   * A completed packing record left sitting as an open form reads as unsaved
   * work: every figure in an input box, a Save button underneath, and nothing
   * saying the entry had already been accepted. It also invited a second
   * submission of the same numbers.
   *
   * So a saved record shows as figures with an Edit button, and the form comes
   * back only when Edit is pressed. Correcting one is still allowed — the API
   * upserts — but it is now a deliberate act rather than the default state.
   */
  const [editing, setEditing] = useState(false);

  // Back to the record after a successful save, so the figures just entered are
  // confirmed rather than left in boxes. `state.ok` alone is not enough: the
  // idle state is `{ ok: true }` with no message, which would close the form
  // the moment it opened.
  const savedMessage = state.ok ? state.message : undefined;

  useEffect(() => {
    if (savedMessage) setEditing(false);
  }, [savedMessage]);

  if (recorded && !editing) {
    return (
      <>
        {/* ONE Result, in the SAME POSITION in both branches, so React keeps
            the one instance across the switch between record and form rather
            than unmounting and remounting it.

            Both halves of that matter. It must survive the save that flips
            `recorded`, or the dialog is taken away before it can appear. And it
            must not remount on Edit/Cancel, or it re-announces the last save —
            `useActionState` holds that result for the life of the form, so a
            fresh instance reads a stale message as news. */}
        <Result state={state} pending={pending} />

        <PackingRecordSummary
          packedQuantity={packedQuantity}
          rejectedQuantity={rejectedQuantity}
          packVariant={packVariant}
          consumed={packagingConsumed.map((entry) => {
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
          matches children by position, so keeping this one in slot 0 of both
          returns is what makes it the SAME instance either side of the switch
          rather than a new one. See the note there. */}
      <Result state={state} pending={pending} />

      <form action={action} className="space-y-3 rounded-md bg-slate-50 p-4">
        <input type="hidden" name="batchId" value={batchId} />

        {/* Linked BMR, quantity and variant on one row — US-PROD-04 lists them
          together and they are read together: what this packing is against,
          how much came off the line, and which presentation was run. The BMR
          link is structural (this form only exists inside a batch that has
          one), but the story names it as a field and a packing record that
          does not say which batch it belongs to is one nobody can check. */}
        <div className="grid items-end gap-3 sm:grid-cols-3">
          <ReadOnlyField
            label="Linked BMR"
            value={<span className="font-mono">{batchNumber}</span>}
          />

          <div>
            <label htmlFor={`packed-${batchId}`} className={LABEL}>
              Finished Pack Quantity
              <RequiredMark />
            </label>
            <input
              // KEYED ON THE SAVED VALUE, so the control is remounted when it
              // changes. React 19 resets the form once the action resolves and an
              // input re-reads `defaultValue` only at mount — without the key the
              // box would come back empty holding the previous render's default.
              key={`packed-${packedQuantity ?? ''}`}
              id={`packed-${batchId}`}
              name="packedQuantity"
              defaultValue={packedQuantity ?? ''}
              required
              inputMode="decimal"
              pattern="\d{1,11}(\.\d{1,3})?"
              title="A positive number, up to 3 decimal places"
              className={FIELD}
            />
          </div>

          <div>
            {/* REQUIRED when there are specifications to choose from, optional
              when there are none. The variant decides which components the
              "Packaging consumed" rows below offer, so saving without one
              stores a record whose consumption cannot be reconstructed — and
              the rows somebody had just filled in are dropped on the way. With
              no specification on file there is nothing to pick and the run
              still has to be recorded, so there it is free text. */}
            <label htmlFor={`variant-${batchId}`} className={LABEL}>
              Pack Variant
              {packSpecifications.length === 0 ? (
                <span className="font-normal normal-case text-slate-400"> (optional)</span>
              ) : (
                <RequiredMark />
              )}
            </label>

            {packSpecifications.length === 0 ? (
              // No specification on file, so there is nothing to choose from and
              // the run still has to be recorded. Free text, and no component
              // rows — the form cannot invent which components a pack uses.
              <input
                key={`variant-${packVariant ?? ''}`}
                id={`variant-${batchId}`}
                name="packVariant"
                defaultValue={packVariant ?? ''}
                placeholder="10 x 10 blister carton"
                className={FIELD}
              />
            ) : (
              <select
                id={`variant-${batchId}`}
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
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor={`rejected-${batchId}`} className={LABEL}>
              Rejects <span className="font-normal normal-case text-slate-400">(optional)</span>
            </label>
            <input
              key={`rejected-${rejectedQuantity ?? ''}`}
              id={`rejected-${batchId}`}
              name="rejectedQuantity"
              defaultValue={rejectedQuantity ?? ''}
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
            <legend className="px-1 text-xs font-medium tracking-wide text-slate-600">
              Packaging Consumed
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
                      // KEYED ON THE STORED FIGURE, so the control is remounted
                      // when it changes: React 19 resets the form once the action
                      // resolves and an input re-reads `defaultValue` only at
                      // mount, so without this an amendment would show the value
                      // from the previous render.
                      key={`consumed-${consumedFor(component.id)}`}
                      id={`consumed-${batchId}-${index}`}
                      name={`component.${index}.quantityConsumed`}
                      defaultValue={consumedFor(component.id)}
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

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={pending} className={BUTTON}>
            {pending ? 'Saving…' : 'Save'}
          </button>

          {/* Only when AMENDING. A first entry has nothing to go back to, so a
            Cancel there would be a button that does nothing visible. */}
          {recorded && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={pending}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          )}
        </div>
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
 * Edit is offered because the API allows an amendment right up until the
 * quality gate rules; after that the whole form is absent and the tab says so,
 * so there is no case here where this button appears but cannot be used.
 */
export function PackingRecordSummary({
  packedQuantity,
  rejectedQuantity,
  packVariant,
  consumed = [],
  onEdit,
}: {
  packedQuantity: string;
  rejectedQuantity: string | null;
  packVariant: string | null;
  /**
   * What the pack consumed, ready to display. Empty when nothing was counted,
   * and the section is then left out rather than shown with no rows — a run
   * whose components were never counted has nothing to report here.
   */
  consumed?: { label: string; quantity: string }[];
  /**
   * Omitted once the batch has been through the quality gate: the API refuses
   * an amendment then, so the button would be a control that cannot work. The
   * figures stay readable either way — what was packed is part of the batch's
   * history, and a decided batch is exactly when somebody looks it up.
   */
  onEdit?: () => void;
}) {
  return (
    <div className="space-y-3 rounded-md bg-slate-50 p-4">
      {/* FOUR COLUMNS, the last holding Edit. The three figures left a gap
          where a fourth would be, and putting the button there uses it rather
          than adding a row below — which is also where the eye lands after
          reading across the record.

          The sentence that sat beside it is gone: Edit being offered says the
          record can still be changed, and a line repeating that in words is
          read once and then never again. */}
      {/* The button is a SIBLING of the list, not a cell inside it: a <dl> may
          hold only terms and descriptions, and a <div> wrapping a button is
          neither. The grid lives on this wrapper instead, so the four columns
          line up exactly as they would have. */}
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
        </dl>

        {onEdit && (
          <div className="sm:justify-self-end">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* THE RECALL TRAIL, which the figures above do not carry: what went into
          this batch, from which component. Shown on the record rather than
          only inside the form, so reading a finished batch does not mean
          opening it for editing to see what it consumed. */}
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

      {/* Kept for a DECIDED batch, where there is no Edit button to imply it.
          Without this the record would simply end, with nothing saying why it
          cannot be changed. */}
      {!onEdit && (
        <p className="border-t border-slate-200 pt-3 text-xs text-slate-500">
          This batch has been through the quality gate, so its packing record can no longer be
          changed.
        </p>
      )}
    </div>
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

  // NO CARD OF ITS OWN. This used to sit inline on the register, one per row,
  // where a bordered grey panel was what separated one batch's controls from
  // the next. It now opens in a drawer that is already a panel, and a second
  // border inside the first reads as a box somebody forgot to remove.
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="batchId" value={batchId} />

      <Result state={state} pending={pending} />

      <div>
        <label htmlFor={`release-notes-${batchId}`} className={LABEL}>
          Reason / Test Reference{' '}
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

        {/* HOLD AND REJECT ARE DIFFERENT DECISIONS. A batch held for a
            repeat assay may still be released next week; a rejected one never
            will. One button called "Block" could not record which had been
            meant, so neither could be reported on afterwards. Both refuse
            dispatch, and both need a reason. */}
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

        <p className="text-xs text-slate-600">
          {packedQuantity === null ? (
            <>No packing record yet, so there is no quantity to release into stock.</>
          ) : (
            <>
              Releasing adds <strong>{packedQuantity}</strong> {uom} of {batchNumber} to sellable
              stock. Holding withholds it pending further testing; rejecting withholds it for good.
              None of the three can be undone here.
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
      </div>
    </form>
  );
}
