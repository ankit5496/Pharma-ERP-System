'use client';

import { useCallback, useMemo, useState } from 'react';
import type { BomView } from '@pharma-erp/types';

import { Quantity } from './shared';
import { RegisterPager, RegisterToolbar, useRegisterView } from './register-toolbar';

/**
 * Formulations as a compact table — one row per PRODUCT, showing the version in
 * force, with its superseded versions revealed underneath on click.
 *
 * ONLY THE ACTIVE VERSION IS LISTED at rest. A flat table of every version puts
 * "PCM-500 v1" beside "PCM-500 v4" as though they were two products, and with
 * seven versions across two products the history outnumbers the answer. What is
 * in force is the question people arrive with; what it replaced is the question
 * they ask second, which is what the expander is for.
 *
 * The superseded rows are nested INSIDE the parent's own <tbody>, not appended
 * to the table as siblings. One tbody per product is what lets the group be
 * striped, bordered and expanded as a unit, and it keeps the child rows tied to
 * their parent if the table is ever sorted.
 *
 * Everything is already fetched by the server component that renders this, so
 * expanding a row costs no request.
 */
export function FormulationTable({ boms }: { boms: BomView[] }) {
  const products = useMemo(() => groupByProduct(boms), [boms]);

  // Searched and paged over PRODUCTS, not versions: the rows are products, and
  // a count of versions would not match what is on screen. A product matches on
  // its own code and name and on any of its versions' material codes, so
  // "which formulation uses PCM-600" is answerable from here.
  const searchText = useCallback(
    (product: ProductGroup) =>
      [
        product.productCode,
        product.productName,
        ...[product.current, ...product.superseded]
          .filter((bom): bom is BomView => bom !== null)
          .flatMap((bom) => bom.lines.flatMap((line) => [line.item.code, line.item.name])),
      ].join(' '),
    [],
  );

  const matchesFilter = useCallback(
    (product: ProductGroup, value: string) =>
      value === 'ACTIVE' ? product.current !== null : product.current === null,
    [],
  );

  const view = useRegisterView({ rows: products, searchText, matchesFilter });

  // Product ids whose history is open. A set rather than a single id: comparing
  // two products' histories side by side is a normal thing to want, and closing
  // one to open another would make that impossible.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // Which version's materials are open, keyed by BOM id. Separate from the set
  // above because expanding a product's history and opening one version's
  // recipe are different questions.
  const [openBomId, setOpenBomId] = useState<string | null>(null);

  const toggleProduct = (productId: string) =>
    setExpanded((current) => {
      const next = new Set(current);

      if (next.has(productId)) next.delete(productId);
      else next.add(productId);

      return next;
    });

  const toggleBom = (bomId: string) =>
    setOpenBomId((current) => (current === bomId ? null : bomId));

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <RegisterToolbar
        query={view.query}
        onQuery={view.setQuery}
        placeholder="Search product or material…"
        noun="formulations"
        filter={view.filter}
        onFilter={view.setFilter}
        filterOptions={[
          { value: 'ACTIVE', label: 'Has an active version' },
          { value: 'INACTIVE', label: 'No active version' },
        ]}
        shown={view.filtered.length}
        total={view.total}
      />

      {view.filtered.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <Th className="w-8" />
                <Th>Formulation</Th>
                <Th align="right">Version</Th>
                <Th align="right">Batch size</Th>
                <Th align="right">Materials</Th>
                <Th>Status</Th>
                <Th align="right">Action</Th>
              </tr>
            </thead>

            {view.visible.map((product) => {
              const isExpanded = expanded.has(product.productId);
              const { current } = product;

              return (
                <tbody
                  key={product.productId}
                  className="border-b border-slate-200 last:border-b-0"
                >
                  {/* The product's row: the version in force, or a warning that
                    there is none. */}
                  <tr className={isExpanded ? 'bg-slate-50/60' : 'hover:bg-slate-50'}>
                    <td className="py-2.5 pl-4 pr-1 align-middle">
                      {product.superseded.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => toggleProduct(product.productId)}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? 'Hide' : 'Show'} earlier versions of ${product.productCode}`}
                          className="flex h-6 w-6 items-center justify-center rounded text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
                        >
                          <Chevron open={isExpanded} />
                        </button>
                      ) : (
                        // A product with no history keeps the column's width so
                        // the codes below it stay in one line.
                        <span className="block h-6 w-6" />
                      )}
                    </td>

                    <td className="py-2.5 pr-4">
                      <span className="font-mono text-xs text-slate-600">
                        {product.productCode}
                      </span>{' '}
                      <span className="font-medium text-slate-900">{product.productName}</span>
                    </td>

                    <td className="py-2.5 pr-4 text-right tabular-nums text-slate-800">
                      {current ? `v${current.version}` : <Blank />}
                    </td>

                    <td className="py-2.5 pr-4 text-right">
                      {current ? (
                        <Quantity value={current.outputQuantity} uom={current.product.uom} />
                      ) : (
                        <Blank />
                      )}
                    </td>

                    <td className="py-2.5 pr-4 text-right tabular-nums text-slate-800">
                      {current ? current.lines.length : <Blank />}
                    </td>

                    <td className="py-2.5 pr-4">
                      {current ? (
                        <StatusPill kind="active" />
                      ) : (
                        <span className="whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-inset ring-amber-200">
                          No active version
                        </span>
                      )}
                    </td>

                    <td className="py-2.5 pr-4 text-right">
                      {current && (
                        <RowAction
                          open={openBomId === current.id}
                          onClick={() => toggleBom(current.id)}
                          label={`materials for ${product.productCode} v${current.version}`}
                        />
                      )}
                    </td>
                  </tr>

                  {/* The active version's materials. */}
                  {current && openBomId === current.id && (
                    <tr>
                      <td colSpan={7} className="bg-slate-50/60 px-4 pb-4 pt-1">
                        <MaterialTable bom={current} />
                      </td>
                    </tr>
                  )}

                  {/* The history, indented under the row it belongs to. */}
                  {isExpanded &&
                    product.superseded.map((bom) => (
                      <FragmentRow
                        key={bom.id}
                        bom={bom}
                        open={openBomId === bom.id}
                        onToggle={() => toggleBom(bom.id)}
                        productCode={product.productCode}
                      />
                    ))}
                </tbody>
              );
            })}
          </table>
        </div>
      )}

      {view.filtered.length === 0 && (
        <p className="px-6 py-8 text-sm text-slate-600">
          {products.length === 0 ? 'No formulations yet.' : 'No formulation matches that search.'}
        </p>
      )}

      <RegisterPager
        page={view.page}
        pageCount={view.pageCount}
        first={view.first}
        last={view.last}
        total={view.filtered.length}
        noun="formulations"
        pageSize={view.pageSize}
        onPage={view.goTo}
        onPageSize={view.setPageSize}
      />
    </div>
  );
}

/**
 * A superseded version, as a child row.
 *
 * Indented and muted rather than merely labelled: the indent is what says "this
 * belongs to the row above" without the reader having to match product codes
 * down a column.
 */
function FragmentRow({
  bom,
  open,
  onToggle,
  productCode,
}: {
  bom: BomView;
  open: boolean;
  onToggle: () => void;
  productCode: string;
}) {
  return (
    <>
      <tr className="bg-slate-50/40 text-slate-600 hover:bg-slate-100/60">
        <td className="py-2 pl-4 pr-1" />

        <td className="py-2 pl-6 pr-4">
          {/* A rule rather than a repeated product name: the name is on the
              parent row, and repeating it is what made the flat table read as
              though each version were its own product. */}
          <span aria-hidden className="mr-2 text-slate-300">
            └
          </span>
          <span className="text-xs text-slate-500">
            superseded {bom.effectiveFrom && <>· from {bom.effectiveFrom}</>}
          </span>
        </td>

        <td className="py-2 pr-4 text-right tabular-nums">v{bom.version}</td>

        <td className="py-2 pr-4 text-right">
          <Quantity value={bom.outputQuantity} uom={bom.product.uom} />
        </td>

        <td className="py-2 pr-4 text-right tabular-nums">{bom.lines.length}</td>

        <td className="py-2 pr-4">
          <StatusPill kind="superseded" />
        </td>

        <td className="py-2 pr-4 text-right">
          <RowAction
            open={open}
            onClick={onToggle}
            label={`materials for ${productCode} v${bom.version}`}
          />
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={7} className="bg-slate-50/60 px-4 pb-4 pt-1">
            <MaterialTable bom={bom} />
          </td>
        </tr>
      )}
    </>
  );
}

/** The materials of one version, shown under its row. */
function MaterialTable({ bom }: { bom: BomView }) {
  return (
    <div className="ml-6 overflow-hidden rounded-md border border-slate-200 bg-white">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-white text-[10px] uppercase tracking-wide text-slate-500">
            <th scope="col" className="px-4 py-2 font-medium">
              Material
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Type
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Quantity per batch
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Notes
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {bom.lines.map((line) => (
            <tr key={line.id}>
              <td className="px-4 py-2">
                <span className="font-mono text-[11px] text-slate-600">{line.item.code}</span>{' '}
                <span className="text-slate-800">{line.item.name}</span>
              </td>
              <td className="px-4 py-2 text-slate-600">
                {line.item.type === 'PACKING_MATERIAL' ? 'Packing' : 'Raw material'}
              </td>
              <td className="px-4 py-2 text-right">
                <Quantity value={line.quantityPer} uom={line.item.uom} />
              </td>
              <td className="px-4 py-2 text-slate-600">{line.notes ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {bom.instructions && (
        <div className="border-t border-slate-200 px-4 py-3">
          <h5 className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Manufacturing instructions
          </h5>
          <pre className="mt-1.5 whitespace-pre-wrap font-sans text-xs text-slate-700">
            {bom.instructions}
          </pre>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  align = 'left',
  className = '',
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-4 py-2.5 font-medium ${
        align === 'right' ? 'text-right' : ''
      } ${className}`}
    >
      {children}
    </th>
  );
}

function Blank() {
  return <span className="text-slate-300">—</span>;
}

/**
 * Active is green, superseded is grey — and both carry the word.
 *
 * Whether a recipe is the one in force decides what can be manufactured, so it
 * is not a thing to encode in hue alone.
 */
function StatusPill({ kind }: { kind: 'active' | 'superseded' }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
        kind === 'active'
          ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
          : 'bg-slate-100 text-slate-600 ring-slate-200'
      }`}
    >
      {kind === 'active' ? 'Active' : 'Superseded'}
    </span>
  );
}

/** The row's own control: opens that version's materials. */
function RowAction({
  open,
  onClick,
  label,
}: {
  open: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} ${label}`}
      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
    >
      {open ? 'Hide' : 'View'}
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path d="M7.5 5 12.5 10 7.5 15" />
    </svg>
  );
}

interface ProductGroup {
  productId: string;
  productCode: string;
  productName: string;
  /** The version in force. Null when every version has been superseded. */
  current: BomView | null;
  /** The rest, newest first. */
  superseded: BomView[];
}

/**
 * One entry per product, with its versions sorted.
 *
 * `isActive` decides which version is current rather than "the highest version
 * number": those usually agree, but the flag is what the API and the work-order
 * gate read, and a row that disagreed with what can actually be manufactured
 * would be worse than no row.
 *
 * A product with no active version is kept, not dropped. It is a real and
 * awkward state — nothing can be made from it — and hiding the product would
 * make it look as though the formulation had been deleted.
 */
function groupByProduct(boms: BomView[]): ProductGroup[] {
  const byProduct = new Map<string, BomView[]>();

  for (const bom of boms) {
    byProduct.set(bom.product.id, [...(byProduct.get(bom.product.id) ?? []), bom]);
  }

  return Array.from(byProduct.values())
    .map((versions) => {
      const newestFirst = [...versions].sort((a, b) => b.version - a.version);
      // `find`, not `filter`: a partial unique index allows only one active
      // version per product, so a second would be a database fault rather than
      // something to render.
      const current = newestFirst.find((bom) => bom.isActive) ?? null;
      const first = newestFirst[0]!;

      return {
        productId: first.product.id,
        productCode: first.product.code,
        productName: first.product.name,
        current,
        superseded: newestFirst.filter((bom) => bom !== current),
      };
    })
    .sort((a, b) => a.productCode.localeCompare(b.productCode));
}
