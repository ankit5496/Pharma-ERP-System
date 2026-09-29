import type { ReactNode } from 'react';
import { canAccessModule } from '@pharma-erp/types';

import { AppShell } from '@/components/app-shell';
import { InventoryTabs } from '@/components/inventory/inventory-tabs';
import { ErrorState } from '@/components/procurement/ui';
import { requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The chrome the Dashboard & Reports screens share, laid out like a
 * workflow's: the heading, the pill sub-tabs, then the screen's own panel.
 * The header's tab row shows this section's own tab — see PrimaryNav.
 *
 * A role without the 'inventory' module — everyone but Admin, Store Officer
 * and Management — gets one clear refusal here instead of each screen's own.
 * The API refuses the data regardless; this only says so in words, and covers
 * the Dashboard tab, which reads nothing to be refused.
 */
export default async function InventoryLayout({ children }: { children: ReactNode }) {
  const user = await requireSession();
  const allowed = canAccessModule(user.role, 'inventory');

  return (
    <AppShell user={user}>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Dashboard &amp; Reports
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm text-slate-600">
            Stock on hand, batch by batch, and the batches running out of shelf life before they
            become a write-off.
          </p>
        </header>

        {allowed ? (
          <>
            <InventoryTabs />
            {children}
          </>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <ErrorState message="Your role cannot open Dashboard & Reports. It is for Store Officers, Management and Admins." />
          </div>
        )}
      </main>
    </AppShell>
  );
}
