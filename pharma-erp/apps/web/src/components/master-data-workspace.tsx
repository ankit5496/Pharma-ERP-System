'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import {
  MASTER_DATA_FORMS,
  masterDataHref,
  type BomView,
  type ItemSummary,
  type MasterDataFormKey,
  type PartySummary,
} from '@pharma-erp/types';

import { BomMasterForm } from '@/app/(app)/master-data/bom-master-form';
import { ItemMasterForm } from '@/app/(app)/master-data/item-master-form';
import { LicenceComplianceMasterForm } from '@/app/(app)/master-data/licence-compliance-master-form';
import { PackagingRequirementMasterForm } from '@/app/(app)/master-data/packaging-requirement-master-form';
import { PartyMasterForm } from '@/app/(app)/master-data/party-master-form';
import { PrincipalAgreementMasterForm } from '@/app/(app)/master-data/principal-agreement-master-form';
import { BomGrid, ItemGrid, PartyGrid, PlannedGrid } from '@/components/master-data-grid';
import { MasterDataDrawer } from '@/components/master-data-drawer';
import type { ApiResult } from '@/lib/api';

/**
 * The Master Data working area: registers down the left, the selected
 * register as a grid, and the form in a drawer over it.
 *
 * The grid is the register and the form is the detour — an item master is
 * corrected far more often than it is created, and a form shows one record
 * where the question is usually "which of these two hundred is wrong".
 *
 * SWITCHING IS CLIENT-SIDE. Every protected page calls `requireSession()`,
 * which asks the API for `/auth/me`, which re-reads the account from Postgres
 * inside a transaction: BEGIN, set_config, the user, the tenant, COMMIT. Five
 * sequential round trips — measured against the Oregon database at 300ms on a
 * good trip and often over 900ms. Routing between registers was buying all of
 * that to change which component is mounted, so the rows for every register
 * are fetched once by the page and switching touches no network at all.
 *
 * The rows are still real `<Link>`s, so middle-click, ctrl-click and "copy
 * link address" behave normally and the URLs stay shareable — only an ordinary
 * left-click is intercepted. The server route renders any of the six directly,
 * which is what makes a deep link or a refresh work.
 */
export function MasterDataWorkspace({
  initialKey,
  items,
  boms,
  parties,
}: {
  initialKey: MasterDataFormKey;
  items: ApiResult<ItemSummary[]>;
  boms: ApiResult<BomView[]>;
  parties: ApiResult<PartySummary[]>;
}) {
  const [activeKey, setActiveKey] = useState<MasterDataFormKey>(initialKey);
  // One piece of state, not an `isOpen` plus an `editing`: those two can
  // disagree, and "open with nothing to edit" is not a state that exists.
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);

  const active = MASTER_DATA_FORMS.find((form) => form.key === activeKey) ?? MASTER_DATA_FORMS[0]!;
  const Form = FORMS[active.key];

  function select(key: MasterDataFormKey) {
    setActiveKey(key);

    // The pane is not remounted — only its contents are — so it keeps the
    // scroll offset the previous register left behind.
    paneRef.current?.scrollTo({ top: 0 });

    // replaceState rather than pushState: pushState would stack a history
    // entry per register, and Next would then serve the popstate as a real
    // navigation — a server round trip, which is the thing being avoided.
    // The cost is that Back leaves Master Data instead of stepping between
    // registers, which is the lesser surprise.
    window.history.replaceState(null, '', masterDataHref(key));
  }

  const closeDrawer = () => setDrawer(null);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm sm:grid sm:grid-cols-[13rem_minmax(0,1fr)]">
        {/* On a phone the panel stays whole and the divider simply turns
            horizontal: the list sits above the grid rather than beside it.
            `flex-none` keeps the list at its natural height there; in the
            grid layout it is ignored. */}
        <nav
          aria-label="Registers"
          className="flex-none overflow-y-auto border-b border-slate-200 bg-slate-50 p-1.5 sm:border-b-0 sm:border-r"
        >
          <ul className="flex flex-col gap-0.5">
            {MASTER_DATA_FORMS.map((form) => {
              const isActive = form.key === active.key;

              return (
                <li key={form.key}>
                  <Link
                    href={masterDataHref(form.key)}
                    aria-current={isActive ? 'page' : undefined}
                    title={form.title}
                    onClick={(event) => {
                      // Leave modified clicks to the browser: ctrl/cmd-click
                      // opens a new tab, shift-click a new window, and
                      // hijacking those is the classic way a custom link
                      // stops behaving like a link.
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

                      event.preventDefault();
                      select(form.key);
                    }}
                    // `ring-inset` rather than a border so the active row does
                    // not shift its neighbours by a pixel.
                    className={`block rounded-md px-3 py-2 text-sm transition ${
                      isActive
                        ? 'bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200'
                        : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    {form.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div ref={paneRef} className="flex min-h-0 flex-1 flex-col">
          <Register
            activeKey={active.key}
            items={items}
            boms={boms}
            parties={parties}
            onNew={() => setDrawer({ mode: 'new' })}
            onEditItem={(row) => setDrawer({ mode: 'edit', item: row })}
            onEditParty={(row) => setDrawer({ mode: 'edit-party', party: row })}
          />
        </div>
      </div>

      {drawer && (
        <MasterDataDrawer
          title={
            drawer.mode === 'edit'
              ? `${drawer.item.code} — ${drawer.item.name}`
              : drawer.mode === 'edit-party'
                ? `${drawer.party.code} — ${drawer.party.name}`
                : `New — ${active.title}`
          }
          description={
            drawer.mode === 'new'
              ? SAVES.has(active.key)
                ? 'Required fields are marked. The record joins the register as soon as it saves.'
                : 'Nothing is saved yet; this register has no create endpoint behind it.'
              : 'The code cannot be changed. Everything else can.'
          }
          onClose={closeDrawer}
        >
          {/* Editing exists for the two registers with an update endpoint,
              and each is only reachable from its own grid — so the edit
              branches name their form directly rather than pretending the
              registry supports editing generally. */}
          {drawer.mode === 'edit' ? (
            <ItemMasterForm item={drawer.item} onSaved={closeDrawer} />
          ) : drawer.mode === 'edit-party' ? (
            <PartyMasterForm party={drawer.party} onSaved={closeDrawer} />
          ) : (
            <Form onSaved={closeDrawer} />
          )}
        </MasterDataDrawer>
      )}
    </>
  );
}

/** Nothing open, creating in the active register, or editing one item. */
type DrawerState =
  | { mode: 'new' }
  | { mode: 'edit'; item: ItemSummary }
  | { mode: 'edit-party'; party: PartySummary };

/**
 * Registers whose form is wired to a real create endpoint.
 *
 * One entry today. It exists so the drawer does not tell someone their work
 * will be discarded when it will not — and so adding the next endpoint is a
 * one-line change here rather than a message somebody forgets to update.
 */
const SAVES = new Set<MasterDataFormKey>(['item-product', 'party']);

/**
 * Which grid serves each register.
 *
 * A switch rather than a lookup table, because the two live registers take
 * differently-typed results and a shared table would have to erase that to
 * `unknown` — losing exactly the check that catches a column reading a field
 * the API no longer sends.
 */
function Register({
  activeKey,
  items,
  boms,
  parties,
  onNew,
  onEditItem,
  onEditParty,
}: {
  activeKey: MasterDataFormKey;
  items: ApiResult<ItemSummary[]>;
  boms: ApiResult<BomView[]>;
  parties: ApiResult<PartySummary[]>;
  onNew: () => void;
  onEditItem: (item: ItemSummary) => void;
  onEditParty: (party: PartySummary) => void;
}) {
  switch (activeKey) {
    case 'item-product':
      return <ItemGrid result={items} onNew={onNew} onEdit={onEditItem} />;
    case 'party':
      return <PartyGrid result={parties} onNew={onNew} onEdit={onEditParty} />;
    case 'bom-formulation':
      return <BomGrid result={boms} onNew={onNew} />;
    default: {
      const planned = PLANNED[activeKey];
      return (
        <PlannedGrid
          columns={planned.columns}
          noun={planned.noun}
          singular={planned.singular}
          reason={planned.reason}
          onNew={onNew}
        />
      );
    }
  }
}

/**
 * The registers with no table behind them.
 *
 * Columns are listed so the shape is readable now. The reason is stated
 * plainly rather than shown as an empty grid, because an empty grid asserts
 * "there are no parties" and the truth is "there is nowhere to put one" —
 * a different claim, and in a pharma system the difference matters.
 */
const PLANNED: Record<
  Exclude<MasterDataFormKey, 'item-product' | 'bom-formulation' | 'party'>,
  { noun: string; singular: string; reason: string; columns: readonly string[] }
> = {
  'licence-compliance': {
    noun: 'licences',
    singular: 'licence',
    reason:
      'Nothing tracks renewal dates yet, so an expiring manufacturing licence passes unnoticed.',
    columns: ['Type', 'Number', 'Issuing authority', 'Expiry', 'Days left'],
  },
  'principal-job-work': {
    noun: 'agreements',
    singular: 'agreement',
    reason:
      'The Job Work workflow is still placeholders; this register is what would give it something to work against.',
    columns: ['Principal', 'Reference', 'Billing model', 'Rate', 'Products', 'Valid until'],
  },
  'packaging-requirement': {
    noun: 'requirements',
    singular: 'requirement',
    reason:
      'Packing consumes components today without checking them off a required list, so a short shipper is found on the line.',
    columns: ['Product', 'Pack variant', 'Components', 'Levels', 'Mandatory'],
  },
};

/**
 * Which form the drawer opens for each register.
 *
 * A total record keyed by the same strings as MASTER_DATA_FORMS, so adding a
 * register to that list without adding its form here is a compile error
 * rather than an empty drawer nobody notices.
 *
 * `onSaved` closes the drawer. The five forms that cannot save yet simply
 * ignore it — a function that takes fewer parameters than its type allows is
 * still assignable, so they need no change until they get an endpoint.
 */
const FORMS: Record<MasterDataFormKey, (props: { onSaved: () => void }) => React.ReactNode> = {
  'item-product': ItemMasterForm,
  party: PartyMasterForm,
  'bom-formulation': BomMasterForm,
  'licence-compliance': LicenceComplianceMasterForm,
  'principal-job-work': PrincipalAgreementMasterForm,
  'packaging-requirement': PackagingRequirementMasterForm,
};
