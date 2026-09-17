'use client';

import { useCallback } from 'react';
import type { MaterialIssueView, ProductionStockLot } from '@pharma-erp/types';
import { STOCK_LOT_STATUS_LABELS, STOCK_LOT_STATUSES } from '@pharma-erp/types';

import { DateCell, ExpiryHint, Quantity } from './shared';
import { RegisterPager, RegisterToolbar, useRegisterView } from './register-toolbar';

/** Dispensing records, searchable by issue number, order, material or lot. */
export function IssueTable({ issues }: { issues: MaterialIssueView[] }) {
  const searchText = useCallback(
    (issue: MaterialIssueView) =>
      [
        issue.issueNumber,
        issue.orderNumber,
        issue.issuedBy,
        ...issue.lines.flatMap((line) => [line.item.code, line.item.name, line.lotNumber]),
      ]
        .filter(Boolean)
        .join(' '),
    [],
  );

  const view = useRegisterView({ rows: issues, searchText });

  return (
    <>
      <RegisterToolbar
        query={view.query}
        onQuery={view.setQuery}
        placeholder="Search issue, order, material or lot…"
        noun="dispensing records"
        shown={view.filtered.length}
        total={view.total}
      />

      {view.filtered.length === 0 ? (
        <p className="px-6 py-8 text-sm text-slate-600">
          {issues.length === 0
            ? 'Nothing dispensed yet.'
            : 'No dispensing record matches that search.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <Th>Issue</Th>
                <Th>Order</Th>
                <Th>Dispensed</Th>
                <Th>Materials</Th>
                <Th>By</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {view.visible.map((issue) => (
                <tr key={issue.id} className="align-top">
                  <td className="px-6 py-3">
                    <span className="font-mono text-xs font-semibold text-slate-800">
                      {issue.issueNumber}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <span className="font-mono text-xs text-slate-700">{issue.orderNumber}</span>
                  </td>
                  <td className="px-6 py-3">
                    <DateCell value={issue.issuedAt.slice(0, 10)} />
                  </td>
                  <td className="px-6 py-3">
                    <ul className="space-y-1">
                      {issue.lines.map((line) => (
                        <li key={line.id} className="flex flex-wrap items-center gap-x-2">
                          <span className="font-mono text-xs text-slate-700">{line.item.code}</span>
                          <span className="font-mono text-xs text-slate-500">{line.lotNumber}</span>
                          <Quantity value={line.quantityIssued} uom={line.item.uom} />
                          {/* An override is the exception the criterion allows,
                              so it is marked wherever the line is shown — a
                              departure from FEFO that is invisible in the record
                              is not really recorded. */}
                          {line.isFefoOverride && (
                            <span
                              title={line.overrideReason ?? undefined}
                              className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200"
                            >
                              override
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-6 py-3 text-slate-600">{issue.issuedBy ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RegisterPager
        page={view.page}
        pageCount={view.pageCount}
        first={view.first}
        last={view.last}
        total={view.filtered.length}
        noun="dispensing records"
        pageSize={view.pageSize}
        onPage={view.goTo}
        onPageSize={view.setPageSize}
      />
    </>
  );
}

/** Stock on hand, searchable by material or lot and filtered by QC status. */
export function StockTable({ lots }: { lots: ProductionStockLot[] }) {
  const searchText = useCallback(
    (lot: ProductionStockLot) => [lot.item.code, lot.item.name, lot.lotNumber].join(' '),
    [],
  );

  const matchesFilter = useCallback(
    (lot: ProductionStockLot, value: string) => lot.status === value,
    [],
  );

  const view = useRegisterView({ rows: lots, searchText, matchesFilter });

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-4">
        <h3 className="text-sm font-semibold text-slate-900">Stock on hand</h3>
      </div>

      <RegisterToolbar
        query={view.query}
        onQuery={view.setQuery}
        placeholder="Search material or lot…"
        noun="lots"
        filter={view.filter}
        onFilter={view.setFilter}
        filterOptions={STOCK_LOT_STATUSES.map((status) => ({
          value: status,
          label: STOCK_LOT_STATUS_LABELS[status],
        }))}
        shown={view.filtered.length}
        total={view.total}
      />

      {view.filtered.length === 0 ? (
        <p className="px-6 py-8 text-sm text-slate-600">
          {lots.length === 0
            ? 'No stock. Receive material through Procure-to-Pay first.'
            : 'No lot matches that search.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <Th>Material</Th>
                <Th>Lot</Th>
                <Th>Expiry</Th>
                <Th>Status</Th>
                <Th align="right">Available</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {view.visible.map((lot) => (
                <tr key={lot.id} className={lot.status === 'USABLE' ? '' : 'bg-slate-50/60'}>
                  <td className="px-6 py-3">
                    <span className="font-mono text-xs text-slate-700">{lot.item.code}</span>
                    <div className="text-slate-800">{lot.item.name}</div>
                  </td>
                  <td className="px-6 py-3 font-mono text-xs text-slate-700">{lot.lotNumber}</td>
                  <td className="px-6 py-3">
                    <DateCell value={lot.expiryDate} />
                    {/* Packaging usually has no expiry, and a hint needs a date
                        to count down from. DateCell already shows the dash. */}
                    {lot.expiryDate && <ExpiryHint date={lot.expiryDate} />}
                  </td>
                  <td className="px-6 py-3">
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                        lot.status === 'USABLE'
                          ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                          : lot.status === 'QUARANTINE' || lot.status === 'ON_HOLD'
                            ? 'bg-amber-50 text-amber-800 ring-amber-200'
                            : 'bg-red-50 text-red-800 ring-red-200'
                      }`}
                    >
                      {STOCK_LOT_STATUS_LABELS[lot.status]}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Quantity value={lot.quantityAvailable} uom={lot.item.uom} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RegisterPager
        page={view.page}
        pageCount={view.pageCount}
        first={view.first}
        last={view.last}
        total={view.filtered.length}
        noun="lots"
        pageSize={view.pageSize}
        onPage={view.goTo}
        onPageSize={view.setPageSize}
      />
    </div>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-6 py-3 font-medium ${align === 'right' ? 'text-right' : ''}`}
    >
      {children}
    </th>
  );
}
