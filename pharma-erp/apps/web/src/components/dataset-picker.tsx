'use client';

import { useRouter } from 'next/navigation';
import { useId } from 'react';
import { DATASETS } from '@pharma-erp/types';

/**
 * "Inspect a table" — the record browser's entry point.
 *
 * A plain <select> rather than a custom menu: it is a list of table names, it
 * has to work on a phone, and the native control already handles keyboard
 * navigation, type-ahead and the mobile picker sheet correctly. A bespoke
 * dropdown here would be more code doing less.
 *
 * Tables with no model behind them yet are rendered in a separate, disabled
 * group. Listing them keeps the roadmap visible; disabling them means nobody
 * navigates to a page that can only apologise.
 */
export function DatasetPicker({ current }: { current?: string }) {
  const router = useRouter();
  const selectId = useId();

  const available = DATASETS.filter((dataset) => dataset.source.kind === 'endpoint');
  const planned = DATASETS.filter((dataset) => dataset.source.kind === 'planned');

  return (
    <div className="w-full sm:w-56">
      <label htmlFor={selectId} className="sr-only">
        Inspect a data table
      </label>
      <select
        id={selectId}
        // Uncontrolled would keep showing a stale table name after a Back
        // navigation; `value` ties it to the URL, which is the real state.
        value={current ?? ''}
        onChange={(event) => {
          const key = event.target.value;
          if (key) router.push(`/data/${key}`);
        }}
        className="field-sm w-full"
      >
        <option value="">Inspect a table…</option>

        <optgroup label="Available">
          {available.map((dataset) => (
            <option key={dataset.key} value={dataset.key}>
              {dataset.label}
            </option>
          ))}
        </optgroup>

        <optgroup label="Not built yet">
          {planned.map((dataset) => (
            <option key={dataset.key} value={dataset.key} disabled>
              {dataset.label}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}
