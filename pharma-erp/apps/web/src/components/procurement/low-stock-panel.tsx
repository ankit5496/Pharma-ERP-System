import { type LowStockItem } from '@pharma-erp/types';

import type { ApiResult } from '@/lib/api';

import { ReorderCheckButton } from './reorder-check-button';
import { EmptyState, ErrorState, Panel, Pill, Qty, TableWrap, Td, Th } from './ui';

/**
 * The trigger for the whole workflow: raw materials whose usable stock has
 * fallen below their reorder level.
 *
 * "Usable" is doing real work in that sentence. Material sitting in quarantine
 * awaiting QC is shown in its own column but is NOT counted as available,
 * because it cannot be dispensed — counting it would suppress a shortage that
 * genuinely needs a requisition raised.
 *
 * THERE IS NO PER-ROW "RAISE" BUTTON, and its absence is the design. The
 * specification distinguishes two kinds of requisition: an AUTO_REORDER one
 * the system raises from this exact condition, and a MANUAL one a person
 * raises against a production plan. A per-row button would be neither — a
 * human action producing a document that claims no plan and no author. The
 * reorder check raises them all as what they are, and the manual path lives
 * in the toolbar above, where a plan can be chosen.
 */
export function LowStockPanel({
  result,
  highlighted,
}: {
  result: ApiResult<LowStockItem[]>;
  /** True when the user arrived from the Low stock summary card. */
  highlighted?: boolean;
}) {
  const pending = result.ok ? result.data.filter((row) => !row.hasOpenRequisition).length : 0;

  return (
    <div
      className={highlighted ? 'rounded-lg ring-2 ring-amber-400 ring-offset-2' : undefined}
      id="low-stock"
    >
      <Panel
        title="Low stock — needs procurement"
        subtitle="Available counts QC-accepted material only. The reorder check raises a requisition for each item that has none open."
        action={<ReorderCheckButton pendingCount={pending} />}
      >
        {!result.ok ? (
          <ErrorState message={`Could not load low-stock items: ${result.error}`} />
        ) : result.data.length === 0 ? (
          <EmptyState
            title="Every item is above its reorder level."
            hint="Items appear here automatically when usable stock falls below the level set on the item."
          />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[60rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <Th>Item</Th>
                  <Th align="right">Available</Th>
                  <Th align="right">Reorder level</Th>
                  <Th align="right">Shortfall</Th>
                  <Th align="right">Reorder qty</Th>
                  <Th align="right">In quarantine</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.data.map((row) => (
                  <tr key={row.item.id} className="bg-amber-50/30">
                    <Td>
                      <p className="font-medium text-slate-900">{row.item.name}</p>
                      <p className="font-mono text-xs text-slate-500">{row.item.code}</p>
                    </Td>

                    <Td align="right">
                      <span className="font-semibold text-amber-900">
                        <Qty value={row.availableStock} uom={row.item.uom} />
                      </span>
                    </Td>

                    <Td align="right">
                      {row.item.reorderLevel === null ? (
                        <span className="text-slate-300">not set</span>
                      ) : (
                        <Qty value={row.item.reorderLevel} uom={row.item.uom} />
                      )}
                    </Td>

                    <Td align="right">
                      <span className="font-semibold text-slate-900">
                        <Qty value={row.shortfall} uom={row.item.uom} />
                      </span>
                    </Td>

                    {/* What the reorder check will actually order — the
                        configured quantity, not the shortfall. Ordering the
                        shortfall would put stock back exactly on the
                        threshold, so the next issue trips the reorder again. */}
                    <Td align="right">
                      {row.item.reorderQuantity === null || row.item.reorderQuantity === '0' ? (
                        <span
                          className="text-red-700"
                          title="Not configured — the reorder check cannot raise a requisition"
                        >
                          not set
                        </span>
                      ) : (
                        <Qty value={row.item.reorderQuantity} uom={row.item.uom} />
                      )}
                    </Td>

                    <Td align="right">
                      {row.quarantineStock === '0' ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <span title="Received but not yet QC-accepted, so not usable">
                          <Qty value={row.quarantineStock} uom={row.item.uom} />
                        </span>
                      )}
                    </Td>

                    <Td>
                      {row.hasOpenRequisition ? (
                        <Pill tone="info">Requisition open</Pill>
                      ) : row.item.reorderQuantity === null || row.item.reorderQuantity === '0' ? (
                        <Pill tone="danger">No reorder qty</Pill>
                      ) : (
                        <Pill tone="warn">Awaiting reorder check</Pill>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}
