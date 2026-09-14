import type { Metadata } from 'next';
import { PROCUREMENT_ROUTES, type LowStockItem } from '@pharma-erp/types';

import { AutoCreationToggle } from '@/components/procurement/auto-creation-toggle';
import { ReorderCheckButton } from '@/components/procurement/reorder-check-button';
import {
  EmptyState,
  ErrorState,
  Panel,
  Pill,
  Qty,
  RecordLink,
  TableWrap,
  Td,
  Th,
} from '@/components/procurement/ui';
import { fetchLowStock, fetchProcurementSettings } from '@/lib/procurement';

export const metadata: Metadata = { title: 'Low stock' };
export const dynamic = 'force-dynamic';

/**
 * Sub-tab 1 — Low stock.
 *
 * The trigger for the whole workflow: every item whose usable stock has fallen
 * below the reorder level set on it.
 *
 * "USABLE" IS DOING REAL WORK IN THAT SENTENCE. Material sitting in quarantine
 * awaiting QC is shown in its own column but is NOT counted as available,
 * because it cannot be dispensed. Counting it would suppress a shortage that
 * genuinely needs buying — the batch may yet be rejected.
 *
 * THERE IS NO PER-ROW "RAISE REQUISITION" BUTTON, and its absence is the
 * design. A requisition is either one the system raised from this exact
 * condition — AUTO_REORDER, no author, quantity from the item master — or one
 * a person raised deliberately on the requisition form, which is MANUAL and
 * attributed to them. A button here would be neither: a human action producing
 * a document that claims nobody raised it. The reorder check raises them all
 * as what they are, and the manual path lives one tab along.
 */
export default async function LowStockPage() {
  const [lowStock, settings] = await Promise.all([fetchLowStock(), fetchProcurementSettings()]);

  const autoCreationEnabled = settings.ok ? settings.data.autoRequisitionEnabled : true;

  const rows = lowStock.ok ? lowStock.data : [];

  // Items the reorder check would actually act on: below the level, nothing
  // open already, and a reorder quantity configured to order.
  const unconfigured = rows.filter(
    (row) => !row.hasOpenRequisition && !hasReorderQuantity(row),
  );
  const actionable = rows.filter((row) => !row.hasOpenRequisition && hasReorderQuantity(row));
  const covered = rows.filter((row) => row.hasOpenRequisition);

  return (
    <Panel
      title="Low stock"
      subtitle={
        lowStock.ok
          ? rows.length === 0
            ? 'Every item is above its reorder level.'
            : `${rows.length} item${rows.length === 1 ? '' : 's'} below reorder level · ` +
              `${covered.length} already requisitioned`
          : undefined
      }
      action={
        <div className="flex flex-wrap items-start justify-end gap-4">
          <AutoCreationToggle enabled={autoCreationEnabled} />
          <ReorderCheckButton pendingCount={autoCreationEnabled ? actionable.length : 0} />
        </div>
      }
    >
      {!lowStock.ok ? (
        <ErrorState message={`Could not load low-stock items: ${lowStock.error}`} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Every item is above its reorder level."
          hint="Items appear here automatically when usable stock falls below the level set on the item master."
        />
      ) : (
        <>
          {/* Two conditions worth saying in words rather than leaving the
              reader to infer them from a table of numbers. */}
          {unconfigured.length > 0 && (
            <p className="border-b border-slate-200 bg-red-50 px-5 py-2.5 text-xs text-red-800">
              {unconfigured.length} of these have no reorder quantity on the item master, so the
              reorder check cannot raise anything for them. Set one, or raise the requisition by
              hand.
            </p>
          )}

          {!autoCreationEnabled && actionable.length > 0 && (
            <p className="border-b border-slate-200 bg-amber-50 px-5 py-2.5 text-xs text-amber-900">
              Auto creation is off, so none of these will be requisitioned automatically. Raise
              them on the{' '}
              <RecordLink href={PROCUREMENT_ROUTES.requisitions}>
                Purchase requisitions
              </RecordLink>{' '}
              tab.
            </p>
          )}

          <TableWrap>
            <table className="w-full min-w-[64rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <Th>Item</Th>
                  <Th>Type</Th>
                  <Th align="right">Available</Th>
                  <Th align="right">Reorder level</Th>
                  <Th align="right">Shortfall</Th>
                  <Th align="right">Reorder qty</Th>
                  <Th align="right">In quarantine</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.item.id} className="bg-amber-50/30">
                    <Td>
                      <p className="font-medium text-slate-900">{row.item.name}</p>
                      <p className="font-mono text-xs text-slate-500">{row.item.code}</p>
                    </Td>

                    <Td>
                      <span className="text-xs text-slate-600">
                        {row.item.type.replace(/_/g, ' ').toLowerCase()}
                      </span>
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

                    {/* What would actually be ordered — the configured
                        quantity, NOT the shortfall. Ordering the shortfall
                        puts stock back exactly on the threshold, so the next
                        issue trips the reorder again immediately. */}
                    <Td align="right">
                      {hasReorderQuantity(row) ? (
                        <Qty value={row.item.reorderQuantity ?? '0'} uom={row.item.uom} />
                      ) : (
                        <span
                          className="text-red-700"
                          title="Not configured — the reorder check cannot raise a requisition for this item"
                        >
                          not set
                        </span>
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
                      ) : !hasReorderQuantity(row) ? (
                        <Pill tone="danger">No reorder qty</Pill>
                      ) : autoCreationEnabled ? (
                        <Pill tone="warn">Awaiting reorder check</Pill>
                      ) : (
                        <Pill tone="neutral">Needs a manual requisition</Pill>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </>
      )}
    </Panel>
  );
}

/**
 * An item with no reorder quantity, or one of zero, cannot be reordered
 * automatically — there is no sensible amount to put on an order.
 */
function hasReorderQuantity(row: LowStockItem): boolean {
  return row.item.reorderQuantity !== null && row.item.reorderQuantity !== '0';
}
