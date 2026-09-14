'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import {
  LICENCE_VISIBLE_TO,
  MASTER_DATA_FORMS,
  masterDataHref,
  type BomView,
  type ItemSummary,
  type JobWorkAgreementSummary,
  type LicenceRegister,
  type LicenceSummary,
  type MasterDataFormKey,
  type PackagingRequirementView,
  type PartySummary,
  type UserRole,
} from '@pharma-erp/types';

import { BomMasterForm } from '@/app/(app)/master-data/bom-master-form';
import { ItemMasterForm } from '@/app/(app)/master-data/item-master-form';
import { LicenceComplianceMasterForm } from '@/app/(app)/master-data/licence-compliance-master-form';
import { PackagingRequirementMasterForm } from '@/app/(app)/master-data/packaging-requirement-master-form';
import { PartyMasterForm } from '@/app/(app)/master-data/party-master-form';
import { PrincipalAgreementMasterForm } from '@/app/(app)/master-data/principal-agreement-master-form';
import {
  AgreementGrid,
  BomGrid,
  ItemGrid,
  LicenceGrid,
  PackagingGrid,
  PartyGrid,
} from '@/components/master-data-grid';
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
  role,
  items,
  boms,
  parties,
  licences,
  agreements,
  packaging,
}: {
  initialKey: MasterDataFormKey;
  /** Decides which registers are listed; see `visible` below. */
  role: UserRole;
  items: ApiResult<ItemSummary[]>;
  boms: ApiResult<BomView[]>;
  parties: ApiResult<PartySummary[]>;
  /** Null when the caller's role may not see licences — US-MD-04. */
  licences: ApiResult<LicenceRegister> | null;
  agreements: ApiResult<JobWorkAgreementSummary[]>;
  packaging: ApiResult<PackagingRequirementView[]>;
}) {
  // US-MD-04: licence records are for Admin and Quality/Compliance only. This
  // hides the tab; it is NOT the enforcement. The API refuses the request and
  // the page never fetches the rows for anyone else, so what this prevents is
  // a dead-end click, not a leak.
  const visible = MASTER_DATA_FORMS.filter(
    (form) => form.key !== 'licence-compliance' || canSeeLicences(role),
  );

  const [activeKey, setActiveKey] = useState<MasterDataFormKey>(initialKey);
  // One piece of state, not an `isOpen` plus an `editing`: those two can
  // disagree, and "open with nothing to edit" is not a state that exists.
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);

  // Resolved against EVERY register, not just the visible ones. A role that
  // may not see licences can still arrive on that URL — a bookmark, a link
  // from someone who can — and falling back to the first visible register
  // would show them the Item grid under a heading that says Licence &
  // Compliance. Keeping the requested register active lets Register answer
  // honestly instead.
  const active =
    MASTER_DATA_FORMS.find((form) => form.key === activeKey) ?? MASTER_DATA_FORMS[0]!;
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
            {visible.map((form) => {
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
            licences={licences}
            agreements={agreements}
            packaging={packaging}
            onNew={() => setDrawer({ mode: 'new' })}
            onEditItem={(row) => setDrawer({ mode: 'edit', item: row })}
            onEditParty={(row) => setDrawer({ mode: 'edit-party', party: row })}
            onEditLicence={(row) => setDrawer({ mode: 'edit-licence', licence: row })}
            onEditAgreement={(row) => setDrawer({ mode: 'edit-agreement', agreement: row })}
            onEditPackaging={(row) => setDrawer({ mode: 'edit-packaging', requirement: row })}
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
                : drawer.mode === 'edit-licence'
                  ? drawer.licence.licenceNumber
                  : drawer.mode === 'edit-agreement'
                    ? `${drawer.agreement.principalName}${
                        drawer.agreement.agreementReference
                          ? ` — ${drawer.agreement.agreementReference}`
                          : ''
                      }`
                    : drawer.mode === 'edit-packaging'
                      ? `${drawer.requirement.product.code} — ${drawer.requirement.packVariant}`
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
          ) : drawer.mode === 'edit-licence' ? (
            <LicenceComplianceMasterForm licence={drawer.licence} onSaved={closeDrawer} />
          ) : drawer.mode === 'edit-agreement' ? (
            <PrincipalAgreementMasterForm
              agreement={drawer.agreement}
              parties={parties.ok ? parties.data : []}
              boms={boms.ok ? boms.data : []}
              onSaved={closeDrawer}
            />
          ) : drawer.mode === 'edit-packaging' ? (
            <PackagingRequirementMasterForm
              requirement={drawer.requirement}
              items={items.ok ? items.data : []}
              onSaved={closeDrawer}
            />
          ) : (
            <Form
              onSaved={closeDrawer}
              items={items.ok ? items.data : []}
              parties={parties.ok ? parties.data : []}
              boms={boms.ok ? boms.data : []}
            />
          )}
        </MasterDataDrawer>
      )}
    </>
  );
}

/** Nothing open, creating in the active register, or editing one record. */
type DrawerState =
  | { mode: 'new' }
  | { mode: 'edit'; item: ItemSummary }
  | { mode: 'edit-party'; party: PartySummary }
  | { mode: 'edit-licence'; licence: LicenceSummary }
  | { mode: 'edit-agreement'; agreement: JobWorkAgreementSummary }
  | { mode: 'edit-packaging'; requirement: PackagingRequirementView };

/**
 * Whether this role may see the licence register at all — US-MD-04.
 *
 * Reads LICENCE_VISIBLE_TO rather than restating the roles, so the tab, the
 * page's fetch and the API guard cannot drift apart. Two copies of a
 * permission rule is how a screen ends up visible to someone the API refuses.
 */
function canSeeLicences(role: UserRole): boolean {
  return LICENCE_VISIBLE_TO.includes(role as (typeof LICENCE_VISIBLE_TO)[number]);
}

/**
 * Registers whose form is wired to a real create endpoint.
 *
 * All six, as of US-MD-06. Kept rather than deleted because the drawer still
 * asks the question, and because the honest answer stops being "yes" the
 * moment a seventh register is added ahead of its endpoint.
 */
const SAVES: ReadonlySet<MasterDataFormKey> = new Set(
  MASTER_DATA_FORMS.map((form) => form.key),
);

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
  licences,
  agreements,
  packaging,
  onNew,
  onEditItem,
  onEditParty,
  onEditLicence,
  onEditAgreement,
  onEditPackaging,
}: {
  activeKey: MasterDataFormKey;
  items: ApiResult<ItemSummary[]>;
  boms: ApiResult<BomView[]>;
  parties: ApiResult<PartySummary[]>;
  licences: ApiResult<LicenceRegister> | null;
  agreements: ApiResult<JobWorkAgreementSummary[]>;
  packaging: ApiResult<PackagingRequirementView[]>;
  onNew: () => void;
  onEditItem: (item: ItemSummary) => void;
  onEditParty: (party: PartySummary) => void;
  onEditLicence: (licence: LicenceSummary) => void;
  onEditAgreement: (agreement: JobWorkAgreementSummary) => void;
  onEditPackaging: (requirement: PackagingRequirementView) => void;
}) {
  switch (activeKey) {
    case 'item-product':
      return <ItemGrid result={items} onNew={onNew} onEdit={onEditItem} />;
    case 'party':
      return <PartyGrid result={parties} onNew={onNew} onEdit={onEditParty} />;
    case 'bom-formulation':
      return <BomGrid result={boms} onNew={onNew} />;
    case 'licence-compliance':
      // Null when the role may not see licences. Unreachable through the rail,
      // which does not list the register for those roles — but a stale URL or
      // a role changed mid-session both land here, and rendering nothing is
      // better than rendering a grid with no rows and no explanation.
      return licences ? (
        <LicenceGrid result={licences} onNew={onNew} onEdit={onEditLicence} />
      ) : (
        <Restricted />
      );
    case 'principal-job-work':
      return <AgreementGrid result={agreements} onNew={onNew} onEdit={onEditAgreement} />;
    case 'packaging-requirement':
      return <PackagingGrid result={packaging} onNew={onNew} onEdit={onEditPackaging} />;
  }
}

/**
 * Shown when a register exists but this role may not open it.
 *
 * Says so plainly instead of showing an empty grid. "No licences on file" and
 * "you may not see the licences on file" are different claims, and in a
 * compliance register the difference is the whole point.
 */
function Restricted() {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-slate-900">
          Licence records are restricted
        </p>
        <p className="mt-1.5 text-sm text-slate-600">
          Only an Admin or a Quality / Compliance Officer may view the licence register. Ask one of
          them if you need a licence number or a renewal date.
        </p>
      </div>
    </div>
  );
}

/**
 * Which form the drawer opens for each register.
 *
 * A total record keyed by the same strings as MASTER_DATA_FORMS, so adding a
 * register to that list without adding its form here is a compile error
 * rather than an empty drawer nobody notices.
 *
 * Every prop is passed to every form; the ones that do not need them simply
 * ignore them — a function taking fewer parameters than its type allows is
 * still assignable, so an unwired form needs no change until it gets an
 * endpoint. These are what let the forms offer PICKERS instead of asking
 * someone to type a code: `items` for the BOM form, `parties` and `boms` for
 * the job-work agreement.
 */
const FORMS: Record<
  MasterDataFormKey,
  (props: {
    onSaved: () => void;
    items: readonly ItemSummary[];
    parties: readonly PartySummary[];
    boms: readonly BomView[];
  }) => React.ReactNode
> = {
  'item-product': ItemMasterForm,
  party: PartyMasterForm,
  'bom-formulation': BomMasterForm,
  'licence-compliance': LicenceComplianceMasterForm,
  'principal-job-work': PrincipalAgreementMasterForm,
  'packaging-requirement': PackagingRequirementMasterForm,
};
