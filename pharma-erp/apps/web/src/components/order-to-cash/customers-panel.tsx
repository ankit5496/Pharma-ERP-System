import { LICENCE_EXPIRY_WARNING_DAYS, type PartySummary } from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

import { CustomerRowActions } from './customer-forms';
import {
  Badge,
  Cell,
  EmptyState,
  ErrorState,
  formatDate,
  Money,
  Panel,
  StatusBadge,
  StepHeader,
  Table,
} from './ui';

const COLUMNS = [
  'Customer',
  'Licence',
  'Licence expiry',
  'Credit limit',
  'Status',
  'Actions',
] as const;

/**
 * Subtab 1 — Customers.
 *
 * READ-ONLY OVER THE SHARED PARTY REGISTER. This screen shows the customers
 * Master Data already holds — `GET /api/v1/parties?type=CUSTOMER`, the same
 * endpoint the Master Data party screen reads — and does not create them. A
 * customer is a party, and there is exactly one place to add one.
 *
 * The register is the same table either way; what changed is that this page no
 * longer offers a second way into it. Adding a customer belongs on the Master
 * Data screen, where the party register is maintained for every desk that reads
 * it, not only for sales.
 *
 * The licence columns come from the party's own licence fields — the single
 * licence US-MD-02 tests — so what is shown here is exactly what the order gate
 * will check.
 */
export async function CustomersPanel({ search }: { search?: string }) {
  const result = await apiFetch<PartySummary[]>('/api/v1/parties?type=CUSTOMER', {
    authenticated: true,
  });

  // Filtered here rather than on the wire: the shared endpoint takes no search
  // parameter, and adding one to a register three other modules read is not
  // this screen's call to make.
  const term = search?.trim().toLowerCase();
  const customers =
    result.ok && term
      ? result.data.filter((party) =>
          [party.code, party.name, party.gstin ?? '']
            .join(' ')
            .toLowerCase()
            .includes(term),
        )
      : result.ok
        ? result.data
        : [];

  return (
    <>
      <StepHeader
        title="Customers"
        description="Distributors and stockists who buy finished product, with the drug licence and credit terms every order is checked against."
      />

      <Panel
        heading="Customers"
        count={result.ok ? customers.length : undefined}
        noun="customer"
        footer="Customers are part of the shared party register and are added on the Master Data screen, so purchasing, sales and job work all read the same record."
      >
        {!result.ok ? (
          <ErrorState what="customers" message={result.error} />
        ) : customers.length === 0 ? (
          <EmptyState
            title={search ? `No customer matches “${search}”.` : 'No customers yet.'}
            hint={
              search
                ? 'Try a different code, name or GSTIN.'
                : 'Customers are added on the Master Data screen, under the party register. An order cannot be confirmed without a drug licence and a credit limit on file.'
            }
          />
        ) : (
          <Table columns={COLUMNS}>
            {customers.map((customer) => (
              <CustomerRow key={customer.id} customer={customer} />
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

function CustomerRow({ customer }: { customer: PartySummary }) {
  return (
    <tr>
      <Cell>
        <p className="font-medium text-slate-900">{customer.name}</p>
        <p className="mt-0.5 font-mono text-xs text-slate-500">{customer.code}</p>
        {customer.gstin && (
          <p className="mt-0.5 font-mono text-[11px] text-slate-400">{customer.gstin}</p>
        )}
      </Cell>

      <Cell>
        {customer.drugLicenceNumber ? (
          <p className="font-mono text-xs text-slate-700">{customer.drugLicenceNumber}</p>
        ) : (
          <Badge tone="red" title="An order cannot be confirmed without a valid drug licence">
            None on file
          </Badge>
        )}
      </Cell>

      <Cell>
        <LicenceExpiryCell customer={customer} />
      </Cell>

      <Cell align="right">
        <Money value={customer.creditLimit ?? '0.00'} />
        {customer.creditPeriodDays != null && customer.creditPeriodDays > 0 && (
          <p className="mt-0.5 text-[11px] text-slate-500">{customer.creditPeriodDays} days</p>
        )}
      </Cell>

      <Cell>
        <StatusBadge status={customer.status} />
      </Cell>

      <Cell>
        <CustomerRowActions customer={customer} />
      </Cell>
    </tr>
  );
}

/**
 * Licence expiry, with the three states that matter operationally.
 *
 * Expired is red because it stops orders today. "Expiring soon" is amber and
 * explicitly NOT a refusal — a licence valid for another fortnight is valid, and
 * the gate lets it through. Showing it as a warning is the point: it is the only
 * chance anyone gets to chase the renewal before it becomes a blocked order.
 *
 * `licenceExpired` is decided by the API against its own clock, so every screen
 * agrees on what "today" means. Only the countdown is worked out here, and only
 * for a licence the API has already said is still valid.
 */
function LicenceExpiryCell({ customer }: { customer: PartySummary }) {
  if (!customer.drugLicenceValidTo) return <span className="text-sm text-slate-400">—</span>;

  const validTo = customer.drugLicenceValidTo;

  if (customer.licenceExpired) {
    return (
      <>
        <p className="text-xs text-slate-700">{formatDate(validTo)}</p>
        <span className="mt-1 inline-block">
          <Badge tone="red">Expired</Badge>
        </span>
      </>
    );
  }

  const daysToExpiry = daysUntil(validTo);

  return (
    <>
      <p className="text-xs text-slate-700">{formatDate(validTo)}</p>
      <span className="mt-1 inline-block">
        {daysToExpiry !== null && daysToExpiry <= LICENCE_EXPIRY_WARNING_DAYS ? (
          <Badge tone="amber" title="Still valid — orders are not blocked. Chase the renewal.">
            {daysToExpiry}d left
          </Badge>
        ) : (
          <Badge tone="green">Valid</Badge>
        )}
      </span>
    </>
  );
}

/** Whole days from today to an ISO date, in UTC so it cannot drift by timezone. */
function daysUntil(isoDate: string): number | null {
  const expiry = new Date(isoDate);

  if (Number.isNaN(expiry.getTime())) return null;

  const today = new Date();
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const startOfExpiry = Date.UTC(
    expiry.getUTCFullYear(),
    expiry.getUTCMonth(),
    expiry.getUTCDate(),
  );

  return Math.round((startOfExpiry - startOfToday) / 86_400_000);
}
