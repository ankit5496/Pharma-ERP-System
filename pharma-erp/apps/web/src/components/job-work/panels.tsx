import {
  AGREEMENT_STATUS_LABELS,
  BILLING_MODEL_LABELS,
  CONVERSION_RATE_BASIS_LABELS,
  JOB_WORK_INVOICE_BASIS_LABELS,
  STOCK_OWNERSHIP_LABELS,
  type ItemSummary,
  type JobWorkAgreementSummary,
  type JobWorkDispatchableBatch,
  type JobWorkInvoiceView,
  type JobWorkMaterialReceiptView,
  type JobWorkOrderablePrincipal,
  type JobWorkOrderSummary,
  type JobWorkRegisterGroup,
} from '@pharma-erp/types';

import {
  Blank,
  DateText,
  DateTimeText,
  EmptyState,
  ErrorState,
  Money,
  Panel,
  Pill,
  Qty,
  RecordLink,
  StatusPill,
  TableWrap,
  Td,
  Th,
  Name,
  Code,
} from '@/components/procurement/ui';
import { apiFetch } from '@/lib/api';

import {
  CreateJobWorkDispatchButton,
  CreateJobWorkOrderButton,
  CreateJobWorkReceiptButton,
  RaiseJobWorkProductionButton,
} from './forms';

/**
 * Job Work — the screens behind the fourth workflow tab.
 *
 * SEVEN STEPS, AND EVERY ONE OF THEM NOW HAS A SCREEN. What each shows follows
 * the brief's section 16: where the work already lives elsewhere in the app,
 * these screens LINK to it rather than rebuilding it. That is why Production
 * and Quality & release show the job-work view of records owned by
 * Production & Quality and hand off to those screens for the actual operation —
 * US-JW-03 and US-JW-04 say in as many words that no new record and no new
 * quality gate may be created.
 *
 * ONE VOCABULARY RUNS THROUGH ALL OF THEM (section 17): a value the system
 * decided carries a badge saying which kind of decision it was, so nobody has
 * to guess which fields they may change.
 */

/** A system-decided value, shown with the badge that says why it is fixed. */
function DerivedTag({
  children,
  badge,
}: {
  children: React.ReactNode;
  badge: 'AUTO-INHERITED' | 'SYSTEM-DERIVED' | 'AUTO-DERIVED' | 'SYSTEM-SET' | 'READ-ONLY';
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-sm text-slate-800">{children}</span>
      <span className="rounded border border-slate-300 bg-slate-50 px-1 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-slate-500">
        {badge}
      </span>
    </span>
  );
}

/** Which of the two paths an agreement or order puts its work down. */
const PATH: Record<string, { label: string; tone: 'warn' | 'info'; detail: string }> = {
  PURE_CONVERSION: {
    label: 'Pure conversion',
    tone: 'warn',
    detail: 'Principal supplies the material free of cost; we invoice the conversion charge only.',
  },
  OWN_PROCUREMENT: {
    label: 'Own-procurement',
    tone: 'info',
    detail: 'We buy the material through the normal purchase flow and invoice the full value.',
  },
};

// ---------------------------------------------------------------------------
// 1. Principals — the agreement register (US-MD-05)
// ---------------------------------------------------------------------------

export async function PrincipalsPanel() {
  const agreements = await apiFetch<JobWorkAgreementSummary[]>('/api/v1/job-work/agreements', {
    authenticated: true,
  });

  return (
    <Panel
      title="Principals & job-work agreements"
      subtitle={
        agreements.ok
          ? `${agreements.data.length} agreement${agreements.data.length === 1 ? '' : 's'} — the billing model on each one decides which path its orders follow`
          : undefined
      }
      action={
        // The register itself lives in Master Data, which owns creating and
        // editing it. Duplicating that form here would be a second place for
        // the same record to be written from, and a second place to fix.
        <RecordLink href="/master-data/principal-job-work">Manage in master data →</RecordLink>
      }
    >
      {!agreements.ok ? (
        <ErrorState message={`Could not load job-work agreements: ${agreements.error}`} />
      ) : agreements.data.length === 0 ? (
        <EmptyState
          title="No job-work agreements yet."
          hint="Record the brand owner as a job-work principal in the Party register, then write an agreement against it in Master Data."
        />
      ) : (
        <TableWrap>
          <table className="w-full min-w-[72rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Principal</Th>
                <Th>Agreement</Th>
                <Th>Billing model</Th>
                <Th align="right">Conversion charge</Th>
                <Th>Valid</Th>
                <Th>Products covered</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {agreements.data.map((agreement) => {
                const path = PATH[agreement.billingModel];

                return (
                  <tr key={agreement.id}>
                    <Td>
                      <p className="font-medium text-slate-900"><Name>{agreement.principalName}</Name></p>
                      <p className="font-mono text-xs text-slate-500"><Code>{agreement.principalCode}</Code></p>
                    </Td>

                    <Td>
                      {agreement.agreementReference ? (
                        <span className="font-mono text-xs">{agreement.agreementReference}</span>
                      ) : (
                        <Blank />
                      )}
                    </Td>

                    <Td valign="top">
                      <span title={path?.detail}>
                        <Pill tone={path?.tone ?? 'neutral'}>
                          {path?.label ?? BILLING_MODEL_LABELS[agreement.billingModel]}
                        </Pill>
                      </span>
                      <p className="mt-1 max-w-[18rem] text-[11px] leading-snug text-slate-500">
                        {path?.detail}
                      </p>
                    </Td>

                    <Td align="right" valign="top">
                      {agreement.conversionChargeRate ? (
                        <>
                          <Money amount={agreement.conversionChargeRate} />
                          {agreement.conversionRateBasis && (
                            <span className="mt-0.5 block text-[11px] text-slate-500">
                              {CONVERSION_RATE_BASIS_LABELS[agreement.conversionRateBasis]}
                            </span>
                          )}
                        </>
                      ) : (
                        <Blank />
                      )}
                    </Td>

                    <Td>
                      <span className="whitespace-nowrap tabular-nums text-xs text-slate-700">
                        {agreement.validFrom ?? '—'}
                        {agreement.validTo ? ` → ${agreement.validTo}` : ''}
                      </span>
                    </Td>

                    <Td valign="top">
                      {agreement.mappings.length === 0 ? (
                        <span className="text-xs text-slate-400">None mapped</span>
                      ) : (
                        <ul className="space-y-1">
                          {agreement.mappings.map((mapping) => (
                            <li key={mapping.id} className="leading-snug">
                              <span
                                className="block max-w-[16rem] truncate text-xs font-medium text-slate-800"
                                title={mapping.principalBrandName}
                              >
                                {mapping.principalBrandName}
                              </span>
                              <span className="block text-[11px] text-slate-500">
                                {mapping.bomLabel} · <Name>{mapping.productName}</Name>
                                {mapping.packDesignRef ? ` · ${mapping.packDesignRef}` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>

                    <Td>
                      <StatusPill
                        status={agreement.status}
                        label={AGREEMENT_STATUS_LABELS[agreement.status]}
                      />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 2. Job-work orders — US-JW-01
// ---------------------------------------------------------------------------

export async function JobWorkOrdersPanel() {
  const [orders, principals] = await Promise.all([
    apiFetch<JobWorkOrderSummary[]>('/api/v1/job-work/orders', { authenticated: true }),
    apiFetch<JobWorkOrderablePrincipal[]>('/api/v1/job-work/orders/orderable', {
      authenticated: true,
    }),
  ]);

  return (
    <Panel
      title="Job-work orders"
      subtitle={
        orders.ok
          ? `${orders.data.length} order${orders.data.length === 1 ? '' : 's'} — the billing model on each is inherited from its agreement and cannot be changed here`
          : undefined
      }
      action={
        principals.ok ? <CreateJobWorkOrderButton principals={principals.data} /> : undefined
      }
    >
      {!orders.ok ? (
        <ErrorState message={`Could not load job-work orders: ${orders.error}`} />
      ) : orders.data.length === 0 ? (
        <EmptyState
          title="No job-work orders yet."
          hint="An order can only be raised against a principal whose agreement is in force. Create one with the button above."
        />
      ) : (
        <TableWrap>
          <table className="w-full min-w-[78rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Order</Th>
                <Th>Principal</Th>
                <Th>Brand / product</Th>
                <Th>Billing model</Th>
                <Th>Stock bucket</Th>
                <Th align="right">Ordered</Th>
                <Th align="right">Received</Th>
                <Th align="right">Consumed</Th>
                <Th align="right">Dispatched</Th>
                <Th>Delivery</Th>
              </tr>
            </thead>
            <tbody>
              {orders.data.map((order) => (
                <tr key={order.id}>
                  <Td>
                    <p className="font-mono text-xs font-semibold text-slate-900">
                      <Code>{order.orderNumber}</Code>
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {order.productionOrderCount} work order
                      {order.productionOrderCount === 1 ? '' : 's'}
                    </p>
                  </Td>

                  <Td>
                    <p className="text-slate-800"><Name>{order.principalName}</Name></p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {order.agreementReference ?? order.principalCode}
                    </p>
                  </Td>

                  <Td valign="top">
                    <p className="max-w-[14rem] truncate font-medium text-slate-800">
                      {order.product.principalBrandName}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      <Name>{order.product.productName}</Name> (<Code>{order.product.productCode}</Code>)
                    </p>
                  </Td>

                  <Td valign="top">
                    <DerivedTag badge="AUTO-INHERITED">
                      <Pill tone={PATH[order.billingModel]?.tone ?? 'neutral'}>
                        {BILLING_MODEL_LABELS[order.billingModel]}
                      </Pill>
                    </DerivedTag>
                  </Td>

                  <Td valign="top">
                    <DerivedTag badge="SYSTEM-DERIVED">
                      {STOCK_OWNERSHIP_LABELS[order.stockBucket]}
                    </DerivedTag>
                  </Td>

                  <Td align="right">
                    <Qty value={order.quantity} uom={order.product.uom} />
                  </Td>
                  <Td align="right">
                    <Qty value={order.materialReceivedQuantity} />
                  </Td>
                  <Td align="right">
                    <Qty value={order.materialConsumedQuantity} />
                  </Td>
                  <Td align="right">
                    <Qty value={order.dispatchedQuantity} />
                  </Td>

                  <Td>
                    <DateText value={order.deliveryDate} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 3. Inward materials — US-JW-02
// ---------------------------------------------------------------------------

export async function InwardMaterialsPanel() {
  const [receipts, orders, items] = await Promise.all([
    apiFetch<JobWorkMaterialReceiptView[]>('/api/v1/job-work/material-receipts', {
      authenticated: true,
    }),
    apiFetch<JobWorkOrderSummary[]>('/api/v1/job-work/orders', { authenticated: true }),
    apiFetch<ItemSummary[]>('/api/v1/procurement/items', { authenticated: true }),
  ]);

  // Only PURE_CONVERSION orders can take a free-of-cost receipt; the API
  // refuses the rest, so the form must not offer them.
  const conversionOrders = orders.ok
    ? orders.data.filter((order) => order.billingModel === 'PURE_CONVERSION')
    : [];

  const inputItems = items.ok
    ? items.data.filter((item) => item.type !== 'FINISHED_GOOD')
    : [];

  return (
    <Panel
      title="Inward materials"
      subtitle="Material the principal supplied, on their delivery challan. Free of cost — no purchase order and no purchase invoice is created."
      action={
        orders.ok && items.ok ? (
          <CreateJobWorkReceiptButton orders={conversionOrders} items={inputItems} />
        ) : undefined
      }
    >
      {!receipts.ok ? (
        <ErrorState message={`Could not load material receipts: ${receipts.error}`} />
      ) : receipts.data.length === 0 ? (
        <EmptyState
          title="No principal material received yet."
          hint="Under pure conversion the principal ships the raw material on their own delivery challan. Record it here and it enters principal-owned stock."
        />
      ) : (
        <TableWrap>
          <table className="w-full min-w-[80rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Receipt</Th>
                <Th>Job-work order</Th>
                <Th>Delivery challan</Th>
                <Th>Material</Th>
                <Th>Batch / lot</Th>
                <Th align="right">Received</Th>
                <Th align="right">Remaining</Th>
                <Th>Ownership</Th>
                <Th>Expiry</Th>
                <Th>Recorded</Th>
              </tr>
            </thead>
            <tbody>
              {receipts.data.map((receipt) => (
                <tr key={receipt.id}>
                  <Td>
                    <p className="font-mono text-xs font-semibold text-slate-900">
                      <Code>{receipt.receiptNumber}</Code>
                    </p>
                    {receipt.lotNumber && (
                      <p className="font-mono text-[11px] text-slate-500"><Code>{receipt.lotNumber}</Code></p>
                    )}
                  </Td>

                  <Td>
                    <p className="font-mono text-xs text-slate-800">{receipt.jobWorkOrderNumber}</p>
                    <p className="text-[11px] text-slate-500"><Name>{receipt.principalName}</Name></p>
                  </Td>

                  <Td>
                    {/* Named as a challan everywhere it appears. US-JW-02 is
                        explicit that it is not a purchase invoice. */}
                    <span className="font-mono text-xs text-slate-800">
                      {receipt.deliveryChallanNumber}
                    </span>
                    <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-slate-400">
                      Not a purchase invoice
                    </span>
                  </Td>

                  <Td valign="top">
                    <p className="text-slate-800"><Name>{receipt.item.name}</Name></p>
                    <p className="font-mono text-[11px] text-slate-500"><Code>{receipt.item.code}</Code></p>
                  </Td>

                  <Td>
                    <span className="font-mono text-xs"><Code>{receipt.batchNumber}</Code></span>
                  </Td>

                  <Td align="right">
                    <Qty value={receipt.receivedQuantity} uom={receipt.item.uom} />
                  </Td>

                  <Td align="right">
                    {receipt.lotQuantityAvailable ? (
                      <Qty value={receipt.lotQuantityAvailable} uom={receipt.item.uom} />
                    ) : (
                      <Blank />
                    )}
                  </Td>

                  <Td valign="top">
                    <DerivedTag badge="SYSTEM-SET">
                      <Pill tone="warn">{STOCK_OWNERSHIP_LABELS[receipt.stockOwnership]}</Pill>
                    </DerivedTag>
                  </Td>

                  <Td>
                    <DateText value={receipt.expiryDate} />
                  </Td>

                  <Td>
                    <DateTimeText value={receipt.receivedAt} />
                    {receipt.receivedBy && (
                      <span className="block text-[11px] text-slate-500">
                        <Name>{receipt.receivedBy}</Name>
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 4. Production — US-JW-03, through the EXISTING work order
// ---------------------------------------------------------------------------

export async function JobWorkProductionPanel() {
  const orders = await apiFetch<JobWorkOrderSummary[]>('/api/v1/job-work/orders', {
    authenticated: true,
  });

  return (
    <Panel
      title="Job-work production"
      subtitle="Manufacturing runs on the SAME production work order as own-brand batches, tagged to the principal. Material is drawn from the bucket the billing model chose, and nothing else."
      action={
        <RecordLink href="/workflows/production-quality/production-orders">
          All work orders →
        </RecordLink>
      }
    >
      {!orders.ok ? (
        <ErrorState message={`Could not load job-work orders: ${orders.error}`} />
      ) : orders.data.length === 0 ? (
        <EmptyState
          title="No job-work orders to manufacture."
          hint="Raise a job-work order first; production is then raised against it."
        />
      ) : (
        <TableWrap>
          <table className="w-full min-w-[72rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Order</Th>
                <Th>Brand / product</Th>
                <Th>Stock bucket</Th>
                <Th align="right">Ordered</Th>
                <Th align="right">Material available</Th>
                <Th align="right">Work orders</Th>
                <Th>Raise production</Th>
              </tr>
            </thead>
            <tbody>
              {orders.data.map((order) => {
                // What is left of the principal's material for this order.
                // Shown because under pure conversion it is the binding
                // constraint, and a refusal at the point of raising the work
                // order is less useful than the number beforehand.
                const remaining = (
                  Number(order.materialReceivedQuantity) - Number(order.materialConsumedQuantity)
                ).toFixed(3);

                return (
                  <tr key={order.id}>
                    <Td>
                      <p className="font-mono text-xs font-semibold text-slate-900">
                        <Code>{order.orderNumber}</Code>
                      </p>
                      <p className="text-[11px] text-slate-500"><Name>{order.principalName}</Name></p>
                    </Td>

                    <Td valign="top">
                      <p className="max-w-[14rem] truncate font-medium text-slate-800">
                        {order.product.principalBrandName}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        <Name>{order.product.productName}</Name> (<Code>{order.product.productCode}</Code>)
                      </p>
                    </Td>

                    <Td valign="top">
                      <DerivedTag badge="SYSTEM-DERIVED">
                        <Pill tone={order.stockBucket === 'PRINCIPAL_OWNED' ? 'warn' : 'info'}>
                          {STOCK_OWNERSHIP_LABELS[order.stockBucket]}
                        </Pill>
                      </DerivedTag>
                    </Td>

                    <Td align="right">
                      <Qty value={order.quantity} uom={order.product.uom} />
                    </Td>

                    <Td align="right">
                      {order.billingModel === 'PURE_CONVERSION' ? (
                        <Qty value={remaining} />
                      ) : (
                        <span className="text-[11px] text-slate-500">Company stock</span>
                      )}
                    </Td>

                    <Td align="right">{order.productionOrderCount}</Td>

                    <Td>
                      <RaiseJobWorkProductionButton order={order} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 5. Quality & release — US-JW-04, the EXISTING gate
// ---------------------------------------------------------------------------

export async function JobWorkQualityPanel() {
  const orders = await apiFetch<JobWorkOrderSummary[]>('/api/v1/job-work/orders', {
    authenticated: true,
  });

  const batchesByOrder = orders.ok
    ? await Promise.all(
        orders.data.map(async (order) => ({
          order,
          batches: await apiFetch<JobWorkDispatchableBatch[]>(
            `/api/v1/job-work/orders/${order.id}/dispatchable`,
            { authenticated: true },
          ),
        })),
      )
    : [];

  const rows = batchesByOrder.flatMap(({ order, batches }) =>
    batches.ok ? batches.data.map((batch) => ({ order, batch })) : [],
  );

  return (
    <Panel
      title="Quality & release"
      subtitle="Job-work batches pass the SAME quality gate as every other batch — US-QG-01, unchanged. Only a released batch can be dispatched to the principal."
      action={
        <RecordLink href="/workflows/production-quality/batch-release">
          Batch release →
        </RecordLink>
      }
    >
      {!orders.ok ? (
        <ErrorState message={`Could not load job-work orders: ${orders.error}`} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No released job-work batches."
          hint="A batch appears here once it has been manufactured, packed and released by the quality gate. Batches on hold or rejected stay on the Batch release screen until they are decided."
        />
      ) : (
        <TableWrap>
          <table className="w-full min-w-[68rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Batch</Th>
                <Th>Job-work order</Th>
                <Th>Product</Th>
                <Th>Quality gate</Th>
                <Th align="right">Available</Th>
                <Th>Expiry</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ order, batch }) => (
                <tr key={batch.batchId}>
                  <Td>
                    <p className="font-mono text-xs font-semibold text-slate-900">
                      <Code>{batch.batchNumber}</Code>
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {batch.productionOrderNumber}
                    </p>
                  </Td>

                  <Td>
                    <p className="font-mono text-xs text-slate-800"><Code>{order.orderNumber}</Code></p>
                    <p className="text-[11px] text-slate-500"><Name>{order.principalName}</Name></p>
                  </Td>

                  <Td valign="top">
                    <p className="text-slate-800"><Name>{batch.item.name}</Name></p>
                    <p className="text-[11px] text-slate-500">
                      sold as {order.product.principalBrandName}
                    </p>
                  </Td>

                  <Td>
                    {/* Section 17: the status AND what it permits, because the
                        consequence is the part someone needs. */}
                    <Pill tone="ok">Released</Pill>
                    <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                      Dispatch allowed
                    </span>
                  </Td>

                  <Td align="right">
                    <Qty value={batch.quantityAvailable} uom={batch.item.uom} />
                  </Td>

                  <Td>
                    <DateText value={batch.expiryDate} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 6. Outward dispatch — US-JW-05, the challan side
// ---------------------------------------------------------------------------

export async function OutwardDispatchPanel() {
  const orders = await apiFetch<JobWorkOrderSummary[]>('/api/v1/job-work/orders', {
    authenticated: true,
  });

  const dispatchable = orders.ok
    ? await Promise.all(
        orders.data.map(async (order) => ({
          order,
          batches: await apiFetch<JobWorkDispatchableBatch[]>(
            `/api/v1/job-work/orders/${order.id}/dispatchable`,
            { authenticated: true },
          ),
        })),
      )
    : [];

  const invoices = await apiFetch<JobWorkInvoiceView[]>('/api/v1/job-work/invoices', {
    authenticated: true,
  });

  return (
    <div className="space-y-5">
      <Panel
        title="Ready to dispatch"
        subtitle="Released batches, by job-work order. A batch that the quality gate has not released cannot be sent — the button is absent and the API refuses it."
      >
        {!orders.ok ? (
          <ErrorState message={`Could not load job-work orders: ${orders.error}`} />
        ) : dispatchable.length === 0 ? (
          <EmptyState title="No job-work orders yet." hint="Raise one to begin." />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[64rem] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <Th>Order</Th>
                  <Th>Principal / brand</Th>
                  <Th>Invoice basis</Th>
                  <Th align="right">Released batches</Th>
                  <Th align="right">Dispatched so far</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {dispatchable.map(({ order, batches }) => (
                  <tr key={order.id}>
                    <Td>
                      <p className="font-mono text-xs font-semibold text-slate-900">
                        <Code>{order.orderNumber}</Code>
                      </p>
                      <DateText value={order.deliveryDate} />
                    </Td>

                    <Td valign="top">
                      <p className="text-slate-800"><Name>{order.principalName}</Name></p>
                      <p className="max-w-[14rem] truncate text-[11px] text-slate-500">
                        {order.product.principalBrandName}
                      </p>
                    </Td>

                    <Td valign="top">
                      <DerivedTag badge="AUTO-DERIVED">
                        {JOB_WORK_INVOICE_BASIS_LABELS[order.invoiceBasis]}
                      </DerivedTag>
                    </Td>

                    <Td align="right">{batches.ok ? batches.data.length : '—'}</Td>

                    <Td align="right">
                      <Qty value={order.dispatchedQuantity} />
                    </Td>

                    <Td>
                      <CreateJobWorkDispatchButton
                        order={order}
                        batches={batches.ok ? batches.data : []}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      <Panel
        title="Dispatch challans"
        subtitle="What has gone back to the principal. The same record is the invoice — see Billing for the money side."
      >
        {!invoices.ok ? (
          <ErrorState message={`Could not load dispatches: ${invoices.error}`} />
        ) : invoices.data.length === 0 ? (
          <EmptyState
            title="Nothing dispatched yet."
            hint="Dispatch a released batch above and the challan appears here."
          />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[64rem] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <Th>Challan / invoice</Th>
                  <Th>Job-work order</Th>
                  <Th>Principal</Th>
                  <Th>Batch</Th>
                  <Th align="right">Quantity</Th>
                  <Th>Dispatched</Th>
                </tr>
              </thead>
              <tbody>
                {invoices.data.map((invoice) => (
                  <tr key={invoice.id}>
                    <Td>
                      <span className="font-mono text-xs font-semibold text-slate-900">
                        <Code>{invoice.invoiceNumber}</Code>
                      </span>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs">{invoice.jobWorkOrderNumber}</span>
                    </Td>
                    <Td><Name>{invoice.principalName}</Name></Td>
                    <Td>
                      <span className="font-mono text-xs"><Code>{invoice.batchNumber}</Code></span>
                    </Td>
                    <Td align="right">
                      <Qty value={invoice.dispatchedQuantity} />
                    </Td>
                    <Td>
                      <DateText value={invoice.dispatchDate} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. Billing — US-JW-05, the money side of the same record
// ---------------------------------------------------------------------------

export async function JobWorkBillingPanel() {
  const invoices = await apiFetch<JobWorkInvoiceView[]>('/api/v1/job-work/invoices', {
    authenticated: true,
  });

  return (
    <Panel
      title="Job-work billing"
      subtitle="The invoice basis is derived from each order's billing model and is never chosen: pure conversion bills the conversion charge only, own-procurement bills the full finished-goods value."
    >
      {!invoices.ok ? (
        <ErrorState message={`Could not load job-work invoices: ${invoices.error}`} />
      ) : invoices.data.length === 0 ? (
        <EmptyState
          title="Nothing invoiced yet."
          hint="An invoice is raised by the dispatch that sends a released batch back to the principal."
        />
      ) : (
        <TableWrap>
          <table className="w-full min-w-[80rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Invoice</Th>
                <Th>Principal</Th>
                <Th>Billing model</Th>
                <Th>Invoice basis</Th>
                <Th align="right">Quantity</Th>
                <Th align="right">Rate</Th>
                <Th align="right">Taxable</Th>
                <Th align="right">GST</Th>
                <Th align="right">Total</Th>
                <Th>Date</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.data.map((invoice) => (
                <tr key={invoice.id}>
                  <Td>
                    <p className="font-mono text-xs font-semibold text-slate-900">
                      <Code>{invoice.invoiceNumber}</Code>
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {invoice.jobWorkOrderNumber}
                    </p>
                  </Td>

                  <Td><Name>{invoice.principalName}</Name></Td>

                  <Td valign="top">
                    <Pill tone={PATH[invoice.billingModel]?.tone ?? 'neutral'}>
                      {BILLING_MODEL_LABELS[invoice.billingModel]}
                    </Pill>
                  </Td>

                  <Td valign="top">
                    <DerivedTag badge="AUTO-DERIVED">
                      {JOB_WORK_INVOICE_BASIS_LABELS[invoice.invoiceBasis]}
                    </DerivedTag>
                    {invoice.invoiceBasis === 'CONVERSION_CHARGE_ONLY' && (
                      <p className="mt-1 max-w-[16rem] text-[11px] leading-snug text-slate-500">
                        Raw-material value is not invoiced — the principal supplied it.
                      </p>
                    )}
                  </Td>

                  <Td align="right">
                    <Qty value={invoice.dispatchedQuantity} />
                  </Td>

                  <Td align="right">
                    <Money amount={invoice.rateApplied} />
                    {invoice.rateBasis && (
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {CONVERSION_RATE_BASIS_LABELS[invoice.rateBasis]}
                      </span>
                    )}
                  </Td>

                  <Td align="right">
                    <Money amount={invoice.taxableValue} />
                  </Td>

                  <Td align="right">
                    <Money amount={invoice.gstAmount} />
                    <span className="mt-0.5 block text-[11px] text-slate-500">
                      @ {invoice.gstRatePercent}%
                    </span>
                  </Td>

                  <Td align="right">
                    <Money amount={invoice.totalValue} bold />
                  </Td>

                  <Td>
                    <DateText value={invoice.dispatchDate} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 8. Job-work register — US-JW-06
// ---------------------------------------------------------------------------

export async function JobWorkRegisterPanel() {
  const register = await apiFetch<JobWorkRegisterGroup[]>('/api/v1/job-work/register', {
    authenticated: true,
  });

  return (
    <Panel
      title="Job-work register"
      subtitle="Read-only, and derived entirely from actual transactions — material receipts, material issues and dispatches. There is nothing here to edit and no form that writes it."
      action={
        <span className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Read-only · auto-derived
        </span>
      }
    >
      {!register.ok ? (
        <ErrorState message={`Could not load the job-work register: ${register.error}`} />
      ) : register.data.length === 0 ? (
        <EmptyState
          title="Nothing to report yet."
          hint="The register fills itself as material is received, consumed and dispatched against job-work orders."
        />
      ) : (
        <div className="divide-y-2 divide-slate-200">
          {register.data.map((group) => (
            <div key={`${group.principalId}:${group.agreementId}`} className="px-5 py-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900"><Name>{group.principalName}</Name></h3>
                  <p className="font-mono text-[11px] text-slate-500">
                    {group.agreementReference ?? 'No agreement reference'} ·{' '}
                    {BILLING_MODEL_LABELS[group.billingModel]}
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
                  <span>
                    Received <strong className="tabular-nums">{group.totalMaterialReceived}</strong>
                  </span>
                  <span>
                    Consumed <strong className="tabular-nums">{group.totalQuantityConsumed}</strong>
                  </span>
                  <span>
                    Dispatched{' '}
                    <strong className="tabular-nums">{group.totalFinishedGoodsDispatched}</strong>
                  </span>
                  <span>
                    Closing <strong className="tabular-nums">{group.totalClosingBalance}</strong>
                  </span>
                </div>
              </div>

              <TableWrap>
                <table className="w-full min-w-[64rem] text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-slate-500">
                      <Th>Job-work order</Th>
                      <Th>Brand / product</Th>
                      <Th align="right">Ordered</Th>
                      <Th align="right">Material received</Th>
                      <Th align="right">Consumed in production</Th>
                      <Th align="right">FG dispatched</Th>
                      <Th align="right">Closing balance</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <tr key={row.jobWorkOrderId}>
                        <Td>
                          <span className="font-mono text-xs font-semibold text-slate-900">
                            {row.jobWorkOrderNumber}
                          </span>
                        </Td>
                        <Td valign="top">
                          <p className="max-w-[14rem] truncate text-slate-800">
                            {row.principalBrandName}
                          </p>
                          <p className="text-[11px] text-slate-500"><Name>{row.productName}</Name></p>
                        </Td>
                        <Td align="right">
                          <Qty value={row.orderedQuantity} />
                        </Td>
                        <Td align="right">
                          <Qty value={row.materialReceived} />
                        </Td>
                        <Td align="right">
                          <Qty value={row.quantityConsumed} />
                        </Td>
                        <Td align="right">
                          <Qty value={row.finishedGoodsDispatched} />
                        </Td>
                        <Td align="right">
                          <strong className="tabular-nums">{row.closingBalance}</strong>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/**
 * Which Job Work step has a screen.
 *
 * Keyed by the same strings as WORKFLOWS, matching the production and
 * order-to-cash tables in the step page: a step marked 'ready' with no entry
 * here is a missing key rather than a silently blank page.
 */
export const JOB_WORK_STEPS: Record<string, () => React.ReactNode> = {
  principals: () => <PrincipalsPanel />,
  'job-work-orders': () => <JobWorkOrdersPanel />,
  'inward-materials': () => <InwardMaterialsPanel />,
  production: () => <JobWorkProductionPanel />,
  'quality-release': () => <JobWorkQualityPanel />,
  'outward-dispatch': () => <OutwardDispatchPanel />,
  billing: () => <JobWorkBillingPanel />,
  register: () => <JobWorkRegisterPanel />,
};
