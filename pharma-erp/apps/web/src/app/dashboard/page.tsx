import type { Metadata } from 'next';
import Link from 'next/link';
import {
  LICENCE_TYPE_LABELS,
  masterDataHref,
  PACKAGING_RISK_LABELS,
  type LicenceAlert,
  type PackagingShortageAlert,
  type StatWidget,
  type TenantDashboard,
} from '@pharma-erp/types';

import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import { requireSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

/**
 * The signed-in user's dashboard.
 *
 * Every section here comes from the API, which decides what this role may see.
 * The page renders what arrives rather than fetching everything and hiding
 * some of it — a dashboard that filters client-side has already sent the data.
 */
export default async function DashboardPage() {
  const user = await requireSession();
  const result = await apiFetch<TenantDashboard>('/api/v1/dashboard', { authenticated: true });

  return (
    <AppShell user={user}>
      <main className="mx-auto max-w-6xl px-6 py-10">
        {!result.ok ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
            Could not load your dashboard: {result.error}
          </p>
        ) : (
          <DashboardContent data={result.data} />
        )}
      </main>
    </AppShell>
  );
}

function DashboardContent({ data }: { data: TenantDashboard }) {
  return (
    <>
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
          {data.roleLabel}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          {data.headline}
        </h1>
        <p className="mt-1.5 text-sm text-slate-600">
          {data.company.name} · <span className="font-mono text-xs">{data.company.slug}</span> ·{' '}
          {data.company.timezone}
        </p>
      </header>

      {/* Above everything else on purpose. An expired manufacturing licence is
          a stop-work condition, not a statistic, and a warning further down the
          page is a warning somebody scrolls past. Present only for the roles
          allowed to see licence records — US-MD-04. */}
      {data.licenceAlert && <LicenceAlertPanel alert={data.licenceAlert} />}

      {/* US-MD-06: a packaging shortage must be visible BEFORE the batch is due
          for packing. Directly under the licence warning and above everything
          else, because both are things that stop work rather than describe it. */}
      {data.packagingShortages && data.packagingShortages.plans.length > 0 && (
        <PackagingShortagePanel alert={data.packagingShortages} />
      )}

      {/* The identity panel: who you are, what company, what you can do. Stated
          explicitly because in a multi-tenant system acting in the wrong company
          or believing you have authority you lack are both real hazards. */}
      <section
        aria-labelledby="your-access"
        className="mb-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="your-access" className="text-base font-semibold text-slate-900">
              Your access
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {data.readOnly
                ? 'You can view every module but cannot create or change records.'
                : 'Enforced by the API and by row-level security, not by this page.'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge
              label={data.company.status}
              tone={data.company.status === 'ACTIVE' ? 'ok' : 'warn'}
            />
            {data.readOnly && <Badge label="Read-only" tone="warn" />}
            {!data.company.drugLicenceNumber && <Badge label="No licence on file" tone="warn" />}
          </div>
        </div>

        <ul className="mt-5 flex flex-wrap gap-2">
          {data.accessibleModules.map((module) => (
            <li
              key={module}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium capitalize text-slate-700"
            >
              {module}
            </li>
          ))}
        </ul>
      </section>

      {data.companyStats && <CompanyStatsPanel stats={data.companyStats} />}

      <div className="space-y-6">
        {data.sections.map((section) => (
          <section
            key={section.key}
            aria-labelledby={`section-${section.key}`}
            className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 id={`section-${section.key}`} className="text-base font-semibold text-slate-900">
              {section.title}
            </h2>
            {section.note && <p className="mt-1 text-sm text-slate-500">{section.note}</p>}

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {section.widgets.map((widget) => (
                <Widget key={widget.key} widget={widget} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <section
        aria-labelledby="recent-activity"
        className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm"
      >
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 id="recent-activity" className="text-base font-semibold text-slate-900">
            Recent activity
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {data.role === 'ADMIN' || data.role === 'MANAGEMENT'
              ? 'Everything at this company. Append-only — these records cannot be edited by anyone.'
              : 'Your own activity. Append-only and cannot be edited.'}
          </p>
        </div>

        {data.recentActivity.length === 0 ? (
          <p className="p-6 text-sm text-slate-600">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.recentActivity.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-baseline justify-between gap-2 px-6 py-3 text-sm"
              >
                <span className="font-medium text-slate-800">
                  {entry.action.toLowerCase()} · {entry.entityType}
                </span>
                <span className="text-xs text-slate-500">
                  {entry.actor ?? 'system'} ·{' '}
                  {new Date(entry.at).toISOString().slice(0, 16).replace('T', ' ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * The licence renewal warning — US-MD-04's "dashboard alert".
 *
 * Three states, and each says something different:
 *
 *   nothing expiring — a quiet line confirming the check ran. Silence would be
 *       indistinguishable from the feature being broken, which is the failure
 *       mode that matters for a compliance alert.
 *   expiring — amber, with the days remaining.
 *   already expired — red, listed first, and phrased as a fact rather than a
 *       countdown. Production on a lapsed licence is not a scheduling problem.
 *
 * `leadDays` is shown because it explains WHY a licence is on the list, and
 * because someone surprised by the cutoff can then go and change it.
 */
function LicenceAlertPanel({ alert }: { alert: LicenceAlert }) {
  const expired = alert.licences.filter((licence) => licence.status === 'EXPIRED');
  const expiring = alert.licences.filter((licence) => licence.status === 'EXPIRING');

  if (alert.licences.length === 0) {
    return (
      <section
        aria-labelledby="licence-alert"
        className="mb-8 rounded-lg border border-slate-200 bg-white px-6 py-4 shadow-sm"
      >
        <h2 id="licence-alert" className="text-sm font-semibold text-slate-900">
          Licences
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Nothing expires within {alert.leadDays} days.{' '}
          <Link
            href={masterDataHref('licence-compliance')}
            className="font-medium text-slate-900 underline underline-offset-2 hover:text-slate-700"
          >
            Open the register
          </Link>
        </p>
      </section>
    );
  }

  const critical = expired.length > 0;

  return (
    <section
      aria-labelledby="licence-alert"
      className={`mb-8 rounded-lg border shadow-sm ${
        critical ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 py-4">
        <div>
          <h2
            id="licence-alert"
            className={`text-sm font-semibold ${critical ? 'text-red-900' : 'text-amber-900'}`}
          >
            {critical
              ? `${expired.length} ${expired.length === 1 ? 'licence has' : 'licences have'} expired`
              : `${expiring.length} ${expiring.length === 1 ? 'licence expires' : 'licences expire'} soon`}
          </h2>
          <p className={`mt-1 text-sm ${critical ? 'text-red-800' : 'text-amber-800'}`}>
            {critical && expiring.length > 0 && `${expiring.length} more within `}
            {!critical && 'Within '}
            {(critical && expiring.length > 0) || !critical ? `${alert.leadDays} days. ` : ''}
            Renewing means changing the expiry date on the existing record.
          </p>
        </div>

        <Link
          href={masterDataHref('licence-compliance')}
          className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition ${
            critical ? 'bg-red-700 hover:bg-red-800' : 'bg-amber-700 hover:bg-amber-800'
          }`}
        >
          Open the register
        </Link>
      </div>

      <ul
        className={`divide-y border-t ${
          critical ? 'divide-red-200 border-red-200' : 'divide-amber-200 border-amber-200'
        }`}
      >
        {/* Expired first: they are the ones that have already stopped being a
            deadline and started being a problem. */}
        {[...expired, ...expiring].map((licence) => (
          <li
            key={licence.id}
            className="flex flex-wrap items-baseline justify-between gap-2 px-6 py-2.5 text-sm"
          >
            <span className="font-medium text-slate-900">
              {LICENCE_TYPE_LABELS[licence.licenceType]}{' '}
              <span className="font-mono text-xs text-slate-600">{licence.licenceNumber}</span>
            </span>
            <span
              className={
                licence.status === 'EXPIRED'
                  ? 'text-xs font-semibold text-red-800'
                  : 'text-xs font-semibold text-amber-900'
              }
            >
              {licence.status === 'EXPIRED'
                ? `expired ${licence.expiryDate}`
                : `${licence.daysUntilExpiry} ${
                    licence.daysUntilExpiry === 1 ? 'day' : 'days'
                  } left · ${licence.expiryDate}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Planned batches that will not pack cleanly — US-MD-06's fourth criterion.
 *
 * Rendered only when there is something to say. Unlike the licence panel, there
 * is no quiet "all clear" line: a company with no open plans would get one
 * every day, and a panel that is always present is one nobody reads.
 *
 * Each row leads with the days remaining, because that is the number that
 * decides whether this is today's problem or next month's. The short
 * components are named underneath — a buyer cannot act on "packaging short",
 * only on "400 cartons".
 */
function PackagingShortagePanel({ alert }: { alert: PackagingShortageAlert }) {
  const critical = alert.blockedCount > 0;

  return (
    <section
      aria-labelledby="packaging-shortages"
      className={`mb-8 rounded-lg border shadow-sm ${
        critical ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 py-4">
        <div>
          <h2
            id="packaging-shortages"
            className={`text-sm font-semibold ${critical ? 'text-red-900' : 'text-amber-900'}`}
          >
            {critical
              ? `${alert.blockedCount} planned ${
                  alert.blockedCount === 1 ? 'batch cannot' : 'batches cannot'
                } be packed`
              : `${alert.plans.length} planned ${
                  alert.plans.length === 1 ? 'batch is' : 'batches are'
                } partly short of packaging`}
          </h2>
          <p className={`mt-1 text-sm ${critical ? 'text-red-800' : 'text-amber-800'}`}>
            Found before the batch is due, not on the packing line.
          </p>
        </div>

        <Link
          href={masterDataHref('packaging-requirement')}
          className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition ${
            critical ? 'bg-red-700 hover:bg-red-800' : 'bg-amber-700 hover:bg-amber-800'
          }`}
        >
          Pack specifications
        </Link>
      </div>

      <ul
        className={`divide-y border-t ${
          critical ? 'divide-red-200 border-red-200' : 'divide-amber-200 border-amber-200'
        }`}
      >
        {alert.plans.map((plan) => (
          <li key={plan.planId} className="px-6 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-slate-900">
                {plan.productCode} <span className="font-normal">{plan.productName}</span>
                {plan.packVariant && (
                  <span className="ml-1.5 text-xs text-slate-600">· {plan.packVariant}</span>
                )}
                <span className="ml-1.5 font-mono text-[11px] text-slate-500">
                  {plan.planNumber}
                </span>
              </span>
              <span
                className={`text-xs font-semibold ${
                  plan.risk === 'SHORT_OPTIONAL' ? 'text-amber-900' : 'text-red-800'
                }`}
              >
                {PACKAGING_RISK_LABELS[plan.risk]}
                {plan.daysUntilPacking === null
                  ? ' · no date set'
                  : plan.daysUntilPacking < 0
                    ? ` · due ${Math.abs(plan.daysUntilPacking)}d ago`
                    : ` · due in ${plan.daysUntilPacking}d`}
              </span>
            </div>

            {plan.shortComponents.length > 0 ? (
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {plan.shortComponents.map((component) => (
                  <li
                    key={component.itemCode}
                    className="flex flex-wrap items-baseline gap-1.5 text-xs text-slate-700"
                  >
                    <span className="font-mono text-[11px] text-slate-600">
                      {component.itemCode}
                    </span>
                    <span className="font-semibold tabular-nums">
                      short {component.quantityShort} {component.uom}
                    </span>
                    <span className="text-slate-500">
                      (need {component.quantityRequired}, have {component.quantityAvailable})
                    </span>
                    {component.requirement === 'MANDATORY' && (
                      <span className="font-semibold uppercase tracking-wide text-red-700">
                        blocks
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-xs text-slate-700">
                This product has no active pack specification, so no work order can be raised for
                it.
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CompanyStatsPanel({ stats }: { stats: NonNullable<TenantDashboard['companyStats']> }) {
  return (
    <section
      aria-labelledby="company-stats"
      className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2 id="company-stats" className="text-base font-semibold text-slate-900">
        Company
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Since {new Date(stats.createdAt).toISOString().slice(0, 10)} ·{' '}
        {stats.auditRecordCount.toLocaleString()} audit records
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Users" value={stats.users.total} />
        <Tile label="Active" value={stats.users.active} tone="ok" />
        <Tile
          label="Awaiting password change"
          value={stats.users.pendingPasswordChange}
          tone={stats.users.pendingPasswordChange > 0 ? 'warn' : 'neutral'}
        />
        <Tile label="Disabled" value={stats.users.disabled} />
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th scope="col" className="pb-2 pr-4 font-medium">
                Role
              </th>
              <th scope="col" className="pb-2 font-medium">
                People
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {stats.users.byRole.map((row) => (
              <tr key={row.role}>
                <th scope="row" className="py-2 pr-4 font-normal text-slate-700">
                  {row.label}
                </th>
                <td
                  className={`py-2 tabular-nums ${
                    row.count === 0 ? 'text-slate-400' : 'font-medium text-slate-900'
                  }`}
                >
                  {row.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * A single statistic.
 *
 * A `pending` widget shows an em dash and a note, never a zero. A zero is a
 * claim — "there are no expiring batches" — and in a pharma system that claim
 * being wrong is worse than an obvious gap.
 */
function Widget({ widget }: { widget: StatWidget }) {
  if (widget.state === 'pending') {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-4">
        <p className="text-xs uppercase tracking-wide text-slate-400">{widget.label}</p>
        <p className="mt-1 text-2xl font-semibold text-slate-300">—</p>
        <p className="mt-1 text-xs text-slate-400">Not built yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{widget.label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{widget.value}</p>
      {widget.detail && <p className="mt-1 text-xs text-slate-500">{widget.detail}</p>}
    </div>
  );
}

function Tile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'ok' | 'warn';
}) {
  const toneClass = {
    neutral: 'text-slate-900',
    ok: 'text-status-ok',
    warn: 'text-status-warn',
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: 'ok' | 'warn' }) {
  const toneClass =
    tone === 'ok'
      ? 'bg-green-50 text-green-800 ring-green-200'
      : 'bg-amber-50 text-amber-800 ring-amber-200';

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${toneClass}`}
    >
      {label}
    </span>
  );
}
