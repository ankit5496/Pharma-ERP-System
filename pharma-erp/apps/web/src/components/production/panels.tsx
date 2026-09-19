import type {
  BatchView,
  BomView,
  FinishedGoodsLotView,
  ItemSummary,
  MaterialIssuePlan,
  MaterialIssueView,
  PackagingRequirementView,
  ProductionStockLot,
  ProductionOrderSummary,
} from '@pharma-erp/types';

import { BatchRecords } from '@/components/production/batch-records';
import { FormulationTable } from '@/components/production/formulation-table';
import { IssueTable, StockTable } from '@/components/production/issue-table';
import { OrderTable } from '@/components/production/order-table';
import { ProductionRegister } from '@/components/production/register';
import {
  DecidedTable,
  PendingReleaseList,
  SellableStockTable,
} from '@/components/production/release-tables';
import { ProductionTabs } from '@/components/production/tabs';
import { apiFetch, type ApiResult } from '@/lib/api';
import { requireSession } from '@/lib/session';

import {
  CreateProductionOrderForm,
  IssueMaterialForm,
  type PackSpecification,
  RecordBatchForm,
  RecordPackingForm,
  ReleaseDecisionForm,
} from './forms';
import { EmptyState, LoadError, Panel } from './shared';

/**
 * The five built steps of Production & Quality Gate.
 *
 * Server components: each fetches what it needs with the caller's own bearer
 * token, so the API's role checks apply to the read as well as the write. A
 * step a role cannot read renders the API's refusal rather than an empty table
 * — the same reasoning as the workflow placeholders, that an empty table is a
 * claim and a wrong claim is worse than a visible gap.
 */

const get = <T,>(path: string): Promise<ApiResult<T>> =>
  apiFetch<T>(path, { authenticated: true, timeoutMs: 20_000 });

// ---------------------------------------------------------------------------
// 1. Formulations
// ---------------------------------------------------------------------------

export async function FormulationsPanel() {
  const result = await get<BomView[]>('/api/v1/production/boms');

  if (!result.ok)
    return (
      <Panel title="Formulations">
        <LoadError error={result.error} />
      </Panel>
    );

  const boms = result.data;

  if (boms.length === 0) {
    return (
      <Panel title="Formulations">
        <EmptyState>
          No formulations yet. Seed the demo data with <code>pnpm seed:production</code>, or create
          one through <code>POST /api/v1/production/boms</code>.
        </EmptyState>
      </Panel>
    );
  }

  // A row per product showing the version in force, expanding onto its
  // history. The rows are all fetched here, so expanding one costs no request —
  // see FormulationTable for why it groups rather than listing every version
  // flat.
  return <FormulationTable boms={boms} />;
}

// ---------------------------------------------------------------------------
// 2. Production orders
// ---------------------------------------------------------------------------

export async function ProductionOrdersPanel() {
  const [ordersResult, bomsResult] = await Promise.all([
    get<ProductionOrderSummary[]>('/api/v1/production/orders'),
    get<BomView[]>('/api/v1/production/boms'),
  ]);

  if (!ordersResult.ok) {
    return (
      <Panel title="Production orders">
        <LoadError error={ordersResult.error} />
      </Panel>
    );
  }

  // Only products with an ACTIVE formulation can be ordered — the API refuses
  // otherwise, so offering the rest would be an invitation to a 400.
  const products: ItemSummary[] = bomsResult.ok
    ? bomsResult.data.filter((bom) => bom.isActive).map((bom) => bom.product)
    : [];

  const orders = ordersResult.data;

  return (
    <ProductionRegister
      newLabel="New work order"
      newTitle="New — Work order"
      form={<CreateProductionOrderForm products={products} />}
    >
      <OrderTable orders={orders} />
    </ProductionRegister>
  );
}

// ---------------------------------------------------------------------------
// 3. Material issue
// ---------------------------------------------------------------------------

export async function MaterialIssuePanel() {
  const [ordersResult, lotsResult, issuesResult] = await Promise.all([
    get<ProductionOrderSummary[]>('/api/v1/production/orders'),
    get<ProductionStockLot[]>('/api/v1/production/stock-lots'),
    get<MaterialIssueView[]>('/api/v1/production/issues'),
  ]);

  if (!issuesResult.ok) {
    return (
      <Panel title="Material issue">
        <LoadError error={issuesResult.error} />
      </Panel>
    );
  }

  const awaiting = ordersResult.ok
    ? ordersResult.data.filter((order) => order.status === 'PLANNED')
    : [];

  // ONE plan computed here, for the order the form opens on. The rest are
  // fetched by the form when the officer picks them: a plan costs an allocation
  // query per material, so computing all of them on every page load would pay
  // for orders nobody opens. Oldest first, because that is the one most likely
  // to be dispensed next.
  const first = awaiting.at(-1);
  const planResult = first
    ? await get<MaterialIssuePlan>(`/api/v1/production/orders/${first.id}/issue-plan`)
    : null;

  // Null when the read failed, and the form then fetches it like any other —
  // a failed preload should cost a round trip, not the ability to dispense.
  const initialPlan = planResult?.ok ? planResult.data : null;

  const issues = issuesResult.data;

  const lots = lotsResult.ok ? lotsResult.data : [];

  return (
    <ProductionTabs
      tabs={[
        {
          key: 'issues',
          label: 'Material issue',
          badge: String(issues.length),
          panel: (
            <ProductionRegister
              newLabel={awaiting.length > 0 ? 'Dispense material' : undefined}
              newTitle="Dispense material"
              // The plan is a table of every material with its lots; at the
              // default width those columns wrapped and had to be scrolled.
              formWidth="wide"
              form={
                awaiting.length > 0 ? (
                  // EVERY order awaiting material, not just one. The form picks
                  // between them and fetches the chosen order's plan itself —
                  // see IssueMaterialForm for why the plan cannot be computed
                  // here for all of them.
                  <IssueMaterialForm orders={awaiting} initialPlan={initialPlan} lots={lots} />
                ) : undefined
              }
            >
              <IssueTable issues={issues} />
            </ProductionRegister>
          ),
        },
        {
          key: 'stock',
          label: 'Stock on hand',
          badge: String(lots.length),
          panel: <StockTable lots={lots} />,
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// 4. Batch record
// ---------------------------------------------------------------------------

export async function BatchRecordPanel() {
  const [ordersResult, batchesResult, packagingResult] = await Promise.all([
    get<ProductionOrderSummary[]>('/api/v1/production/orders'),
    get<BatchView[]>('/api/v1/production/batches'),
    get<PackagingRequirementView[]>('/api/v1/packaging/requirements'),
  ]);

  if (!batchesResult.ok) {
    return (
      <Panel title="Batch record">
        <LoadError error={batchesResult.error} />
      </Panel>
    );
  }

  const awaitingBatch = ordersResult.ok
    ? ordersResult.data.filter((order) => order.status === 'MATERIAL_ISSUED')
    : [];

  // The active specifications, by product, for the packing form below.
  //
  // Read here rather than folded into BatchView because a product can have
  // several presentations and the operator picks which one was run — the batch
  // record does not know that until it is written. A failed read is not fatal:
  // the form falls back to a free-text variant with no component rows, which
  // is what a product with no specification gets anyway.
  const specificationsByProduct = new Map<string, PackSpecification[]>();

  for (const requirement of packagingResult.ok ? packagingResult.data : []) {
    if (!requirement.isActive) continue;

    const specifications = specificationsByProduct.get(requirement.product.id) ?? [];

    specifications.push({
      id: requirement.id,
      packVariant: requirement.packVariant,
      unitsPerPack: requirement.unitsPerPack,
      components: requirement.lines.map((line) => ({
        id: line.item.id,
        code: line.item.code,
        name: line.item.name,
        uom: line.item.uom,
      })),
    });

    specificationsByProduct.set(requirement.product.id, specifications);
  }

  const batches = batchesResult.data;

  // The packing form per batch, built HERE because it needs the product's pack
  // specifications — which the client list does not carry and should not have
  // to. Only for a batch still awaiting a decision: packing cannot be amended
  // once the quality gate has ruled, so offering the form afterwards would be a
  // control the API refuses.
  const packingForms: Record<string, React.ReactNode> = {};

  for (const batch of batches) {
    if (batch.releaseStatus !== 'PENDING') continue;

    packingForms[batch.id] = (
      <RecordPackingForm
        batchId={batch.id}
        batchNumber={batch.batchNumber}
        packSpecifications={specificationsByProduct.get(batch.product.id) ?? []}
      />
    );
  }

  return (
    <ProductionRegister
      newLabel={awaitingBatch.length > 0 ? 'New batch' : undefined}
      newTitle="New — Batch record"
      form={awaitingBatch.length > 0 ? <RecordBatchForm orders={awaitingBatch} /> : undefined}
    >
      <div className="p-6">
        {batches.length === 0 ? (
          <EmptyState>
            {awaitingBatch.length > 0
              ? 'No batches yet. A work order has material issued and is ready to open one.'
              : 'No batches yet. Issue material against a work order first.'}
          </EmptyState>
        ) : (
          <BatchRecords batches={batches} packingFormFor={packingForms} />
        )}
      </div>
    </ProductionRegister>
  );
}

// ---------------------------------------------------------------------------
// 7. Batch release — the quality gate
// ---------------------------------------------------------------------------

export async function BatchReleasePanel() {
  // The role is resolved here rather than handed down from the page, so that
  // the four steps which do not need it make no session call at all. It joins
  // the same Promise.all as the reads, so it costs no extra wait even here —
  // `getSession` is request-cached, and this is the only caller in this render.
  const [user, batchesResult, stockResult] = await Promise.all([
    requireSession(),
    get<BatchView[]>('/api/v1/production/batches'),
    get<FinishedGoodsLotView[]>('/api/v1/production/finished-goods'),
  ]);

  const role = user.role;

  if (!batchesResult.ok) {
    return (
      <Panel title="Batch release">
        <LoadError error={batchesResult.error} />
      </Panel>
    );
  }

  const pending = batchesResult.data.filter((batch) => batch.releaseStatus === 'PENDING');
  const decided = batchesResult.data.filter((batch) => batch.releaseStatus !== 'PENDING');

  // The release form per batch, built HERE because it carries the server action
  // binding; the client list only decides which ones are on screen.
  const releaseForms: Record<string, React.ReactNode> = {};

  for (const batch of pending) {
    releaseForms[batch.id] = (
      // KEYED, even though each of these is rendered as a single child rather
      // than from an array. They are CREATED in a loop here and consumed by a
      // client component across the server/client boundary, and React warns
      // about the collection either way — "Check the render method of
      // PendingReleaseList. It was passed a child from BatchReleasePanel."
      // A key costs nothing and is correct regardless of which side attributes
      // the list.
      <ReleaseDecisionForm
        key={batch.id}
        batchId={batch.id}
        batchNumber={batch.batchNumber}
        packedQuantity={batch.packedQuantity}
        uom={batch.product.uom}
      />
    );
  }

  // WHO MAY DECIDE, and therefore who sees this step at all. Anyone else is
  // shown the sentence and nothing else — not the pending batches, not the
  // sellable stock, not the decisions already made.
  //
  // This is a DISCLOSURE, not the enforcement: RolesGuard on the release
  // endpoint is what actually refuses the decision, and it names the same two
  // roles. Hiding the tabs here only saves somebody from reading a register
  // they can take no action on.
  const canDecide = role === 'QUALITY_OFFICER' || role === 'ADMIN';

  if (!canDecide) {
    return (
      <p className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        Batch should be released by Admin and Quality Officer.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <ProductionTabs
        tabs={[
          {
            key: 'gate',
            label: 'Batch release',
            badge: String(pending.length),
            panel: <PendingReleaseList batches={pending} formFor={releaseForms} />,
          },
          {
            key: 'stock',
            label: 'Sellable stock',
            badge: stockResult.ok ? String(stockResult.data.length) : undefined,
            panel: stockResult.ok ? (
              <SellableStockTable lots={stockResult.data} />
            ) : (
              <Panel title="Sellable stock">
                <LoadError error={stockResult.error} />
              </Panel>
            ),
          },
          {
            key: 'decided',
            label: 'Decided',
            badge: String(decided.length),
            panel: <DecidedTable batches={decided} />,
          },
        ]}
      />
    </div>
  );
}
