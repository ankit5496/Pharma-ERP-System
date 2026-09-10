import type { UserRole } from './roles';
import type { WorkflowKey } from './workflows';

/**
 * The data tables a staff member can inspect from the record browser.
 *
 * One registry, one generic viewer. The point is that adding a table is a
 * dozen lines here rather than a new page, a new route and a new hand-written
 * <table> — the last of which is how a UI ends up with eight subtly different
 * ways to render a date.
 *
 * NAMES COME FROM THE SCHEMA, not from this file. `model` is the Prisma model
 * name and `table` is the physical table its `@@map` produces, so the dropdown
 * shows what actually exists in packages/database/prisma/schema.prisma rather
 * than a parallel vocabulary that can drift from it.
 *
 * Tables the schema does not have yet are listed with `kind: 'planned'`. They
 * are named after the roadmap stated at the top of schema.prisma (Item, Party,
 * Bom, Batch, purchase/production/sales) and are rendered as unselectable, so
 * the shape of the product is visible without implying there are rows behind
 * them. When a model lands, its entry swaps to an endpoint and the viewer
 * needs no change.
 *
 * Deliberately absent: PlatformUser and PlatformAuditLog. They are not tenant
 * data, the runtime `pharma_app` role is REVOKEd on both, and staff have no
 * business seeing the vendor's own operators.
 */

/** How a cell is formatted. Kept small on purpose; widen only when a table needs it. */
export type DatasetColumnType = 'text' | 'code' | 'datetime' | 'boolean' | 'role';

export interface DatasetColumn {
  /** Property name on the record as the API returns it. */
  key: string;
  label: string;
  type?: DatasetColumnType;
}

export type DatasetSource =
  | {
      kind: 'endpoint';
      /** API path, called server-side with the caller's own bearer token. */
      path: string;
      /**
       * Property of the response holding the records, when the endpoint
       * returns an envelope rather than a bare array. A picked value that is a
       * single object is rendered as a one-row table.
       */
      pick?: string;
      /**
       * Roles the API is known to allow. Used only to explain a refusal before
       * it happens — the authoritative check is `@Roles(...)` on the
       * controller, which runs whatever this says.
       */
      allowedRoles?: readonly UserRole[];
    }
  | { kind: 'planned' };

export interface Dataset {
  /** URL segment. Kebab-case of the model name. */
  key: string;
  /** Prisma model name, e.g. "AuditLog". */
  model: string;
  /** Physical Postgres table, from the model's `@@map`. */
  table: string;
  label: string;
  description: string;
  /** Which workflow this table mainly serves; 'core' for cross-cutting tables. */
  group: WorkflowKey | 'core';
  source: DatasetSource;
  /** Property to use as the React key. Falls back to the row index. */
  rowKey?: string;
  columns: readonly DatasetColumn[];
}

export const DATASETS: readonly Dataset[] = [
  // ---------------------------------------------------------------------------
  // Live — models that exist today, read through endpoints that already exist.
  // ---------------------------------------------------------------------------
  {
    key: 'users',
    model: 'User',
    table: 'users',
    label: 'Users',
    description: 'Everyone with a sign-in at this company.',
    group: 'core',
    // Admin-only at the API (`@Roles('ADMIN')` on UsersController, read routes
    // included). Listed for every role so the table is discoverable, with the
    // restriction stated rather than discovered through a 403.
    source: { kind: 'endpoint', path: '/api/v1/users', allowedRoles: ['ADMIN'] },
    rowKey: 'id',
    columns: [
      { key: 'fullName', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'role', label: 'Role', type: 'role' },
      { key: 'status', label: 'Status' },
      { key: 'phone', label: 'Phone' },
      { key: 'mustChangePassword', label: 'Must change password', type: 'boolean' },
      { key: 'isLocked', label: 'Locked out', type: 'boolean' },
      { key: 'lastLoginAt', label: 'Last sign-in', type: 'datetime' },
      { key: 'createdAt', label: 'Created', type: 'datetime' },
    ],
  },
  {
    key: 'tenant',
    model: 'Tenant',
    table: 'tenants',
    label: 'Company',
    description: 'Your own company record. Row-level security scopes this to one row.',
    group: 'core',
    source: { kind: 'endpoint', path: '/api/v1/dashboard', pick: 'company' },
    rowKey: 'slug',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'slug', label: 'Slug', type: 'code' },
      { key: 'status', label: 'Status' },
      { key: 'drugLicenceNumber', label: 'Drug licence', type: 'code' },
      { key: 'timezone', label: 'Timezone', type: 'code' },
    ],
  },
  {
    key: 'audit-logs',
    model: 'AuditLog',
    table: 'audit_logs',
    label: 'Audit trail',
    description:
      'Recent recorded changes. Append-only — nobody, including an Admin, can edit these.',
    group: 'core',
    // The dashboard already returns this, role-scoped by the API: everything at
    // the company for ADMIN and MANAGEMENT, your own activity otherwise. Reused
    // rather than adding an endpoint, so no API surface changes for a UI feature.
    source: { kind: 'endpoint', path: '/api/v1/dashboard', pick: 'recentActivity' },
    rowKey: 'id',
    columns: [
      { key: 'at', label: 'When', type: 'datetime' },
      { key: 'action', label: 'Action' },
      { key: 'entityType', label: 'Entity' },
      { key: 'entityId', label: 'Record', type: 'code' },
      { key: 'actor', label: 'Actor' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Planned — named after the roadmap in schema.prisma. No rows behind these.
  // ---------------------------------------------------------------------------
  {
    key: 'items',
    model: 'Item',
    table: 'items',
    label: 'Items',
    description: 'Raw materials, packaging and finished products.',
    group: 'core',
    source: { kind: 'planned' },
    columns: [],
  },
  {
    key: 'parties',
    model: 'Party',
    table: 'parties',
    label: 'Parties (suppliers & customers)',
    description:
      'One register for suppliers, distributors and job-work principals, rather than three tables that drift apart.',
    group: 'core',
    source: { kind: 'planned' },
    columns: [],
  },
  {
    key: 'purchase-orders',
    model: 'PurchaseOrder',
    table: 'purchase_orders',
    label: 'Purchase orders',
    description: 'Orders placed on a supplier.',
    group: 'procure-to-pay',
    source: { kind: 'planned' },
    columns: [],
  },
  {
    key: 'goods-receipts',
    model: 'GoodsReceipt',
    table: 'goods_receipts',
    label: 'Goods receipts',
    description: 'Material received against a purchase order.',
    group: 'procure-to-pay',
    source: { kind: 'planned' },
    columns: [],
  },
  {
    key: 'boms',
    model: 'Bom',
    table: 'boms',
    label: 'Formulations (BOM)',
    description: 'Bills of material and their versions.',
    group: 'production-quality',
    source: { kind: 'planned' },
    columns: [],
  },
  {
    key: 'batches',
    model: 'Batch',
    table: 'batches',
    label: 'Batches',
    description: 'Manufactured batches, their status and expiry.',
    group: 'production-quality',
    source: { kind: 'planned' },
    columns: [],
  },
  {
    key: 'sales-orders',
    model: 'SalesOrder',
    table: 'sales_orders',
    label: 'Sales orders',
    description: 'Orders received from distributors.',
    group: 'order-to-cash',
    source: { kind: 'planned' },
    columns: [],
  },
  {
    key: 'shipments',
    model: 'Shipment',
    table: 'shipments',
    label: 'Shipments',
    description: 'Dispatches, traceable to the batches that went out.',
    group: 'order-to-cash',
    source: { kind: 'planned' },
    columns: [],
  },
  {
    key: 'job-work-orders',
    model: 'JobWorkOrder',
    table: 'job_work_orders',
    label: 'Job work orders',
    description: 'Manufacturing commissioned by another brand owner.',
    group: 'job-work',
    source: { kind: 'planned' },
    columns: [],
  },
];

export function findDataset(key: string): Dataset | undefined {
  return DATASETS.find((dataset) => dataset.key === key);
}

export function isDatasetReadable(dataset: Dataset): boolean {
  return dataset.source.kind === 'endpoint';
}

/**
 * Whether the API is expected to let this role read the table.
 *
 * A hint for the UI only. The endpoint enforces its own rule regardless, and a
 * false positive here shows up as the 403 the viewer already renders.
 */
export function mayReadDataset(dataset: Dataset, role: UserRole): boolean {
  if (dataset.source.kind !== 'endpoint') return false;
  return dataset.source.allowedRoles ? dataset.source.allowedRoles.includes(role) : true;
}
