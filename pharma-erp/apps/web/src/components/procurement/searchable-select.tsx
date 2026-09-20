'use client';

/**
 * Procure-to-Pay's lookup field — now the shared one.
 *
 * This module held the original, and Order-to-Cash and Master Data each grew a
 * copy. The three had drifted: only one searched a hidden keyword, only one
 * suppressed the "none" row on a required field, and only one left the keyboard
 * un-armed when the list opened. A lookup that behaves differently depending on
 * which screen it is on is a lookup nobody can learn once.
 *
 * The shared component is this file's implementation — the most careful of the
 * three — plus Order-to-Cash's `keywords`. Re-exported rather than deleted so
 * that no call site had to change.
 */
export {
  SearchableSelect,
  type LookupOption,
  type SelectOption,
} from '@/components/searchable-select';
