/**
 * Display formatting for table values — a UI standard, not a data change.
 *
 * Nothing here is ever written back. A vendor stored as "SUN CHEMICALS PVT LTD"
 * stays that way in the database; it is only *read* as "Sun Chemicals Pvt Ltd".
 * That matters because the same record is edited on a form, and a form that
 * silently re-cased what somebody typed would rewrite their data on every save.
 *
 * THE ONE RULE THAT SHAPES ALL OF THIS: a value whose casing was chosen on
 * purpose must not be second-guessed. "Lactose IP" is not a mistake — IP is the
 * Indian Pharmacopoeia — and a title-caser that turns it into "Lactose Ip" has
 * corrupted a drug name on a pharmaceutical document. So `titleCaseName` only
 * reshapes strings that are ENTIRELY upper or ENTIRELY lower case, which are
 * the two failure modes worth fixing, and leaves every mixed-case value exactly
 * as written.
 */

/**
 * Tokens that stay upper case when a shouted string is title-cased.
 *
 * Only consulted for input that was ALL CAPS, where the casing carries no
 * information and every token looks alike. Pharmacopoeias, dosage forms and the
 * document prefixes this system issues — the words most likely to appear in an
 * item or party name that somebody typed with caps lock on.
 */
const ACRONYMS = new Set([
  // Pharmacopoeias and standards
  'IP',
  'BP',
  'USP',
  'EP',
  'JP',
  'NF',
  'API',
  'GMP',
  'GLP',
  'WHO',
  'ISO',
  // Regulatory and commercial
  'GST',
  'GSTIN',
  'HSN',
  'MRP',
  'DPCO',
  'NLEM',
  'PAN',
  'TAN',
  'CIN',
  'FSSAI',
  // Documents this system issues
  'PR',
  'PO',
  'GRN',
  'QC',
  'MI',
  'JW',
  'JWR',
  'JWI',
  'SO',
  'DSP',
  'RCPT',
  'SRTN',
  'PINV',
  'SINV',
  'BMR',
  'BPR',
  'COA',
  'LOT',
  'FEFO',
  'UOM',
  'ID',
  // Company suffixes that are genuinely abbreviations
  'LLP',
  'LLC',
]);

/** Words kept lower case inside a title-cased phrase, unless they lead it. */
const MINOR_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'via',
  'with',
]);

/** Whether a string carries no case information of its own. */
function isShouted(value: string): boolean {
  return value === value.toUpperCase() && /[A-Z]/.test(value);
}

function isWhispered(value: string): boolean {
  return value === value.toLowerCase() && /[a-z]/.test(value);
}

/** Title-cases one word, preserving a known acronym and any punctuation. */
function titleCaseWord(word: string, isFirst: boolean): string {
  // Split off leading/trailing punctuation so "(pvt.)" title-cases the word
  // inside the brackets rather than giving up on the whole token.
  const match = word.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);

  if (!match) return word;

  const [, before, core, after] = match;

  if (!core) return word;

  if (ACRONYMS.has(core.toUpperCase())) return `${before}${core.toUpperCase()}${after}`;

  const lower = core.toLowerCase();

  if (!isFirst && MINOR_WORDS.has(lower)) return `${before}${lower}${after}`;

  // A token with digits in it is a code or a strength — "500mg", "10x10" — and
  // capitalising its first letter is the most that should happen to it.
  return `${before}${lower.charAt(0).toUpperCase()}${lower.slice(1)}${after}`;
}

/**
 * A human-readable name, as a table should show it.
 *
 * Reshapes ONLY the two cases the convention rules out — ALL CAPS and all
 * lowercase — and returns everything else untouched. "Lactose IP", "Sun
 * Chemicals Pvt. Ltd." and "3M Healthcare" are already deliberate and are
 * passed straight through.
 */
export function titleCaseName(value: string | null | undefined): string {
  if (!value) return '';

  const trimmed = value.trim();

  if (!trimmed) return '';

  // Mixed case: somebody chose it. Leave it alone.
  if (!isShouted(trimmed) && !isWhispered(trimmed)) return trimmed;

  return trimmed
    .split(/(\s+)/)
    .map((part, index) => (/\s/.test(part) ? part : titleCaseWord(part, index === 0)))
    .join('');
}

/**
 * A document number or code — PR-1204, PO-4482, GRN-8841, RM-PARA-001.
 *
 * Upper cased, because these are identifiers rather than words: they are read
 * aloud letter by letter and quoted back in emails, and a lower-case prefix
 * makes two references to the same document look like two documents.
 */
export function formatCode(value: string | null | undefined): string {
  return value ? value.trim().toUpperCase() : '';
}

/**
 * An email address, always lower case.
 *
 * The local part is case-sensitive per RFC 5321 and case-insensitive in every
 * mail system anyone actually uses; lower case is what people expect to read
 * and what the login form already stores.
 */
export function formatEmail(value: string | null | undefined): string {
  return value ? value.trim().toLowerCase() : '';
}

/**
 * A status or type label.
 *
 * Takes the label the API already provides — "Converted to PO", "Pure
 * conversion" — and title-cases it for the table convention. Enum values that
 * reach here raw (SCREAMING_SNAKE_CASE) are humanised first, so a label map
 * that has not been written yet still reads properly rather than shouting.
 */
export function formatStatus(value: string | null | undefined): string {
  if (!value) return '';

  const trimmed = value.trim();

  if (!trimmed) return '';

  // A raw enum value: PURE_CONVERSION -> Pure Conversion.
  const humanised = /^[A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(trimmed)
    ? trimmed.replace(/_/g, ' ')
    : trimmed;

  return humanised
    .split(/(\s+|-)/)
    .map((part, index) =>
      /\s/.test(part) || part === '-' ? part : titleCaseWord(part, index === 0),
    )
    .join('');
}

/**
 * An ISO date as DD-MM-YYYY, which is how a date is read on a carton here.
 *
 * Takes the first ten characters and reorders them — NO `Date` PARSING. A
 * stored expiry is a calendar day, not an instant, and `new Date('2027-04-03')`
 * is midnight UTC: one `toLocaleDateString` west of Greenwich and the label
 * reads 02-04-2027, a day early on a document that governs whether stock may
 * be sold. Reordering the string cannot drift.
 *
 * Returns what it was given if that is not a well-formed date, rather than
 * inventing something: a malformed value should look wrong, not plausible.
 */
export function formatDateDMY(value: string | null | undefined): string {
  if (!value) return '';

  const [year, month, day] = value.slice(0, 10).split('-');

  if (!/^\d{4}$/.test(year ?? '') || !/^\d{2}$/.test(month ?? '') || !/^\d{2}$/.test(day ?? '')) {
    return value;
  }

  return `${day}-${month}-${year}`;
}
