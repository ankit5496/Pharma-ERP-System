'use client';

import { useEffect, useState } from 'react';

import { FULFILMENT_STAGE_LABELS, type SalesOrderTrace } from '@pharma-erp/types';

import { salesOrderTraceAction } from './actions';
import { Modal } from './modal';
import { Section } from './sales-order-panels';
import { Badge, formatDate } from './ui';

/**
 * Everything that happened to fill one order, on one screen — US-SAL-08.
 *
 * READ-ONLY, AND NOTHING HERE IS STORED. The API derives every figure from the
 * procurement, production and despatch records that already point at this
 * order; there is no trace record to create, refresh or fall out of step.
 *
 * Built to answer a customer on the telephone: the CURRENT STAGE is at the top,
 * in words, with the reason beside it, and the three chains that produced it
 * are underneath in the same accordions the Sales Order form uses — closed
 * until someone needs the detail behind the answer.
 */
export function SalesOrderTraceDialog({
  salesOrderId,
  orderNumber,
  customerName,
  onClose,
}: {
  salesOrderId: string;
  orderNumber: string;
  customerName: string;
  onClose: () => void;
}) {
  const [trace, setTrace] = useState<SalesOrderTrace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;

    void (async () => {
      const result = await salesOrderTraceAction(salesOrderId);
      if (!current) return;

      if (result.ok) setTrace(result.data ?? null);
      else setError(result.error ?? 'The trace could not be read.');
    })();

    return () => {
      current = false;
    };
  }, [salesOrderId]);

  return (
    <Modal title={`${orderNumber} — fulfilment trace`} description={customerName} wide onClose={onClose}>
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : !trace ? (
        <p className="text-xs text-slate-500">Reading the order&rsquo;s trace…</p>
      ) : (
        <TraceBody trace={trace} />
      )}
    </Modal>
  );
}

/** The stage, and the sentence explaining it. Both derived, neither stored. */
function Stage({ trace }: { trace: SalesOrderTrace }) {
  const tone =
    trace.stage === 'DISPATCHED'
      ? 'green'
      : trace.stage === 'CANCELLED'
        ? 'red'
        : trace.stage === 'READY_TO_DISPATCH'
          ? 'blue'
          : trace.stage === 'NOT_STARTED'
            ? 'slate'
            : 'amber';

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="field-label">Current Stage</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{FULFILMENT_STAGE_LABELS[trace.stage]}</Badge>
        <span className="text-xs text-slate-600">{trace.stageReason}</span>
      </div>
    </div>
  );
}

function TraceBody({ trace }: { trace: SalesOrderTrace }) {
  const procurementCount =
    trace.requisitions.length + trace.purchaseOrders.length + trace.goodsReceipts.length;

  const batchCount = trace.workOrders.reduce(
    (total, workOrder) => total + workOrder.batches.length,
    0,
  );

  return (
    <div className="space-y-4">
      <Stage trace={trace} />

      <Section title="Procurement" subtitle={countLabel(procurementCount, 'record')}>
        <Group title="Purchase Requisitions" empty="None raised for this order.">
          {trace.requisitions.map((requisition) => (
            <Line
              key={requisition.id}
              primary={requisition.number}
              secondary={`${requisition.itemCode} · ${requisition.itemName} · ${requisition.quantity}`}
              status={requisition.status}
              date={requisition.raisedOn}
            />
          ))}
        </Group>

        <Group title="Purchase Orders" empty="No requisition has been converted yet.">
          {trace.purchaseOrders.map((purchaseOrder) => (
            <Line
              key={purchaseOrder.id}
              primary={purchaseOrder.number}
              secondary={`${purchaseOrder.vendorName} · for ${purchaseOrder.requisitionNumbers.join(', ')}`}
              status={purchaseOrder.status}
              date={purchaseOrder.orderedOn}
            />
          ))}
        </Group>

        <Group title="GRNs" empty="Nothing received yet.">
          {trace.goodsReceipts.map((receipt) => (
            <Line
              key={receipt.id}
              primary={receipt.number}
              secondary={`against ${receipt.purchaseOrderNumber} · ${receipt.vendorName} · ${countLabel(
                receipt.lineCount,
                'line',
              )}`}
              date={receipt.receivedOn}
            />
          ))}
        </Group>
      </Section>

      <Section
        title="Production"
        subtitle={`${countLabel(trace.workOrders.length, 'work order')} · ${countLabel(
          batchCount,
          'batch',
          'batches',
        )}`}
      >
        {trace.workOrders.length === 0 ? (
          <p className="text-xs text-slate-500">No work order has been raised for this order.</p>
        ) : (
          <div className="space-y-3">
            {trace.workOrders.map((workOrder) => (
              <div key={workOrder.id} className="rounded-md border border-slate-200 p-3">
                <Line
                  primary={workOrder.number}
                  secondary={`${workOrder.productCode} · ${workOrder.productName} · planned ${workOrder.plannedQuantity}`}
                  status={workOrder.status}
                />

                {/* The BMR is the batch record and the BPR is its packing
                    record — the Production screens' own names for them, kept
                    here so the two views read as the same thing. */}
                {workOrder.batches.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">No batch recorded yet.</p>
                ) : (
                  <dl className="mt-2 grid gap-3 grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">
                    {workOrder.batches.map((batch) => (
                      <div
                        key={batch.id}
                        className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <p className="font-mono text-xs font-semibold text-slate-900">
                          {batch.batchNumber}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-600">
                          BMR:{' '}
                          {batch.manufacturedOn
                            ? `made ${formatDate(batch.manufacturedOn)}${
                                batch.actualQuantity ? ` · ${batch.actualQuantity}` : ''
                              }`
                            : 'not recorded'}
                        </p>
                        <p className="text-[11px] text-slate-600">
                          BPR:{' '}
                          {batch.packedOn
                            ? `packed ${formatDate(batch.packedOn)} · ${batch.packedQuantity}${
                                batch.packVariant ? ` · ${batch.packVariant}` : ''
                              }`
                            : 'not recorded'}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                          <Badge tone={batch.releaseStatus === 'RELEASED' ? 'green' : 'amber'}>
                            {humanise(batch.releaseStatus)}
                          </Badge>
                          <span>expires {formatDate(batch.expiryDate)}</span>
                        </p>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Dispatch"
        subtitle={
          trace.dispatches.length > 0
            ? countLabel(trace.dispatches.length, 'despatch', 'despatches')
            : trace.allocationCount > 0
              ? 'Reserved, nothing shipped'
              : 'Nothing reserved'
        }
      >
        <p className="text-xs text-slate-600">
          {trace.allocationCount > 0
            ? `${trace.allocatedQuantity} reserved against this order on ${countLabel(
                trace.allocationCount,
                'batch',
                'batches',
              )}.`
            : 'No stock is reserved against this order.'}
        </p>

        <div className="mt-2">
          <Group title="Despatches" empty="Nothing has shipped yet.">
            {trace.dispatches.map((dispatch) => (
              <Line
                key={dispatch.id}
                primary={dispatch.dispatchNumber}
                secondary={`${dispatch.totalQuantity}${
                  dispatch.invoiceNumber ? ` · invoiced ${dispatch.invoiceNumber}` : ' · not invoiced'
                }`}
                status={dispatch.status}
                date={dispatch.dispatchDate}
              />
            ))}
          </Group>
        </div>
      </Section>
    </div>
  );
}

/** One named list inside a section, or a sentence saying it is empty. */
function Group({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const rows = Array.isArray(children) ? children : [children];
  const filled = rows.filter(Boolean).length > 0;

  return (
    <div className="mt-3 first:mt-0">
      <p className="field-label">{title}</p>
      {filled ? (
        <div className="mt-1.5 divide-y divide-slate-100 rounded-md border border-slate-200">
          {children}
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-slate-500">{empty}</p>
      )}
    </div>
  );
}

/** One record: what it is, what it is against, where it has got to. */
function Line({
  primary,
  secondary,
  status,
  date,
}: {
  primary: string;
  secondary?: string;
  status?: string;
  date?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        <p className="font-mono text-xs font-medium text-slate-900">{primary}</p>
        {secondary && <p className="mt-0.5 text-[11px] text-slate-500">{secondary}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {date && <span className="text-[11px] text-slate-500">{formatDate(date)}</span>}
        {status && <Badge tone="slate">{humanise(status)}</Badge>}
      </div>
    </div>
  );
}

function humanise(value: string): string {
  const words = value.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
