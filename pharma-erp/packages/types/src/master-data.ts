/**
 * The master-data registers, as the Master Data tab row lists them.
 *
 * Structurally the same idea as WORKFLOWS in ./workflows, and deliberately a
 * separate list rather than a fifth workflow: a workflow's steps are ORDERED —
 * you cannot receive goods before raising the order — whereas these six are
 * independent registers. The numbering below is just the order they were
 * specified in, and nothing reads it as a sequence.
 *
 * Held as data so the tab bar, the routes and the page headings all come from
 * one place. Adding a seventh register is an entry here plus a component.
 *
 * NO ROLE GATING, matching WORKFLOWS and APP_SECTIONS. Hiding a tab is not the
 * security boundary; RolesGuard and row-level security are.
 */

/** Stable URL segment for each register. */
export type MasterDataFormKey =
  | 'item-product'
  | 'party'
  | 'bom-formulation'
  | 'licence-compliance'
  | 'principal-job-work'
  | 'packaging-requirement'
  | 'material-requirement';

export interface MasterDataForm {
  key: MasterDataFormKey;
  /**
   * Tab text. Shorter than {@link title} on purpose — six tabs each ending in
   * "Master" overflows the row on anything narrower than a desktop, and the
   * word carries no information once you are inside the Master Data section.
   */
  label: string;
  /** The register's full name, used as the page heading. */
  title: string;
}

export const MASTER_DATA_FORMS: readonly MasterDataForm[] = [
  { key: 'item-product', label: 'Item / Product', title: 'Item / Product Master' },
  { key: 'party', label: 'Party', title: 'Party Master' },
  { key: 'bom-formulation', label: 'BOM / Formulation', title: 'BOM / Formulation Master' },
  {
    key: 'licence-compliance',
    label: 'Licence & Compliance',
    title: 'Licence & Compliance Master',
  },
  {
    key: 'principal-job-work',
    label: 'Principal & Job-Work',
    title: 'Principal & Job-Work Agreement Master',
  },
  {
    key: 'packaging-requirement',
    label: 'Packaging Requirement',
    title: 'Packaging Requirement Master',
  },
  /**
   * US-MD-07, and the one register here that nobody types into.
   *
   * Every other entry is a thing somebody DEFINES; this one is COMPUTED, when a
   * sales order is confirmed. It sits here because the story places it in
   * Master Data and because the question it answers — "what have we committed
   * to that we cannot cover" — spans every order at once, which is not a
   * question any single order's screen can be asked.
   *
   * Last in the row, so the six registers that are maintained stay together.
   */
  {
    key: 'material-requirement',
    label: 'Material Requirement',
    title: 'Material Requirement Determination',
  },
];

/** Where a signed-in user lands when they open Master Data. */
export const MASTER_DATA_HOME = '/master-data/item-product';

export function masterDataHref(form: MasterDataFormKey): string {
  return `/master-data/${form}`;
}

export function findMasterDataForm(key: string): MasterDataForm | undefined {
  return MASTER_DATA_FORMS.find((form) => form.key === key);
}
