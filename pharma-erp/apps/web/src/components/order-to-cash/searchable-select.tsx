'use client';

/**
 * Order-to-Cash's lookup field — now the shared one.
 *
 * Its `keywords` idea survived into the shared component: an identifier the
 * label no longer shows is still what somebody types to find the record, and a
 * picker that cannot find DIST-002 because it now reads "ROX PHARMA" is worse
 * than the label it replaced.
 *
 * Re-exported rather than deleted so that no call site had to change; the
 * implementation lives in components/searchable-select.
 */
export {
  SearchableSelect,
  type LookupOption,
  type SelectOption,
} from '@/components/searchable-select';
