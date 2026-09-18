import type { CustomerListItem, ItemListItem, SalesOrderListItem } from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

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
  StepHeader,
  Table,
} from './ui';

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
export async function SalesOrdersPanel({ search }: { search?: string }) {
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

  return (
    <>
      <StepHeader
        title="Sales orders"
        description="Orders received from a distributor, priced from the item master. An order must pass both the licence and the credit check before any stock can be reserved against it."
      />

      <div className="mb-6">
        <NewSalesOrderForm
          customers={customers.ok ? customers.data : []}
          items={items.ok ? items.data : []}
          customersError={customers.ok ? null : customers.error}
          itemsError={items.ok ? null : items.error}
        />
      </div>

      <Panel
        heading="Orders"
        count={orders.ok ? orders.data.length : undefined}
        noun="order"
        footer="Both checks are re-run from the database every time. A pass recorded earlier is never reused at allocation, invoicing or dispatch — each of those re-reads it."
      >
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
            {orders.data.map((order) => (
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
