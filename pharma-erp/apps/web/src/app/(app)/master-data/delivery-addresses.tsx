'use client';

import { useState } from 'react';

import type { PartySummary } from '@pharma-erp/types';

import { TextField } from './form-kit';

/**
 * A party's delivery addresses — US-MD-02.
 *
 * WHERE THE GOODS ACTUALLY GO, which the registered address on the form above
 * does not answer: one customer routinely receives at several places — a head
 * office that never takes stock, two depots, a hospital store.
 *
 * COLLAPSED UNTIL OPENED. A saved address is a fact to read, not a form to
 * fill in, so it shows as one line — "Bhiwandi depot · Plot 14, MIDC ·
 * Bhiwandi, Maharashtra 421302" — and opens only when Edit is pressed. Seven
 * controls per row, times four depots, is a wall of boxes that buries the rest
 * of the form; a summary per row is read at a glance.
 *
 * ITS OWN COMPONENT because it needs state the party form has no other use
 * for: which rows are open, and which rows exist. The form around it stays a
 * plain uncontrolled form, which is what lets every other field keep its
 * `defaultValue` behaviour across a refused save.
 *
 * Every field still posts under `addr.<row>.<field>`, exactly as a flat layout
 * would — the action walks those names and neither knows nor cares that the
 * row was collapsed.
 */

/** A row being edited: its own id when it came from the server, or a new one. */
interface Row {
  /** Stable across renders; used in the field names and as the React key. */
  key: number;
  /** The stored address this row started from, absent for a row just added. */
  saved?: PartySummary['deliveryAddresses'][number];
}

export function DeliveryAddresses({
  addresses,
  /** What was typed on a refused save, so nothing is lost. */
  typed,
}: {
  addresses: PartySummary['deliveryAddresses'];
  typed: (field: string, stored?: string | null) => string | undefined;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    addresses.map((saved, index) => ({ key: index, saved })),
  );

  /**
   * Which rows are open.
   *
   * A saved address starts CLOSED — it is there to be read. A row somebody has
   * just added starts open, because an empty summary says nothing and would
   * need a click to become useful.
   */
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());

  /**
   * Which row is the default, by key.
   *
   * Held here rather than left to the radios themselves: a radio group only
   * enforces one selection among controls that are RENDERED, and a collapsed
   * row renders none. Without this, opening a row would silently drop the
   * default that was set on a closed one.
   */
  const [defaultKey, setDefaultKey] = useState<number>(() => {
    const marked = addresses.findIndex((entry) => entry.isDefault);
    return marked === -1 ? 0 : marked;
  });

  // Ever-increasing, so a removed row's key is never reused — reusing one
  // would let a new row inherit the fields left behind under that name.
  const [nextKey, setNextKey] = useState(addresses.length);

  const add = () => {
    setRows((current) => [...current, { key: nextKey }]);
    setOpen((current) => new Set(current).add(nextKey));
    setNextKey((current) => current + 1);
  };

  const remove = (key: number) => {
    setRows((current) => current.filter((row) => row.key !== key));

    // The default moving with the row it was on: a list whose default points
    // at a row that no longer exists would leave an invoice with no shipping
    // address to print.
    setDefaultKey((current) => {
      if (current !== key) return current;

      const survivor = rows.find((row) => row.key !== key);
      return survivor?.key ?? 0;
    });
  };

  const toggle = (key: number) =>
    setOpen((current) => {
      const next = new Set(current);

      if (next.has(key)) next.delete(key);
      else next.add(key);

      return next;
    });

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          None yet.
        </p>
      )}

      {rows.map((row) => {
        const isOpen = open.has(row.key);
        const isDefault = defaultKey === row.key;

        return (
          <div
            key={row.key}
            className={`rounded-md border ${
              isDefault ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'
            }`}
          >
            {/* THE SUMMARY LINE, which is what a closed row is for. The radio
                lives here rather than inside the open panel, so the default can
                be changed without opening anything. */}
            <div className="flex items-start gap-3 px-3 py-2.5">
              <input
                type="radio"
                name="addr.default"
                value={String(row.key)}
                checked={isDefault}
                onChange={() => setDefaultKey(row.key)}
                aria-label={`Use ${row.saved?.label ?? 'this address'} on invoices`}
                className="mt-1 h-4 w-4 border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-900/15"
              />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {row.saved?.label || (
                    <span className="font-normal italic text-slate-400">New address</span>
                  )}
                </p>

                {/* The address on one line, in the order it is written. Only
                    for a SAVED row: a row being typed has nothing to summarise
                    yet, and the boxes below are showing it anyway. */}
                {row.saved && (
                  <p className="truncate text-xs text-slate-600">
                    {[
                      row.saved.line1,
                      row.saved.line2,
                      `${row.saved.city}, ${row.saved.state} ${row.saved.pin}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}

                {isDefault && (
                  <span className="mt-1 inline-block rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                    Default for invoices
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => toggle(row.key)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                {isOpen ? 'Done' : 'Edit'}
              </button>

              <button
                type="button"
                onClick={() => remove(row.key)}
                aria-label="Remove this address"
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Remove
              </button>
            </div>

            {/* THE FIELDS, rendered only while the row is open.

                A closed row posts NOTHING, which is why its values are carried
                by the hidden inputs below — the action reads the same field
                names either way and cannot tell the two apart. */}
            {isOpen ? (
              <div className="space-y-3 border-t border-slate-200 px-3 py-3">
                <input type="hidden" name={`addr.${row.key}.id`} value={row.saved?.id ?? ''} />

                <TextField
                  name={`addr.${row.key}.label`}
                  label="Label"
                  compact
                  maxLength={120}
                  placeholder="Bhiwandi depot"
                  defaultValue={typed(`addr.${row.key}.label`, row.saved?.label)}
                  hint="What the people there call it — this is how the address is picked."
                />

                <TextField
                  name={`addr.${row.key}.line1`}
                  label="Address line 1"
                  compact
                  maxLength={255}
                  defaultValue={typed(`addr.${row.key}.line1`, row.saved?.line1)}
                />

                <TextField
                  name={`addr.${row.key}.line2`}
                  label="Address line 2"
                  compact
                  maxLength={255}
                  placeholder="Optional"
                  defaultValue={typed(`addr.${row.key}.line2`, row.saved?.line2)}
                />

                <div className="grid gap-3 sm:grid-cols-[2fr_2fr_1fr]">
                  <TextField
                    name={`addr.${row.key}.city`}
                    label="City"
                    compact
                    maxLength={120}
                    defaultValue={typed(`addr.${row.key}.city`, row.saved?.city)}
                  />
                  <TextField
                    name={`addr.${row.key}.state`}
                    label="State"
                    compact
                    maxLength={120}
                    defaultValue={typed(`addr.${row.key}.state`, row.saved?.state)}
                  />
                  <TextField
                    name={`addr.${row.key}.pin`}
                    label="PIN"
                    compact
                    maxLength={6}
                    digitsOnly
                    placeholder="421302"
                    defaultValue={typed(`addr.${row.key}.pin`, row.saved?.pin)}
                  />
                </div>
              </div>
            ) : (
              /* A CLOSED ROW STILL POSTS. Without these its fields would be
                 absent from the submission, and the action — which treats the
                 list as the complete set — would read the address as withdrawn.
                 Editing one depot would quietly delete the other three. */
              row.saved && (
                <>
                  <input type="hidden" name={`addr.${row.key}.id`} value={row.saved.id} />
                  <input type="hidden" name={`addr.${row.key}.label`} value={row.saved.label} />
                  <input type="hidden" name={`addr.${row.key}.line1`} value={row.saved.line1} />
                  <input
                    type="hidden"
                    name={`addr.${row.key}.line2`}
                    value={row.saved.line2 ?? ''}
                  />
                  <input type="hidden" name={`addr.${row.key}.city`} value={row.saved.city} />
                  <input type="hidden" name={`addr.${row.key}.state`} value={row.saved.state} />
                  <input type="hidden" name={`addr.${row.key}.pin`} value={row.saved.pin} />
                </>
              )
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={add}
        className="w-full rounded-md border border-dashed border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
      >
        + Add delivery address
      </button>
    </div>
  );
}
