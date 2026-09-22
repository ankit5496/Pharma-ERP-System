'use client';

import { useState, type ReactNode } from 'react';

/**
 * Two views of one step, switched in place.
 *
 * Built for Material issue, where "what have we dispensed" and "what could we
 * dispense" are both answers this step owes. They used to be stacked, which
 * meant the stock listing — the thing a storekeeper checks BEFORE dispensing —
 * sat below a register that grows by a row per issue, and was the first thing
 * to fall off the bottom of the screen.
 *
 * Both panels are rendered by the server and passed in; this only decides which
 * is shown. Switching touches no network and loses no state in the hidden one,
 * because the hidden one is still mounted — `hidden` rather than unmounting, so
 * a scroll position or an open row survives a look at the other tab.
 */
export function ProductionTabs({
  tabs,
}: {
  tabs: readonly { key: string; label: string; badge?: string; panel: ReactNode }[];
}) {
  const [activeKey, setActiveKey] = useState(tabs[0]?.key ?? '');

  return (
    <div className="space-y-4">
      {/* `role="tablist"` and the arrow-key behaviour a real tab widget needs
          are deliberately NOT here: these are two links to two views, and a
          browser's own focus order moves between them correctly. Announcing a
          tablist without implementing its keyboard contract is worse than
          announcing nothing. */}
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200">
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey;

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveKey(tab.key)}
              aria-current={isActive ? 'true' : undefined}
              // The active tab sits ON the border, hiding it for its own width,
              // which is what joins it to the panel below rather than leaving
              // it floating above a line.
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
                isActive
                  ? 'border-slate-900 font-semibold text-slate-900'
                  : 'border-transparent font-medium text-slate-500 hover:border-slate-300 hover:text-slate-800'
              }`}
            >
              {tab.label}
              {/* OPTIONAL, and the Production steps deliberately pass none: a
                  count here repeated what the register below already states —
                  "10 dispensing records" under its own heading — and two counts
                  for one list invite a comparison to check they agree. Job work
                  does use it, where the tab is the only place a count appears. */}
              {tab.badge && (
                <span
                  className={`ml-2 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
                    isActive ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div key={tab.key} hidden={tab.key !== activeKey}>
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
