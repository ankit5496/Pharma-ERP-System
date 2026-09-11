import { unitLabel, type LowStockItem, type PartySummary } from '@pharma-erp/types';

import type { ApiResult } from '@/lib/api';

import { RaiseRequisitionForm } from './raise-requisition-form';
import { EmptyState, ErrorState, Panel, Qty, TableWrap, Td, Th } from './ui';

/**
 * The trigger for the whole workflow: raw materials whose usable stock has
 * fallen below their reorder level.
 *
 * "Usable" is doing real work in that sentence. Material sitting in quarantine
 * awaiting QC is shown in its own column but is NOT counted as available,
 * because it cannot be dispensed — counting it would suppress a shortage that
 * genuinely needs a requisition raised.
 */
export function LowStockPanel({
  result,
  vendors,
  highlighted,
}: {
  result: ApiResult<LowStockItem[]>;
  vendors: readonly PartySummary[];
  /** True when the user arrived from the Low stock summary card. */
  highlighted?: boolean;
}) {
  return (
    <div
      className={highlighted ? 'rounded-lg ring-2 ring-amber-400 ring-offset-2' : undefined}
      id="low-stock"
    >
      <Panel
        title="Low stock — needs procurement"
        subtitle="Available stock is below the reorder level. Available counts QC-accepted material only."
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
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <Th>Item</Th>
                  <Th align="right">Available</Th>
                  <Th align="right">Reorder level</Th>
                  <Th align="right">Shortfall</Th>
                  <Th align="right">In quarantine</Th>
                  <Th>Action</Th>
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
                        <Qty value={row.availableStock} uom={unitLabel(row.item.uom)} />
                      </span>
                    </Td>

                    <Td align="right">
                      {/* An item can have no reorder level configured, which is
                          not the same as a level of zero. This row only exists
                          because one is set, but the type allows null. */}
                      <Qty value={row.item.reorderLevel ?? '0'} uom={unitLabel(row.item.uom)} />
                    </Td>

                    <Td align="right">
                      <span className="font-semibold text-slate-900">
                        <Qty value={row.shortfall} uom={unitLabel(row.item.uom)} />
                      </span>
                    </Td>

                    <Td align="right">
                      {row.quarantineStock === '0' ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <span title="Received but not yet QC-accepted, so not usable">
                          <Qty value={row.quarantineStock} uom={unitLabel(row.item.uom)} />
                        </span>
                      )}
                    </Td>

                    <Td>
                      {/* Always the same component, whether or not a
                          requisition is already open — it decides internally.
                          Choosing here would unmount it the instant a submit
                          succeeded and swallow the confirmation. */}
                      <RaiseRequisitionForm
                        item={row.item}
                        suggestedQuantity={row.shortfall}
                        vendors={vendors}
                        hasOpenRequisition={row.hasOpenRequisition}
                      />
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
