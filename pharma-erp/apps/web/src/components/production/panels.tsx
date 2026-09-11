import type {
  BatchView,
  BomView,
  FinishedGoodsLotView,
  ItemSummary,
  MaterialIssuePlan,
  MaterialIssueView,
  MaterialLotSummary,
  ProductionOrderSummary,
} from '@pharma-erp/types';
import { MATERIAL_LOT_STATUS_LABELS } from '@pharma-erp/types';

import { apiFetch, type ApiResult } from '@/lib/api';

import {
  CreateProductionOrderForm,
  IssueMaterialForm,
  RecordBatchForm,
  RecordPackingForm,
  ReleaseDecisionForm,
} from './forms';
import {
  DateCell,
  EmptyState,
  ExpiryHint,
  LoadError,
  OrderStatusBadge,
  Panel,
  Quantity,
  ReleaseBadge,
  TableFrame,
  Th,
} from './shared';

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

  return (
    <div className="space-y-6">
      {boms.length === 0 && (
        <Panel title="Formulations">
          <EmptyState>
            No formulations yet. Seed the demo data with <code>pnpm seed:production</code>, or
            create one through <code>POST /api/v1/production/boms</code>.
          </EmptyState>
        </Panel>
      )}

      {boms.map((bom) => (
        <Panel
          key={bom.id}
          title={`${bom.product.code} — ${bom.product.name}`}
          description={`Version ${bom.version}, per ${bom.outputQuantity.replace(/\.?0+$/, '')} ${bom.product.uom}.`}
          actions={
            bom.isActive ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
                Active
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
                Superseded
              </span>
            )
          }
        >
          <TableFrame
            head={
              <>
                <Th>Material</Th>
                <Th>Type</Th>
                <Th align="right">Quantity per batch</Th>
                <Th>Notes</Th>
              </>
            }
          >
            {bom.lines.map((line) => (
              <tr key={line.id} className="align-top">
                <td className="px-6 py-3">
                  <span className="font-mono text-xs text-slate-700">{line.item.code}</span>
                  <div className="text-slate-800">{line.item.name}</div>
                </td>
                <td className="px-6 py-3 text-slate-600">
                  {line.item.type === 'PACKING_MATERIAL' ? 'Packing' : 'Raw material'}
                </td>
                <td className="px-6 py-3 text-right">
                  <Quantity value={line.quantityPer} uom={line.item.uom} />
                </td>
                <td className="px-6 py-3 text-slate-600">{line.notes ?? '—'}</td>
              </tr>
            ))}
          </TableFrame>

          {bom.instructions && (
            <div className="border-t border-slate-200 px-6 py-4">
              <h4 className="text-xs font-medium uppercase tracking-wide text-slate-600">
                Manufacturing instructions
              </h4>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-slate-700">
                {bom.instructions}
              </pre>
            </div>
          )}
        </Panel>
      ))}

      <p className="text-xs text-slate-500">
        Formulations are versioned, never edited: a batch made last month was made to the recipe as
        it stood then, and rewriting it would destroy the only evidence of what was followed. A
        change creates a new version and supersedes the old one.
      </p>
    </div>
  );
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
    <div className="space-y-6">
      <Panel
        title="Raise a work order"
        description="What to make, how much, and against the formulation version current right now."
      >
        <CreateProductionOrderForm products={products} />
      </Panel>

      <Panel title={`${orders.length} work order${orders.length === 1 ? '' : 's'}`}>
        {orders.length === 0 ? (
          <EmptyState>No work orders yet.</EmptyState>
        ) : (
          <TableFrame
            head={
              <>
                <Th>Order</Th>
                <Th>Product</Th>
                <Th align="right">Planned</Th>
                <Th>Status</Th>
                <Th>Batch</Th>
                <Th>Raised by</Th>
              </>
            }
          >
            {orders.map((order) => (
              <tr key={order.id} className="align-top">
                <td className="px-6 py-3">
                  <span className="font-mono text-xs font-semibold text-slate-800">
                    {order.orderNumber}
                  </span>
                  <div className="text-xs text-slate-500">BOM v{order.bomVersion}</div>
                </td>
                <td className="px-6 py-3">
                  <span className="font-mono text-xs text-slate-700">{order.product.code}</span>
                  <div className="text-slate-800">{order.product.name}</div>
                </td>
                <td className="px-6 py-3 text-right">
                  <Quantity value={order.plannedQuantity} uom={order.product.uom} />
                </td>
                <td className="px-6 py-3">
                  <OrderStatusBadge status={order.status} />
                </td>
                <td className="px-6 py-3">
                  {order.batchNumber ? (
                    <>
                      <span className="font-mono text-xs text-slate-800">{order.batchNumber}</span>
                      {order.releaseStatus && (
                        <div className="mt-1">
                          <ReleaseBadge status={order.releaseStatus} />
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-6 py-3 text-slate-600">{order.createdBy ?? '—'}</td>
              </tr>
            ))}
          </TableFrame>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Material issue
// ---------------------------------------------------------------------------

export async function MaterialIssuePanel() {
  const [ordersResult, lotsResult] = await Promise.all([
    get<ProductionOrderSummary[]>('/api/v1/production/orders'),
    get<MaterialLotSummary[]>('/api/v1/production/material-lots'),
  ]);

  if (!ordersResult.ok) {
    return (
      <Panel title="Material issue">
        <LoadError error={ordersResult.error} />
      </Panel>
    );
  }

  const awaiting = ordersResult.data.filter((order) => order.status === 'PLANNED');

  // One plan at a time: the oldest order awaiting material. Previewing every
  // order would mean an allocation query per order per page load, and the
  // shop floor dispenses one order at a time anyway.
  const next = awaiting.at(-1);
  const planResult = next
    ? await get<MaterialIssuePlan>(`/api/v1/production/orders/${next.id}/issue-plan`)
    : null;

  const issuedResult = next
    ? null
    : await (async () => {
        const recent = ordersResult.data.find((order) => order.status !== 'PLANNED');
        return recent
          ? get<MaterialIssueView[]>(`/api/v1/production/orders/${recent.id}/issues`)
          : null;
      })();

  return (
    <div className="space-y-6">
      <Panel
        title="Next to dispense"
        description="Materials are picked First Expiry, First Out — the lot that expires soonest is consumed first, whatever order it arrived in."
      >
        {!next ? (
          <EmptyState>
            No work order is awaiting material. Raise one under Production orders.
          </EmptyState>
        ) : !planResult?.ok ? (
          <LoadError error={planResult?.error ?? 'unknown error'} />
        ) : (
          <>
            <div className="border-b border-slate-200 px-6 py-3 text-sm text-slate-700">
              <span className="font-mono font-semibold">{planResult.data.orderNumber}</span> ·{' '}
              {next.product.name} · planned{' '}
              <Quantity value={next.plannedQuantity} uom={next.product.uom} />
            </div>

            <TableFrame
              head={
                <>
                  <Th>Material</Th>
                  <Th align="right">Required</Th>
                  <Th>Lots the plan will take</Th>
                  <Th align="right">Short</Th>
                </>
              }
            >
              {planResult.data.lines.map((line) => (
                <tr key={line.item.id} className="align-top">
                  <td className="px-6 py-3">
                    <span className="font-mono text-xs text-slate-700">{line.item.code}</span>
                    <div className="text-slate-800">{line.item.name}</div>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Quantity value={line.quantityRequired} uom={line.item.uom} />
                  </td>
                  <td className="px-6 py-3">
                    {line.allocations.length === 0 ? (
                      <span className="text-red-700">No usable stock</span>
                    ) : (
                      <ul className="space-y-1">
                        {line.allocations.map((allocation) => (
                          <li
                            key={allocation.lotId}
                            className="flex flex-wrap items-center gap-x-2"
                          >
                            <span className="font-mono text-xs text-slate-700">
                              {allocation.lotNumber}
                            </span>
                            <span className="text-xs text-slate-500">
                              exp {allocation.expiryDate}
                            </span>
                            <ExpiryHint date={allocation.expiryDate} />
                            <Quantity value={allocation.quantity} uom={line.item.uom} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right">
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
            </TableFrame>

            <IssueMaterialForm plan={planResult.data} />
          </>
        )}
      </Panel>

      {issuedResult?.ok && issuedResult.data.length > 0 && (
        <Panel
          title="Last dispensing"
          description="Every line here is a traceability link: it answers which supplier lot went into which batch, in both directions."
        >
          <TableFrame
            head={
              <>
                <Th>Material</Th>
                <Th>Lot</Th>
                <Th>Expiry</Th>
                <Th align="right">Issued</Th>
              </>
            }
          >
            {issuedResult.data[0]?.lines.map((line) => (
              <tr key={line.id}>
                <td className="px-6 py-3">
                  <span className="font-mono text-xs text-slate-700">{line.item.code}</span>
                </td>
                <td className="px-6 py-3 font-mono text-xs text-slate-700">{line.lotNumber}</td>
                <td className="px-6 py-3">
                  <DateCell value={line.expiryDate} />
                </td>
                <td className="px-6 py-3 text-right">
                  <Quantity value={line.quantityIssued} uom={line.item.uom} />
                </td>
              </tr>
            ))}
          </TableFrame>
        </Panel>
      )}

      {lotsResult.ok && (
        <Panel
          title="Stock on hand"
          description="Ordered by expiry, which is the order FEFO consumes it in. Quarantined and rejected lots stay visible but are never picked."
        >
          <TableFrame
            head={
              <>
                <Th>Material</Th>
                <Th>Lot</Th>
                <Th>Expiry</Th>
                <Th>Status</Th>
                <Th align="right">Available</Th>
              </>
            }
          >
            {lotsResult.data.map((lot) => (
              <tr key={lot.id} className={lot.status === 'USABLE' ? '' : 'bg-slate-50/60'}>
                <td className="px-6 py-3">
                  <span className="font-mono text-xs text-slate-700">{lot.item.code}</span>
                </td>
                <td className="px-6 py-3 font-mono text-xs text-slate-700">{lot.lotNumber}</td>
                <td className="px-6 py-3">
                  <DateCell value={lot.expiryDate} />
                  <ExpiryHint date={lot.expiryDate} />
                </td>
                <td className="px-6 py-3">
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                      lot.status === 'USABLE'
                        ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                        : lot.status === 'QUARANTINE'
                          ? 'bg-amber-50 text-amber-800 ring-amber-200'
                          : 'bg-red-50 text-red-800 ring-red-200'
                    }`}
                  >
                    {MATERIAL_LOT_STATUS_LABELS[lot.status]}
                  </span>
                </td>
                <td className="px-6 py-3 text-right">
                  <Quantity value={lot.quantityAvailable} uom={lot.item.uom} />
                </td>
              </tr>
            ))}
          </TableFrame>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Batch record
// ---------------------------------------------------------------------------

export async function BatchRecordPanel() {
  const [ordersResult, batchesResult] = await Promise.all([
    get<ProductionOrderSummary[]>('/api/v1/production/orders'),
    get<BatchView[]>('/api/v1/production/batches'),
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

  return (
    <div className="space-y-6">
      <Panel
        title="Open a batch record"
        description="Assigns the batch number and expiry, and records the yield actually manufactured."
      >
        <RecordBatchForm orders={awaitingBatch} />
      </Panel>

      {batchesResult.data.length === 0 ? (
        <Panel title="Batches">
          <EmptyState>No batches yet.</EmptyState>
        </Panel>
      ) : (
        batchesResult.data.map((batch) => (
          <Panel
            key={batch.id}
            title={`${batch.batchNumber} — ${batch.product.name}`}
            description={`Work order ${batch.orderNumber}. Manufactured ${batch.manufacturedOn}, expires ${batch.expiryDate}.`}
            actions={<ReleaseBadge status={batch.releaseStatus} />}
          >
            <dl className="grid gap-4 border-b border-slate-200 px-6 py-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Planned</dt>
                <dd className="mt-1">
                  <Quantity value={batch.plannedQuantity} uom={batch.product.uom} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Manufactured</dt>
                <dd className="mt-1">
                  <Quantity value={batch.actualQuantity} uom={batch.product.uom} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Packed</dt>
                <dd className="mt-1">
                  <Quantity value={batch.packedQuantity} uom={batch.product.uom} />
                </dd>
              </div>
            </dl>

            <div className="px-6 py-4">
              <h4 className="text-xs font-medium uppercase tracking-wide text-slate-600">
                Planned vs actual consumption
              </h4>
              <p className="mt-1 text-xs text-slate-500">
                Anything beyond ±{batch.varianceThresholdPercent}% is flagged for review.
              </p>
            </div>

            <TableFrame
              head={
                <>
                  <Th>Material</Th>
                  <Th align="right">Planned</Th>
                  <Th align="right">Issued</Th>
                  <Th align="right">Variance</Th>
                </>
              }
            >
              {batch.materialVariances.map((variance) => (
                <tr key={variance.item.id} className={variance.flagged ? 'bg-amber-50/60' : ''}>
                  <td className="px-6 py-3">
                    <span className="font-mono text-xs text-slate-700">{variance.item.code}</span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Quantity value={variance.quantityPlanned} uom={variance.item.uom} />
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Quantity value={variance.quantityIssued} uom={variance.item.uom} />
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span
                      className={`tabular-nums ${
                        variance.flagged ? 'font-semibold text-amber-800' : 'text-slate-600'
                      }`}
                    >
                      {variance.variancePercent}%
                    </span>
                    {variance.flagged && (
                      <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                        review
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </TableFrame>

            {batch.releaseStatus === 'PENDING' && (
              <div className="border-t border-slate-200 px-6 py-4">
                <h4 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-600">
                  Batch packing record
                </h4>
                <RecordPackingForm batchId={batch.id} batchNumber={batch.batchNumber} />
              </div>
            )}
          </Panel>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. Batch release — the quality gate
// ---------------------------------------------------------------------------

export async function BatchReleasePanel({ role }: { role: string }) {
  const [batchesResult, stockResult] = await Promise.all([
    get<BatchView[]>('/api/v1/production/batches'),
    get<FinishedGoodsLotView[]>('/api/v1/production/finished-goods'),
  ]);

  if (!batchesResult.ok) {
    return (
      <Panel title="Batch release">
        <LoadError error={batchesResult.error} />
      </Panel>
    );
  }

  const pending = batchesResult.data.filter((batch) => batch.releaseStatus === 'PENDING');
  const decided = batchesResult.data.filter((batch) => batch.releaseStatus !== 'PENDING');

  return (
    <div className="space-y-6">
      {role !== 'QUALITY_OFFICER' && (
        <p className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          Only a Quality Officer can decide a release, so the buttons below will be refused for your
          role. That is deliberate and enforced at the API — not even an Admin can sign off a
          quality decision, because a separation that an administrator can step around is not a
          separation.
        </p>
      )}

      <Panel
        title={`${pending.length} batch${pending.length === 1 ? '' : 'es'} awaiting a decision`}
        description="Releasing creates sellable stock. Blocking withholds the batch from every sale channel, permanently."
      >
        {pending.length === 0 ? (
          <EmptyState>Nothing is waiting at the gate.</EmptyState>
        ) : (
          <div className="divide-y divide-slate-100">
            {pending.map((batch) => (
              <div key={batch.id} className="space-y-3 px-6 py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className="font-mono text-sm font-semibold text-slate-900">
                      {batch.batchNumber}
                    </span>
                    <span className="ml-2 text-sm text-slate-700">{batch.product.name}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    Manufactured {batch.manufacturedOn} · expires {batch.expiryDate}
                  </div>
                </div>

                {batch.materialVariances.some((variance) => variance.flagged) && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    This batch has a material variance beyond ±{batch.varianceThresholdPercent}%.
                    Review the batch record before deciding.
                  </p>
                )}

                <ReleaseDecisionForm
                  batchId={batch.id}
                  batchNumber={batch.batchNumber}
                  packedQuantity={batch.packedQuantity}
                  uom={batch.product.uom}
                />
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Sellable stock"
        description="A row exists here only because a batch was released — that is what makes 'may this be sold' unforgeable downstream."
      >
        {!stockResult.ok ? (
          <LoadError error={stockResult.error} />
        ) : stockResult.data.length === 0 ? (
          <EmptyState>No released stock yet.</EmptyState>
        ) : (
          <TableFrame
            head={
              <>
                <Th>Product</Th>
                <Th>Batch</Th>
                <Th>Expiry</Th>
                <Th align="right">Available</Th>
              </>
            }
          >
            {stockResult.data.map((lot) => (
              <tr key={lot.id}>
                <td className="px-6 py-3">
                  <span className="font-mono text-xs text-slate-700">{lot.item.code}</span>
                  <div className="text-slate-800">{lot.item.name}</div>
                </td>
                <td className="px-6 py-3 font-mono text-xs text-slate-800">{lot.batchNumber}</td>
                <td className="px-6 py-3">
                  <DateCell value={lot.expiryDate} />
                  <ExpiryHint date={lot.expiryDate} />
                </td>
                <td className="px-6 py-3 text-right">
                  <Quantity value={lot.quantityAvailable} uom={lot.item.uom} />
                </td>
              </tr>
            ))}
          </TableFrame>
        )}
      </Panel>

      {decided.length > 0 && (
        <Panel title="Decided" description="Every decision, with who made it and when.">
          <TableFrame
            head={
              <>
                <Th>Batch</Th>
                <Th>Decision</Th>
                <Th>By</Th>
                <Th>When</Th>
                <Th>Reason</Th>
              </>
            }
          >
            {decided.map((batch) => (
              <tr key={batch.id} className="align-top">
                <td className="px-6 py-3 font-mono text-xs text-slate-800">{batch.batchNumber}</td>
                <td className="px-6 py-3">
                  <ReleaseBadge status={batch.releaseStatus} />
                </td>
                <td className="px-6 py-3 text-slate-700">{batch.releaseDecidedBy ?? '—'}</td>
                <td className="px-6 py-3">
                  <DateCell value={batch.releaseDecidedAt?.slice(0, 10) ?? null} />
                </td>
                <td className="px-6 py-3 text-slate-600">{batch.releaseNotes ?? '—'}</td>
              </tr>
            ))}
          </TableFrame>
        </Panel>
      )}
    </div>
  );
}
