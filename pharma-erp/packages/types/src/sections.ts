/**
 * The top-level areas of the staff application, as the header menu lists them.
 *
 * Deliberately separate from WORKFLOWS in ./workflows, because they answer
 * different questions. A workflow is a PROCESS — procure-to-pay, production —
 * and belongs in the tab bar, where the order of the tabs is itself meaningful.
 * A section is a PLACE. Master data is not a step in anything; it is the set of
 * registers every process reads from, so putting it in the tab row would imply
 * a sequence that does not exist.
 *
 * Held as data for the same reason WORKFLOWS is: adding a third section is a
 * few lines here rather than another branch in a component.
 *
 * NO ROLE GATING, matching WORKFLOWS. Worth restating so it is not mistaken for
 * an oversight: hiding a menu entry has never been the security boundary.
 * RolesGuard and row-level security are, and neither is affected by this file.
 */

/** Stable key for each section. Also the URL segment where there is one. */
export type SectionKey = 'master-data' | 'erp-data';

export interface AppSection {
  key: SectionKey;
  label: string;
  /** One line under the label in the menu, so the split explains itself. */
  purpose: string;
  /** Where the entry navigates to. */
  href: string;
  /**
   * Path prefixes this section owns, for the menu's current-section marker.
   * `href` alone is not enough — /data/users belongs to the section that /data
   * points at, and a plain equality check would leave it looking unselected.
   */
  owns: readonly string[];
}

export const APP_SECTIONS: readonly AppSection[] = [
  {
    key: 'master-data',
    label: 'Master Data',
    // Kept general on purpose: the page is deliberately empty and what goes in
    // it is undecided, so naming registers here would promise screens that do
    // not exist.
    purpose: 'The registers the rest of the system refers to.',
    href: '/master-data',
    owns: ['/master-data'],
  },
  {
    key: 'erp-data',
    label: 'Pharma-ERP-data',
    purpose: 'Records the workflows have produced, read straight from the tables.',
    href: '/data',
    owns: ['/data'],
  },
];

/**
 * The section a path belongs to, or undefined when it belongs to neither.
 *
 * Undefined is the normal case, not an error: the workflow pages are reached
 * from the tab bar and sit outside this menu entirely.
 */
export function findSectionForPath(pathname: string): AppSection | undefined {
  return APP_SECTIONS.find((section) =>
    section.owns.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)),
  );
}
