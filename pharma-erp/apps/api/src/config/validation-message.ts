import type { ValidationError } from 'class-validator';

/**
 * Turns class-validator's output into sentences a person can read.
 *
 * WHY THIS EXISTS. class-validator builds its default messages from the DTO's
 * PROPERTY NAME: `hsnCode should not be empty`, `gstRate must be a number
 * string`, `unitsPerPack must be a positive quantity`. Those names are
 * camelCase identifiers, so a form that failed three constraints showed three
 * fragments starting in lower case, sitting beside author-written messages that
 * start with a capital. QA reported it as "some field names start with capital
 * letters and some are starting with small letters", and it appeared on every
 * form because the ValidationPipe is global.
 *
 * The fix is central for the same reason the bug was: one pipe produces every
 * validation message in the product. Giving each DTO field a hand-written
 * message would work and would be a hundred places to forget.
 *
 * What this does NOT do is rewrite author-written messages. A constraint that
 * already carries `{ message: 'A pack specification needs at least one
 * component.' }` is passed through untouched — it does not begin with the
 * property name, so there is nothing to replace.
 */

/**
 * Names whose humanised form is not merely the split camelCase.
 *
 * Two kinds live here: acronyms that must stay upper case (`hsnCode` is not
 * "Hsn code"), and identifiers whose field label is a different word from the
 * property (`productId` is the "Finished product" on screen, not "Product id").
 *
 * Anything absent falls through to the generic humaniser, so a new DTO field is
 * never worse off than it is today — it simply reads "Units per pack" instead
 * of "unitsPerPack".
 */
const LABELS: Record<string, string> = {
  // Acronyms and codes
  hsnCode: 'HSN code',
  gstRate: 'GST rate',
  gstin: 'GSTIN',
  mrp: 'MRP',
  uom: 'Unit of measure',
  dpcoCeiling: 'DPCO ceiling',
  id: 'Identifier',

  // Identifiers whose label differs from the property name
  productId: 'Finished product',
  itemId: 'Item',
  bomId: 'Formulation',
  principalId: 'Principal',
  partyId: 'Party',
  agreementId: 'Agreement',
  requirementId: 'Pack specification',
  tenantId: 'Company',
  userId: 'User',

  // Fields whose plain humanisation reads oddly
  packVariant: 'Pack variant',
  unitsPerPack: 'Units per pack',
  quantityPer: 'Quantity',
  quantityBasis: 'Charged',
  requirement: 'If short at packing',
  licenceType: 'Licence type',
  licenceNumber: 'Licence number',
  issuingAuthority: 'Issuing authority',
  expiryDate: 'Expiry date',
  issuedOn: 'Issued on',
  billingModel: 'Billing model',
  conversionChargeRate: 'Conversion charge rate',
  conversionRateBasis: 'Rate basis',
  agreementReference: 'Agreement reference',
  principalBrandName: "Principal's brand name",
  packDesignRef: 'Pack design reference',
  drugLicenceNumber: 'Drug licence number',
  drugLicenceValidTo: 'Drug licence validity',
  creditLimit: 'Credit limit',
  creditPeriodDays: 'Credit period',
  paymentTermsDays: 'Payment terms',
  scheduleClassification: 'Schedule classification',
  shelfLifeMonths: 'Shelf life',
  storageConditions: 'Storage conditions',
  reorderLevel: 'Reorder level',
  reorderQuantity: 'Reorder quantity',
  brandName: 'Brand name',
  genericName: 'Generic name',
  partyType: 'Party type',
  alertLeadDays: 'Renewal warning',
  plannedQuantity: 'Planned quantity',
  batchQuantity: 'Batch quantity',
};

/**
 * Collections whose child index is worth naming in the message.
 *
 * "Component 2: Quantity must be a positive quantity" tells someone which row
 * to look at; "lines.1.quantityPer must be..." does not.
 */
const LINE_NOUNS: Record<string, string> = {
  lines: 'Component',
  mappings: 'Product mapping',
};

/**
 * Constraints whose message says only what TYPE a value should have.
 *
 * An empty required field fails several at once — a blank `code` trips
 * `isString`, `maxLength` and `matches` together, and reporting all three gives
 * the reader "Code must not start or end with whitespace. Code must be shorter
 * than or equal to 64 characters. Code must be a string." for one empty box.
 *
 * These are the least useful of the three, so they lose. One field, one
 * sentence — and the sentence is the one that says what the field wants rather
 * than what JavaScript type it is.
 */
const GENERIC_CONSTRAINTS = new Set([
  'isString',
  'isNumber',
  'isInt',
  'isBoolean',
  'isArray',
  'isDefined',
  'isNotEmpty',
  'maxLength',
  'minLength',
  'nestedValidation',
]);

/**
 * Constraints that can only fail when the value is absent or of the wrong
 * JavaScript type.
 *
 * A blank box sends nothing, so `@IsString()` fails — and so does every other
 * rule on that field, because none of them can run on `undefined`. Reporting
 * the length rule then tells someone their empty field "must be shorter than
 * or equal to 255 characters", which is true, useless, and how the original
 * bug report came to say the messages were not proper.
 *
 * `isIn` is deliberately NOT here: when an enum field is missing it lists the
 * accepted values, which is exactly what the reader needs.
 */
const MISSING_VALUE_CONSTRAINTS = new Set([
  'isString',
  'isNumber',
  'isInt',
  'isBoolean',
  'isArray',
]);

/**
 * One message per field: the most useful constraint that failed.
 *
 * Three cases, in order:
 *
 *   1. A type constraint failed, so nothing was sent -> say it is required,
 *      rather than reporting a length or format rule about a value that does
 *      not exist.
 *   2. A specific constraint failed -> use it. This keeps the author-written
 *      message ("HSN code must be 4 to 8 digits") over the generic one beside
 *      it.
 *   3. Otherwise the first one, so a field is never silently dropped.
 *
 * The returned string still begins with the raw property name, because
 * `relabel` is what turns that into the field's label.
 */
function bestMessage(constraints: Record<string, string>, property: string): string | undefined {
  const entries = Object.entries(constraints);

  if (entries.some(([name]) => MISSING_VALUE_CONSTRAINTS.has(name))) {
    return `${property} is required`;
  }

  const specific = entries.find(([name]) => !GENERIC_CONSTRAINTS.has(name));

  return (specific ?? entries[0])?.[1];
}

/** `unitsPerPack` -> `Units per pack`. The fallback, not the main path. */
function humanise(property: string): string {
  const spaced = property
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function labelFor(property: string): string {
  return LABELS[property] ?? humanise(property);
}

/**
 * Replaces the leading property name in a constraint message with its label.
 *
 * Only the LEADING occurrence, and only when the message actually starts with
 * the property: that is the shape class-validator's defaults take, and
 * anything else is a message an author wrote deliberately.
 */
function relabel(message: string, property: string): string {
  if (!message.startsWith(property)) return message;

  return `${labelFor(property)}${message.slice(property.length)}`;
}

/**
 * Flattens one error, and its children, into readable sentences.
 *
 * Nested DTOs arrive as a tree: `lines` -> `0` -> `quantityPer`. Walking it
 * with the collection's noun and the one-based index produces "Component 1:
 * Quantity must be …" rather than a dotted path.
 */
function flatten(error: ValidationError, prefix: string): string[] {
  const messages: string[] = [];

  if (error.constraints) {
    const chosen = bestMessage(error.constraints, error.property);

    if (chosen) {
      messages.push(prefix ? `${prefix}: ${relabel(chosen, error.property)}` : relabel(chosen, error.property));
    }
  }

  for (const child of error.children ?? []) {
    // A numeric property is an array index, so the prefix becomes the noun of
    // the collection it came from plus the human (one-based) row number.
    const childPrefix = /^\d+$/.test(child.property)
      ? `${LINE_NOUNS[error.property] ?? labelFor(error.property)} ${Number(child.property) + 1}`
      : prefix;

    messages.push(...flatten(child, childPrefix));
  }

  return messages;
}

/**
 * Every failed constraint, as sentences, de-duplicated and terminated.
 *
 * Full stops are added here rather than in each message so the web app can join
 * them with a space and get prose, instead of the run-on it gets today.
 */
export function toReadableMessages(errors: readonly ValidationError[]): string[] {
  const messages = errors.flatMap((error) => flatten(error, ''));

  return [...new Set(messages)].map((message) =>
    /[.!?]$/.test(message) ? message : `${message}.`,
  );
}
