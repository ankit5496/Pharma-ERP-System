'use server';

import { revalidatePath } from 'next/cache';

import type {
  CreateItemRequest,
  ItemSummary,
  ItemType,
  PartyStatus,
  PartySummary,
  PartyType,
  ScheduleClassification,
  UpdateItemRequest,
  UpdatePartyRequest,
} from '@pharma-erp/types';

import { apiFetch } from '@/lib/api';

/**
 * Writes for the master-data registers.
 *
 * Actions return `{ ok }` rather than throwing. A refusal is usually a rule
 * doing its job — a duplicate item code, a DPCO flag with no price, the wrong
 * role — and the API writes those messages to be read by the person who hit
 * them, so they are passed through verbatim rather than replaced with
 * something vaguer.
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
  if (!code || !type || !uom || !hsnCode || !gstRate) {
    return {
      ok: false,
      values,
      message: 'Code, category, unit, HSN code and GST rate are all required.',
    };
  }

  // `name` is what every other screen shows and what the BOM picker searches,
  // so it must not be blank. A finished good is known by its brand; a raw
  // material has none and is known by its composition.
  const displayName = name || genericName;

  if (!displayName) {
    return {
      ok: false,
      values,
      message: 'Enter a brand name, or a generic name for a material that has no brand.',
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

  if (!result.ok) return { ok: false, message: result.error, values };

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
    return { ok: false, values, message: 'Code, name and party type are all required.' };
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
    phone: optional(formData, 'phone') ?? null,
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

  if (!result.ok) return { ok: false, message: result.error, values };

  revalidatePath('/master-data', 'layout');

  return {
    ok: true,
    message: `${result.data.code} — ${result.data.name} ${partyId ? 'updated' : 'added'}.`,
  };
}

export async function deletePartyAction(partyId: string): Promise<ActionResult> {
  const result = await apiFetch<void>(`/api/v1/parties/${partyId}`, {
    method: 'DELETE',
    authenticated: true,
    timeoutMs: 20_000,
  });

  if (!result.ok) return { ok: false, message: result.error };

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

  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath('/master-data', 'layout');

  return { ok: true, message: 'Item retired.' };
}
