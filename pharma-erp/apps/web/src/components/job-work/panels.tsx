import {
  AGREEMENT_STATUS_LABELS,
  BILLING_MODELS,
  BILLING_MODEL_LABELS,
  CONVERSION_RATE_BASIS_LABELS,
  JOB_WORK_INVOICE_BASIS_LABELS,
  STOCK_OWNERSHIP_LABELS,
  type JobWorkAgreementSummary,
  type JobWorkDispatchableBatch,
  type JobWorkInvoiceView,
  type JobWorkMaterialReadiness,
  type JobWorkMaterialReceiptView,
  type JobWorkOrderablePrincipal,
  type JobWorkOrderMaterial,
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
import Link from 'next/link';

import { apiFetch } from '@/lib/api';
import { FilterButton, FilterPanel, SearchBox } from '@/components/procurement/filter-bar';

import {
  CreateJobWorkDispatchButton,
  CreateJobWorkOrderButton,
  CreateJobWorkReceiptButton,
  EditJobWorkOrderButton,
  RaiseJobWorkProductionButton,
  ViewJobWorkReceiptButton,
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
// Reading the URL these screens filter themselves by
// ---------------------------------------------------------------------------

/** The query as Next hands it over, once awaited. */
export type StepQuery = Record<string, string | string[] | undefined>;

/** One value for a key, ignoring the repeated-parameter case nothing writes. */
const param = (query: StepQuery, key: string): string | undefined =>
  typeof query[key] === 'string' && query[key].trim() ? (query[key] as string).trim() : undefined;

/**
 * Whether a row answers the search term.
 *
 * EVERY WORD HAS TO APPEAR, in any of the fields handed in and in any order,
 * so "healwell 500" finds the HealCure-500 order for HealWell without anyone
 * having to remember which column holds which half of it.
 */
function matches(term: string | undefined, ...parts: (string | null | undefined)[]): boolean {
  if (!term) return true;

  const hay = parts.filter(Boolean).join(' ').toLowerCase();

  return term
    .toLowerCase()
    .split(/\s+/)
    .every((word) => hay.includes(word));
}

/** The principals in a set of rows, as filter options. */
/**
 * The principals present in a list, newest first.
 *
 * ORDERED BY THE MOST RECENT RECORD EACH ONE APPEARS ON, which is the closest
 * thing to "newest first" a filter derived from a list can honestly be: the
 * principal somebody wants is the one they were just working with. Every list
 * that feeds this carries the created date of its own records, so the ordering
 * is read rather than guessed at from a document number.
 *
 * Derived from the rows rather than fetched, deliberately: the filter offers
 * the principals this list actually contains, so choosing one always narrows
 * to something instead of emptying the screen.
 */
function principalOptions<T extends { principalId: string; principalName: string }>(
  rows: readonly T[],
  /**
   * When the row was created, as ISO 8601.
   *
   * Passed rather than assumed: most of these records call it `createdAt`, a
   * material receipt calls it `receivedAt`, and both are the moment the row
   * was written. ISO 8601 strings compare correctly as text, so no parsing.
   */
  createdAt: (row: T) => string,
): { value: string; label: string }[] {
  const newest = new Map<string, { label: string; createdAt: string }>();

  for (const row of rows) {
    const held = newest.get(row.principalId);
    const at = createdAt(row);

    if (!held || at > held.createdAt) {
      newest.set(row.principalId, { label: row.principalName, createdAt: at });
    }
  }

  return [...newest]
    .sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt))
    .map(([value, { label }]) => ({ value, label }));
}

/** The two billing models, as filter options. */
const BILLING_MODEL_OPTIONS = BILLING_MODELS.map((model) => ({
  value: model,
  label: BILLING_MODEL_LABELS[model],
}));

/** The count a table title carries, with no explanation attached to it. */
const countLabel = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------
// 1. Principals — the agreement register (US-MD-05)
// ---------------------------------------------------------------------------

export async function PrincipalsPanel(query: StepQuery) {
  const agreements = await apiFetch<JobWorkAgreementSummary[]>('/api/v1/job-work/agreements', {
    authenticated: true,
  });

  const search = param(query, 'search');
  const principalId = param(query, 'principalId');
  const billingModel = param(query, 'billingModel');

  const all = agreements.ok ? agreements.data : [];

  const rows = all.filter(
    (agreement) =>
      (!principalId || agreement.principalId === principalId) &&
      (!billingModel || agreement.billingModel === billingModel) &&
      matches(
        search,
        agreement.principalName,
        agreement.agreementReference,
        BILLING_MODEL_LABELS[agreement.billingModel],
        ...agreement.mappings.map((mapping) => mapping.principalBrandName),
        ...agreement.mappings.map((mapping) => mapping.productName),
      ),
  );

  return (
    <Panel
      title="Principals & job-work agreements"
      subtitle={agreements.ok ? countLabel(rows.length, 'agreement') : undefined}
      action={
        <>
          <SearchBox placeholder="Search by principal, reference, brand or product…" />
          <FilterButton />

          {/* The register itself lives in Master Data, which owns creating and
              editing it. Duplicating that form here would be a second place for
              the same record to be written from, and a second place to fix.

              An <a> styled as a button, not a <button> that navigates: this
              goes somewhere, so middle-click, open-in-new-tab and the status
              bar preview should all keep working. */}
          <Link
            href="/master-data/principal-job-work"
            className="inline-flex h-9 items-center whitespace-nowrap rounded-md bg-slate-900 px-3 text-sm font-medium text-white no-underline transition hover:bg-slate-800"
          >
            Manage in Master Data
          </Link>
        </>
      }
    >
      <FilterPanel
        principals={principalOptions(all, (row) => row.createdAt)}
        billingModels={BILLING_MODEL_OPTIONS}
        showDates={false}
      />

      {!agreements.ok ? (
        <ErrorState message={`Could not load job-work agreements: ${agreements.error}`} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={
            all.length === 0 ? 'No job-work agreements yet.' : 'No agreement matches that.'
          }
          hint={
            all.length === 0
              ? 'Record the brand owner as a job-work principal in the Party register, then write an agreement against it in Master Data.'
              : undefined
          }
          filtered={all.length > 0}
        />
      ) : (
        <TableWrap>
          <table className="w-full min-w-[86rem] text-left text-sm">
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
              {rows.map((agreement) => {
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

export async function JobWorkOrdersPanel(query: StepQuery) {
  const [orders, principals] = await Promise.all([
    apiFetch<JobWorkOrderSummary[]>('/api/v1/job-work/orders', { authenticated: true }),
    apiFetch<JobWorkOrderablePrincipal[]>('/api/v1/job-work/orders/orderable', {
      authenticated: true,
    }),
  ]);

  const search = param(query, 'search');
  const principalId = param(query, 'principalId');
  const billingModel = param(query, 'billingModel');

  const all = orders.ok ? orders.data : [];

  const rows = all.filter(
    (order) =>
      (!principalId || order.principalId === principalId) &&
      (!billingModel || order.billingModel === billingModel) &&
      matches(
        search,
        order.orderNumber,
        order.principalName,
        order.product.principalBrandName,
        order.product.productName,
        order.product.productCode,
        BILLING_MODEL_LABELS[order.billingModel],
      ),
  );

  return (
    <Panel
      title="Job-work orders"
      subtitle={orders.ok ? countLabel(rows.length, 'order') : undefined}
      action={
        <>
          <SearchBox placeholder="Search by order no., principal, brand or product…" />
          <FilterButton />
          {principals.ok ? <CreateJobWorkOrderButton principals={principals.data} /> : null}
        </>
      }
    >
      <FilterPanel
        principals={principalOptions(all, (row) => row.createdAt)}
        billingModels={BILLING_MODEL_OPTIONS}
        showDates={false}
      />

      {!orders.ok ? (
        <ErrorState message={`Could not load job-work orders: ${orders.error}`} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? 'No job-work orders yet.' : 'No order matches that.'}
          hint={
            all.length === 0
              ? 'An order can only be raised against a principal whose agreement is in force. Create one with the button above.'
              : undefined
          }
          filtered={all.length > 0}
        />
      ) : (
        <TableWrap>
          <table className="w-full min-w-[86rem] text-left text-sm">
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
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
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

                  <Td>
                    {/* The API has accepted a change of quantity, delivery date
                        or notes since these orders were built; no screen ever
                        offered it. The terms — principal, product, brand,
                        billing model — are not editable anywhere, and the
                        dialog shows them read-only rather than hiding them. */}
                    <EditJobWorkOrderButton order={order} />
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

export async function InwardMaterialsPanel(query: StepQuery) {
  const [receipts, orders] = await Promise.all([
    apiFetch<JobWorkMaterialReceiptView[]>('/api/v1/job-work/material-receipts', {
      authenticated: true,
    }),
    apiFetch<JobWorkOrderSummary[]>('/api/v1/job-work/orders', { authenticated: true }),
  ]);

  // Only PURE_CONVERSION orders can take a free-of-cost receipt; the API
  // refuses the rest, so the form must not offer them.
  const conversionOrders = orders.ok
    ? orders.data.filter((order) => order.billingModel === 'PURE_CONVERSION')
    : [];

  // Counted so the empty states can tell "you have no job-work orders" apart
  // from "your orders are all on the model this screen does not serve" — two
  // situations that need opposite advice.
  const ownProcurementOrders = orders.ok
    ? orders.data.filter((order) => order.billingModel === 'OWN_PROCUREMENT').length
    : 0;

  // WHAT EACH ORDER'S FORMULATION CALLS FOR, resolved here rather than in the
  // browser so choosing an order on the form lays its materials out at once.
  // An order whose BOM is missing or empty is left out of the map on purpose —
  // the API says so with a 400, and the form turns that absence into the
  // message rather than an empty list of rows to fill in.
  const materialsByOrder: Record<string, JobWorkOrderMaterial[]> = {};

  await Promise.all(
    conversionOrders.map(async (order) => {
      const materials = await apiFetch<JobWorkOrderMaterial[]>(
        `/api/v1/job-work/orders/${order.id}/materials`,
        { authenticated: true },
      );

      if (materials.ok) materialsByOrder[order.id] = materials.data;
    }),
  );

  const search = param(query, 'search');
  const principalId = param(query, 'principalId');

  const allReceipts = receipts.ok ? receipts.data : [];

  // ONE ROW PER MATERIAL, under the challan it arrived on. The register is
  // read material by material — "have we got the lactose, and is it released"
  // — so flattening here is what makes the table answer that question, while
  // the receipt's own identity travels with every row.
  const rows = allReceipts
    .filter((receipt) => !principalId || receipt.principalId === principalId)
    .flatMap((receipt) => receipt.lines.map((line) => ({ receipt, line })))
    .filter(({ receipt, line }) =>
      matches(
        search,
        receipt.receiptNumber,
        receipt.deliveryChallanNumber,
        receipt.principalName,
        receipt.jobWorkOrderNumber,
        line.item.name,
        line.item.code,
        line.batchNumber,
        line.lotNumber,
      ),
    );

  return (
    <Panel
      title="Inward materials"
      subtitle={receipts.ok ? countLabel(rows.length, 'material line') : undefined}
      action={
        <>
          <SearchBox placeholder="Search by receipt, challan, principal, order, item or batch…" />
          <FilterButton />
          {orders.ok ? (
            <CreateJobWorkReceiptButton
              orders={conversionOrders}
              materialsByOrder={materialsByOrder}
              ownProcurementOrderCount={ownProcurementOrders}
            />
          ) : null}
        </>
      }
    >
      <FilterPanel
        principals={principalOptions(allReceipts, (receipt) => receipt.receivedAt)}
        showDates={false}
      />

      {!receipts.ok ? (
        <ErrorState message={`Could not load material receipts: ${receipts.error}`} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={
            conversionOrders.length === 0 && ownProcurementOrders > 0
              ? 'Nothing is received here on your current agreements.'
              : 'No principal material received yet.'
          }
          hint={
            conversionOrders.length === 0 && ownProcurementOrders > 0
              ? 'Every job-work order you hold is on the own-procurement model, where you buy the material yourself through Procure to Pay. This screen records material a principal ships you free of cost under a pure-conversion agreement.'
              : 'Under pure conversion the principal ships the raw material on their own delivery challan. Record it here and it enters principal-owned stock.'
          }
        />
      ) : (
        <TableWrap>
          <table className="w-full min-w-[98rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Receipt</Th>
                <Th>Job-work order</Th>
                <Th>Delivery challan</Th>
                <Th>Material</Th>
                <Th>Batch / lot</Th>
                <Th align="right">Received</Th>
                <Th align="right">Remaining</Th>
                <Th>QC</Th>
                <Th>Ownership</Th>
                <Th>Expiry</Th>
                <Th>Recorded</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ receipt, line }) => (
                <tr key={line.id}>
                  <Td>
                    <p className="font-mono text-xs font-semibold text-slate-900">
                      <Code>{receipt.receiptNumber}</Code>
                    </p>
                    {line.lotNumber && (
                      <p className="font-mono text-[11px] text-slate-500">
                        <Code>{line.lotNumber}</Code>
                      </p>
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
                    <p className="text-slate-800"><Name>{line.item.name}</Name></p>
                    <p className="font-mono text-[11px] text-slate-500"><Code>{line.item.code}</Code></p>
                  </Td>

                  <Td>
                    <span className="font-mono text-xs"><Code>{line.batchNumber}</Code></span>
                  </Td>

                  <Td align="right">
                    <Qty value={line.receivedQuantity} uom={line.item.uom} />
                  </Td>

                  <Td align="right">
                    {line.lotQuantityAvailable ? (
                      <Qty value={line.lotQuantityAvailable} uom={line.item.uom} />
                    ) : (
                      <Blank />
                    )}
                  </Td>

                  <Td valign="top">
                    {/* THE DRUM’S OWN STATE, not the challan’s summary: a
                        consignment can be half released, and the row that
                        matters to a production officer is this one. */}
                    {!receipt.qcRequired ? (
                      <>
                        <Pill tone="info">Not required</Pill>
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          Usable on arrival
                        </span>
                      </>
                    ) : line.lotStatus === 'USABLE' ? (
                      <Pill tone="ok">Released</Pill>
                    ) : line.lotStatus === 'QUARANTINE' ? (
                      <>
                        <Pill tone="warn">QC pending</Pill>
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          Cannot be issued yet
                        </span>
                      </>
                    ) : line.lotStatus === 'ON_HOLD' ? (
                      <Pill tone="warn">On hold</Pill>
                    ) : line.lotStatus === 'REJECTED' ? (
                      <Pill tone="danger">Rejected</Pill>
                    ) : (
                      <Blank />
                    )}
                  </Td>

                  <Td valign="top">
                    <DerivedTag badge="SYSTEM-SET">
                      <Pill tone="warn">{STOCK_OWNERSHIP_LABELS[line.stockOwnership]}</Pill>
                    </DerivedTag>
                  </Td>

                  <Td>
                    <DateText value={line.expiryDate} />
                  </Td>

                  <Td>
                    <DateTimeText value={receipt.receivedAt} />
                    {receipt.receivedBy && (
                      <span className="block text-[11px] text-slate-500">
                        <Name>{receipt.receivedBy}</Name>
                      </span>
                    )}
                  </Td>

                  <Td>
                    {/* The PARENT receipt, opened from any of its material
                        rows: the register is read material by material, and
                        this is the way back to the document. */}
                    <ViewJobWorkReceiptButton receipt={receipt} />
                  </Td>
                </tr>
              ))}            </tbody>
          </table>
        </TableWrap>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 4. Production — US-JW-03, through the EXISTING work order
// ---------------------------------------------------------------------------

export async function JobWorkProductionPanel(query: StepQuery) {
  const orders = await apiFetch<JobWorkOrderSummary[]>('/api/v1/job-work/orders', {
    authenticated: true,
  });

  // WHETHER EACH ORDER COULD BE MANUFACTURED, resolved here with the list so
  // the form opens on a filled-in table rather than a spinner. The same call
  // the work-order service makes when the button is pressed, which is what
  // stops the screen and the refusal disagreeing.
  const readinessByOrder: Record<string, JobWorkMaterialReadiness> = {};

  await Promise.all(
    (orders.ok ? orders.data : []).map(async (order) => {
      const readiness = await apiFetch<JobWorkMaterialReadiness>(
        `/api/v1/job-work/orders/${order.id}/readiness`,
        { authenticated: true },
      );

      if (readiness.ok) readinessByOrder[order.id] = readiness.data;
    }),
  );

  const search = param(query, 'search');
  const principalId = param(query, 'principalId');
  const billingModel = param(query, 'billingModel');

  const all = orders.ok ? orders.data : [];

  const rows = all.filter(
    (order) =>
      (!principalId || order.principalId === principalId) &&
      (!billingModel || order.billingModel === billingModel) &&
      matches(
        search,
        order.orderNumber,
        order.principalName,
        order.product.principalBrandName,
        order.product.productName,
        order.product.productCode,
      ),
  );

  return (
    <Panel
      title="Job-work production"
      subtitle={orders.ok ? countLabel(rows.length, 'order') : undefined}
      action={
        <>
          <SearchBox placeholder="Search by order no., principal, brand or product…" />
          <FilterButton />
          <RecordLink href="/workflows/production-quality/production-orders">
            All work orders →
          </RecordLink>
        </>
      }
    >
      <FilterPanel
        principals={principalOptions(all, (row) => row.createdAt)}
        billingModels={BILLING_MODEL_OPTIONS}
        showDates={false}
      />

      {!orders.ok ? (
        <ErrorState message={`Could not load job-work orders: ${orders.error}`} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={
            all.length === 0 ? 'No job-work orders to manufacture.' : 'No order matches that.'
          }
          hint={
            all.length === 0
              ? 'Raise a job-work order first; production is then raised against it.'
              : undefined
          }
          filtered={all.length > 0}
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
                <Th>Material readiness</Th>
                <Th align="right">Work orders</Th>
                <Th>Raise production</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => {
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

                    <Td valign="top">
                      {/* THE ANSWER THE BUTTON WILL GIVE, before it is pressed.
                          Short by how much, and on which material — the detail
                          is in the form, but the verdict belongs on the row. */}
                      {(() => {
                        const readiness = readinessByOrder[order.id];

                        if (!readiness) return <Blank />;
                        if (readiness.ready) return <Pill tone="ok">Ready</Pill>;

                        const short = readiness.lines.filter((line) => !line.ready);

                        return (
                          <>
                            <Pill tone="warn">
                              {short.length > 0 ? `Short ${short.length}` : 'Blocked'}
                            </Pill>
                            <span className="mt-0.5 block max-w-[16rem] text-[10px] text-slate-500">
                              {short.length > 0
                                ? short.map((line) => line.item.code).join(', ')
                                : readiness.blockedReason}
                            </span>
                          </>
                        );
                      })()}
                    </Td>

                    <Td align="right">{order.productionOrderCount}</Td>

                    <Td>
                      <RaiseJobWorkProductionButton
                        order={order}
                        readiness={readinessByOrder[order.id] ?? null}
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
// 5. Quality & release — US-JW-04, the EXISTING gate
// ---------------------------------------------------------------------------

export async function JobWorkQualityPanel(query: StepQuery) {
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

  const allRows = batchesByOrder.flatMap(({ order, batches }) =>
    batches.ok ? batches.data.map((batch) => ({ order, batch })) : [],
  );

  const search = param(query, 'search');
  const principalId = param(query, 'principalId');

  const rows = allRows.filter(
    ({ order, batch }) =>
      (!principalId || order.principalId === principalId) &&
      matches(
        search,
        order.orderNumber,
        order.principalName,
        order.product.principalBrandName,
        order.product.productName,
        batch.batchNumber,
      ),
  );

  return (
    <Panel
      title="Quality & release"
      subtitle={countLabel(rows.length, 'released batch')}
      action={
        <>
          <SearchBox placeholder="Search by batch, order no., principal or brand…" />
          <FilterButton />
          <RecordLink href="/workflows/production-quality/batch-release">
            Batch release →
          </RecordLink>
        </>
      }
    >
      <FilterPanel
        principals={principalOptions(orders.ok ? orders.data : [], (order) => order.createdAt)}
        showDates={false}
      />

      {!orders.ok ? (
        <ErrorState message={`Could not load job-work orders: ${orders.error}`} />
      ) : rows.length === 0 ? (
        <EmptyState
          filtered={allRows.length > 0}
          title={
            allRows.length === 0 ? 'No released job-work batches.' : 'No batch matches that.'
          }
          hint="A batch appears here once it has been manufactured, packed and released by the quality gate. Batches on hold or rejected stay on the Batch release screen until they are decided."
        />
      ) : (
        <TableWrap>
          <table className="w-full min-w-[84rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Batch</Th>
                <Th>Job-work order</Th>
                <Th>Product</Th>
                <Th>Ownership</Th>
                <Th>Quality gate</Th>
                <Th align="right">Available</Th>
                <Th>Expiry</Th>
                <Th>Release</Th>
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
                    {/* OFF THE LOT, not off the agreement — see the wire type.
                        On the table rather than behind the row, because "whose
                        goods are these" is the question this screen is scanned
                        for and opening every batch to answer it is the cost the
                        column removes. */}
                    <Pill tone={batch.stockOwnership === 'PRINCIPAL_OWNED' ? 'warn' : 'info'}>
                      {STOCK_OWNERSHIP_LABELS[batch.stockOwnership]}
                    </Pill>
                    {batch.stockOwnership === 'PRINCIPAL_OWNED' ? (
                      <span className="mt-0.5 block text-[10px] text-slate-500">
                        <Name>{order.principalName}</Name>
                      </span>
                    ) : null}
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

                  <Td>
                    {/* THE SAME BATCH RELEASE SCREEN, opened on this batch. The
                        gate itself lives in Production & Quality and is not
                        reimplemented here; the link carries the batch number as
                        that screen's own search term, so the decision history
                        for this batch is what loads. */}
                    <RecordLink
                      href={`/workflows/production-quality/batch-release?search=${encodeURIComponent(
                        batch.batchNumber,
                      )}`}
                    >
                      Open
                    </RecordLink>
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

export async function OutwardDispatchPanel(query: StepQuery) {
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

  const search = param(query, 'search');
  const principalId = param(query, 'principalId');

  const allOrders = orders.ok ? orders.data : [];

  const readyRows = dispatchable.filter(
    ({ order }) =>
      (!principalId || order.principalId === principalId) &&
      matches(
        search,
        order.orderNumber,
        order.principalName,
        order.product.principalBrandName,
        order.product.productName,
      ),
  );

  const allInvoices = invoices.ok ? invoices.data : [];

  const challans = allInvoices.filter(
    (invoice) =>
      (!principalId || invoice.principalId === principalId) &&
      matches(
        search,
        invoice.invoiceNumber,
        invoice.principalName,
        invoice.jobWorkOrderNumber,
        invoice.batchNumber,
      ),
  );

  return (
    <div className="space-y-5">
      <Panel
        title="Ready to dispatch"
        subtitle={countLabel(readyRows.length, 'order')}
        action={
          <>
            <SearchBox placeholder="Search by order no., principal, brand or batch…" />
            <FilterButton />
          </>
        }
      >
        <FilterPanel
          principals={principalOptions(allOrders, (order) => order.createdAt)}
          showDates={false}
        />

        {!orders.ok ? (
          <ErrorState message={`Could not load job-work orders: ${orders.error}`} />
        ) : dispatchable.length === 0 ? (
          <EmptyState title="No job-work orders yet." hint="Raise one to begin." />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[78rem] text-left text-sm">
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

      <Panel title="Dispatch challans" subtitle={countLabel(challans.length, 'challan')}>
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

export async function JobWorkBillingPanel(query: StepQuery) {
  const invoices = await apiFetch<JobWorkInvoiceView[]>('/api/v1/job-work/invoices', {
    authenticated: true,
  });

  const search = param(query, 'search');
  const principalId = param(query, 'principalId');
  const billingModel = param(query, 'billingModel');

  const all = invoices.ok ? invoices.data : [];

  const rows = all.filter(
    (invoice) =>
      (!principalId || invoice.principalId === principalId) &&
      (!billingModel || invoice.billingModel === billingModel) &&
      matches(
        search,
        invoice.invoiceNumber,
        invoice.principalName,
        invoice.jobWorkOrderNumber,
        invoice.batchNumber,
      ),
  );

  return (
    <Panel
      title="Job-work billing"
      subtitle={invoices.ok ? countLabel(rows.length, 'invoice') : undefined}
      action={
        <>
          <SearchBox placeholder="Search by invoice no., principal, order or batch…" />
          <FilterButton />
        </>
      }
    >
      <FilterPanel
        principals={principalOptions(all, (row) => row.createdAt)}
        billingModels={BILLING_MODEL_OPTIONS}
        showDates={false}
      />

      {!invoices.ok ? (
        <ErrorState message={`Could not load job-work invoices: ${invoices.error}`} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? 'Nothing invoiced yet.' : 'No invoice matches that.'}
          hint={
            all.length === 0
              ? 'An invoice is raised by the dispatch that sends a released batch back to the principal.'
              : undefined
          }
          filtered={all.length > 0}
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

export async function JobWorkRegisterPanel(query: StepQuery) {
  const register = await apiFetch<JobWorkRegisterGroup[]>('/api/v1/job-work/register', {
    authenticated: true,
  });

  const search = param(query, 'search');
  const principalId = param(query, 'principalId');
  const billingModel = param(query, 'billingModel');

  const all = register.ok ? register.data : [];

  // Filtered at BOTH levels: a group survives if any of its rows matches, and
  // then shows only the rows that did — so searching an order number gives that
  // order under its own principal rather than the whole group it sits in.
  const groups = all
    .filter(
      (group) =>
        (!principalId || group.principalId === principalId) &&
        (!billingModel || group.billingModel === billingModel),
    )
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) =>
        matches(
          search,
          row.jobWorkOrderNumber,
          row.principalName,
          row.productName,
          row.principalBrandName,
          group.agreementReference,
        ),
      ),
    }))
    .filter((group) => group.rows.length > 0);

  return (
    <Panel
      title="Job-work register"
      subtitle={register.ok ? countLabel(groups.length, 'agreement') : undefined}
      action={
        <>
          <SearchBox placeholder="Search by order no., principal, brand or product…" />
          <FilterButton />

          <span className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Read-only · auto-derived
          </span>
        </>
      }
    >
      <FilterPanel
        principals={principalOptions(
          all.flatMap((group) => group.rows),
          (row) => row.createdAt,
        )}
        billingModels={BILLING_MODEL_OPTIONS}
        showDates={false}
      />

      {!register.ok ? (
        <ErrorState message={`Could not load the job-work register: ${register.error}`} />
      ) : groups.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? 'Nothing to report yet.' : 'Nothing matches that.'}
          hint={
            all.length === 0
              ? 'The register fills itself as material is received, consumed and dispatched against job-work orders.'
              : undefined
          }
          filtered={all.length > 0}
        />
      ) : (
        <div className="divide-y-2 divide-slate-200">
          {groups.map((group) => (
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
                    Produced{' '}
                    <strong className="tabular-nums">{group.totalFinishedGoodsProduced}</strong>
                  </span>
                  <span>
                    Dispatched{' '}
                    <strong className="tabular-nums">{group.totalFinishedGoodsDispatched}</strong>
                  </span>
                  <span>
                    Closing <strong className="tabular-nums">{group.totalClosingBalance}</strong>
                  </span>
                  <span>
                    Invoiced{' '}
                    <strong className="tabular-nums">
                      <Money amount={group.totalInvoicedAmount} />
                    </strong>
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
                      <Th align="right">FG produced</Th>
                      <Th align="right">FG dispatched</Th>
                      <Th align="right">Closing balance</Th>
                      <Th>Invoice</Th>
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
                          {/* UNDER OWN PROCUREMENT THE PRINCIPAL SENDS NOTHING,
                              so this is not a zero — it is a column that does
                              not apply. Saying so is the difference between
                              "none arrived" and "none was expected". */}
                          {row.billingModel === 'PURE_CONVERSION' ? (
                            <Qty value={row.materialReceived} />
                          ) : (
                            <span className="text-[11px] text-slate-400">Not applicable</span>
                          )}
                        </Td>
                        <Td align="right">
                          <Qty value={row.quantityConsumed} />
                        </Td>
                        <Td align="right">
                          <Qty value={row.finishedGoodsProduced} />
                        </Td>
                        <Td align="right">
                          <Qty value={row.finishedGoodsDispatched} />
                        </Td>
                        <Td align="right">
                          {row.billingModel === 'PURE_CONVERSION' ? (
                            <strong className="tabular-nums">{row.closingBalance}</strong>
                          ) : (
                            <span className="text-[11px] text-slate-400">Not applicable</span>
                          )}
                        </Td>
                        <Td valign="top">
                          {row.invoiceNumbers.length === 0 ? (
                            <Blank />
                          ) : (
                            <>
                              <p className="font-mono text-[11px] text-slate-700">
                                {row.invoiceNumbers.join(', ')}
                              </p>
                              <p className="text-[11px] font-semibold text-slate-900">
                                <Money amount={row.invoicedAmount} />
                              </p>
                            </>
                          )}
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
export const JOB_WORK_STEPS: Record<string, (query: StepQuery) => React.ReactNode> = {
  principals: (query) => <PrincipalsPanel {...query} />,
  'job-work-orders': (query) => <JobWorkOrdersPanel {...query} />,
  'inward-materials': (query) => <InwardMaterialsPanel {...query} />,
  production: (query) => <JobWorkProductionPanel {...query} />,
  'quality-release': (query) => <JobWorkQualityPanel {...query} />,
  'outward-dispatch': (query) => <OutwardDispatchPanel {...query} />,
  billing: (query) => <JobWorkBillingPanel {...query} />,
  register: (query) => <JobWorkRegisterPanel {...query} />,
};
