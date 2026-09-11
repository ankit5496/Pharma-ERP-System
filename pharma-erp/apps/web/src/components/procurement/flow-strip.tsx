'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PROCUREMENT_ROUTES } from '@pharma-erp/types';

/**
 * The end-to-end flow, shown above every sub-tab.
 *
 * Procure-to-Pay is one process crossing four roles, and the person doing any
 * single step usually cannot see where their work goes next. This makes the
 * whole chain visible from every screen and marks where the reader currently
 * is, including the branch at the quality gate — which is the one place the
 * process can go two ways, and the one thing a linear list of tabs cannot say.
 */
const STEPS: readonly { key: string; label: string; href: string }[] = [
  { key: 'low-stock', label: 'Low stock', href: `${PROCUREMENT_ROUTES.requisitions}?view=low-stock` },
  { key: 'requisitions', label: 'Requisition', href: PROCUREMENT_ROUTES.requisitions },
  { key: 'purchase-orders', label: 'Purchase order', href: PROCUREMENT_ROUTES.purchaseOrders },
  { key: 'goods-receipts', label: 'GRN', href: PROCUREMENT_ROUTES.goodsReceipts },
  { key: 'incoming-qc', label: 'Incoming QC', href: PROCUREMENT_ROUTES.incomingQc },
  { key: 'invoices', label: 'Invoice', href: PROCUREMENT_ROUTES.invoices },
  { key: 'payments', label: 'Payment', href: PROCUREMENT_ROUTES.payments },
];

export function FlowStrip() {
  const pathname = usePathname();
  // The active step is the last URL segment, which is the sub-tab key.
  const active = pathname.split('/').filter(Boolean).pop() ?? '';

  return (
    <nav
      aria-label="Procure-to-Pay flow"
      className="mb-6 overflow-x-auto rounded-lg border border-slate-200 bg-white px-4 py-3"
    >
      <ol className="flex min-w-max items-center gap-1 text-xs">
        {STEPS.map((step, index) => {
          const isActive = step.key === active;

          return (
            <li key={step.key} className="flex items-center gap-1">
              {index > 0 && (
                <span aria-hidden="true" className="px-1 text-slate-300">
                  →
                </span>
              )}
              <Link
                href={step.href}
                aria-current={isActive ? 'step' : undefined}
                className={`whitespace-nowrap rounded px-2 py-1 font-medium transition ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {step.label}
              </Link>

              {/* The branch. Stated inline because "accepted goes one way,
                  rejected goes another" is the single most important rule in
                  this workflow and it has no tab of its own. */}
              {step.key === 'incoming-qc' && (
                <span className="ml-1 flex items-center gap-1 whitespace-nowrap rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px]">
                  <span className="font-medium text-green-800">accepted → usable stock</span>
                  <span className="text-slate-300">|</span>
                  <span className="font-medium text-red-800">
                    rejected → quarantine, vendor return
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
