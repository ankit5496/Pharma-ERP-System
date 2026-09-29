import type { Metadata } from 'next';
import {
  DEFAULT_PAGE_SIZE,
  REQUIRED_MATERIAL_KIND_LABELS,
  PROCUREMENT_ROUTES,
  REQUISITION_TRIGGER_HINTS,
  REQUISITION_TRIGGER_LABELS,
  type RequiredMaterialKind,
  type RequiredStockLine,
} from '@pharma-erp/types';

import { AutoCreationToggle } from '@/components/procurement/auto-creation-toggle';
import {
  Code,
  EmptyState,
  ErrorState,
  Name,
  Panel,
  Pill,
  Qty,
  RecordLink,
  TableWrap,
  Td,
  Th,
} from '@/components/procurement/ui';
import { Pagination } from '@/components/procurement/pagination';
import { RequiredStockRowActions } from '@/components/procurement/required-stock-actions';
import { fetchProcurementSettings, fetchRequiredStock, toListQuery } from '@/lib/procurement';

export const metadata: Metadata = { title: 'Required Stock' };
export const dynamic = 'force-dynamic';

/**
 * Sub-tab 1 — Required stock.
 *
 * WHAT LIVE SALES ORDERS NEED, and whether we have it. The trigger for the
 * whole workflow, and it is a customer's order rather than a threshold on a
 * spreadsheet: for every finished product somebody has ordered, the product's
 * active formulation and pack specification say what it takes to make, scaled
 * to the quantity still owed.
 *
 * SO THERE IS NO REORDER LEVEL AND NO REORDER QUANTITY on this screen. The
 * tab it replaced compared each item's stock against a level typed on the item
 * master, which answers "are we low on this?" — a question about the shelf.
 * This one answers "can we make what we have promised?", which is the question
 * a buyer has.
 *
 * TWO GROUPS, SHOWN SEPARATELY. Raw materials come off the formulation and
 * packing components off the pack specification; they are bought from
 * different vendors on different lead times, and reading them in one list
 * means reading past half of it.
 *
 * "FREE" IS DOING REAL WORK. It counts USABLE lots only — material awaiting QC
 * cannot be dispensed, so counting it would suppress a purchase that has to
 * happen — and it is SHARED OUT between orders rather than repeated: the
 * earliest delivery takes what it needs first. Two orders for fifty kilos do
 * not both see the same fifty kilos as covered.
 */
export default async function RequiredStockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = toListQuery(await searchParams);

  const [required, settings] = await Promise.all([
    fetchRequiredStock(),
    fetchProcurementSettings(),
  ]);

  const autoCreationEnabled = settings.ok ? settings.data.autoRequisitionEnabled : true;

  const rows = required.ok ? required.data : [];

  const raw = rows.filter((row) => row.materialType === 'RAW' && row.blockedReason === null);
  const packing = rows.filter(
    (row) => row.materialType === 'PACKING' && row.blockedReason === null,
  );
  const blocked = rows.filter((row) => row.blockedReason !== null);

  const short = rows.filter((row) => row.blockedReason === null && isShort(row));
  const awaitingAuto = short.filter((row) => !row.hasOpenRequisition);

  return (
    <div className="space-y-4">
      <Panel
        title="Required Stock"
        subtitle={
          required.ok
            ? rows.length === 0
              ? 'No live sales order needs anything.'
              : `${rows.length} material line${rows.length === 1 ? '' : 's'} across live sales ` +
                `orders · ${short.length} short`
            : undefined
        }
        action={<AutoCreationToggle enabled={autoCreationEnabled} />}
      >
        {!required.ok ? (
          <ErrorState message={`Could not work out what is required: ${required.error}`} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No live sales order needs anything."
            hint="Material requirements are worked out from approved sales orders. Raise one under Sales Order, and every raw material and packing component its product's formulation calls for appears here."
          />
        ) : (
          <>
            {/* Two conditions worth saying in words rather than leaving the
                reader to infer them from a table of numbers. */}
            {blocked.length > 0 && (
              <p className="border-b border-slate-200 bg-red-50 px-5 py-2.5 text-xs text-red-800">
                {blocked.length} ordered product{blocked.length === 1 ? ' has' : 's have'} no active
                formulation, so nothing can be worked out for {blocked.length === 1 ? 'it' : 'them'}
                . They are listed at the foot of this page.
              </p>
            )}

            {!autoCreationEnabled && awaitingAuto.length > 0 && (
              <p className="border-b border-slate-200 bg-amber-50 px-5 py-2.5 text-xs text-amber-900">
                Auto is off, so none of these {awaitingAuto.length} shortages will be requisitioned
                automatically. Raise them on the{' '}
                <RecordLink href={PROCUREMENT_ROUTES.requisitions}>
                  Purchase requisitions
                </RecordLink>{' '}
                tab.
              </p>
            )}

            <MaterialTable
              kind="RAW"
              rows={raw}
              query={query}
              autoCreationEnabled={autoCreationEnabled}
            />
          </>
        )}
      </Panel>

      {packing.length > 0 && (
        <Panel
          title="Packing Materials"
          subtitle={`${packing.length} component line${packing.length === 1 ? '' : 's'}`}
        >
          {/* NOT PAGED. Both tables are on one screen and the pager reads one
              `?page=`, so paging both would move them together — which reads as
              a bug the first time somebody pages the raw materials and the
              packing list jumps too. A pack specification lists a handful of
              components per product, so this table stays short on its own. */}
          <MaterialTable
            kind="PACKING"
            rows={packing}
            query={query}
            autoCreationEnabled={autoCreationEnabled}
            paged={false}
          />
        </Panel>
      )}

      {blocked.length > 0 && (
        <Panel
          title="Nothing to work out from"
          subtitle="Ordered products with no active formulation"
        >
          <TableWrap>
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <Th>Sales order</Th>
                  <Th>Product</Th>
                  <Th>Why</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {blocked.map((row) => (
                  <tr key={row.id}>
                    <Td>
                      <p className="font-mono text-xs font-semibold text-slate-900">
                        <Code>{row.salesOrderNumber}</Code>
                      </p>
                      <p className="text-xs text-slate-500">
                        <Name>{row.customerName}</Name>
                      </p>
                    </Td>
                    <Td>
                      <p className="text-slate-800">
                        <Name>{row.finishedProduct.name}</Name>
                      </p>
                      <p className="font-mono text-xs text-slate-500">
                        <Code>{row.finishedProduct.code}</Code>
                      </p>
                    </Td>
                    <Td>
                      <span className="text-xs text-red-800">{row.blockedReason}</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      )}
    </div>
  );
}

/**
 * One group's table. The same columns for both, because they answer the same
 * question about different kinds of material.
 *
 * PAGED HERE RATHER THAN IN THE DATABASE. These rows are a calculation over
 * sales orders and formulations, not a table — there is no query that returns
 * "page 2" of it without doing the whole calculation first. The slice still
 * happens on the server, and the list is bounded by live orders rather than by
 * history.
 */
function MaterialTable({
  kind,
  rows,
  query,
  autoCreationEnabled,
  paged = true,
}: {
  kind: RequiredMaterialKind;
  rows: RequiredStockLine[];
  query: { page?: number; pageSize?: number };
  autoCreationEnabled: boolean;
  /** False for the second table on the page — see the note at the call site. */
  paged?: boolean;
}) {
  const page = Math.max(query.page ?? 1, 1);
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  const visible = paged ? rows.slice((page - 1) * pageSize, page * pageSize) : rows;

  if (rows.length === 0) {
    return (
      <EmptyState
        title={`No ${REQUIRED_MATERIAL_KIND_LABELS[kind].toLowerCase()} is required.`}
        hint="Live sales orders call for none, or their products have no formulation on file."
      />
    );
  }

  return (
    <>
      <TableWrap>
        <table className="w-full min-w-[92rem] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <Th>Sales order</Th>
              {/* "Product", not "Finished product". The material columns name
                  themselves, so the qualifier was distinguishing this column
                  from nothing. */}
              <Th>Product</Th>
              <Th align="right">Product qty</Th>
              <Th>Material</Th>
              <Th align="right">Required</Th>
              <Th align="right">Free stock</Th>
              <Th align="right">Shortfall</Th>
              <Th>Trigger type</Th>
              <Th>Auto</Th>
              <Th>Status</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((row) => (
              <tr key={row.id} className={isShort(row) ? 'bg-amber-50/30' : undefined}>
                <Td>
                  <p className="font-mono text-xs font-semibold text-slate-900">
                    <Code>{row.salesOrderNumber}</Code>
                  </p>
                  <p className="text-xs text-slate-500">
                    <Name>{row.customerName}</Name>
                  </p>
                  {row.requestedDeliveryDate && (
                    <p className="text-[11px] text-slate-400">
                      wants {row.requestedDeliveryDate}
                    </p>
                  )}
                </Td>

                <Td>
                  <p className="text-slate-800">
                    <Name>{row.finishedProduct.name}</Name>
                  </p>
                  <p className="font-mono text-xs text-slate-500">
                    <Code>{row.finishedProduct.code}</Code>
                  </p>
                  {/* The pack the requirement was scaled against, which is what
                      decides how many cartons and leaflets a run takes. */}
                  {row.packVariant && (
                    <p className="text-[11px] text-slate-400">{row.packVariant}</p>
                  )}
                </Td>

                <Td align="right">
                  <Qty value={row.productQuantity} uom={row.finishedProduct.uom} />
                </Td>

                <Td>
                  <p className="text-slate-800">
                    <Name>{row.material.name}</Name>
                  </p>
                  <p className="font-mono text-xs text-slate-500">
                    <Code>{row.material.code}</Code>
                  </p>
                  <span className="text-[11px] text-slate-400">
                    {REQUIRED_MATERIAL_KIND_LABELS[row.materialType]}
                  </span>
                </Td>

                {/* WHAT TO BUY, AND WHAT IT WAS GROSSED UP FROM.
                    A requisition for 21 kg against a formulation that says 20
                    is a figure somebody queries, so the row answers it in
                    place rather than making them open the record. */}
                <Td align="right">
                  <Qty value={row.requiredQuantity} uom={row.material.uom} />
                  {Number(row.overagePercent) > 0 && (
                    <span
                      className="mt-0.5 block text-[11px] text-slate-500"
                      title={`${row.baseRequiredQuantity} ${row.material.uom} per the formulation, plus this material’s own ${row.overagePercent}% overage from the formulation.`}
                    >
                      {row.baseRequiredQuantity} + {row.overagePercent}%
                    </span>
                  )}
                </Td>

                <Td align="right">
                  <Qty value={row.availableQuantity} uom={row.material.uom} />
                </Td>

                <Td align="right">
                  {isShort(row) ? (
                    <span className="font-semibold text-amber-900">
                      <Qty value={row.shortfallQuantity} uom={row.material.uom} />
                    </span>
                  ) : (
                    <span className="text-slate-300">none</span>
                  )}
                </Td>

                {/* HOW THE REQUISITION FOR THIS SHORTAGE WAS RAISED, read off
                    the requisition itself rather than worked out again here.
                    A row with nothing raised against it has no trigger to
                    report, and saying "Auto" because the switch is on would
                    name a document that does not exist. */}
                <Td>
                  {row.triggerType ? (
                    <span
                      className="text-xs text-slate-700"
                      title={REQUISITION_TRIGGER_HINTS[row.triggerType]}
                    >
                      {REQUISITION_TRIGGER_LABELS[row.triggerType]}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400" title="Nothing has been raised for this line yet.">
                      &mdash;
                    </span>
                  )}
                </Td>

                {/* WHAT AUTO WILL DO WITH THIS ROW, per row, rather than a
                    restatement of the company-wide switch: a row that is
                    covered needs nothing, one already requisitioned has had it,
                    and one waiting is what the switch governs. */}
                <Td>
                  {!isShort(row) ? (
                    <span className="text-xs text-slate-400">Not needed</span>
                  ) : row.hasOpenRequisition ? (
                    <span className="text-xs text-slate-600">Raised</span>
                  ) : autoCreationEnabled ? (
                    <span className="text-xs text-amber-800">Will raise</span>
                  ) : (
                    <span className="text-xs text-slate-500">Off</span>
                  )}
                </Td>

                <Td>
                  {!isShort(row) ? (
                    <Pill tone="ok">Covered</Pill>
                  ) : row.requisitionNumber ? (
                    <span title={`Requisition ${row.requisitionNumber} is open for this shortage.`}>
                      <Pill tone="info">{row.requisitionNumber}</Pill>
                    </span>
                  ) : row.hasOpenPurchaseOrder ? (
                    <span title="Material is on order. The row stays here until incoming QC accepts it.">
                      <Pill tone="info">On order</Pill>
                    </span>
                  ) : autoCreationEnabled ? (
                    <Pill tone="warn">Auto pending</Pill>
                  ) : (
                    <Pill tone="neutral">Needs a requisition</Pill>
                  )}
                </Td>

                {/* VIEW ONLY. This row is a calculation over the sales order,
                    the formulation and current stock — there is no stored
                    record behind it to edit, and the view says so. */}
                <Td>
                  <RequiredStockRowActions line={row} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      {paged && (
        <Pagination total={rows.length} page={page} pageSize={pageSize} noun="material lines" />
      )}
    </>
  );
}

/** Short by anything at all. The shortfall is already floored at zero. */
function isShort(row: RequiredStockLine): boolean {
  return Number(row.shortfallQuantity) > 0;
}
