import {
  AGREEMENT_STATUS_LABELS,
  BILLING_MODELS,
  BILLING_MODEL_LABELS,
  CONVERSION_RATE_BASIS_LABELS,
  JOB_WORK_INVOICE_BASIS_LABELS,
  JOB_WORK_PRODUCTION_STAGES,
  JOB_WORK_PRODUCTION_STAGE_LABELS,
  JOB_WORK_RECEIPT_STATUSES,
  JOB_WORK_RECEIPT_STATUS_LABELS,
  STOCK_OWNERSHIP_LABELS,
  type JobWorkAgreementSummary,
  type JobWorkBatchView,
  type JobWorkDispatchableBatch,
  type JobWorkEligibleReceipt,
  type JobWorkInvoiceView,
  type JobWorkIssuePlan,
  type JobWorkMaterialIssueView,
  type JobWorkMaterialReceiptView,
  type JobWorkOrderablePrincipal,
  type JobWorkOrderSummary,
  type JobWorkProductionOrderView,
  type JobWorkProductionStage,
  type JobWorkRegisterGroup,
  type PackagingRequirementView,
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
  StatusPill,
  TableWrap,
  Td,
  Th,
  Name,
  Code,
} from '@/components/procurement/ui';
import Link from 'next/link';

import { apiFetch, type ApiResult } from '@/lib/api';
import { FilterButton, FilterPanel, SearchBox } from '@/components/procurement/filter-bar';

import {
  CreateJobWorkDispatchButton,
  CreateJobWorkOrderButton,
  CreateJobWorkReceiptButton,
  EditJobWorkOrderButton,
  JobWorkQualityCheckRowActions,
  JobWorkProductionRowActions,
  JobWorkInwardRowActions,
  ViewJobWorkInvoiceButton,
} from './forms';
// The Production & Quality Gate register, drawer, confirmation dialog and
// sub-tab switcher, imported and used unchanged. That module is not modified by
// any of this — see production-tables.tsx for why they are reused rather than
// reimplemented.
import { ProductionRegister } from '@/components/production/register';
import {
  EmptyState as ProductionEmptyState,
  LoadError,
  Panel as ProductionPanel,
} from '@/components/production/shared';
import { ProductionTabs } from '@/components/production/tabs';
import { requireSession } from '@/lib/session';

import {
  IssueJobWorkMaterialForm,
  JobWorkPackingRecordSummary,
  JobWorkReleaseDecisionForm,
  type JobWorkPackSpecification,
  RaiseJobWorkProductionOrderForm,
  RecordJobWorkBatchForm,
  RecordJobWorkPackingForm,
} from './production-forms';
import {
  JobWorkBatchRecords,
  JobWorkDecidedTable,
  JobWorkIssueTable,
  JobWorkOrderTable,
  JobWorkPendingReleaseList,
  JobWorkReceivedMaterialTable,
  JobWorkReleasedTable,
} from './production-tables';

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
 * A value the system decided is shown rather than hidden (section 17), so
 * nobody has to guess what a record holds. Section 17 also asked for a badge
 * naming the kind of decision — SYSTEM-DERIVED and the rest — and those were
 * withdrawn at the product owner's request. The values are unchanged; only the
 * technical label describing them is gone.
 */

/**
 * A system-decided value in a table cell.
 *
 * Named for what it holds rather than for the badge it used to carry: the
 * SYSTEM-DERIVED / AUTO-INHERITED markers were withdrawn at the product
 * owner's request, since a register is read for what the values are and not
 * for how the system arrived at them.
 *
 * Kept as a component because it is the one place these cells' spacing and
 * type size are decided, and because the values inside it are still derived —
 * only the label describing that is gone.
 */
function DerivedValue({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-sm text-slate-800">{children}</span>
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

/**
 * An authenticated read, with the timeout the Production panels use.
 *
 * The caller’s own bearer token, so the API’s role checks apply to the read as
 * well as to the write: a step a role cannot read renders the refusal rather
 * than an empty table, because an empty table is a claim and a wrong claim is
 * worse than a visible gap.
 */
const get = <T,>(path: string): Promise<ApiResult<T>> =>
  apiFetch<T>(path, { authenticated: true, timeoutMs: 20_000 });

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
                    <DerivedValue>
                      <Pill tone={PATH[order.billingModel]?.tone ?? 'neutral'}>
                        {BILLING_MODEL_LABELS[order.billingModel]}
                      </Pill>
                    </DerivedValue>
                  </Td>

                  <Td valign="top">
                    <DerivedValue>
                      {STOCK_OWNERSHIP_LABELS[order.stockBucket]}
                    </DerivedValue>
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

  const search = param(query, 'search');
  const principalId = param(query, 'principalId');

  const allReceipts = receipts.ok ? receipts.data : [];

  // ONE ROW PER RECEIPT. The register answers "what has this principal sent
  // us against this order, and where has it got to" — which is a question
  // about the document. Searching still reaches the materials inside it, so a
  // batch number or an item code finds the receipt that holds it.
  const rows = allReceipts
    .filter((receipt) => !principalId || receipt.principalId === principalId)
    .filter((receipt) =>
      matches(
        search,
        receipt.receiptNumber,
        receipt.principalName,
        receipt.jobWorkOrderNumber,
        ...receipt.deliveryChallanNumbers,
        ...receipt.lines.map((line) => line.item.name),
        ...receipt.lines.map((line) => line.item.code),
        ...receipt.lines.map((line) => line.batchNumber),
      ),
    );

  return (
    <Panel
      title="Inward materials"
      subtitle={receipts.ok ? countLabel(rows.length, 'receipt') : undefined}
      action={
        <>
          <SearchBox placeholder="Search by receipt, challan, principal, order, item or batch…" />
          <FilterButton />
          {orders.ok ? (
            <CreateJobWorkReceiptButton
              orders={conversionOrders}
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
                <Th>Product</Th>
                <Th align="right">Raw</Th>
                <Th align="right">Packing</Th>
                <Th>Challans</Th>
                <Th>Status</Th>
                <Th>Recorded</Th>
                <Th align="right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((receipt) => (
                <tr key={receipt.id}>
                  <Td>
                    <p className="font-mono text-xs font-semibold text-slate-900">
                      <Code>{receipt.receiptNumber}</Code>
                    </p>
                    <p className="text-[11px] text-slate-500">
                      <DateText value={receipt.receiptDate} />
                    </p>
                  </Td>

                  <Td>
                    <p className="font-mono text-xs text-slate-800">{receipt.jobWorkOrderNumber}</p>
                    <p className="text-[11px] text-slate-500"><Name>{receipt.principalName}</Name></p>
                  </Td>

                  <Td valign="top">
                    <p className="text-slate-800"><Name>{receipt.productName}</Name></p>
                    <p className="text-[11px] text-slate-500">
                      sold as {receipt.principalBrandName}
                    </p>
                  </Td>

                  <Td align="right">{receipt.rawMaterialCount}</Td>
                  <Td align="right">{receipt.packingMaterialCount}</Td>

                  <Td>
                    {/* Named as challans everywhere they appear. US-JW-02 is
                        explicit that they are not purchase invoices. */}
                    {receipt.deliveryChallanNumbers.length === 0 ? (
                      <Blank />
                    ) : (
                      <span className="font-mono text-[11px] text-slate-700">
                        {receipt.deliveryChallanNumbers.join(", ")}
                      </span>
                    )}
                  </Td>

                  <Td valign="top">
                    <Pill
                      tone={
                        receipt.status === 'APPROVED'
                          ? 'ok'
                          : receipt.status === 'REJECTED'
                            ? 'danger'
                            : receipt.status === 'DRAFT'
                              ? 'info'
                              : 'warn'
                      }
                    >
                      {JOB_WORK_RECEIPT_STATUS_LABELS[receipt.status]}
                    </Pill>
                    {receipt.status === 'PENDING_APPROVAL' && (
                      <span className="mt-0.5 block text-[10px] text-slate-500">
                        Waiting on Quality check
                      </span>
                    )}
                  </Td>

                  <Td>
                    <DateTimeText value={receipt.receivedAt} />
                    {receipt.receivedBy && (
                      <span className="block text-[11px] text-slate-500">
                        <Name>{receipt.receivedBy}</Name>
                      </span>
                    )}
                  </Td>

                  <Td align="right">
                    {/* ONE Actions menu, as every other register on these
                        screens has. The two controls that used to sit here
                        side by side are its entries. */}
                    <JobWorkInwardRowActions receipt={receipt} />
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
// 4b. Quality check — the consignment a principal sent
// ---------------------------------------------------------------------------

/**
 * What the principal has sent that is waiting to be approved.
 *
 * THE OTHER HALF OF THE OLD "QUALITY & RELEASE" TAB. That screen showed
 * released BATCHES — work we had finished — under a name that also promised
 * quality checking, which had nowhere of its own to happen and was borrowed
 * from the purchased-material screen. This is that decision, on its own
 * records: a consignment arrives, somebody says it is completely recorded,
 * and a quality user approves or refuses it.
 *
 * NOTHING HERE IS ISSUABLE. Every lot under a receipt on this screen is
 * quarantined; approving the receipt is what releases them, and it is the
 * only thing that does.
 */
export async function JobWorkQualityCheckPanel(query: StepQuery) {
  const receipts = await apiFetch<JobWorkMaterialReceiptView[]>(
    '/api/v1/job-work/material-receipts',
    { authenticated: true },
  );

  const search = param(query, 'search');
  const principalId = param(query, 'principalId');
  const status = param(query, 'status');

  const all = receipts.ok ? receipts.data : [];

  // A DRAFT IS NOT YET ANYBODY ELSE’S BUSINESS. The store is still adding to
  // it, and putting it on a quality worklist would be asking for a decision
  // about a document that is still changing.
  const submitted = all.filter((receipt) => receipt.status !== 'DRAFT');

  const rows = submitted.filter(
    (receipt) =>
      (!principalId || receipt.principalId === principalId) &&
      (!status || receipt.status === status) &&
      matches(
        search,
        receipt.receiptNumber,
        receipt.principalName,
        receipt.jobWorkOrderNumber,
        receipt.productName,
        ...receipt.deliveryChallanNumbers,
        ...receipt.lines.map((line) => line.item.name),
        ...receipt.lines.map((line) => line.batchNumber),
      ),
  );

  const waiting = submitted.filter((receipt) => receipt.status === 'PENDING_APPROVAL').length;

  return (
    <Panel
      title="Quality check"
      subtitle={
        receipts.ok
          ? `${countLabel(rows.length, 'consignment')}${
              waiting > 0 ? ` · ${waiting} awaiting a decision` : ''
            }`
          : undefined
      }
      action={
        <>
          <SearchBox placeholder="Search by receipt, principal, order, product, challan or batch…" />
          <FilterButton />
        </>
      }
    >
      <FilterPanel
        principals={principalOptions(submitted, (receipt) => receipt.receivedAt)}
        statuses={JOB_WORK_RECEIPT_STATUSES.filter((value) => value !== 'DRAFT').map(
          (value) => ({ value, label: JOB_WORK_RECEIPT_STATUS_LABELS[value] }),
        )}
        showDates={false}
      />

      {!receipts.ok ? (
        <ErrorState message={`Could not load material receipts: ${receipts.error}`} />
      ) : rows.length === 0 ? (
        <EmptyState
          filtered={submitted.length > 0}
          title={
            submitted.length === 0
              ? 'Nothing has been sent for approval yet.'
              : 'No consignment matches that.'
          }
          hint={
            submitted.length === 0
              ? 'A receipt reaches this screen when the store sends it for approval from Material received from principal.'
              : undefined
          }
        />
      ) : (
        <TableWrap>
          <table className="w-full min-w-[84rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Receipt</Th>
                <Th>Job-work order</Th>
                <Th>Product</Th>
                <Th align="right">Raw</Th>
                <Th align="right">Packing</Th>
                <Th>Sent for approval</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((receipt) => (
                <tr key={receipt.id}>
                  <Td>
                    <p className="font-mono text-xs font-semibold text-slate-900">
                      <Code>{receipt.receiptNumber}</Code>
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {receipt.deliveryChallanNumbers.join(", ")}
                    </p>
                  </Td>

                  <Td>
                    <p className="font-mono text-xs text-slate-800">{receipt.jobWorkOrderNumber}</p>
                    <p className="text-[11px] text-slate-500"><Name>{receipt.principalName}</Name></p>
                  </Td>

                  <Td valign="top">
                    <p className="text-slate-800"><Name>{receipt.productName}</Name></p>
                    <p className="text-[11px] text-slate-500">
                      sold as {receipt.principalBrandName}
                    </p>
                  </Td>

                  <Td align="right">{receipt.rawMaterialCount}</Td>
                  <Td align="right">{receipt.packingMaterialCount}</Td>

                  <Td>
                    {receipt.submittedAt ? (
                      <>
                        <DateTimeText value={receipt.submittedAt} />
                        {receipt.submittedBy && (
                          <span className="block text-[11px] text-slate-500">
                            <Name>{receipt.submittedBy}</Name>
                          </span>
                        )}
                      </>
                    ) : (
                      <Blank />
                    )}
                  </Td>

                  <Td valign="top">
                    <Pill
                      tone={
                        receipt.status === 'APPROVED'
                          ? 'ok'
                          : receipt.status === 'REJECTED'
                            ? 'danger'
                            : 'warn'
                      }
                    >
                      {JOB_WORK_RECEIPT_STATUS_LABELS[receipt.status]}
                    </Pill>
                    {receipt.decidedBy && (
                      <span className="mt-0.5 block text-[10px] text-slate-500">
                        by <Name>{receipt.decidedBy}</Name>
                      </span>
                    )}
                  </Td>

                  <Td>
                    <JobWorkQualityCheckRowActions receipt={receipt} />
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
// 5. Production to batch release — four sub-tabs over the module's own tables
// ---------------------------------------------------------------------------

/**
 * One tab, four stages: production orders, material issue, batch record,
 * batch release.
 *
 * BUILT FROM PRODUCTION & QUALITY GATE'S OWN COMPONENTS. `ProductionRegister`
 * gives the New button, the centred drawer and the confirmation dialog;
 * `ProductionTabs` gives the in-place sub-views; `useRegisterView` and its
 * toolbar and pager give the search, the filter panel and the paging. All are
 * imported and used unchanged — that module is not modified by any of this.
 *
 * THE TABLES UNDERNEATH ARE JOB WORK'S OWN. Nothing here reads
 * `production_orders`, `material_issues`, `batches` or `batch_packing_records`.
 *
 * THE SUB-TAB IS IN THE URL, as `?stage=`. A link to a particular stage has to
 * survive being shared and a page refresh, and the workflow's own navigation
 * already works that way. The sub-views INSIDE a stage are client state, which
 * is what ProductionTabs does on the internal screens.
 */
export async function JobWorkProductionToBatchReleasePanel(query: StepQuery) {
  const stage = stageFrom(param(query, 'stage'));

  return (
    <div className="flex flex-col gap-4">
      <StageTabs current={stage} />

      {stage === 'production-orders' && <JobWorkProductionPanel />}
      {stage === 'material-issue' && <JobWorkMaterialIssuePanel />}
      {stage === 'batch-record' && <JobWorkBatchRecordPanel />}
      {stage === 'batch-release' && <JobWorkBatchReleasePanel />}
    </div>
  );
}

/** An unknown or missing stage lands on the first one rather than a blank page. */
function stageFrom(value: string | undefined): JobWorkProductionStage {
  return JOB_WORK_PRODUCTION_STAGES.includes(value as JobWorkProductionStage)
    ? (value as JobWorkProductionStage)
    : 'production-orders';
}

/**
 * The sub-tab row.
 *
 * PLAIN LINKS, not buttons: each stage is a URL, so it can be linked to, opened
 * in a new tab and reached with the back button — none of which a client-side
 * toggle gives you. Styled as the internal ProductionTabs styles its own, so
 * the two screens read as one system.
 */
function StageTabs({ current }: { current: JobWorkProductionStage }) {
  return (
    <nav
      aria-label="Production to batch release"
      className="flex flex-wrap items-center gap-1 border-b border-slate-200"
    >
      {JOB_WORK_PRODUCTION_STAGES.map((stage) => {
        const active = stage === current;

        return (
          <Link
            key={stage}
            href={`/workflows/job-work/production-to-batch-release?stage=${stage}`}
            aria-current={active ? 'page' : undefined}
            // The active tab sits ON the border, hiding it for its own width,
            // which is what joins it to the panel below rather than leaving it
            // floating above a line.
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
              active
                ? 'border-slate-900 font-semibold text-slate-900'
                : 'border-transparent font-medium text-slate-500 hover:border-slate-300 hover:text-slate-800'
            }`}
          >
            {JOB_WORK_PRODUCTION_STAGE_LABELS[stage]}
          </Link>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// 5a. Production orders
// ---------------------------------------------------------------------------

/**
 * Job-work production orders, raised against an approved consignment.
 *
 * The register a work order gets internally, over this module's own table. The
 * form is offered only where there is something to raise one against: a
 * job-work order with a consignment that has passed Quality check.
 */
export async function JobWorkProductionPanel() {
  const [ordersResult, jobWorkOrdersResult] = await Promise.all([
    get<JobWorkProductionOrderView[]>('/api/v1/job-work/production-orders'),
    get<JobWorkOrderSummary[]>('/api/v1/job-work/orders'),
  ]);

  if (!ordersResult.ok) {
    return (
      <ProductionPanel title="Production orders">
        <LoadError error={ordersResult.error} />
      </ProductionPanel>
    );
  }

  // WHICH ORDERS COULD HAVE ONE RAISED, and out of which consignments.
  //
  // ONE CALL. This used to ask per job-work order — seventy-four requests to
  // draw one page, twenty-six seconds of them, which is what tripped the
  // thirty-second timeout. "Approved" is still the API's judgement; it is just
  // answered for every order at once.
  const eligibleResult = await get<Record<string, JobWorkEligibleReceipt[]>>(
    '/api/v1/job-work/eligible-receipts',
  );

  const receiptsByOrder = eligibleResult.ok ? eligibleResult.data : {};

  // WHICH ORDERS CAN HAVE ONE RAISED, and the answer differs by billing model.
  //
  // PURE CONVERSION needs an approved consignment behind it — the material is
  // the principal's and the quality decision on it is what makes it issuable.
  //
  // OWN PROCUREMENT needs none: we bought the material ourselves through
  // Procure-to-Pay, so there is no consignment and no second quality check. The
  // filter used to demand a receipt of every order, which is precisely why
  // every own-procurement order was missing from the dropdown.
  const raisable = (jobWorkOrdersResult.ok ? jobWorkOrdersResult.data : []).filter((order) =>
    order.billingModel === 'PURE_CONVERSION'
      ? (receiptsByOrder[order.id]?.length ?? 0) > 0
      : true,
  );

  // The View/Edit menu per row, built HERE because it carries the server action
  // binding; the client table only decides which rows are on screen.
  const rowActions: Record<string, React.ReactNode> = {};

  for (const order of ordersResult.data) {
    rowActions[order.id] = <JobWorkProductionRowActions key={order.id} order={order} />;
  }

  // NO `form` ON THE REGISTER. The form opens its own modal — the one the
  // Purchase Requisition form uses — so the register would have wrapped a
  // dialog in a drawer. Its trigger goes in the toolbar instead, which is where
  // the register's own button sat.
  return (
    <ProductionRegister>
      <JobWorkOrderTable
        orders={ordersResult.data}
        actionFor={rowActions}
        toolbarAction={
          raisable.length > 0 ? (
            <RaiseJobWorkProductionOrderForm orders={raisable} receiptsByOrder={receiptsByOrder} />
          ) : undefined
        }
      />
    </ProductionRegister>
  );
}

// ---------------------------------------------------------------------------
// 5b. Material issue
// ---------------------------------------------------------------------------

/**
 * What has been dispensed, and what the principal has sent to dispense from.
 *
 * TWO VIEWS, as the internal step has: the register of issues, and the material
 * on hand. "On hand" here is the principal's consignment — the inward receipt's
 * own lines with what earlier issues took already subtracted — which is the
 * Pure Conversion integration the brief asks for, shown where the internal
 * screen shows company stock.
 */
export async function JobWorkMaterialIssuePanel() {
  const [issuesResult, ordersResult] = await Promise.all([
    get<JobWorkMaterialIssueView[]>('/api/v1/job-work/material-issues'),
    get<JobWorkProductionOrderView[]>('/api/v1/job-work/production-orders'),
  ]);

  if (!issuesResult.ok) {
    return (
      <ProductionPanel title="Material issue">
        <LoadError error={issuesResult.error} />
      </ProductionPanel>
    );
  }

  // A released or cancelled order is finished; offering it would be offering a
  // refusal.
  const open = (ordersResult.ok ? ordersResult.data : []).filter(
    (order) => order.status !== 'BATCH_RELEASED' && order.status !== 'CANCELLED',
  );

  // ONE plan computed here, for the order the form opens on. The rest are
  // fetched by the form when an officer picks them: a plan costs a query per
  // material, so computing all of them on every page load would pay for orders
  // nobody opens.
  const firstOrder = open[0];
  const planResult = firstOrder
    ? await get<JobWorkIssuePlan>(`/api/v1/job-work/production-orders/${firstOrder.id}/issue-plan`)
    : null;

  // Null when the read failed, and the form then fetches it like any other — a
  // failed preload should cost a round trip, not the ability to dispense.
  const initialPlan = planResult?.ok ? planResult.data : null;

  // THE PRINCIPAL'S MATERIAL, DERIVED FROM WHAT IS ALREADY HERE.
  //
  // NO EXTRA REQUESTS. Each production order already carries its consignment
  // and every line's lot — number, status and what is left on it — so asking
  // the API again, once per open order, was fetching data the page was holding.
  // What has been issued is the drum's received quantity less what remains,
  // which is the same arithmetic the API was doing.
  const material = open.flatMap((order) =>
    // Own procurement has no consignment to list here: its material is company
    // stock, and the dispensing form reads it straight off the shelf.
    (order.materialReceipt?.lines ?? [])
      .filter((line) => line.lotId !== null)
      .map((line) => ({
        receiptLineId: line.id,
        lotId: line.lotId!,
        lotNumber: line.lotNumber ?? '—',
        item: line.item,
        kind: line.kind,
        batchNumber: line.batchNumber,
        deliveryChallanNumber: line.deliveryChallanNumber,
        manufacturingDate: line.manufacturingDate,
        expiryDate: line.expiryDate,
        receivedQuantity: line.receivedQuantity,
        quantityAvailable: line.lotQuantityAvailable ?? '0',
        alreadyIssued: (
          Number(line.receivedQuantity) - Number(line.lotQuantityAvailable ?? 0)
        ).toString(),
        lotStatus: line.lotStatus ?? 'QUARANTINE',
        productionOrderNumber: order.orderNumber,
        principalName: order.principalName,
      })),
  );

  const issues = issuesResult.data;

  return (
    <ProductionTabs
      tabs={[
        {
          key: 'issues',
          label: 'Material issue',
          badge: String(issues.length),
          panel: (
            <ProductionRegister>
              <JobWorkIssueTable
                issues={issues}
                toolbarAction={
                  open.length > 0 ? (
                    <IssueJobWorkMaterialForm orders={open} initialPlan={initialPlan} />
                  ) : undefined
                }
              />
            </ProductionRegister>
          ),
        },
        {
          key: 'received',
          label: 'Material received from principal',
          badge: String(material.length),
          panel: <JobWorkReceivedMaterialTable material={material} />,
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// 5c. Batch record
// ---------------------------------------------------------------------------

/**
 * The batches made against job-work production orders.
 *
 * The internal step's master/detail register, over this module's own table: the
 * list on the left, and on the right the batch's quantities, its yield, what
 * the formulation called for against what was actually drawn from the
 * principal's consignment, and the packing record.
 */
export async function JobWorkBatchRecordPanel() {
  const [batchesResult, ordersResult, packagingResult] = await Promise.all([
    get<JobWorkBatchView[]>('/api/v1/job-work/batches'),
    get<JobWorkProductionOrderView[]>('/api/v1/job-work/production-orders'),
    // THE SAME SPECIFICATION REGISTER the internal batch record reads. A pack
    // specification describes the PRODUCT — how many units go in a carton,
    // which leaflet it takes — and that does not change according to who owns
    // the goods. The consumption it drives is written to job work's own table.
    get<PackagingRequirementView[]>('/api/v1/packaging/requirements'),
  ]);

  if (!batchesResult.ok) {
    return (
      <ProductionPanel title="Batch record">
        <LoadError error={batchesResult.error} />
      </ProductionPanel>
    );
  }

  // A batch can only be opened against an order material has actually gone to,
  // which the API checks; an issue is what moves an order into production.
  const awaitingBatch = (ordersResult.ok ? ordersResult.data : []).filter(
    (order) =>
      order.issueCount > 0 &&
      order.batchNumber === null &&
      order.status !== 'CANCELLED' &&
      order.status !== 'BATCH_RELEASED',
  );

  const batches = batchesResult.data;

  // The active specifications, by product, for the packing form below.
  //
  // Read here rather than folded into JobWorkBatchView because a product can
  // have several presentations and the operator picks which one was run — the
  // batch record does not know that until it is written. A failed read is not
  // fatal: the form falls back to a free-text variant with no component rows,
  // which is what a product with no specification gets anyway.
  const specificationsByProduct = new Map<string, JobWorkPackSpecification[]>();

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

  // The packing form per batch, built HERE because it carries the server action
  // binding and the product's pack specifications, neither of which the client
  // list carries.
  const packingForms: Record<string, React.ReactNode> = {};

  for (const batch of batches) {
    // DECIDED: the record, with no way to change it. The API refuses an
    // amendment once the quality gate has ruled, so the form is not offered —
    // but the figures are still part of the batch's history, and a decided
    // batch is exactly the one somebody looks up. This used to render nothing
    // at all, so a released batch's packing was simply unreadable.
    if (batch.releaseStatus !== 'PENDING') {
      if (batch.packedQuantity !== null) {
        const specification = specificationsByProduct
          .get(batch.product.id)
          ?.find((entry) => entry.packVariant === batch.packVariant);

        packingForms[batch.id] = (
          <JobWorkPackingRecordSummary
            key={batch.id}
            packedQuantity={batch.packedQuantity}
            rejectedQuantity={batch.rejectedQuantity}
            packVariant={batch.packVariant}
            packedOn={batch.packedOn}
            consumed={batch.packagingConsumed.map((entry) => {
              const component = specification?.components.find((item) => item.id === entry.itemId);

              return {
                label: component ? `${component.code} ${component.name}` : entry.itemId,
                quantity: component
                  ? `${entry.quantityConsumed} ${component.uom}`
                  : entry.quantityConsumed,
              };
            })}
          />
        );
      }

      continue;
    }

    packingForms[batch.id] = (
      <RecordJobWorkPackingForm
        key={batch.id}
        batch={batch}
        packSpecifications={specificationsByProduct.get(batch.product.id) ?? []}
      />
    );
  }

  // NO `form` ON THE REGISTER — the form opens its own modal, the requisition
  // form's. Its trigger goes in the toolbar, where the register's own sat.
  return (
    <ProductionRegister>
      <div className="p-6">
        {batches.length === 0 ? (
          // The trigger sits WITH the empty state rather than being withheld
          // until the first batch exists: an empty register is exactly when
          // somebody is looking for the way to open one.
          <div className="space-y-4">
            <div className="flex justify-end">
              <RecordJobWorkBatchForm orders={awaitingBatch} />
            </div>

            <ProductionEmptyState>
              {awaitingBatch.length > 0
                ? 'No batches yet. A production order has material issued and is ready to open one.'
                : 'No batches yet. Issue the principal’s material against a production order first.'}
            </ProductionEmptyState>
          </div>
        ) : (
          <JobWorkBatchRecords
            batches={batches}
            packingFormFor={packingForms}
            // ALWAYS OFFERED, as the internal register offers its own: a
            // trigger that vanishes when nothing is waiting reads as the
            // feature being missing. The form opens and explains instead.
            toolbarAction={<RecordJobWorkBatchForm orders={awaitingBatch} />}
          />
        )}
      </div>
    </ProductionRegister>
  );
}

// ---------------------------------------------------------------------------
// 5d. Batch release — the quality gate
// ---------------------------------------------------------------------------

/**
 * The release decision on a finished job-work batch.
 *
 * SEPARATE FROM QUALITY CHECK, which clears what the principal SENT. This one
 * clears what was made of it, on this module's own batches — the internal Batch
 * release screen is untouched and still decides own-brand batches.
 *
 * WHO MAY DECIDE, and therefore who sees this stage at all, is the same pair
 * the internal gate names. A DISCLOSURE, not the enforcement: RolesGuard on the
 * release endpoint is what actually refuses, and it names the same two roles.
 */
export async function JobWorkBatchReleasePanel() {
  const [user, batchesResult] = await Promise.all([
    requireSession(),
    get<JobWorkBatchView[]>('/api/v1/job-work/batches'),
  ]);

  if (!batchesResult.ok) {
    return (
      <ProductionPanel title="Batch release">
        <LoadError error={batchesResult.error} />
      </ProductionPanel>
    );
  }

  const canDecide = user.role === 'QUALITY_OFFICER' || user.role === 'ADMIN';

  if (!canDecide) {
    return (
      <p className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        A job-work batch should be released by Admin and Quality Officer.
      </p>
    );
  }

  /**
   * AWAITING A DECISION, AND ACTUALLY READY FOR ONE.
   *
   * `PENDING` alone is not enough: a batch is pending from the moment it is
   * opened, so the gate used to list batches whose packing had never been
   * entered. The quality officer was being asked to release something nobody
   * had finished making, and the figures the verdict turns on — quantity
   * manufactured, quantity packed — were dashes on the row.
   *
   * `packedOn` is the signal rather than `packedQuantity`, because it records
   * the packing HAVING HAPPENED. A run that genuinely packed nothing still has
   * a date and is still a batch someone must decide on; keying on the quantity
   * would hide it forever.
   *
   * A batch still in production is not lost — it sits in the Batch record
   * register until its packing is entered, which is where the work to finish it
   * is done.
   */
  const pending = batchesResult.data.filter(
    (batch) => batch.releaseStatus === 'PENDING' && batch.packedOn !== null,
  );
  const decided = batchesResult.data.filter((batch) => batch.releaseStatus !== 'PENDING');
  const released = batchesResult.data.filter((batch) => batch.releaseStatus === 'RELEASED');

  // The release form per batch, built HERE because it carries the server action
  // binding; the client list only decides which ones are on screen.
  const releaseForms: Record<string, React.ReactNode> = {};

  for (const batch of pending) {
    // KEYED, even though each is rendered as a single child: they are CREATED
    // in a loop here and consumed by a client component across the
    // server/client boundary, and React attributes the collection to either
    // side depending on where it looks.
    releaseForms[batch.id] = <JobWorkReleaseDecisionForm key={batch.id} batch={batch} />;
  }

  // THE SAME THREE TABS, IN THE SAME ORDER, as the internal gate: the decision,
  // the stock it produced, then every decision already made.
  //
  // ONE NAME DIFFERS, deliberately. The internal middle tab is "Sellable
  // Stock"; a released job-work batch is NOT sellable by us — it belongs to the
  // principal and leaves on a dispatch challan — so calling it that here would
  // put a claim on screen that is wrong in the one place it matters. The tab is
  // the same register of what release produced, under a name that is true.
  return (
    <div className="space-y-4">
      <ProductionTabs
        tabs={[
          // NO COUNT BADGES. Each register below states its own total in its
          // toolbar — "4 batches" — so a number on the tab restated it, and two
          // counts for one list invite a comparison to check they agree. It is
          // also what the internal gate does: its tabs carry labels only.
          {
            key: 'gate',
            label: 'Batch Release',
            panel: <JobWorkPendingReleaseList batches={pending} formFor={releaseForms} />,
          },
          {
            key: 'stock',
            label: 'Released Stock',
            panel: <JobWorkReleasedTable batches={released} />,
          },
          {
            key: 'decided',
            label: 'Released',
            panel: <JobWorkDecidedTable batches={decided} />,
          },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. Outward dispatch — US-JW-05, the challan side
// ---------------------------------------------------------------------------

export async function OutwardDispatchPanel(query: StepQuery) {
  // THREE READS FOR THE WHOLE SCREEN, not three plus one per order.
  //
  // This used to ask `/orders/:id/dispatchable` once per job-work order —
  // eighty requests on the current data, each opening its own tenant-scoped
  // transaction, with the page waiting on the slowest. It is the same fan-out
  // that tripped the thirty-second timeout on production orders, and the same
  // remedy: one endpoint that answers for every order at once.
  const [orders, ready, invoices] = await Promise.all([
    apiFetch<JobWorkOrderSummary[]>('/api/v1/job-work/orders', { authenticated: true }),
    apiFetch<Record<string, JobWorkDispatchableBatch[]>>('/api/v1/job-work/dispatchable', {
      authenticated: true,
    }),
    apiFetch<JobWorkInvoiceView[]>('/api/v1/job-work/invoices', { authenticated: true }),
  ]);

  // An order with nothing ready is simply absent from the map, which is what
  // the row filter below already tests for.
  const batchesFor = (orderId: string): JobWorkDispatchableBatch[] =>
    (ready.ok ? (ready.data[orderId] ?? []) : []);

  const dispatchable = orders.ok
    ? orders.data.map((order) => ({ order, batches: batchesFor(order.id) }))
    : [];

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
        ) : readyRows.length === 0 ? (
          <EmptyState
            title={dispatchable.length === 0 ? 'No job-work orders yet.' : 'No order matches that.'}
            hint={dispatchable.length === 0 ? 'Raise one to begin.' : undefined}
            filtered={dispatchable.length > 0}
          />
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
                {/* `readyRows`, NOT `dispatchable`. The body listed every order
                    while the heading counted the filtered ones, so searching
                    this register changed the count and nothing else. */}
                {readyRows.map(({ order, batches }) => (
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
                      <DerivedValue>
                        {JOB_WORK_INVOICE_BASIS_LABELS[order.invoiceBasis]}
                      </DerivedValue>
                    </Td>

                    <Td align="right">{batches.length}</Td>

                    <Td align="right">
                      <Qty value={order.dispatchedQuantity} />
                    </Td>

                    <Td>
                      <CreateJobWorkDispatchButton
                        order={order}
                        batches={batches}
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
  // TWO READS, IN PARALLEL, AND NO MORE. The orders carry the product, the
  // ordered quantity and the delivery date, none of which is on the invoice —
  // so the View dialog needs them. Fetched once for the page and matched by id
  // below, rather than once per row.
  const [invoices, orders] = await Promise.all([
    apiFetch<JobWorkInvoiceView[]>('/api/v1/job-work/invoices', { authenticated: true }),
    apiFetch<JobWorkOrderSummary[]>('/api/v1/job-work/orders', { authenticated: true }),
  ]);

  const orderById = new Map((orders.ok ? orders.data : []).map((order) => [order.id, order]));

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
                <Th align="right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {/* `rows`, NOT `invoices.data`. The body listed every invoice
                  while the heading counted the filtered ones, so searching this
                  register changed the count and nothing else — which reads as
                  the search being broken. */}
              {rows.map((invoice) => (
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
                    <DerivedValue>
                      {JOB_WORK_INVOICE_BASIS_LABELS[invoice.invoiceBasis]}
                    </DerivedValue>
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

                  <Td align="right">
                    <ViewJobWorkInvoiceButton
                      invoice={invoice}
                      order={orderById.get(invoice.jobWorkOrderId)}
                    />
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
  'quality-check': (query) => <JobWorkQualityCheckPanel {...query} />,
  // ONE ENTRY FOR FOUR SCREENS. Production and Batch release were separate
  // steps until 2026-09-21; they are now sub-tabs of this one, chosen by
  // the stage query parameter, and the panel below picks between them.
  'production-to-batch-release': (query) => (
    <JobWorkProductionToBatchReleasePanel {...query} />
  ),
  'outward-dispatch': (query) => <OutwardDispatchPanel {...query} />,
  billing: (query) => <JobWorkBillingPanel {...query} />,
  register: (query) => <JobWorkRegisterPanel {...query} />,
};
