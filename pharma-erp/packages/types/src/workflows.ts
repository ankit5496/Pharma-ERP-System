/**
 * The four operational workflows the staff application is organised around.
 *
 * This is navigation structure, deliberately kept SEPARATE from `AppModule` /
 * `ROLE_MODULES` in ./auth. Those describe what a role is permitted to reach
 * and are read by the API's dashboard service; these describe how the staff UI
 * is laid out. Folding the two together would mean a purely visual change to
 * the tab bar altering an authorisation table.
 *
 * NO ROLE GATING TODAY, by product decision: every signed-in staff member sees
 * all four workflows and every sub-step. When permissions arrive they belong
 * here as an added field plus a check in the shell, not as a rewrite of the
 * structure. Note what that does and does not mean: hiding a tab was never a
 * security boundary anyway. The enforcement that matters is RolesGuard and
 * row-level security, both untouched by this file, so a step that eventually
 * calls a restricted endpoint is still refused at the API.
 */

/** Stable URL segment for each workflow. */
export type WorkflowKey = 'procure-to-pay' | 'production-quality' | 'order-to-cash' | 'job-work';

/**
 * Whether a step has a real screen behind it.
 *
 * Mirrors `WidgetState` in ./dashboard and exists for the same reason: a step
 * whose domain tables do not exist yet renders an honest "not built yet" panel
 * rather than an empty table. An empty table is a claim — "there are no open
 * purchase orders" — and in a pharma system a wrong claim is worse than a
 * visible gap.
 *
 * All seven Order-to-Cash steps are 'ready': their screens are built and wired
 * through @/components/order-to-cash. Their API endpoints are NOT built yet, so
 * each panel renders its heading, its create form and its table chrome, then an
 * ErrorState where the rows would be. That is deliberate — the failure is shown
 * where the data would have been, not disguised as an empty register.
 */
export type WorkflowStepState = 'ready' | 'planned';

export interface WorkflowStep {
  /** URL segment, unique within its workflow. */
  key: string;
  label: string;
  /**
   * One line on what happens at this step. Rendered as the page's subtitle and
   * as the sub-tab's hover title.
   *
   * OPTIONAL. A workflow whose screens say what they are — a register of tiles
   * with its own heading, a form whose fields are self-evident — does not need
   * a sentence above it explaining the obvious, and Production & Quality Gate
   * omits it throughout for that reason. Absent means nothing is rendered at
   * all, not an empty paragraph holding space.
   */
  purpose?: string;
  state: WorkflowStepState;
}

export interface Workflow {
  key: WorkflowKey;
  label: string;
  /** Shown under the tab row, so the tab's scope is never in doubt. Optional; see WorkflowStep.purpose. */
  purpose?: string;
  steps: readonly WorkflowStep[];
}

/**
 * Ordered as the work itself is ordered: each `steps` array reads down the
 * process, so the sub-tab bar doubles as a description of the flow.
 *
 * Adding a step later is a one-line change here — the routes are a single
 * dynamic segment and the sub-tab bar is generated from this list — which is
 * the point of holding the structure as data.
 */
export const WORKFLOWS: readonly Workflow[] = [
  {
    key: 'procure-to-pay',
    label: 'Procure-to-Pay',
    purpose:
      'Manage the complete process of procuring raw materials, from identifying low stock through vendor payment.',
    steps: [
      {
        // FIRST, because it is where the work starts. Nothing in this workflow
        // happens until something runs short, and a buyer opening the module
        // wants to see what needs buying before seeing what has been asked
        // for. It was a strip inside the requisitions screen; a shortage list
        // is worth its own table.
        key: 'low-stock',
        label: 'Low stock',
        purpose:
          'Items whose usable stock has fallen below their reorder level, and what is already on order for them.',
        state: 'ready',
      },
      {
        key: 'requisitions',
        label: 'Purchase requisitions',
        purpose: 'Requests to buy, raised by hand or automatically when stock runs low.',
        state: 'ready',
      },
      {
        key: 'purchase-orders',
        label: 'Purchase orders',
        purpose: 'Approved requisitions placed on a vendor, with rates, tax and delivery terms.',
        state: 'ready',
      },
      {
        key: 'goods-receipts',
        label: 'GRN',
        purpose: 'Material received against a purchase order, recorded batch by batch.',
        state: 'ready',
      },
      {
        key: 'incoming-qc',
        label: 'Incoming QC',
        purpose: 'The quality gate: each received batch is accepted, rejected or held.',
        state: 'ready',
      },
      {
        // AFTER Incoming QC, because that is the moment material becomes
        // stock. The ledger records what QC released, what it refused, and
        // what has since been consumed — read in the order the work actually
        // happens, it belongs here rather than at the end.
        key: 'stock-ledger',
        label: 'Raw material stock',
        purpose:
          'Batch-wise raw material stock and every movement behind it, in first-expiry-first-out order.',
        state: 'ready',
      },
      {
        key: 'invoices',
        label: 'Purchase invoices',
        purpose: 'Vendor invoices matched against the order and the receipt, with GST input tax.',
        state: 'ready',
      },
      {
        key: 'payments',
        label: 'Vendor payments',
        purpose: 'The payables ledger: what is outstanding, what is overdue, what has been paid.',
        state: 'ready',
      },
    ],
  },
  {
    // NO `purpose` ON THIS WORKFLOW OR ANY OF ITS STEPS, deliberately.
    //
    // Its screens carry their own headings and the tiles and tables say what
    // they hold, so the subtitle was restating the tab name in a longer form —
    // "Formulations" above "Bills of material and standard manufacturing
    // instructions." Removed at the product owner's request on 2026-09-17,
    // including the hover titles, which were the same sentence again.
    //
    // The other three workflows keep theirs. If they are ever dropped too, the
    // field becomes dead weight and should go from the interface rather than
    // being left as an option nobody takes.
    key: 'production-quality',
    label: 'Production & Quality Gate',
    steps: [
      {
        key: 'formulations',
        label: 'Formulations',
        state: 'ready',
      },
      {
        key: 'production-orders',
        label: 'Production orders',
        state: 'ready',
      },
      {
        key: 'material-issue',
        label: 'Material issue',
        state: 'ready',
      },
      {
        key: 'batch-record',
        label: 'Batch record',
        state: 'ready',
      },
      // REMOVED, NOT BUILT: 'in-process-checks' and 'finished-goods-testing'
      // sat here between the batch record and the release gate. They were
      // withdrawn from the navigation on 2026-09-15 at the product owner's
      // request, because a tab that only ever showed "not built yet" read as a
      // broken screen rather than as a gap.
      //
      // The gap itself is still real, and withdrawing the tabs does not close
      // it: a Quality Officer can release a batch with NO recorded test
      // results. The release decision captures who, when and why, but nothing
      // requires that in-process checks passed or that finished-goods testing
      // happened. Building them needs tables that do not exist — a product
      // specification master (what to test, and the acceptance limits), a
      // results table per batch per control point — and then the release gate
      // has to refuse a batch whose required tests have not passed.
      //
      // Restore them here when that work is scheduled; the placeholder
      // mechanism they used is still in place for the other workflows.
      {
        key: 'batch-release',
        label: 'Batch release',
        state: 'ready',
      },
    ],
  },
  {
    key: 'order-to-cash',
    label: 'Order-to-Cash',
    purpose: 'Selling finished product to distributors and collecting payment.',
    steps: [
      {
        key: 'customers',
        label: 'Customers',
        purpose: 'Distributors and stockists, with their drug licence details.',
        state: 'ready',
      },
      {
        key: 'sales-orders',
        label: 'Sales orders',
        purpose: 'Orders received from a distributor, priced and confirmed.',
        state: 'ready',
      },
      {
        key: 'allocation',
        label: 'Allocation',
        purpose: 'Reserving released batches against an order, respecting expiry order.',
        state: 'ready',
      },
      {
        key: 'dispatch',
        label: 'Dispatch',
        purpose: 'Picking, packing and shipping, recorded down to the batch.',
        state: 'ready',
      },
      {
        key: 'invoices',
        label: 'Invoices',
        purpose: 'Tax invoices raised against a dispatch.',
        state: 'ready',
      },
      {
        key: 'receipts',
        label: 'Receipts',
        purpose: 'Payments collected and applied to outstanding invoices.',
        state: 'ready',
      },
      {
        key: 'returns',
        label: 'Returns',
        purpose: 'Sales returns and recalls, traced back to the batch that shipped.',
        state: 'ready',
      },
    ],
  },
  {
    key: 'job-work',
    label: 'Job Work',
    purpose: 'Manufacturing batches on behalf of another brand owner, on their licence.',
    steps: [
      {
        key: 'principals',
        label: 'Principals',
        purpose: 'Brand owners you manufacture for, and the agreements that cover it.',
        state: 'ready',
      },
      {
        key: 'job-work-orders',
        label: 'Job work orders',
        purpose: 'What a principal has asked you to make, and on what terms.',
        state: 'ready',
      },
      {
        key: 'inward-materials',
        label: 'Inward materials',
        purpose: 'Material supplied by the principal, held on their account rather than yours.',
        state: 'ready',
      },
      {
        key: 'production',
        label: 'Production',
        purpose: 'Manufacturing against the order, kept separate from own-brand batches.',
        state: 'ready',
      },
      {
        key: 'quality-release',
        label: 'Quality & release',
        purpose: 'Testing and release, with results shared back to the principal.',
        state: 'ready',
      },
      {
        key: 'outward-dispatch',
        label: 'Outward dispatch',
        purpose: 'Returning finished goods to the principal, with the batch documentation.',
        state: 'ready',
      },
      {
        key: 'billing',
        label: 'Billing',
        purpose: 'Charging conversion and packing rather than the value of the goods.',
        state: 'ready',
      },
      {
        key: 'register',
        label: 'Job-work register',
        purpose:
          'Material received, consumed and dispatched per principal — derived from the ' +
          'transactions, never keyed in.',
        state: 'ready',
      },
    ],
  },
];

/** Where a signed-in staff member lands: the first workflow, first step. */
export const WORKFLOW_HOME = '/workflows/procure-to-pay/requisitions';

/** URL for a workflow, or for one step within it. */
export function workflowHref(workflow: WorkflowKey, step?: string): string {
  return step ? `/workflows/${workflow}/${step}` : `/workflows/${workflow}`;
}

export function findWorkflow(key: string): Workflow | undefined {
  return WORKFLOWS.find((workflow) => workflow.key === key);
}

export function findWorkflowStep(workflow: Workflow, key: string): WorkflowStep | undefined {
  return workflow.steps.find((step) => step.key === key);
}
