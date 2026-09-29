'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The Reports tab's screens, shown as pill sub-tabs under the heading. */
export const REPORT_TABS = [
  {
    label: 'Stock Enquiry',
    href: '/inventory/stock',
    purpose: 'Stock on hand, batch by batch, with expiry and reservation.',
  },
  {
    label: 'Near-Expiry Report',
    href: '/inventory/near-expiry',
    purpose: "Batches expired or expiring within this company's alert windows.",
  },
] as const;

/**
 * The header's tabs inside Dashboard & Reports, in place of the workflows —
 * see PrimaryNav. Reports opens on its first screen and stays current on both.
 */
export const SECTION_TABS = [
  {
    label: 'Dashboard',
    href: '/inventory',
    purpose: 'Charts and summaries — to be added.',
    isActive: (pathname: string) => pathname === '/inventory',
  },
  {
    label: 'Reports',
    href: REPORT_TABS[0].href,
    purpose: 'Stock enquiry and the near-expiry report.',
    isActive: (pathname: string) => REPORT_TABS.some((tab) => pathname === tab.href),
  },
] as const;

/**
 * The Reports sub-tabs, as the same pill row the workflows use
 * (`WorkflowSubnav`). No step numbers: these are two views, not a sequence.
 * Renders nothing on the Dashboard, which has no sub-tabs.
 */
export function InventoryTabs() {
  const pathname = usePathname();

  if (!SECTION_TABS[1].isActive(pathname)) return null;

  return (
    <nav aria-label="Reports" className="mb-8 overflow-x-auto">
      <ol className="flex min-w-max gap-1.5">
        {REPORT_TABS.map((tab) => {
          const isActive = pathname === tab.href;

          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                title={tab.purpose}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition ${
                  isActive
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
