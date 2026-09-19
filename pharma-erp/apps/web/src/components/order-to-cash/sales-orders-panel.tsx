import type { CustomerListItem, ItemListItem, SalesOrderListItem } from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

import {
  CreateDialogButton,
  FilterPanel,
  FilterToggle,
  PanelSearch,
} from './panel-toolbar';

import { NewSalesOrderForm, SalesOrderRowActions } from './sales-order-forms';
import {
  Cell,
  col,
  CheckBadge,
  EmptyState,
  ErrorState,
  formatDate,
  Money,
  Note,
  Panel,
  Quantity,
  StatusBadge,
  Table,
} from './ui';

const SALES_ORDER_FILTERS = [
  {
    param: 'status',
    label: 'Status',
    allLabel: 'Any status',
    choices: [
      { value: 'DRAFT', label: 'Draft' },
      { value: 'APPROVED', label: 'Approved' },
      { value: 'BLOCKED', label: 'Blocked' },
      { value: 'PARTIALLY_ALLOCATED', label: 'Partially allocated' },
      { value: 'ALLOCATED', label: 'Allocated' },
      { value: 'DISPATCHED', label: 'Dispatched' },
      { value: 'COMPLETED', label: 'Completed' },
      { value: 'CANCELLED', label: 'Cancelled' },
    ],
  },
  { param: 'dateFrom', label: 'Date from' },
  { param: 'dateTo', label: 'Date to' },
] as const;

const COLUMNS = [
  'Order #',
  'Customer',
  'Date',
  col.right('Qty'),
  col.right('Amount'),
  'Licence check',
  'Credit check',
  'Status',
  'Actions',
] as const;

/**
 * Subtab 2 — Sales orders.
 *
 * The two check columns are the reason this screen looks the way it does. Both
 * are always shown, including as "Not run", because the three states are
 * operationally different: not run means someone has to press the button, FAIL
 * means a licence or a credit decision is needed, PASS means the order can go to
 * allocation. Collapsing any pair of those would hide the next action.
 */
export async function SalesOrdersPanel({
  search,
  status,
}: {
  search?: string;
  /**
   * From the panel's Filter button. Applied here rather than on the wire: the
   * list endpoint takes no status parameter, and the rows are already loaded.
   */
  status?: string;
}) {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';

  // Fetched together: the form needs customers and products to offer, and three
  // sequential awaits would make the page three round trips deep.
  const [orders, customers, items] = await Promise.all([
    apiFetch<SalesOrderListItem[]>(`/api/v1/order-to-cash/sales-orders${query}`, {
      authenticated: true,
    }),
    apiFetch<CustomerListItem[]>('/api/v1/order-to-cash/customers?status=ACTIVE', {
      authenticated: true,
    }),
    apiFetch<ItemListItem[]>('/api/v1/masters/items?itemType=FINISHED_GOOD', {
      authenticated: true,
    }),
  ]);

  // Filtered after fetching, for the reason in the prop's comment.
  const visible =
    orders.ok && status
      ? orders.data.filter((row) => row.status === status)
      : orders.ok
        ? orders.data
        : [];

  return (
    <>
      <Panel
        heading="Orders"
        count={orders.ok ? visible.length : undefined}
        noun="order"
        action={
          <>
            <PanelSearch stepKey="sales-orders" placeholder="Search orders…" />
            <FilterToggle fields={SALES_ORDER_FILTERS} />
            <CreateDialogButton
              label="New sales order"
              title="New sales order"
              description="Priced from the item master. Released stock is checked before the order is created."
            >
              <NewSalesOrderForm
                inDialog
                customers={customers.ok ? customers.data : []}
                items={items.ok ? items.data : []}
                customersError={customers.ok ? null : customers.error}
                itemsError={items.ok ? null : items.error}
              />
            </CreateDialogButton>
          </>
        }
        footer="Both checks are re-run from the database every time. A pass recorded earlier is never reused at allocation, invoicing or dispatch — each of those re-reads it."
      >
        <FilterPanel fields={SALES_ORDER_FILTERS} />
        {!orders.ok ? (
          <ErrorState what="sales orders" message={orders.error} />
        ) : orders.data.length === 0 ? (
          <EmptyState
            title={search ? `No order matches “${search}”.` : 'No sales orders yet.'}
            hint={
              search
                ? 'Try a different order number or customer.'
                : 'Create one above. It starts as a draft; running the check is what approves or blocks it.'
            }
          />
        ) : (
          <Table columns={COLUMNS}>
            {visible.map((order) => (
              <OrderRow key={order.id} order={order} />
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

function OrderRow({ order }: { order: SalesOrderListItem }) {
  const blocked = order.status === 'BLOCKED';

  return (
    <>
      <tr className={blocked ? 'bg-red-50/40' : undefined}>
        <Cell>
          <p className="font-mono text-xs font-medium text-slate-900">{order.orderNumber}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {order.itemCount} line{order.itemCount === 1 ? '' : 's'}
          </p>
        </Cell>

        <Cell>
          <p className="text-sm text-slate-800">{order.customerName}</p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500">{order.customerCode}</p>
        </Cell>

        <Cell>
          <p className="whitespace-nowrap text-xs text-slate-700">{formatDate(order.orderDate)}</p>
          {order.requestedDeliveryDate && (
            <p className="mt-0.5 whitespace-nowrap text-[11px] text-slate-500">
              wants {formatDate(order.requestedDeliveryDate)}
            </p>
          )}
        </Cell>

        <Cell align="right">
          <Quantity value={order.totalQuantity} />
        </Cell>

        <Cell align="right">
          <Money value={order.grandTotal} bold />
          <p className="mt-0.5 text-[11px] text-slate-500">
            incl. <Money value={order.taxAmount} /> GST
          </p>
        </Cell>

        <Cell>
          <CheckBadge result={order.licenceCheck} />
        </Cell>

        <Cell>
          <CheckBadge result={order.creditCheck} />
        </Cell>

        <Cell>
          <StatusBadge status={order.status} />
        </Cell>

        <Cell>
          <SalesOrderRowActions order={order} />
        </Cell>
      </tr>

      {/* The refusal, spelled out under the row rather than hidden in a tooltip.
          It carries the limit, the balance and the shortfall, which is what
          someone needs in order to decide whether to raise the limit or chase
          the payment. */}
      {blocked && order.checkFailureReason && (
        <tr className="bg-red-50/40">
          <td colSpan={COLUMNS.length} className="px-5 pb-4 pt-0">
            <Note tone="red">
              <span className="font-semibold">Blocked: </span>
              {order.checkFailureReason}
            </Note>
          </td>
        </tr>
      )}
    </>
  );
}
