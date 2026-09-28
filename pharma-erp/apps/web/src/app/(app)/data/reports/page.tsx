import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { RegisterView } from '@/components/accounting/register-view';
import { AppShell } from '@/components/app-shell';
import { requireSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Accounting Reports' };
export const dynamic = 'force-dynamic';

/**
 * US-ACC-03 — Accounting Reports.
 *
 * ONE PAGE, TWO SUBTABS, matching the workflow screens: the register is a
 * query parameter rather than a second route, so the two registers cannot
 * drift into separate pages with their own navigation, and switching between
 * them keeps the date range you are working in.
 *
 * READ-ONLY. Nothing on this screen creates, amends or cancels an invoice; it
 * reports what Procure-to-Pay and Order-to-Cash have already recorded.
 */

const REGISTERS = [
  { key: 'purchase', label: 'Purchase Register' },
  { key: 'sales', label: 'Sales Register' },
] as const;

type RegisterKey = (typeof REGISTERS)[number]['key'];

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The current month, which is what a register is nearly always run over.
 *
 * Both ends are given so the report is a closed period from the first visit;
 * an open-ended default would change size as invoices were raised during the
 * day.
 */
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  const iso = (date: Date) => date.toISOString().slice(0, 10);

  return {
    from: iso(new Date(Date.UTC(year, month, 1))),
    // Day 0 of the next month is the last day of this one, leap years included.
    to: iso(new Date(Date.UTC(year, month + 1, 0))),
  };
}

function readDate(value: string | string[] | undefined, fallback: string): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

export default async function AccountingReportsPage({ searchParams }: PageProps) {
  const user = await requireSession();
  const query = await searchParams;

  const requested = typeof query.register === 'string' ? query.register : 'purchase';
  const register: RegisterKey = requested === 'sales' ? 'sales' : 'purchase';

  const fallback = defaultRange();
  const from = readDate(query.from, fallback.from);
  const to = readDate(query.to, fallback.to);

  // The table's own search, filter and page. Passed through as data rather
  // than named one by one, so a control can be added to the table without
  // editing this page.
  const table: Record<string, string> = Object.fromEntries(
    Object.entries(query).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
    ),
  );

  return (
    <AppShell user={user}>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Accounting Reports
          </h1>
        </header>

        {/* The subtab bar the workflow screens use, so switching register feels
            the same as switching step. The dates travel with the link: the
            period you are working in is not something to re-enter because you
            looked at the other register. */}
        <nav aria-label="Registers" className="mb-6 flex flex-wrap gap-2">
          {REGISTERS.map((entry) => {
            const active = entry.key === register;

            return (
              <Link
                key={entry.key}
                href={`/data/reports?register=${entry.key}&from=${from}&to=${to}`}
                aria-current={active ? 'page' : undefined}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                {entry.label}
              </Link>
            );
          })}
        </nav>

        {/* Keyed on the whole query so switching register or range remounts
            rather than showing the previous register's figures under the new
            heading while the next request is in flight. */}
        <Suspense key={`${register}-${from}-${to}`} fallback={<LoadingRegister />}>
          <RegisterView register={register} from={from} to={to} table={table} />
        </Suspense>
      </main>
    </AppShell>
  );
}

function LoadingRegister() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6">
      <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((card) => (
          <div key={card} className="h-20 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-slate-100" />
      <p className="text-xs text-slate-500">
        Building the register. The API can take up to a minute to wake after a period of inactivity.
      </p>
    </div>
  );
}
