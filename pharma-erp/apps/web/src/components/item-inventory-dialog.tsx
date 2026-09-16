'use client';

import { useEffect, useState } from 'react';
import { INVENTORY_STATUS_LABELS, type ItemInventory, type ItemSummary } from '@pharma-erp/types';

import { loadItemInventoryAction } from '@/app/(app)/master-data/actions';

/**
 * What one item is actually holding, lot by lot.
 *
 * ONLY LOTS INCOMING QC ACCEPTED APPEAR HERE. A goods receipt creates a lot in
 * quarantine and the QC decision is what releases it, so this answers "what do
 * we hold" rather than "what arrived" — and the two differ by exactly the
 * material somebody has decided must not be used.
 *
 * The status column is DERIVED from the expiry date, never stored: a lot that
 * expires tonight is usable now and expired tomorrow with nothing happening in
 * between, so a stored flag would be wrong from midnight until a job nobody
 * runs rewrote it.
 *
 * Fetched when the dialog opens rather than with the register. The register
 * lists every item and this is one item's detail — loading all of it up front
 * would mean a query per item on a page nobody has asked a stock question on
 * yet.
 */
export function ItemInventoryDialog({ item, onClose }: { item: ItemSummary; onClose: () => void }) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; data: ItemInventory }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void loadItemInventoryAction(item.id).then((result) => {
      // A dialog closed before the answer arrives must not set state on a
      // component that is no longer mounted.
      if (cancelled) return;

      setState(
        result.ok
          ? { status: 'ready', data: result.data }
          : { status: 'error', message: result.message },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [item.id]);

  // Escape closes it, like every other dismissible layer in the application.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close inventory"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-slate-900/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="inventory-title"
        className="relative flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <h2 id="inventory-title" className="text-base font-semibold text-slate-900">
              Inventory — <span className="font-mono text-sm">{item.code}</span> {item.name}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Lots released by incoming QC. Quarantined and rejected stock is not held here.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Close
          </button>
        </header>

        {state.status === 'loading' && (
          <p role="status" className="px-6 py-10 text-center text-sm text-slate-500">
            Loading inventory…
          </p>
        )}

        {state.status === 'error' && (
          <p
            role="alert"
            className="m-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {state.message}
          </p>
        )}

        {state.status === 'ready' && <InventoryBody data={state.data} uom={item.uom} />}
      </div>
    </div>
  );
}

function InventoryBody({ data, uom }: { data: ItemInventory; uom: string }) {
  if (data.lots.length === 0) {
    return (
      <p className="px-6 py-10 text-center text-sm text-slate-600">
        No stock on hand. A lot appears here once a goods receipt has been recorded for it and
        incoming QC has accepted it.
      </p>
    );
  }

  return (
    <>
      <dl className="grid gap-4 border-b border-slate-200 bg-slate-50 px-6 py-4 text-sm sm:grid-cols-3">
        <Total label="Usable" value={data.usableQuantity} uom={uom} />
        <Total label="Expired" value={data.expiredQuantity} uom={uom} tone="text-red-700" />
        <Total label="Lots" value={String(data.lots.length)} />
      </dl>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-10 bg-white">
            <tr>
              {['Lot', 'Status', 'Expiry', 'Available', 'Received', 'Source'].map(
                (label, index) => (
                  <th
                    key={label}
                    scope="col"
                    className={`whitespace-nowrap border-b border-slate-200 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 ${
                      index === 3 || index === 4 ? 'text-right' : ''
                    }`}
                  >
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>

          <tbody>
            {data.lots.map((lot) => (
              <tr key={lot.id} className={lot.status === 'EXPIRED' ? 'bg-red-50/50' : undefined}>
                <td className="border-b border-slate-100 px-4 py-2.5">
                  <span className="font-mono text-xs text-slate-800">{lot.lotNumber}</span>
                  {lot.vendorBatchNumber && (
                    <div className="text-xs text-slate-500">
                      Vendor batch {lot.vendorBatchNumber}
                    </div>
                  )}
                </td>

                <td className="border-b border-slate-100 px-4 py-2.5">
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                      lot.status === 'EXPIRED'
                        ? 'bg-red-50 text-red-800 ring-red-200'
                        : 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                    }`}
                  >
                    {INVENTORY_STATUS_LABELS[lot.status]}
                  </span>
                </td>

                <td className="whitespace-nowrap border-b border-slate-100 px-4 py-2.5 tabular-nums text-slate-700">
                  {lot.expiryDate ?? <span className="text-slate-400">no expiry</span>}
                  {/* The countdown is what turns a date into a decision: "in 12
                      days" is actionable in a way that "2026-09-28" is not. */}
                  {lot.daysToExpiry !== null && (
                    <div
                      className={`text-xs ${
                        lot.daysToExpiry <= 0
                          ? 'text-red-700'
                          : lot.daysToExpiry < 90
                            ? 'text-amber-700'
                            : 'text-slate-500'
                      }`}
                    >
                      {lot.daysToExpiry <= 0
                        ? `expired ${Math.abs(lot.daysToExpiry)}d ago`
                        : lot.daysToExpiry < 60
                          ? `in ${lot.daysToExpiry}d`
                          : `in ${Math.round(lot.daysToExpiry / 30)} months`}
                    </div>
                  )}
                </td>

                <td className="whitespace-nowrap border-b border-slate-100 px-4 py-2.5 text-right tabular-nums text-slate-800">
                  {lot.quantityAvailable} <span className="text-xs text-slate-500">{uom}</span>
                </td>

                <td className="whitespace-nowrap border-b border-slate-100 px-4 py-2.5 text-right tabular-nums text-slate-500">
                  {lot.quantityReceived}
                </td>

                <td className="border-b border-slate-100 px-4 py-2.5 text-slate-600">
                  {lot.goodsReceiptNumber ? (
                    <>
                      <span className="font-mono text-xs">{lot.goodsReceiptNumber}</span>
                      <div className="text-xs text-slate-500">
                        {lot.vendorName}
                        {lot.receivedOn && ` · ${lot.receivedOn}`}
                      </div>
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-slate-200 px-6 py-3 text-xs text-slate-500">
        Expiry is worked out against today, never stored — a lot expiring tonight is usable now and
        expired tomorrow. A lot counts as expired ON its expiry date.
      </p>
    </>
  );
}

function Total({
  label,
  value,
  uom,
  tone = 'text-slate-900',
}: {
  label: string;
  value: string;
  uom?: string;
  tone?: string;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-1 font-semibold tabular-nums ${tone}`}>
        {value} {uom && <span className="text-xs font-normal text-slate-500">{uom}</span>}
      </dd>
    </div>
  );
}
