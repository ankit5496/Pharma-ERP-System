'use server';

import { revalidatePath } from 'next/cache';

import { DEFAULT_DIAL_CODE, joinPhoneNumber } from '@pharma-erp/types';
import type {
  BillingModel,
  BomView,
  ConversionRateBasis,
  CreateItemRequest,
  CreateJobWorkAgreementRequest,
  CreateLicenceRequest,
  JobWorkAgreementSummary,
  JobWorkMappingInput,
  CreatePackagingRequirementRequest,
  PackagingComponentRequirement,
  PackagingLevel,
  PackagingLineInput,
  PackagingQuantityBasis,
  PackagingRequirementView,
  UpdateJobWorkAgreementRequest,
  UpdatePackagingRequirementRequest,
  ItemSummary,
  ItemType,
  LicenceRegister,
  LicenceSummary,
  LicenceType,
  PartyStatus,
  PartySummary,
  PartyType,
  ScheduleClassification,
  UpdateItemRequest,
  UpdateLicenceRequest,
  UpdatePartyRequest,
} from '@pharma-erp/types';

import { apiFetch, isColdStart, COLD_START_MESSAGE, type ApiResult } from '@/lib/api';

/**
 * Writes for the master-data registers.
 *
 * Actions return `{ ok }` rather than throwing. A refusal is usually a rule
 * doing its job — a duplicate item code, a DPCO flag with no price, the wrong
 * role — and the API writes those messages to be read by the person who hit
 * them, so they are passed through verbatim rather than replaced with
 * something vaguer. The one exception is a cold start; see {@link failure}.
 */

export interface ActionResult {
  ok: boolean;
  message?: string;
  /** Kept so a rejected form can be re-rendered with what was typed. */
  values?: Record<string, string>;
}

/** Empty string means "not filled in", which is different from a value of "0". */
function optional(formData: FormData, field: string): string | undefined {
  const value = String(formData.get(field) ?? '').trim();
  return value === '' ? undefined : value;
}

/**
 * "Code is required. Party type is required." — one sentence per empty field,
 * each naming the field as its label appears on screen.
 *
 * One helper rather than a hand-written sentence per form, because the two
 * drift: the party form used to say "Code, name and party type are all
 * required", where only the first field got a capital because it happened to
 * start the sentence. QA reported exactly that. Naming each field in its own
 * sentence removes the question of which word begins a clause.
 *
 * Worded to match what the API produces for the same failure, so a person does
 * not see two different styles depending on whether the browser or the server
 * caught it.
 */
function requireFields(fields: readonly (readonly [string, unknown])[]): string | null {
  const missing = fields.filter(([, value]) => !value).map(([label]) => label);

  if (missing.length === 0) return null;

  return missing.map((label) => `${label} is required.`).join(' ');
}

type ApiFailure = Extract<ApiResult<unknown>, { ok: false }>;

/**
 * Turns a failed call into something worth reading.
 *
 * Everything the API itself refuses is a written sentence and goes through
 * untouched. A cold start is not: it is answered by the host's edge, which has
 * no instance to route to while the container boots, so it arrives as a bare
 * status. "429 Too Many Requests" then sends whoever is at the screen looking
 * for a rate limit that does not exist — this codebase has no throttler — when
 * the right response is simply to wait and press save again.
 *
 * `values` is carried through either way, so a retry does not mean retyping
 * the form.
 */
function failure(result: ApiFailure, values?: Record<string, string>): ActionResult {
  return {
    ok: false,
    message: isColdStart(result) ? COLD_START_MESSAGE : result.error,
    ...(values ? { values } : {}),
  };
}

/**
 * Creates an item, or updates one when `itemId` is given.
 *
 * One action for both because the form is the same form — bound with
 * `saveItemAction.bind(null, id)` from the edit path and
 * `.bind(null, null)` from the new one. Two near-identical actions would
 * drift in exactly the places that matter, like which fields are required.
 */
export async function saveItemAction(
  itemId: string | null,
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('brandName') ?? '').trim();
  const type = String(formData.get('category') ?? '') as ItemType;
  const uom = String(formData.get('uom') ?? '').trim();
  const hsnCode = String(formData.get('hsnCode') ?? '').trim();
  const gstRate = String(formData.get('gstRate') ?? '').trim();
  const genericName = optional(formData, 'genericName');

  // Everything typed, so a rejection does not empty the drawer. React 19
  // resets an uncontrolled form once its action resolves, so without this the
  // person retypes eleven fields to fix one.
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') values[key] = value;
  }

  // Checked here as well as on the API so the obvious omissions are answered
  // without a round trip. The API's own validation is the one that counts.
  const itemMissing = requireFields([
    ['Item code', code],
    ['Category', type],
    ['Unit of measure', uom],
    ['HSN code', hsnCode],
    ['GST rate', gstRate],
  ]);

  if (itemMissing) return { ok: false, values, message: itemMissing };

  // `name` is what every other screen shows and what the BOM picker searches,
  // so it must not be blank. A finished good is known by its brand; a raw
  // material has none and is known by its composition.
  const displayName = name || genericName;

  if (!displayName) {
    return {
      ok: false,
      values,
      message:
        'Brand name is required, or a Generic name for a material that has no brand.',
    };
  }

  const payload: CreateItemRequest = {
    code,
    name: displayName,
    type,
    uom,
    hsnCode,
    gstRate,
    scheduleClassification: (optional(formData, 'scheduleClassification') ??
      'NONE') as ScheduleClassification,
    ...(name ? { brandName: name } : {}),
    ...(genericName ? { genericName } : {}),
    ...(optional(formData, 'mrp') ? { mrp: optional(formData, 'mrp')! } : {}),
    // An unchecked checkbox is absent from FormData entirely, which is how
    // "false" is spelled in a form submission.
    dpcoCeiling: formData.get('dpcoCeiling') !== null,
    ...(optional(formData, 'storageConditions')
      ? { storageConditions: optional(formData, 'storageConditions')! }
      : {}),
    ...(optional(formData, 'shelfLifeMonths')
      ? { shelfLifeMonths: Number(optional(formData, 'shelfLifeMonths')) }
      : {}),
    ...(optional(formData, 'reorderLevel')
      ? { reorderLevel: optional(formData, 'reorderLevel')! }
      : {}),
    ...(optional(formData, 'reorderQuantity')
      ? { reorderQuantity: optional(formData, 'reorderQuantity')! }
      : {}),
  };

  // On an update the code is not sent at all — it is fixed once created, so
  // the API does not accept it. Optional fields left blank are sent as null
  // to CLEAR them, which is the difference between editing and creating: on
  // a create an empty field is simply omitted.
  const { code: _code, ...editable } = payload;

  const update = {
    ...editable,
    brandName: name || null,
    genericName: genericName ?? null,
    mrp: optional(formData, 'mrp') ?? null,
    storageConditions: optional(formData, 'storageConditions') ?? null,
    shelfLifeMonths: optional(formData, 'shelfLifeMonths')
      ? Number(optional(formData, 'shelfLifeMonths'))
      : null,
    reorderLevel: optional(formData, 'reorderLevel') ?? null,
    reorderQuantity: optional(formData, 'reorderQuantity') ?? null,
  } satisfies UpdateItemRequest;

  const result = itemId
    ? await apiFetch<ItemSummary>(`/api/v1/production/items/${itemId}`, {
        method: 'PATCH',
        authenticated: true,
        json: update,
        timeoutMs: 20_000,
      })
    : await apiFetch<ItemSummary>('/api/v1/production/items', {
        method: 'POST',
        authenticated: true,
        json: payload,
        timeoutMs: 20_000,
      });

  if (!result.ok) return failure(result, values);

  // 'layout' rather than 'page': every register route shares one layout, and
  // the grid data is fetched by the route regardless of which register is
  // open, so the change has to reach all of them.
  revalidatePath('/master-data', 'layout');

  return {
    ok: true,
    message: `${result.data.code} — ${result.data.name} ${itemId ? 'updated' : 'added'}.`,
  };
}

/**
 * Creates a party, or updates one when `partyId` is given.
 *
 * US-MD-02 lives on the API and in a CHECK constraint: an ACTIVE customer
 * must have a licence number and validity. Nothing is re-implemented here —
 * the refusal comes back as a sentence and is shown as-is.
 */
export async function savePartyAction(
  partyId: string | null,
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') values[key] = value;
  }

  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const partyType = String(formData.get('partyType') ?? '') as PartyType;
  const status = (optional(formData, 'status') ?? 'ACTIVE') as PartyStatus;

  if (!code || !name || !partyType) {
    return {
      ok: false,
      values,
      message: requireFields([
        ['Party code', code],
        ['Party name', name],
        ['Party type', partyType],
      ])!,
    };
  }

  const terms = optional(formData, 'paymentTermsDays');
  const creditPeriod = optional(formData, 'creditPeriodDays');

  // Customer-only fields are sent only for a customer. Sending a credit limit
  // against a supplier would store a receivable nobody meant to record.
  const isCustomer = partyType === 'CUSTOMER';

  const payload = {
    name,
    partyType,
    status,
    gstin: optional(formData, 'gstin')?.toUpperCase() ?? null,
    email: optional(formData, 'email') ?? null,
    // The form submits a chosen country code and a typed national number; the
    // API stores E.164 and refuses anything that is not a real number for that
    // country. Joined here rather than in the browser so a request made without
    // the form still has to supply a country code.
    phone: joinPhoneNumber(
      String(formData.get('phoneDial') ?? DEFAULT_DIAL_CODE),
      String(formData.get('phoneNational') ?? ''),
    ),
    address: optional(formData, 'address') ?? null,
    ...(terms ? { paymentTermsDays: Number(terms) } : {}),
    drugLicenceNumber: isCustomer ? (optional(formData, 'drugLicenceNumber') ?? null) : null,
    drugLicenceValidTo: isCustomer ? (optional(formData, 'drugLicenceValidTo') ?? null) : null,
    creditLimit: isCustomer ? (optional(formData, 'creditLimit') ?? null) : null,
    creditPeriodDays: isCustomer && creditPeriod ? Number(creditPeriod) : null,
  } satisfies UpdatePartyRequest;

  const result = partyId
    ? await apiFetch<PartySummary>(`/api/v1/parties/${partyId}`, {
        method: 'PATCH',
        authenticated: true,
        json: payload,
        timeoutMs: 20_000,
      })
    : await apiFetch<PartySummary>('/api/v1/parties', {
        method: 'POST',
        authenticated: true,
        // A create cannot send nulls for fields it simply has not got, so the
        // empty ones are dropped rather than cleared.
        json: Object.fromEntries(
          Object.entries({ code, ...payload }).filter(([, value]) => value !== null),
        ),
        timeoutMs: 20_000,
      });

  if (!result.ok) return failure(result, values);

  revalidatePath('/master-data', 'layout');

  return {
    ok: true,
    message: `${result.data.code} — ${result.data.name} ${partyId ? 'updated' : 'added'}.`,
  };
}

/**
 * Creates a formulation.
 *
 * Create only — there is no update endpoint, deliberately: a batch made last
 * month was made to the recipe as it stood then, so a change is a new version
 * and the old one survives because production orders still point at it. The
 * API picks the version number; nothing here chooses it.
 *
 * Raw and packing lines are two sections on screen and one `lines` array on
 * the wire, which is what the table holds. The split is a reading aid, not a
 * distinction the schema makes — an item's own type already says which it is.
 */
export async function saveBomAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') values[key] = value;
  }

  const productId = String(formData.get('productId') ?? '');
  const outputQuantity = String(formData.get('outputQuantity') ?? '').trim();

  if (!productId || !outputQuantity) {
    return {
      ok: false,
      values,
      message: requireFields([
        ['Finished product', productId],
        ['Reference batch size', outputQuantity],
      ])!,
    };
  }

  // Line fields are named `raw.<row>.itemId` / `pack.<row>.itemId`, so the
  // rows are found by walking the names rather than by guessing how many
  // there are — rows can be added and removed in any order.
  const lines: { itemId: string; quantityPer: string }[] = [];

  for (const [key, value] of formData.entries()) {
    const match = /^(raw|pack)\.(\d+)\.itemId$/.exec(key);
    if (!match || typeof value !== 'string' || !value) continue;

    const quantityPer = String(formData.get(`${match[1]}.${match[2]}.quantityPer`) ?? '').trim();

    if (!quantityPer) {
      return {
        ok: false,
        values,
        message: 'Quantity is required on every material line. Remove any line you do not want.',
      };
    }

    lines.push({ itemId: value, quantityPer });
  }

  if (lines.length === 0) {
    return {
      ok: false,
      values,
      message: 'A formulation needs at least one material — there would be nothing to issue.',
    };
  }

  // Caught here as well as by the API because the message can name the
  // duplicate, and because it is the mistake this form makes easiest: two
  // rows, same picker, different quantities.
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.itemId)) {
      return {
        ok: false,
        values,
        message:
          'A material appears on more than one line. Combine the quantities into a single line.',
      };
    }
    seen.add(line.itemId);
  }

  const result = await apiFetch<BomView>('/api/v1/production/boms', {
    method: 'POST',
    authenticated: true,
    json: {
      productId,
      outputQuantity,
      lines,
      // Absent from FormData when unticked, which is how a form spells false.
      activate: formData.get('activate') !== null,
      ...(optional(formData, 'instructions')
        ? { instructions: optional(formData, 'instructions') }
        : {}),
    },
    timeoutMs: 20_000,
  });

  if (!result.ok) return failure(result, values);

  revalidatePath('/master-data', 'layout');

  return {
    ok: true,
    message: `${result.data.product.code} v${result.data.version} saved${
      result.data.isActive ? ' and made active' : ''
    }.`,
  };
}

/**
 * Creates a licence, or updates one when `licenceId` is given — US-MD-04.
 *
 * Renewing is an UPDATE to the expiry date, not a second record: the unique
 * index is on (type, number), and a register holding the same licence twice
 * cannot say which date is the live one.
 *
 * No role check here. The API refuses anyone who is not an Admin or a Quality
 * Officer, and its refusal names the roles — repeating the rule in the web
 * layer would be a second copy to keep in step, not a second lock.
 */
export async function saveLicenceAction(
  licenceId: string | null,
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') values[key] = value;
  }

  const licenceType = String(formData.get('licenceType') ?? '') as LicenceType;
  const licenceNumber = String(formData.get('licenceNumber') ?? '').trim();
  const issuingAuthority = String(formData.get('issuingAuthority') ?? '').trim();
  const expiryDate = String(formData.get('expiryDate') ?? '').trim();
  const issuedOn = optional(formData, 'issuedOn');
  const notes = optional(formData, 'notes');

  // Answered here as well as on the API so the obvious omissions cost no round
  // trip. The API's validation is the one that counts.
  if (!licenceType || !licenceNumber || !issuingAuthority || !expiryDate) {
    return {
      ok: false,
      values,
      message: requireFields([
        ['Licence type', licenceType],
        ['Licence number', licenceNumber],
        ['Issuing authority', issuingAuthority],
        ['Expiry date', expiryDate],
      ])!,
    };
  }

  // Caught before the round trip because the two dates are right next to each
  // other on the form, and naming them beats a constraint message.
  if (issuedOn && expiryDate <= issuedOn) {
    return {
      ok: false,
      values,
      message: 'The expiry date must be after the issue date. Check the two dates.',
    };
  }

  const payload = {
    licenceType,
    licenceNumber,
    issuingAuthority,
    expiryDate,
    ...(issuedOn ? { issuedOn } : {}),
    ...(notes ? { notes } : {}),
  } satisfies CreateLicenceRequest;

  // On an update, the optional fields left blank are sent as null to CLEAR
  // them. expiryDate is never null: a licence with no expiry is invisible to
  // the alert, which is the whole point of the register.
  const update = {
    licenceType,
    licenceNumber,
    issuingAuthority,
    expiryDate,
    issuedOn: issuedOn ?? null,
    notes: notes ?? null,
  } satisfies UpdateLicenceRequest;

  const result = licenceId
    ? await apiFetch<LicenceSummary>(`/api/v1/licences/${licenceId}`, {
        method: 'PATCH',
        authenticated: true,
        json: update,
        timeoutMs: 20_000,
      })
    : await apiFetch<LicenceSummary>('/api/v1/licences', {
        method: 'POST',
        authenticated: true,
        json: payload,
        timeoutMs: 20_000,
      });

  if (!result.ok) return failure(result, values);

  revalidatePath('/master-data', 'layout');
  // The dashboard alert reads the same records, so it is stale the moment a
  // licence is added, renewed or retired.
  revalidatePath('/dashboard');

  return {
    ok: true,
    message: `${result.data.licenceNumber} ${licenceId ? 'updated' : 'added'}.`,
  };
}

/** Retires a licence. Soft delete; the database trigger refuses a real one. */
export async function deleteLicenceAction(licenceId: string): Promise<ActionResult> {
  const result = await apiFetch<void>(`/api/v1/licences/${licenceId}`, {
    method: 'DELETE',
    authenticated: true,
    timeoutMs: 20_000,
  });

  if (!result.ok) return failure(result);

  revalidatePath('/master-data', 'layout');
  revalidatePath('/dashboard');

  return { ok: true, message: 'Licence retired.' };
}

/**
 * Changes how many days before expiry this company is warned — US-MD-04's
 * "configurable number of days".
 *
 * Takes the number rather than a FormData because it is set from a small
 * control on the register rather than from a form submission.
 */
export async function setLicenceAlertAction(days: number): Promise<ActionResult> {
  const result = await apiFetch<LicenceRegister>('/api/v1/licences/alert', {
    method: 'PATCH',
    authenticated: true,
    json: { alertLeadDays: days },
    timeoutMs: 20_000,
  });

  if (!result.ok) return failure(result);

  revalidatePath('/master-data', 'layout');
  revalidatePath('/dashboard');

  return {
    ok: true,
    message: `Now warning ${result.data.alertLeadDays} days before expiry.`,
  };
}

/**
 * Creates a job-work agreement, or updates one when `agreementId` is given —
 * US-MD-05.
 *
 * The mapping lines are named `mapping.<row>.bomId` and so on, so the rows are
 * found by walking the field names rather than by guessing how many there are:
 * rows can be added and removed in any order.
 */
export async function saveAgreementAction(
  agreementId: string | null,
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') values[key] = value;
  }

  const principalId = String(formData.get('principalId') ?? '');
  const billingModel = String(formData.get('billingModel') ?? '') as BillingModel;

  // US-MD-05's first criterion, answered before the round trip. The column is
  // NOT NULL and the DTO requires it; this is only so the refusal names the
  // field instead of arriving as a validation array.
  if (!principalId || !billingModel) {
    return {
      ok: false,
      values,
      message: requireFields([
        ['Principal', principalId],
        ['Billing model', billingModel],
      ])!,
    };
  }

  const rate = optional(formData, 'conversionChargeRate');
  const basis = optional(formData, 'conversionRateBasis') as ConversionRateBasis | undefined;

  if (rate && !basis) {
    return {
      ok: false,
      values,
      message:
        'A conversion charge needs a basis — per batch, per 1,000 units, per pack or per kg.',
    };
  }

  if (!rate && basis) {
    return { ok: false, values, message: 'A rate basis was given with no rate to charge.' };
  }

  const validFrom = optional(formData, 'validFrom');
  const validTo = optional(formData, 'validTo');

  if (validFrom && validTo && validTo <= validFrom) {
    return {
      ok: false,
      values,
      message: 'The agreement cannot end on or before the day it starts. Check the two dates.',
    };
  }

  const mappings: JobWorkMappingInput[] = [];

  for (const [key, value] of formData.entries()) {
    const match = /^mapping\.(\d+)\.bomId$/.exec(key);
    if (!match || typeof value !== 'string' || !value) continue;

    const brand = String(formData.get(`mapping.${match[1]}.principalBrandName`) ?? '').trim();

    if (!brand) {
      return {
        ok: false,
        values,
        message:
          "Every mapped product needs the principal's brand name. Remove any line you do not want.",
      };
    }

    const pack = String(formData.get(`mapping.${match[1]}.packDesignRef`) ?? '').trim();

    mappings.push({
      bomId: value,
      principalBrandName: brand,
      ...(pack ? { packDesignRef: pack } : {}),
    });
  }

  // US-MD-05's second criterion: "one or more". Caught here as well as by the
  // API so the message can say what an agreement is for.
  if (mappings.length === 0) {
    return {
      ok: false,
      values,
      message:
        "An agreement must cover at least one product. Map a formulation to the principal's " +
        'brand name before saving.',
    };
  }

  // Caught here too because the message can say it plainly; the unique index
  // would answer with a constraint name.
  const seen = new Set<string>();
  for (const mapping of mappings) {
    if (seen.has(mapping.bomId)) {
      return {
        ok: false,
        values,
        message:
          'A formulation appears on more than one line. One agreement cannot bill the same ' +
          'recipe two ways.',
      };
    }
    seen.add(mapping.bomId);
  }

  const payload = {
    principalId,
    billingModel,
    mappings,
    ...(optional(formData, 'agreementReference')
      ? { agreementReference: optional(formData, 'agreementReference')! }
      : {}),
    ...(rate ? { conversionChargeRate: rate } : {}),
    ...(basis ? { conversionRateBasis: basis } : {}),
    ...(validFrom ? { validFrom } : {}),
    ...(validTo ? { validTo } : {}),
    ...(optional(formData, 'notes') ? { notes: optional(formData, 'notes')! } : {}),
  } satisfies CreateJobWorkAgreementRequest;

  // On an update the optional fields left blank are sent as null to CLEAR
  // them. `mappings` REPLACES the set — an amendment restates which products
  // are covered, and merging would make removing one impossible.
  const update = {
    principalId,
    billingModel,
    mappings,
    agreementReference: optional(formData, 'agreementReference') ?? null,
    conversionChargeRate: rate ?? null,
    conversionRateBasis: basis ?? null,
    validFrom: validFrom ?? null,
    validTo: validTo ?? null,
    notes: optional(formData, 'notes') ?? null,
  } satisfies UpdateJobWorkAgreementRequest;

  const result = agreementId
    ? await apiFetch<JobWorkAgreementSummary>(`/api/v1/job-work/agreements/${agreementId}`, {
        method: 'PATCH',
        authenticated: true,
        json: update,
        timeoutMs: 20_000,
      })
    : await apiFetch<JobWorkAgreementSummary>('/api/v1/job-work/agreements', {
        method: 'POST',
        authenticated: true,
        json: payload,
        timeoutMs: 20_000,
      });

  if (!result.ok) return failure(result, values);

  revalidatePath('/master-data', 'layout');

  return {
    ok: true,
    message: `${result.data.principalName} — agreement ${agreementId ? 'updated' : 'added'}.`,
  };
}

/** Retires an agreement. Soft delete; the database trigger refuses a real one. */
export async function deleteAgreementAction(agreementId: string): Promise<ActionResult> {
  const result = await apiFetch<void>(`/api/v1/job-work/agreements/${agreementId}`, {
    method: 'DELETE',
    authenticated: true,
    timeoutMs: 20_000,
  });

  if (!result.ok) return failure(result);

  revalidatePath('/master-data', 'layout');

  return { ok: true, message: 'Agreement retired.' };
}

/**
 * Creates a pack specification, or updates one when `requirementId` is given —
 * US-MD-06.
 *
 * Component lines are named `component.<row>.itemId` and so on, so the rows are
 * found by walking the field names rather than by guessing how many there are.
 */
export async function savePackagingAction(
  requirementId: string | null,
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') values[key] = value;
  }

  const productId = String(formData.get('productId') ?? '');
  const packVariant = String(formData.get('packVariant') ?? '').trim();
  const unitsPerPack = String(formData.get('unitsPerPack') ?? '').trim();

  if (!productId || !packVariant || !unitsPerPack) {
    return {
      ok: false,
      values,
      message: requireFields([
        ['Finished product', productId],
        ['Pack variant', packVariant],
        ['Units per pack', unitsPerPack],
      ])!,
    };
  }

  // Answered before the round trip because it is the field people get wrong,
  // and because the reason it matters is not obvious from the label alone.
  if (!(Number(unitsPerPack) > 0)) {
    return {
      ok: false,
      values,
      message:
        'Units per pack must be greater than zero — it is what scales a per-pack quantity to a batch.',
    };
  }

  const lines: PackagingLineInput[] = [];

  for (const [key, value] of formData.entries()) {
    const match = /^component\.(\d+)\.itemId$/.exec(key);
    if (!match || typeof value !== 'string' || !value) continue;

    const row = match[1];
    const level = String(formData.get(`component.${row}.level`) ?? '') as PackagingLevel;
    const quantityPer = String(formData.get(`component.${row}.quantityPer`) ?? '').trim();
    const quantityBasis = String(
      formData.get(`component.${row}.quantityBasis`) ?? '',
    ) as PackagingQuantityBasis;
    const requirement = String(
      formData.get(`component.${row}.requirement`) ?? '',
    ) as PackagingComponentRequirement;

    if (!level || !quantityBasis || !requirement) {
      return {
        ok: false,
        values,
        message:
          'Level, Charged and If short at packing are required on every component. ' +
          'Remove any line you do not want.',
      };
    }

    if (!quantityPer || !(Number(quantityPer) > 0)) {
      return {
        ok: false,
        values,
        message: 'Quantity is required on every component, and must be greater than zero.',
      };
    }

    const notes = String(formData.get(`component.${row}.notes`) ?? '').trim();

    lines.push({
      itemId: value,
      level,
      quantityPer,
      quantityBasis,
      requirement,
      ...(notes ? { notes } : {}),
    });
  }

  if (lines.length === 0) {
    return {
      ok: false,
      values,
      message: 'A pack specification needs at least one component — otherwise it specifies nothing.',
    };
  }

  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.itemId)) {
      return {
        ok: false,
        values,
        message:
          'A component appears on more than one line. Combine the quantities into a single line.',
      };
    }
    seen.add(line.itemId);
  }

  // An unchecked checkbox is absent from FormData entirely, which is how a form
  // spells false.
  const isActive = formData.get('isActive') !== null;

  const payload = {
    productId,
    packVariant,
    unitsPerPack,
    lines,
    isActive,
    ...(optional(formData, 'notes') ? { notes: optional(formData, 'notes')! } : {}),
  } satisfies CreatePackagingRequirementRequest;

  // `productId` is absent from the update: a specification is FOR a product,
  // and moving it would silently re-point every shortage check that cited it.
  const update = {
    packVariant,
    unitsPerPack,
    lines,
    isActive,
    notes: optional(formData, 'notes') ?? null,
  } satisfies UpdatePackagingRequirementRequest;

  const result = requirementId
    ? await apiFetch<PackagingRequirementView>(`/api/v1/packaging/requirements/${requirementId}`, {
        method: 'PATCH',
        authenticated: true,
        json: update,
        timeoutMs: 20_000,
      })
    : await apiFetch<PackagingRequirementView>('/api/v1/packaging/requirements', {
        method: 'POST',
        authenticated: true,
        json: payload,
        timeoutMs: 20_000,
      });

  if (!result.ok) return failure(result, values);

  revalidatePath('/master-data', 'layout');
  // The shortage panel reads the same specifications, so it is stale the
  // moment one is added, amended or retired.
  revalidatePath('/dashboard');

  return {
    ok: true,
    message: `${result.data.product.code} — ${result.data.packVariant} ${
      requirementId ? 'updated' : 'added'
    }.`,
  };
}

/** Retires a pack specification. Soft delete; the trigger refuses a real one. */
export async function deletePackagingAction(requirementId: string): Promise<ActionResult> {
  const result = await apiFetch<void>(`/api/v1/packaging/requirements/${requirementId}`, {
    method: 'DELETE',
    authenticated: true,
    timeoutMs: 20_000,
  });

  if (!result.ok) return failure(result);

  revalidatePath('/master-data', 'layout');
  revalidatePath('/dashboard');

  return { ok: true, message: 'Pack specification retired.' };
}

export async function deletePartyAction(partyId: string): Promise<ActionResult> {
  const result = await apiFetch<void>(`/api/v1/parties/${partyId}`, {
    method: 'DELETE',
    authenticated: true,
    timeoutMs: 20_000,
  });

  if (!result.ok) return failure(result);

  revalidatePath('/master-data', 'layout');

  return { ok: true, message: 'Party retired.' };
}

/**
 * Retires an item.
 *
 * Called straight from the grid rather than through a form, so it takes the
 * id and nothing else. The API refuses if a formulation still names the item,
 * and that refusal is what the caller shows.
 */
export async function deleteItemAction(itemId: string): Promise<ActionResult> {
  const result = await apiFetch<void>(`/api/v1/production/items/${itemId}`, {
    method: 'DELETE',
    authenticated: true,
    timeoutMs: 20_000,
  });

  if (!result.ok) return failure(result);

  revalidatePath('/master-data', 'layout');

  return { ok: true, message: 'Item retired.' };
}
