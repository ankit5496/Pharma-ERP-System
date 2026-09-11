import { AGEING_BUCKETS, AGEING_BUCKET_LABELS, type PayablesReport } from '@pharma-erp/types';

import type { ApiResult } from '@/lib/api';

import { EmptyState, ErrorState, Money, Panel, Pill, TableWrap, Td, Th } from './ui';

/**
 * The outstanding payables report, one row per vendor, aged by days past due.
 *
 * Ageing runs from the DUE date, not the invoice date. Ageing from when the
 * invoice was raised would call a 60-day-terms invoice "60 days old" the day
 * it falls due, which says nothing about whether anyone is late — and lateness
 * is the only question this report exists to answer.
 *
 * Vendors with nothing outstanding do not appear. A payables report listing
 * everyone who has ever invoiced is a report nobody reads.
 */
export function PayablesReportPanel({ result }: { result: ApiResult<PayablesReport> }) {
  return (
    <Panel
      title="Outstanding payables"
      subtitle="By vendor, aged from the due date. Only approved invoices with a balance appear."
      action={
        result.ok ? (
          <div className="text-right">
            <p className="text-lg font-semibold text-slate-900">
              <Money amount={result.data.totals.totalOutstanding} />
            </p>
            <p className="text-xs text-slate-500">
              across {result.data.totals.invoiceCount} invoice
              {result.data.totals.invoiceCount === 1 ? '' : 's'}
            </p>
          </div>
        ) : undefined
      }
    >
      {!result.ok ? (
        <ErrorState message={`Could not load the payables report: ${result.error}`} />
      ) : result.data.rows.length === 0 ? (
        <EmptyState
          title="Nothing outstanding."
          hint="Every approved invoice has been settled."
        />
      ) : (
        <TableWrap>
          <table className="w-full min-w-[64rem] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <Th>Vendor</Th>
                <Th align="right">Outstanding</Th>
                {AGEING_BUCKETS.map((bucket) => (
                  <Th key={bucket} align="right">
                    {AGEING_BUCKET_LABELS[bucket]}
                  </Th>
                ))}
                <Th align="right">Invoices</Th>
                <Th>Oldest</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.data.rows.map((row) => (
                <tr key={row.vendor.id}>
                  <Td>
                    <p className="font-medium text-slate-900">{row.vendor.name}</p>
                    <p className="font-mono text-xs text-slate-500">{row.vendor.code}</p>
                  </Td>

                  <Td align="right">
                    <Money amount={row.totalOutstanding} bold />
                  </Td>

                  {AGEING_BUCKETS.map((bucket) => (
                    <Td key={bucket} align="right">
                      {row.buckets[bucket] === '0.00' ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <span
                          className={
                            bucket === 'DUE_61_90' || bucket === 'DUE_90_PLUS'
                              ? 'font-semibold text-red-800'
                              : bucket === 'NOT_DUE'
                                ? 'text-slate-600'
                                : 'text-amber-900'
                          }
                        >
                          <Money amount={row.buckets[bucket]} />
                        </span>
                      )}
                    </Td>
                  ))}

                  <Td align="right">{row.invoiceCount}</Td>

                  <Td>
                    {row.oldestOverdueDays === 0 ? (
                      <span className="text-xs text-slate-400">nothing overdue</span>
                    ) : (
                      <Pill tone={row.oldestOverdueDays > 60 ? 'danger' : 'warn'}>
                        {row.oldestOverdueDays}d overdue
                      </Pill>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr className="border-t-2 border-slate-300 font-semibold">
                <Td>Total</Td>
                <Td align="right">
                  <Money amount={result.data.totals.totalOutstanding} bold />
                </Td>
                {AGEING_BUCKETS.map((bucket) => (
                  <Td key={bucket} align="right">
                    {result.data.totals.buckets[bucket] === '0.00' ? (
                      <span className="text-slate-300">—</span>
                    ) : (
                      <Money amount={result.data.totals.buckets[bucket]} />
                    )}
                  </Td>
                ))}
                <Td align="right">{result.data.totals.invoiceCount}</Td>
                <Td>{null}</Td>
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      )}
    </Panel>
  );
}
