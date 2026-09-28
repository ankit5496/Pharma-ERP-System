'use client';

import { useEffect, useState } from 'react';

import type { MaterialRequirementSummary } from '@pharma-erp/types';

import { materialRequirementsAction } from './actions';
import { formatDateTime, formatQuantity, Note } from './ui';

/**
 * The disclosure, as a table row of its own.
 *
 * A CLIENT COMPONENT because the sales-order register is a SERVER component —
 * it reads the API directly — and a disclosure needs state. Putting the toggle
 * here keeps the register on the server, where it belongs: only this row and
 * what it opens ship to the browser.
 *
 * TWO ROWS, not one with a nested table: the toggle has to sit inside the
 * existing table's row flow, and the panel has to span every column. A single
 * cell cannot do both.
 *
 * The panel is MOUNTED ONLY WHILE OPEN, so closing it drops the fetch as well
 * as the markup.
 */
export function MaterialRequirementRow({
  salesOrderId,
  colSpan,
}: {
  salesOrderId: string;
  colSpan: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr>
        <td colSpan={colSpan} className="px-5 pb-2 pt-0">
          <button
            type="button"
            onClick={() => setOpen((showing) => !showing)}
            aria-expanded={open}
            className="text-[11px] font-medium text-slate-600 underline-offset-2 transition hover:text-slate-900 hover:underline"
          >
            {open ? 'Hide material requirement' : 'Material requirement'}
          </button>
        </td>
      </tr>

      {open && (
        <tr className="bg-slate-50/60">
          <td colSpan={colSpan} className="px-5 pb-4 pt-0">
            <MaterialRequirementPanel salesOrderId={salesOrderId} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * What confirming a sales order was determined to require — US-MD-07.
 *
 * WHY IT SITS UNDER THE ORDER rather than on a screen of its own: the question
 * it answers is "can this order actually be made", which is asked while looking
 * at the order. A separate register would mean holding an order number in your
 * head and going to find it.
 *
 * LOADED ON DEMAND, not with the list. A determination is several rows per
 * order and most orders are never asked about; fetching all of them to render
 * a row nobody opened would pay for the whole register on every page load.
 *
 * READ-ONLY, and deliberately so. The determination is written when the order
 * is confirmed. Nothing here re-runs it, because a screen that raised
 * requisitions by being opened would raise them again every time it was.
 */
export function MaterialRequirementPanel({ salesOrderId }: { salesOrderId: string }) {
  const [summary, setSummary] = useState<MaterialRequirementSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    materialRequirementsAction(salesOrderId)
      .then((result) => {
        // The row may have been collapsed while the request was in flight —
        // setting state then would warn, and the answer is for a panel nobody
        // is looking at any more.
        if (cancelled) return;

        if (result.ok && result.data) setSummary(result.data);
        else setError(result.error ?? 'Could not load the material requirement.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [salesOrderId]);

  if (loading) {
    return <p className="px-1 py-2 text-sm text-slate-500">Loading material requirement…</p>;
  }

  if (error) {
    return <Note tone="red">{error}</Note>;
  }

  // NEVER RUN is not the same as RAN AND FOUND NOTHING. An order confirmed
  // before US-MD-07, or one whose products are bought in rather than
  // manufactured, has no determination at all — saying "nothing is short"
  // would be a claim the system has not actually made.
  if (!summary || summary.rows.length === 0) {
    return (
      <Note tone="slate">
        No material requirement has been determined for this order. It was confirmed before this
        was recorded, or nothing on it is manufactured in-house.
      </Note>
    );
  }

  const { rows, shortfallCount, determinedAt } = summary;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">
          Material Requirement
          <span className="ml-2 font-normal text-slate-500">
            {rows.length} material{rows.length === 1 ? '' : 's'}
            {shortfallCount > 0 && (
              <>
                {' · '}
                <span className="font-semibold text-red-700">
                  {shortfallCount} short
                </span>
              </>
            )}
          </span>
        </p>

        <p className="text-xs text-slate-500">Determined {formatDateTime(determinedAt)}</p>
      </div>

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-3 py-2 font-medium text-slate-600">Material</th>
              {/* Right-aligned and tabular: three quantities are read by
                  comparing them down the column, which only works if the
                  digits line up. */}
              <th className="px-3 py-2 text-right font-medium text-slate-600">Required</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">Available</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">Short</th>
              <th className="px-3 py-2 font-medium text-slate-600">Requisition</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const short = Number(row.quantityShort) > 0;

              return (
                <tr key={row.id} className={short ? 'bg-red-50/40' : undefined}>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs text-slate-500">{row.item.code}</span>{' '}
                    <span className="text-slate-900">{row.item.name}</span>
                  </td>

                  <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                    {formatQuantity(row.quantityRequired)}{' '}
                    <span className="text-xs text-slate-500">{row.item.uom}</span>
                  </td>

                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {formatQuantity(row.quantityAvailable)}
                  </td>

                  {/* A zero shortfall is shown as a dash, not as "0". The
                      column is scanned for what is missing, and a screen of
                      zeroes hides the two figures that are not. */}
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      short ? 'font-semibold text-red-700' : 'text-slate-400'
                    }`}
                  >
                    {short ? formatQuantity(row.quantityShort) : '—'}
                  </td>

                  <td className="px-3 py-2">
                    {row.requisition ? (
                      <span className="font-mono text-xs text-slate-700">
                        {row.requisition.number}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* WHAT THE FIGURES MEAN, stated once under the table rather than as a
          tooltip per column. Both caveats matter to anyone acting on this:
          required includes overage, and available was true when the order was
          confirmed rather than now. */}
      <p className="text-xs text-slate-500">
        Required includes each material&rsquo;s overage. Available is stock as at the moment the
        order was confirmed, not a live figure.
      </p>
    </div>
  );
}
