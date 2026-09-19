import type { Metadata } from 'next';
import {
  PROCUREMENT_ROUTES,
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_STATUS_LABELS,
} from '@pharma-erp/types';

import { FilterButton, FilterPanel, SearchBox } from '@/components/procurement/filter-bar';
import { Pagination } from '@/components/procurement/pagination';
import { CreatePoDialog } from '@/components/procurement/create-po-dialog';
import { DraftOrderActions } from '@/components/procurement/draft-order-actions';
import { PurchaseOrderActions } from '@/components/procurement/purchase-order-actions';
import {
  Blank,
  DateText,
  EmptyState,
  ErrorState,
  Money,
  Panel,
  Qty,
  RecordLink,
  StatusPill,
  TableWrap,
  Td,
  Th,
  Name,
  Code,
} from '@/components/procurement/ui';
import {
  fetchItems,
  fetchDraftOrders,
  fetchPurchaseOrders,
  fetchRequisitions,
  fetchVendors,
  toListQuery,
  toOptions,
} from '@/lib/procurement';

export const metadata: Metadata = { title: 'Purchase orders' };
export const dynamic = 'force-dynamic';

/**
 * Sub-tab 2 — Purchase orders.
 *
 * Each order expands to its lines, because the line is where the useful
 * information is: what is still outstanding on it decides whether a GRN can
 * be booked, and the requisition it came from is the traceability link the
 * brief asks for.
 */
export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = toListQuery(params);

  // Set by 'Convert to PO' on an approved requisition. The requisition is
  // fetched here so the dialog opens already filled in — the user arrives on
  // this tab with the form in front of them rather than having to find it.
  const fromRequisition =
    typeof params.fromRequisition === 'string' ? params.fromRequisition : undefined;

  const isFiltered = Object.values(query).some(Boolean);

  const [orders, drafts, vendors, items, requisitions] = await Promise.all([
    fetchPurchaseOrders(query),
    fetchDraftOrders(),
    fetchVendors(),
    fetchItems(),
    // Only when it is actually needed. Unfiltered, the orders on the page
    // already name every requisition that produced one, so the whole
    // requisition list would be a second query for information in hand — and
    // this page is re-rendered on every filter change, where it would be paid
    // again each time.
    fromRequisition || isFiltered ? fetchRequisitions({}) : Promise.resolve(null),
  ]);

  // Resolved once: the edit form offers these while the order is still a draft
  // or open, which is exactly when the API will accept a change of vendor.
  const vendorList = vendors.ok ? vendors.data : [];

  const sourceRequisition =
    fromRequisition && requisitions?.ok
      ? (requisitions.data.rows.find((r) => r.id === fromRequisition) ?? null)
      : null;

  // Only requisitions that actually reached an order: offering the rest would
  // be a filter guaranteed to return nothing. Taken from the full list while
  // filtering — derived from the visible orders, choosing one would narrow the
  // page to it and drop every other option, leaving no way back.
  const requisitionOptions = (() => {
    if (requisitions?.ok) {
      return requisitions.data.rows
        .filter((requisition) => requisition.linkedPurchaseOrders.length > 0)
        .map((requisition) => ({ value: requisition.id, label: requisition.number }));
    }

    if (!orders.ok) return [];

    const byId = new Map<string, string>();

    for (const order of orders.data.rows) {
      for (const line of order.lines) {
        if (line.requisition) byId.set(line.requisition.id, line.requisition.number);
      }
    }

    return [...byId].map(([value, label]) => ({ value, label }));
  })();

  return (
    <>
      {sourceRequisition && (
        <CreatePoDialog requisition={sourceRequisition} vendors={vendors.ok ? vendors.data : []} />
      )}

      {drafts.ok && drafts.data.length > 0 && (
        <Panel
          title="Draft purchase orders"
          subtitle={`${drafts.data.length} unplaced draft${drafts.data.length === 1 ? '' : 's'} — nothing has been sent to a vendor`}
        >
          <TableWrap>
            <table className="w-full min-w-[68rem] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <Th>PO no.</Th>
                  <Th>Vendor</Th>
                  <Th>PO date</Th>
                  <Th>Items</Th>
                  <Th align="right">Total</Th>
                  <Th>Status</Th>
                  <Th>Created by</Th>
                  <Th>Created</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {drafts.data.map((draft) => (
                  <tr key={draft.id}>
                    <Td>
                      <span className="font-mono text-xs font-semibold text-slate-900">
                        <Code>{draft.number}</Code>
                      </span>
                    </Td>

                    <Td>
                      <span className="block max-w-[12rem] truncate" title={draft.vendor.name}>
                        <Name>{draft.vendor.name}</Name>
                      </span>
                    </Td>

                    <Td>
                      <DateText value={draft.poDate} />
                    </Td>

                    {/* A draft may legitimately have none yet — that is what a
                      draft is for — so the cell says so rather than sitting
                      blank as though something failed to load. */}
                    <Td valign="top">
                      {draft.lines.length === 0 ? (
                        <span className="text-xs text-slate-400">Nothing added yet</span>
                      ) : (
                        <ul className="space-y-1">
                          {draft.lines.map((line) => (
                            <li key={line.id}>
                              <span
                                className="block max-w-[14rem] truncate text-xs text-slate-800"
                                title={`${line.item.name} (${line.item.code})`}
                              >
                                <Name>{line.item.name}</Name>
                              </span>
                              <span className="block text-[11px] text-slate-500">
                                <Qty value={line.quantity} uom={line.item.uom} />
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>

                    <Td align="right">
                      <Money amount={draft.totalAmount} bold />
                    </Td>

                    <Td>
                      <StatusPill
                        status={draft.status}
                        label={PURCHASE_ORDER_STATUS_LABELS[draft.status]}
                      />
                    </Td>

                    <Td>
                      {draft.createdBy ? (
                        <span className="text-xs text-slate-600"><Name>{draft.createdBy}</Name></span>
                      ) : (
                        <Blank />
                      )}
                    </Td>

                    <Td>
                      <DateText value={draft.createdAt} />
                    </Td>

                    <Td>
                      <DraftOrderActions order={draft} vendors={vendorList} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      )}

      <Panel
        title="Purchase orders"
        subtitle={
          orders.ok ? `${orders.data.total} order${orders.data.total === 1 ? '' : 's'}` : undefined
        }
        action={
          <>
            <SearchBox placeholder="Search by PO number, vendor or item…" />
            <FilterButton />
          </>
        }
      >
        <FilterPanel
          statuses={PURCHASE_ORDER_STATUSES.map((status) => ({
            value: status,
            label: PURCHASE_ORDER_STATUS_LABELS[status],
          }))}
          vendors={vendors.ok ? toOptions(vendors.data) : []}
          items={items.ok ? toOptions(items.data) : []}
          requisitions={requisitionOptions}
        />

        {!orders.ok ? (
          <ErrorState message={`Could not load purchase orders: ${orders.error}`} />
        ) : orders.data.rows.length === 0 ? (
          <EmptyState
            title="No purchase orders yet."
            hint="Approve a requisition and use Convert to PO to raise the first one."
            filtered={isFiltered}
          />
        ) : (
          <>
            <TableWrap>
              <table className="w-full min-w-[86rem] text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500">
                    <Th>PO no.</Th>
                    <Th>Raised</Th>
                    <Th>Vendor</Th>
                    <Th>Item</Th>
                    <Th align="right">Quantity</Th>
                    <Th align="right">Rate</Th>
                    <Th align="right">Total</Th>
                    <Th>Status</Th>
                    <Th>Linked</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {orders.data.rows.map((order) => (
                    <tr key={order.id}>
                      <Td>
                        <span className="font-mono text-xs font-semibold text-slate-900">
                          <Code>{order.number}</Code>
                        </span>
                        <span className="mt-0.5 block text-[11px] text-slate-500">
                          net {order.paymentTermsDays} days
                        </span>
                      </Td>

                      <Td>
                        <DateText value={order.poDate} />
                        {order.expectedDeliveryDate && (
                          <span className="mt-0.5 block text-[11px] text-slate-500">
                            due <DateText value={order.expectedDeliveryDate} />
                          </span>
                        )}
                      </Td>

                      <Td>
                        {/* Truncated with the full name on hover, so one long
                            vendor name cannot set the width of the column. */}
                        <span className="block max-w-[11rem] truncate" title={order.vendor.name}>
                          <Name>{order.vendor.name}</Name>
                        </span>
                      </Td>

                      {/* THE LINES, STACKED IN THE ROW. One row per order keeps
                          the pager's count and the rows on screen the same
                          number, and keeps each order's values unmistakably
                          its own. */}
                      <Td valign="top">
                        <ul className="space-y-1">
                          {order.lines.map((line) => (
                            <li key={line.id}>
                              <span
                                className="block max-w-[14rem] truncate text-xs font-medium text-slate-800"
                                title={`${line.item.name} (${line.item.code})`}
                              >
                                <Name>{line.item.name}</Name>
                              </span>
                              {line.requisition && (
                                <span className="block font-mono text-[11px] text-slate-500">
                                  <Code>{line.requisition.number}</Code>
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </Td>

                      <Td align="right" valign="top">
                        <ul className="space-y-1">
                          {order.lines.map((line) => (
                            <li key={line.id}>
                              <Qty value={line.quantity} uom={line.item.uom} />
                              {line.quantityPending !== '0' && (
                                <span className="block text-[11px] text-amber-800">
                                  {line.quantityPending} pending
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </Td>

                      <Td align="right" valign="top">
                        <ul className="space-y-1">
                          {order.lines.map((line) => (
                            <li key={line.id}>
                              <Money amount={line.rate} />
                            </li>
                          ))}
                        </ul>
                      </Td>

                      <Td align="right">
                        <Money amount={order.totalAmount} bold />
                        <span className="mt-0.5 block text-[11px] text-slate-500">
                          incl. <Money amount={order.taxAmount} /> GST
                        </span>
                      </Td>

                      {/* ONE STATUS, IN ITS OWN COLUMN. The row used to carry a
                          pill here AND a separate dropdown in the actions,
                          which is two controls claiming the same fact. The
                          dropdown moved into the Edit dialog. */}
                      <Td>
                        <StatusPill
                          status={order.status}
                          label={PURCHASE_ORDER_STATUS_LABELS[order.status]}
                        />
                      </Td>

                      <Td>
                        {order.goodsReceipts.length === 0 && order.invoices.length === 0 ? (
                          <Blank />
                        ) : (
                          <ul className="space-y-0.5">
                            {order.goodsReceipts.map((grn) => (
                              <li key={grn.id}>
                                <RecordLink
                                  href={`${PROCUREMENT_ROUTES.goodsReceipts}?search=${grn.number}`}
                                >
                                  <span className="font-mono text-[11px]"><Code>{grn.number}</Code></span>
                                </RecordLink>
                              </li>
                            ))}
                            {order.invoices.map((invoice) => (
                              <li key={invoice.id}>
                                <RecordLink
                                  href={`${PROCUREMENT_ROUTES.invoices}?search=${invoice.number}`}
                                >
                                  <span className="font-mono text-[11px]"><Code>{invoice.number}</Code></span>
                                </RecordLink>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Td>

                      <Td>
                        <PurchaseOrderActions order={order} vendors={vendorList} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>

            <Pagination
              total={orders.data.total}
              page={orders.data.page}
              pageSize={orders.data.pageSize}
              noun="orders"
            />
          </>
        )}
      </Panel>
    </>
  );
}
