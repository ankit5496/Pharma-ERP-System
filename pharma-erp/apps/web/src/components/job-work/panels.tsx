import {
  AGREEMENT_STATUS_LABELS,
  AGREEMENT_STATUSES,
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
  type ProductionStockLot,
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
import { JobWorkAgreementRowActions } from '@/components/job-work/agreement-view';

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
    label: 'Own Procurement',
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
 * THE FILTERS, ON THEIR WAY TO THE DATABASE.
 *
 * Every Job Work register takes the same six, and every one of them is applied
 * to the QUERY rather than to the rows the page has already been handed. That
 * distinction is the whole point: a screen that fetches everything and filters
 * the array it received has a pager that pages the wrong set, a count that
 * disagrees with the rows, and a request that carries a hundred records to
 * show three.
 *
 * ONE HELPER, not one per screen. The keys are the ones the shared filter
 * panel writes into the URL, so adding a control there reaches every register
 * at once.
 */
function listQuery(query: StepQuery, extra: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams();

  const keys = ['search', 'status', 'dateFrom', 'dateTo', 'principalId', 'billingModel'];

  for (const key of keys) {
    const value = param(query, key);

    if (value) params.set(key, value);
  }

  // CREATED BY, UNDER BOTH ITS NAMES.
  //
  // The shared filter panel calls the person who owns a record the one who
  // RAISED it — `raisedById` — because it was built for Procure-to-Pay, where
  // a requisition is raised. Job Work's endpoints call the same person the
  // creator. Two names for one filter is a thing to translate in one place,
  // not to argue with: without this line the control writes a key nothing
  // reads, and picking a colleague silently changes nothing at all.
  //
  // `createdById` wins where both are present, because that is what this
  // module's own registers write.
  const creator = param(query, 'createdById') ?? param(query, 'raisedById');

  if (creator) params.set('createdById', creator);

  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
  }

  const search = params.toString();

  return search ? `?${search}` : '';
}

/** Colleagues, for the Created By filter. One lookup, shared with P2P. */
async function peopleOptions(): Promise<{ value: string; label: string }[]> {
  const people = await get<{ id: string; name: string }[]>('/api/v1/procurement/people');

  return people.ok ? people.data.map((person) => ({ value: person.id, label: person.name })) : [];
}

// THE CLIENT-SIDE SEARCH HELPER IS GONE. Every Job Work register now sends its
// search term to the API, and the agreement register was the last caller — a
// spare copy of "does this row match" is how two screens come to disagree about
// what a search means.

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

/**
 * The three states an agreement can be in, as filter options.
 *
 * DERIVED, NOT STORED: an agreement is in force, not yet started or expired
 * according to its validity dates against today. The query says so in dates;
 * these are the names the badge on the row already uses.
 */
const AGREEMENT_STATUS_OPTIONS = AGREEMENT_STATUSES.map((status) => ({
  value: status,
  label: AGREEMENT_STATUS_LABELS[status],
}));

/** The count a table title carries, with no explanation attached to it. */
const countLabel = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------
// 1. Principals — the agreement register (US-MD-05)
// ---------------------------------------------------------------------------

export async function PrincipalsPanel(query: StepQuery) {
  // FILTERED BY THE DATABASE, like every other Job Work register. This screen
  // was the last one sifting the array it had just been handed, which gives a
  // count that is right, rows that are right, and a request that carries a
  // hundred agreements to show three.
  //
  // THE UNFILTERED LIST IS FETCHED ONLY WHEN SOMETHING IS FILTERED, and only to
  // fill the principal dropdown: deriving it from the filtered rows would
  // narrow it to the chosen principal and strand the reader with no way back.
  const filtering = listQuery(query) !== '';

  const [agreements, unfiltered, people] = await Promise.all([
    apiFetch<JobWorkAgreementSummary[]>(`/api/v1/job-work/agreements${listQuery(query)}`, {
      authenticated: true,
    }),
    filtering
      ? apiFetch<JobWorkAgreementSummary[]>('/api/v1/job-work/agreements', { authenticated: true })
      : Promise.resolve(null),
    peopleOptions(),
  ]);

  const rows = agreements.ok ? agreements.data : [];
  const all = unfiltered?.ok ? unfiltered.data : rows;

  return (
    <Panel
      title="Principals & Job Work Agreements"
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
      {/* THE SAME CONTROLS AS EVERY OTHER REGISTER: principal, billing model,
          status, created between and created by. Status here is DERIVED from
          the validity dates rather than stored, and the query expresses it as
          those dates — see JobWorkService.list. */}
      <FilterPanel
        principals={principalOptions(all, (row) => row.createdAt)}
        billingModels={BILLING_MODEL_OPTIONS}
        statuses={AGREEMENT_STATUS_OPTIONS}
        raisedBy={people}
      />

      {!agreements.ok ? (
        <ErrorState message={`Could not load job work agreements: ${agreements.error}`} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtering ? 'No agreement matches that.' : 'No job work agreements yet.'}
          hint={
            filtering
              ? undefined
              : 'Record the brand owner as a job work principal in the Party register, then write an agreement against it in Master Data.'
          }
          filtered={filtering}
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
                <Th>Action</Th>
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

                    {/* VIEW ONLY. An agreement is a contract that orders,
                        receipts and invoices have already inherited; it is
                        written in Master Data, not amended on the register
                        that reports it. */}
                    <Td valign="top">
                      <JobWorkAgreementRowActions agreement={agreement} />
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
  // FILTERED BY THE DATABASE. `rows` is what came back, not what a second pass
  // over it kept — see `listQuery`.
  //
  // THE UNFILTERED LIST IS FETCHED ONLY WHEN SOMETHING IS FILTERED, and only to
  // populate the dropdowns: deriving the principal list from the filtered rows
  // would narrow it to the chosen principal and strand the reader with no way
  // back.
  const filtering = listQuery(query) !== '';

  const [orders, principals, unfiltered, people] = await Promise.all([
    apiFetch<JobWorkOrderSummary[]>(`/api/v1/job-work/orders${listQuery(query)}`, {
      authenticated: true,
    }),
    apiFetch<JobWorkOrderablePrincipal[]>('/api/v1/job-work/orders/orderable', {
      authenticated: true,
    }),
    filtering
      ? apiFetch<JobWorkOrderSummary[]>('/api/v1/job-work/orders', { authenticated: true })
      : Promise.resolve(null),
    peopleOptions(),
  ]);

  const rows = orders.ok ? orders.data : [];
  const all = unfiltered?.ok ? unfiltered.data : rows;

  return (
    <Panel
      title="Job Work Orders"
      subtitle={orders.ok ? countLabel(rows.length, 'order') : undefined}
      action={
        <>
          <SearchBox placeholder="Search by order no., principal, brand or product…" />
          <FilterButton />
          {principals.ok ? <CreateJobWorkOrderButton principals={principals.data} /> : null}
        </>
      }
    >
      {/* THE SAME FOUR CONTROLS ON EVERY REGISTER: principal, billing model,
          created between, and created by. A job-work order has no status
          column — where it has got to is derived from the records raised
          against it — so this one offers none rather than a dropdown whose
          every value returns the whole list. */}
      <FilterPanel
        principals={principalOptions(all, (row) => row.createdAt)}
        billingModels={BILLING_MODEL_OPTIONS}
        raisedBy={people}
      />

      {!orders.ok ? (
        <ErrorState message={`Could not load job work orders: ${orders.error}`} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtering ? 'No order matches that.' : 'No job work orders yet.'}
          hint={
            filtering
              ? undefined
              : 'An order can only be raised against a principal whose agreement is in force. Create one with the button above.'
          }
          filtered={filtering}
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
                    {/* THE ORDER NUMBER, AND NOTHING ELSE. A count of the
                        production orders raised against it used to sit here —
                        "0 work orders" on almost every row, which is a
                        statement about a later stage of the workflow rather
                        than about this order, and the stage that owns it lists
                        them properly. */}
                    <p className="font-mono text-xs font-semibold text-slate-900">
                      <Code>{order.orderNumber}</Code>
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
  const filtering = listQuery(query) !== '';

  const [receipts, orders, unfiltered, people] = await Promise.all([
    apiFetch<JobWorkMaterialReceiptView[]>(
      `/api/v1/job-work/material-receipts${listQuery(query)}`,
      { authenticated: true },
    ),
    apiFetch<JobWorkOrderSummary[]>('/api/v1/job-work/orders', { authenticated: true }),
    filtering
      ? apiFetch<JobWorkMaterialReceiptView[]>('/api/v1/job-work/material-receipts', {
          authenticated: true,
        })
      : Promise.resolve(null),
    peopleOptions(),
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

  // ONE ROW PER RECEIPT. The register answers "what has this principal sent
  // us against this order, and where has it got to" — which is a question
  // about the document. The search still reaches the materials inside it, so a
  // batch number or an item code finds the receipt that holds it; that clause
  // is in the query now rather than in a pass over the answer.
  const rows = receipts.ok ? receipts.data : [];
  const allReceipts = unfiltered?.ok ? unfiltered.data : rows;

  return (
    <Panel
      title="Inward Materials"
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
        statuses={JOB_WORK_RECEIPT_STATUSES.map((value) => ({
          value,
          label: JOB_WORK_RECEIPT_STATUS_LABELS[value],
        }))}
        raisedBy={people}
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
              ? 'Every job work order you hold is on the own procurement model, where you buy the material yourself through Procure to Pay. This screen records material a principal ships you free of cost under a pure conversion agreement.'
              : 'Under pure conversion the principal ships the raw material on their own delivery challan. Record it here and it enters principal-owned stock.'
          }
        />
      ) : (
        <TableWrap>
          <table className="w-full min-w-[98rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <Th>Receipt</Th>
                <Th>Job work order</Th>
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
                    <JobWorkInwardRowActions receipt={receipt} orders={conversionOrders} />
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
  const filtering = listQuery(query) !== '';

  const [receipts, unfiltered, people] = await Promise.all([
    apiFetch<JobWorkMaterialReceiptView[]>(
      `/api/v1/job-work/material-receipts${listQuery(query)}`,
      { authenticated: true },
    ),
    filtering
      ? apiFetch<JobWorkMaterialReceiptView[]>('/api/v1/job-work/material-receipts', {
          authenticated: true,
        })
      : Promise.resolve(null),
    peopleOptions(),
  ]);

  // A DRAFT IS NOT YET ANYBODY ELSE’S BUSINESS. The store is still adding to
  // it, and putting it on a quality worklist would be asking for a decision
  // about a document that is still changing.
  //
  // KEPT ON THE PAGE rather than pushed into the query: it is not a filter
  // somebody chose, it is what this screen is, and a status filter that could
  // select DRAFT here would contradict it.
  const rows = (receipts.ok ? receipts.data : []).filter(
    (receipt) => receipt.status !== 'DRAFT',
  );

  const submitted = (unfiltered?.ok ? unfiltered.data : (receipts.ok ? receipts.data : [])).filter(
    (receipt) => receipt.status !== 'DRAFT',
  );

  const waiting = submitted.filter((receipt) => receipt.status === 'PENDING_APPROVAL').length;

  return (
    <Panel
      title="Quality Check"
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
        raisedBy={people}
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
                <Th>Job work order</Th>
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

      {/* THE QUERY GOES DOWN WITH THE STAGE. Each stage reads the same five
          keys — search, status, dateFrom, dateTo, createdById — and sends them
          to its own endpoint, so a filter set on one register is a filter on
          that register's query rather than on the rows it was handed. */}
      {stage === 'production-orders' && <JobWorkProductionPanel {...query} />}
      {stage === 'material-issue' && <JobWorkMaterialIssuePanel {...query} />}
      {stage === 'batch-record' && <JobWorkBatchRecordPanel {...query} />}
      {stage === 'batch-release' && <JobWorkBatchReleasePanel {...query} />}
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
export async function JobWorkProductionPanel(query: StepQuery) {
  const [ordersResult, jobWorkOrdersResult, people] = await Promise.all([
    // FILTERED BY THE DATABASE. The register below shows what came back.
    get<JobWorkProductionOrderView[]>(
      `/api/v1/job-work/production-orders${listQuery(query)}`,
    ),
    // UNFILTERED, deliberately: this one populates the "raise one against"
    // dropdown rather than the register, and narrowing it would hide the very
    // order somebody has filtered the register down to find.
    get<JobWorkOrderSummary[]>('/api/v1/job-work/orders'),
    peopleOptions(),
  ]);

  if (!ordersResult.ok) {
    return (
      <ProductionPanel title="Production Orders">
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
        people={people}
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
export async function JobWorkMaterialIssuePanel(query: StepQuery) {
  const [issuesResult, ordersResult, people] = await Promise.all([
    get<JobWorkMaterialIssueView[]>(`/api/v1/job-work/material-issues${listQuery(query)}`),
    // UNFILTERED: these feed the Dispense form and the consignment list beside
    // it, neither of which is the register the filters are narrowing.
    get<JobWorkProductionOrderView[]>('/api/v1/job-work/production-orders'),
    peopleOptions(),
  ]);

  if (!issuesResult.ok) {
    return (
      <ProductionPanel title="Material Issue">
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
        // NO COUNT BADGES. Each register states its own total in its toolbar,
        // so a number on the tab restated it — and two counts for one list
        // invite a comparison to check they agree. The internal tabs carry
        // labels only, for the same reason.
        {
          key: 'issues',
          label: 'Material Issue',
          panel: (
            <ProductionRegister>
              <JobWorkIssueTable
                issues={issues}
                people={people}
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
          label: 'Material Received From Principal',
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
export async function JobWorkBatchRecordPanel(query: StepQuery) {
  const [batchesResult, ordersResult, packagingResult, lotsResult, people] = await Promise.all([
    // FILTERED BY THE DATABASE, including "Packaging due" — which is not a
    // stored status but `PENDING with nothing packed yet`, and is now a value
    // the batch endpoint understands.
    get<JobWorkBatchView[]>(`/api/v1/job-work/batches${listQuery(query, {
      manufacturedFrom: param(query, 'manufacturedFrom'),
      manufacturedTo: param(query, 'manufacturedTo'),
    })}`),
    // UNFILTERED: the orders a batch could be opened against, for the form.
    get<JobWorkProductionOrderView[]>('/api/v1/job-work/production-orders'),
    // THE SAME SPECIFICATION REGISTER the internal batch record reads. A pack
    // specification describes the PRODUCT — how many units go in a carton,
    // which leaflet it takes — and that does not change according to who owns
    // the goods. The consumption it drives is written to job work's own table.
    get<PackagingRequirementView[]>('/api/v1/packaging/requirements'),
    // US-MD-06: the packing record names the LOT each component came from, so
    // a carton lot can be traced to the batches it went into. THE SAME
    // REGISTER the internal batch record reads — a lot is a lot whoever owns
    // it, and the form filters to the right bucket. Fetched here because the
    // form cannot ask for it: it is rendered by this server component, one per
    // batch.
    get<ProductionStockLot[]>('/api/v1/production/stock-lots'),
    peopleOptions(),
  ]);

  if (!batchesResult.ok) {
    return (
      <ProductionPanel title="Batch Record">
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
  // The billing model per production order, so each batch can be told whose
  // packaging it draws on. One pass over the orders already fetched rather than
  // a lookup per batch.
  const billingModelByOrder = new Map(
    (ordersResult.ok ? ordersResult.data : []).map((order) => [order.id, order.billingModel]),
  );

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
        lots={lotsResult.ok ? lotsResult.data : []}
        // WHOSE PACKAGING THIS BATCH MAY CONSUME, resolved from the job work
        // order it was made against — the same rule the raw-material issue
        // applies. A pure-conversion job draws the principal's own cartons;
        // own procurement draws ours, because we bought them.
        ownership={
          billingModelByOrder.get(batch.productionOrderId) === 'OWN_PROCUREMENT'
            ? 'COMPANY_OWNED'
            : 'PRINCIPAL_OWNED'
        }
      />
    );
  }

  // NO `form` ON THE REGISTER — the form opens its own modal, the requisition
  // form's. Its trigger goes in the toolbar, where the register's own sat.
  return (
    <ProductionRegister>
      <div className="p-6">
        {/* AN EMPTY REGISTER AND A REGISTER FILTERED TO NOTHING ARE DIFFERENT
            SCREENS, and only the first of them may replace the toolbar.

            Once the filtering moved into the query, "no rows" stopped meaning
            "nothing has been recorded": it also means "nothing matches what you
            asked for". Swapping the register out in that case takes the search
            box, the filter panel and its Clear off the page — so the reader is
            left looking at an empty screen holding the one control that would
            undo it. The register stays put and says so itself. */}
        {batches.length === 0 && listQuery(query) === '' ? (
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
            people={people}
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
export async function JobWorkBatchReleasePanel(query: StepQuery) {
  /**
   * THREE REGISTERS, THREE QUERIES, ONE ADDRESS BAR.
   *
   * The three tabs are three status slices of the same table, and the slicing
   * is what the tab MEANS — so it belongs in each query rather than in a pass
   * over one big result. Each carries the reader's own filters as well, which
   * is how "released in March by Meera" narrows in the database.
   *
   * THE VERDICT FILTER WRITES `verdict`, NOT `status`. Only the third tab
   * offers one; if it wrote `status` it would be answering for its two
   * neighbours as well, and picking Rejected would empty them both.
   *
   * THREE REQUESTS RATHER THAN ONE, and cheaper than the one they replace:
   * each is strictly narrower than the unfiltered fetch this used to make, and
   * they go out together.
   */
  const verdict = param(query, 'verdict');

  const [user, pendingResult, releasedResult, decidedResult, people] = await Promise.all([
    requireSession(),
    // PENDING means awaiting a DECISION — packed and waiting on the quality
    // officer. The endpoint draws that line; a batch with no packing entered
    // is production's business and stays on the Batch Record register.
    get<JobWorkBatchView[]>(`/api/v1/job-work/batches${listQuery(query, { status: 'PENDING' })}`),
    get<JobWorkBatchView[]>(`/api/v1/job-work/batches${listQuery(query, { status: 'RELEASED' })}`),
    // DECIDED is every verdict there is — released, on hold, rejected, blocked
    // — which no stored value names, so the endpoint names it.
    get<JobWorkBatchView[]>(
      `/api/v1/job-work/batches${listQuery(query, { status: verdict ?? 'DECIDED' })}`,
    ),
    peopleOptions(),
  ]);

  const failed = [pendingResult, releasedResult, decidedResult].find((result) => !result.ok);

  if (failed && !failed.ok) {
    return (
      <ProductionPanel title="Batch Release">
        <LoadError error={failed.error} />
      </ProductionPanel>
    );
  }

  const canDecide = user.role === 'QUALITY_OFFICER' || user.role === 'ADMIN';

  if (!canDecide) {
    return (
      <p className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        A job work batch should be released by Admin and Quality Officer.
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
  const pending = pendingResult.ok ? pendingResult.data : [];
  const released = releasedResult.ok ? releasedResult.data : [];
  const decided = decidedResult.ok ? decidedResult.data : [];

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
            panel: (
              <JobWorkPendingReleaseList
                batches={pending}
                people={people}
                formFor={releaseForms}
              />
            ),
          },
          {
            key: 'stock',
            label: 'Released Stock',
            panel: <JobWorkReleasedTable batches={released} people={people} />,
          },
          {
            key: 'decided',
            label: 'Released',
            panel: <JobWorkDecidedTable batches={decided} people={people} />,
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
  const filtering = listQuery(query) !== '';

  const [orders, ready, invoices, unfiltered, people] = await Promise.all([
    apiFetch<JobWorkOrderSummary[]>(`/api/v1/job-work/orders${listQuery(query)}`, {
      authenticated: true,
    }),
    apiFetch<Record<string, JobWorkDispatchableBatch[]>>('/api/v1/job-work/dispatchable', {
      authenticated: true,
    }),
    apiFetch<JobWorkInvoiceView[]>(`/api/v1/job-work/invoices${listQuery(query)}`, {
      authenticated: true,
    }),
    filtering
      ? apiFetch<JobWorkOrderSummary[]>('/api/v1/job-work/orders', { authenticated: true })
      : Promise.resolve(null),
    peopleOptions(),
  ]);

  // An order with nothing ready is simply absent from the map, which is what
  // the row filter below already tests for.
  const batchesFor = (orderId: string): JobWorkDispatchableBatch[] =>
    (ready.ok ? (ready.data[orderId] ?? []) : []);

  const dispatchable = orders.ok
    ? orders.data.map((order) => ({ order, batches: batchesFor(order.id) }))
    : [];

  // BOTH TABLES ARE FILTERED BY THE QUERY, each against its own register:
  // the orders above and the challans below answer the same filters, so a
  // reader narrowing to one principal sees that principal's half of both.
  const allOrders = unfiltered?.ok ? unfiltered.data : (orders.ok ? orders.data : []);
  const readyRows = dispatchable;
  const challans = invoices.ok ? invoices.data : [];

  return (
    <div className="space-y-5">
      <Panel
        title="Ready to Dispatch"
        subtitle={countLabel(readyRows.length, 'order')}
        action={
          <>
            <SearchBox placeholder="Search by order no., principal, brand or batch…" />
            <FilterButton />
          </>
        }
      >
        <FilterPanel
          raisedBy={people}
          principals={principalOptions(allOrders, (order) => order.createdAt)}
        />

        {!orders.ok ? (
          <ErrorState message={`Could not load job work orders: ${orders.error}`} />
        ) : readyRows.length === 0 ? (
          <EmptyState
            title={dispatchable.length === 0 ? 'No job work orders yet.' : 'No order matches that.'}
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

                    {/* THE COLUMN BOTH BUTTONS BELOW ARE DECIDED BY. */}
                    <Td align="right">{batches.length}</Td>

                    <Td align="right">
                      <Qty value={order.dispatchedQuantity} />
                    </Td>

                    {/* ONE CONTROL, because it is one act: dispatching a
                        released batch is what raises the invoice. It is refused
                        outright with nothing released — and carries the reason
                        on hover rather than going quietly grey. */}
                    <Td>
                      <CreateJobWorkDispatchButton order={order} batches={batches} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Dispatch Challans" subtitle={countLabel(challans.length, 'challan')}>
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
                  <Th>Job work order</Th>
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
  const filtering = listQuery(query) !== '';

  const [invoices, orders, unfiltered, people] = await Promise.all([
    apiFetch<JobWorkInvoiceView[]>(`/api/v1/job-work/invoices${listQuery(query)}`, {
      authenticated: true,
    }),
    apiFetch<JobWorkOrderSummary[]>('/api/v1/job-work/orders', { authenticated: true }),
    filtering
      ? apiFetch<JobWorkInvoiceView[]>('/api/v1/job-work/invoices', { authenticated: true })
      : Promise.resolve(null),
    peopleOptions(),
  ]);

  const orderById = new Map((orders.ok ? orders.data : []).map((order) => [order.id, order]));

  const rows = invoices.ok ? invoices.data : [];
  const all = unfiltered?.ok ? unfiltered.data : rows;

  return (
    <Panel
      title="Job Work Billing"
      subtitle={invoices.ok ? countLabel(rows.length, 'invoice') : undefined}
      action={
        <>
          <SearchBox placeholder="Search by invoice no., principal, order or batch…" />
          <FilterButton />
        </>
      }
    >
      {/* NO STATUS: a job-work invoice has no lifecycle of its own. It is
          raised by the dispatch that returns the batch and never amended, so a
          status dropdown here would offer values no row can carry. */}
      <FilterPanel
        principals={principalOptions(all, (row) => row.createdAt)}
        billingModels={BILLING_MODEL_OPTIONS}
        raisedBy={people}
      />

      {!invoices.ok ? (
        <ErrorState message={`Could not load job work invoices: ${invoices.error}`} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtering ? 'No invoice matches that.' : 'Nothing invoiced yet.'}
          hint={
            filtering
              ? undefined
              : 'An invoice is raised by the dispatch that sends a released batch back to the principal.'
          }
          filtered={filtering}
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
  /**
   * FILTERED BY THE DATABASE, TOTALS AND ALL.
   *
   * This screen is the one where client-side filtering did the most damage,
   * and silently. Every heading on it is a SUM — received, consumed, produced,
   * dispatched, closing balance, invoiced — and those sums are computed by the
   * API over the orders it selected. Dropping rows afterwards left each group
   * claiming figures for rows the reader could no longer see: a heading saying
   * 4,000 kg received above a list showing one order for 300.
   *
   * Narrowing the query instead means the totals are totals OF WHAT IS ON
   * SCREEN, which is the only reading of them that is true.
   *
   * THE UNFILTERED LIST IS FETCHED ONLY TO FILL THE DROPDOWNS, and only when
   * something is filtered: deriving the principal list from the filtered
   * groups would narrow it to the chosen principal and strand the reader with
   * no way back.
   */
  const filtering = listQuery(query) !== '';

  const [register, unfiltered, people] = await Promise.all([
    apiFetch<JobWorkRegisterGroup[]>(`/api/v1/job-work/register${listQuery(query)}`, {
      authenticated: true,
    }),
    filtering
      ? apiFetch<JobWorkRegisterGroup[]>('/api/v1/job-work/register', { authenticated: true })
      : Promise.resolve(null),
    peopleOptions(),
  ]);

  const groups = register.ok ? register.data : [];
  const all = unfiltered?.ok ? unfiltered.data : groups;

  return (
    <Panel
      title="Job Work Register"
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
        raisedBy={people}
      />

      {!register.ok ? (
        <ErrorState message={`Could not load the job work register: ${register.error}`} />
      ) : groups.length === 0 ? (
        <EmptyState
          title={filtering ? 'Nothing matches that.' : 'Nothing to report yet.'}
          hint={
            filtering
              ? undefined
              : 'The register fills itself as material is received, consumed and dispatched against job work orders.'
          }
          filtered={filtering}
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
                      <Th>Job work order</Th>
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
