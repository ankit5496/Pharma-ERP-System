'use client';

import {
  REQUIRED_MATERIAL_KIND_LABELS,
  REQUISITION_TRIGGER_HINTS,
  REQUISITION_TRIGGER_LABELS,
  SALES_ORDER_STATUS_LABELS,
  type RequiredStockLine,
} from '@pharma-erp/types';
import { useState } from 'react';

import { Derived, Disclosure } from '@/components/procurement/form-kit';
import { RowActionMenu } from '@/components/row-action-menu';

/**
 * One required-stock line, opened read-only.
 *
 * WHY THERE IS NO EDIT HERE, and it is not a permission that could be relaxed.
 * A required-stock row is not a record anybody typed: it is an arithmetic
 * result — a live sales order's outstanding quantity put through the product's
 * active formulation and pack specification, less the stock that is genuinely
 * free. There is no row in any table to write back to. Changing what it says
 * means changing one of its sources: the order, the formulation, the pack
 * specification, or the stock.
 *
 * SO THE VIEW NAMES ITS SOURCES. Every figure on it is shown beside where it
 * came from, because "why does this say we are 40 kg short?" is the only
 * question anybody opens this to answer, and a screen of bare numbers cannot
 * answer it.
 */
export function ViewRequiredStockButton({
  line,
  isOpen,
  onOpenChange,
}: {
  line: RequiredStockLine;
  /** Passed by the row's Actions menu, which is then the trigger. */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const short = Number(line.shortfallQuantity) > 0;

  return (
    <Disclosure
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label="View"
      title={`${line.material.name} for ${line.salesOrderNumber}`}
      subtitle={`${line.customerName} · ${REQUIRED_MATERIAL_KIND_LABELS[line.materialType]}`}
      width="60rem"
    >
      {() => (
        <div className="flex grow flex-col gap-5">
          {/* WHAT WAS ORDERED. The requirement exists because of this, so it
              comes first — the reader is being walked from the demand to the
              arithmetic rather than shown a total and asked to trust it. */}
          <Section title="The sales order this is for">
            <Derived label="Sales order" value={line.salesOrderNumber} />
            <Derived label="Customer" value={line.customerName} />
            <Derived
              label="Order status"
              value={SALES_ORDER_STATUS_LABELS[line.salesOrderStatus]}
            />
            <Derived label="Order date" value={line.orderDate} />
            <Derived
              label="Wanted by"
              value={line.requestedDeliveryDate ?? 'No date given'}
              hint={
                line.requestedDeliveryDate
                  ? 'The earliest delivery takes free stock first.'
                  : undefined
              }
            />
          </Section>

          <Section title="The product it will be made into">
            <Derived label="Product" value={line.finishedProduct.name} />
            <Derived label="Product code" value={line.finishedProduct.code} />
            <Derived
              label="Quantity still owed"
              value={`${line.productQuantity} ${line.finishedProduct.uom}`}
              hint="Ordered less already dispatched. What is left to make."
            />
            <Derived
              label="Pack variant"
              value={line.packVariant ?? 'No pack specification'}
              hint={
                line.packVariant
                  ? 'The pack the packing requirement was scaled against.'
                  : undefined
              }
            />
          </Section>

          {/* THE ARITHMETIC, in the order it is done: what it takes, what we
              have, what is missing. */}
          <Section title="The material, and whether we have it">
            <Derived label="Material" value={line.material.name} />
            <Derived label="Material code" value={line.material.code} />
            <Derived
              label="Material type"
              value={REQUIRED_MATERIAL_KIND_LABELS[line.materialType]}
              hint={
                line.materialType === 'RAW'
                  ? 'From the product’s active formulation.'
                  : 'From the product’s pack specification.'
              }
            />
            <Derived
              label="Required"
              value={`${line.requiredQuantity} ${line.material.uom}`}
              hint="The formulation scaled to the quantity still owed."
            />
            <Derived
              label="Free stock"
              value={`${line.availableQuantity} ${line.material.uom}`}
              hint="Usable lots only, less what is reserved for other orders."
            />
            <Derived
              label="Shortfall"
              value={
                short ? `${line.shortfallQuantity} ${line.material.uom}` : 'None'
              }
              hint={short ? 'What has to be bought.' : 'Free stock covers this line.'}
            />
          </Section>

          <Section title="What is being done about it">
            <Derived
              label="Status"
              value={
                !short
                  ? 'Covered'
                  : line.requisitionNumber
                    ? `Requisition ${line.requisitionNumber} is open`
                    : line.hasOpenPurchaseOrder
                      ? 'On order'
                      : 'Needs a requisition'
              }
            />
            <Derived
              label="Trigger type"
              value={
                line.triggerType ? REQUISITION_TRIGGER_LABELS[line.triggerType] : 'Not raised yet'
              }
              hint={
                line.triggerType
                  ? REQUISITION_TRIGGER_HINTS[line.triggerType]
                  : 'Set when a requisition is raised for this shortage.'
              }
            />
            <Derived
              label="Requisition"
              value={line.requisitionNumber ?? 'None'}
            />
            <Derived
              label="On order"
              value={line.hasOpenPurchaseOrder ? 'Yes' : 'No'}
              hint={
                line.hasOpenPurchaseOrder
                  ? 'Material is on a live purchase order. The line stays here until incoming QC accepts it.'
                  : undefined
              }
            />
          </Section>

          {line.blockedReason && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {line.blockedReason}
            </p>
          )}

          {/* SAID ONCE, PLAINLY. Somebody who wants to change a figure here
              needs to know where to go, and "read-only" on its own does not
              tell them. */}
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            This line is worked out from the sales order, the product’s formulation and pack
            specification, and current free stock. It is not stored and cannot be edited — change
            one of those and this follows.
          </p>
        </div>
      )}
    </Disclosure>
  );
}

/** A titled group of read-only fields, laid out as the other view dialogs lay theirs out. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

/**
 * The Action cell.
 *
 * VIEW ONLY, for the reason above: there is nothing here to edit. The menu is
 * the same control every other register's Action column uses, so the column
 * behaves the way a reader has already learnt on the other tabs.
 */
export function RequiredStockRowActions({ line }: { line: RequiredStockLine }) {
  const [viewing, setViewing] = useState(false);

  return (
    <>
      <RowActionMenu
        label={`${line.material.code} for ${line.salesOrderNumber}`}
        actions={[{ label: 'View', onSelect: () => setViewing(true) }]}
      />

      <ViewRequiredStockButton line={line} isOpen={viewing} onOpenChange={setViewing} />
    </>
  );
}
