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
 * Mirrors `WidgetState` in ./dashboard and exists for the same reason: the
 * domain tables (Item, Party, Bom, Batch, purchase/production/sales) are not
 * built yet, and a step that renders an honest "not built yet" panel beats one
 * that shows an empty table. An empty table is a claim — "there are no open
 * purchase orders" — and in a pharma system a wrong claim is worse than a
 * visible gap.
 */
export type WorkflowStepState = 'ready' | 'planned';

export interface WorkflowStep {
  /** URL segment, unique within its workflow. */
  key: string;
  label: string;
  /** One line on what happens at this step. Rendered as the page's subtitle. */
  purpose: string;
  state: WorkflowStepState;
}

export interface Workflow {
  key: WorkflowKey;
  label: string;
  /** Shown under the tab row, so the tab's scope is never in doubt. */
  purpose: string;
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
        key: 'requisitions',
        label: 'Purchase requisitions',
        purpose:
          'Raw materials below their reorder level, and the requisitions raised to restock them.',
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
    key: 'production-quality',
    label: 'Production & Quality Gate',
    purpose: 'Manufacturing a batch and clearing every quality check before it can be sold.',
    steps: [
      {
        key: 'formulations',
        label: 'Formulations',
        purpose: 'Bills of material and standard manufacturing instructions.',
        state: 'planned',
      },
      {
        key: 'production-orders',
        label: 'Production orders',
        purpose: 'What to make, how much, and against which formulation version.',
        state: 'planned',
      },
      {
        key: 'material-issue',
        label: 'Material issue',
        purpose: 'Dispensing raw material to the shop floor, lot by lot.',
        state: 'planned',
      },
      {
        key: 'batch-record',
        label: 'Batch record',
        purpose: 'The batch manufacturing record: every stage, signed as it happens.',
        state: 'planned',
      },
      {
        key: 'in-process-checks',
        label: 'In-process checks',
        purpose: 'Quality checks taken during manufacture, at defined control points.',
        state: 'planned',
      },
      {
        key: 'finished-goods-testing',
        label: 'Finished-goods testing',
        purpose: 'Final analytical testing against the product specification.',
        state: 'planned',
      },
      {
        key: 'batch-release',
        label: 'Batch release',
        purpose: 'The quality gate itself: release, hold or reject. Nothing ships before this.',
        state: 'planned',
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
        state: 'planned',
      },
      {
        key: 'sales-orders',
        label: 'Sales orders',
        purpose: 'Orders received from a distributor, priced and confirmed.',
        state: 'planned',
      },
      {
        key: 'allocation',
        label: 'Allocation',
        purpose: 'Reserving released batches against an order, respecting expiry order.',
        state: 'planned',
      },
      {
        key: 'dispatch',
        label: 'Dispatch',
        purpose: 'Picking, packing and shipping, recorded down to the batch.',
        state: 'planned',
      },
      {
        key: 'invoices',
        label: 'Invoices',
        purpose: 'Tax invoices raised against a dispatch.',
        state: 'planned',
      },
      {
        key: 'receipts',
        label: 'Receipts',
        purpose: 'Payments collected and applied to outstanding invoices.',
        state: 'planned',
      },
      {
        key: 'returns',
        label: 'Returns',
        purpose: 'Sales returns and recalls, traced back to the batch that shipped.',
        state: 'planned',
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
        state: 'planned',
      },
      {
        key: 'job-work-orders',
        label: 'Job work orders',
        purpose: 'What a principal has asked you to make, and on what terms.',
        state: 'planned',
      },
      {
        key: 'inward-materials',
        label: 'Inward materials',
        purpose: 'Material supplied by the principal, held on their account rather than yours.',
        state: 'planned',
      },
      {
        key: 'production',
        label: 'Production',
        purpose: 'Manufacturing against the order, kept separate from own-brand batches.',
        state: 'planned',
      },
      {
        key: 'quality-release',
        label: 'Quality & release',
        purpose: 'Testing and release, with results shared back to the principal.',
        state: 'planned',
      },
      {
        key: 'outward-dispatch',
        label: 'Outward dispatch',
        purpose: 'Returning finished goods to the principal, with the batch documentation.',
        state: 'planned',
      },
      {
        key: 'billing',
        label: 'Billing',
        purpose: 'Charging conversion and packing rather than the value of the goods.',
        state: 'planned',
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
