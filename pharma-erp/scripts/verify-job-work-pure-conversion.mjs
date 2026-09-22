// The HealWell scenario, end to end, against the running API.
//
// ABC Pharma makes 100,000 HealCure-500 tablets for HealWell Pharmaceuticals
// under a Pure Conversion agreement at Rs 0.15 a tablet. HealWell supplies the
// raw material; ABC bills the conversion and nothing else.
//
// Every assertion here is about a DATABASE FACT, not a screen: what ownership
// the stock carries, which bucket the issue drew from, what the invoice was
// raised on, what the register derives. The twelve negative cases are run
// against the API directly, because "the form does not offer it" and "the
// server refuses it" are different claims and only the second one is a rule.
//
// RUN IT:  pnpm verify:job-work         (pure conversion — the HealWell case)
//          pnpm verify:job-work:own     (own procurement — the other model)
//
// Needs the API running (pnpm dev). Signs in as JOB_WORK_TEST_EMAIL /
// JOB_WORK_TEST_PASSWORD, defaulting to the shared dev admin. Everything is
// created fresh under a timestamped suffix, so it can be run repeatedly without
// colliding with its own earlier runs.
//
// IT WRITES TO WHICHEVER COMPANY THAT ACCOUNT BELONGS TO. Point it at another
// tenant by setting those two variables to a user of that tenant.

const API = process.env.JOB_WORK_TEST_API ?? 'http://localhost:4000/api/v1';
const ADMIN = {
  email: process.env.JOB_WORK_TEST_EMAIL ?? 'admin@devanshu.test',
  password: process.env.JOB_WORK_TEST_PASSWORD ?? 'render-shared-dev-2026-b',
};

let failures = 0;
const check = (n, ok, d = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : `  <- ${d}`}`);
};
const section = (t) => console.log(`\n${'='.repeat(4)} ${t} ${'='.repeat(4)}`);
const note = (t) => console.log(`      ${t}`);

const login = async (email, password) => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await r.json();
  if (!body.accessToken) throw new Error(`login failed for ${email}: ${JSON.stringify(body)}`);
  return body.accessToken;
};

const admin = await login(ADMIN.email, ADMIN.password);

const call = (token) => async (path, init = {}) => {
  const r = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await r.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: r.status, body };
};

const api = call(admin);

/** These endpoints return a bare array; the procurement ones return {rows}. */
const rowsOf = (body) => (Array.isArray(body) ? body : (body?.rows ?? []));
const must = async (path, init, what) => {
  const r = await api(path, init);
  if (r.status >= 400) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

const tag = Date.now().toString().slice(-6);

// ---------------------------------------------------------------------------
// Role users, so the role rules are exercised by the roles that hold them.
// ---------------------------------------------------------------------------
const users = (await api('/users')).body;
const userRows = rowsOf(users);

const ensureUser = async (role, prefix) => {
  const existing = userRows.find((u) => u.role === role);
  const password = `JW-${tag}-Role!x`;

  if (existing) {
    await must(`/users/${existing.id}/reset-password`, {
      method: 'POST',
      body: { temporaryPassword: password },
    }, `reset ${role}`);
    return { email: existing.email, password };
  }

  const created = await must('/users', {
    method: 'POST',
    body: {
      email: `${prefix}-${tag}@devanshu.test`,
      fullName: `${role} ${tag}`,
      role,
      temporaryPassword: password,
    },
  }, `create ${role}`);

  return { email: created.email, password };
};

const storeUser = await ensureUser('STORE_OFFICER', 'store');
const qcUser = await ensureUser('QUALITY_OFFICER', 'qc');
const prodUser = await ensureUser('PRODUCTION_OFFICER', 'prod');

/**
 * Signs in on a temporary password and changes it, the way the product
 * requires: a reset password is must-change, and every other route answers 403
 * until it has been. Returns a caller already holding the settled token.
 */
const signIn = async (user) => {
  const settled = `${user.password}-ok`;
  const first = await login(user.email, user.password);

  const changed = await fetch(`${API}/auth/change-password`, {
    method: 'POST',
    headers: { authorization: `Bearer ${first}`, 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword: user.password, newPassword: settled }),
  });

  if (changed.status >= 400) {
    throw new Error(`change-password ${user.email}: ${changed.status} ${await changed.text()}`);
  }

  return call(await login(user.email, settled));
};

const store = await signIn(storeUser);
const quality = await signIn(qcUser);
const production = await signIn(prodUser);

note(`roles ready: store=${storeUser.email} qc=${qcUser.email} prod=${prodUser.email}`);

// ---------------------------------------------------------------------------
section('SETUP — the principal, the materials, the product and its BOM');
// ---------------------------------------------------------------------------

const parties = (await api('/parties')).body;
const partyRows = rowsOf(parties);

let healwell = partyRows.find(
  (p) => p.partyType === 'JOB_WORK_PRINCIPAL' && /healwell/i.test(p.name),
);

if (!healwell) {
  healwell = await must('/parties', {
    method: 'POST',
    body: {
      code: `PRIN-HW-${tag}`,
      name: 'HealWell Pharmaceuticals',
      partyType: 'JOB_WORK_PRINCIPAL',
      gstin: '27AAHCH1234R1ZQ',
      address: 'Plot 14, MIDC, Pune 411019',
      paymentTermsDays: 30,
    },
  }, 'create principal');
}

note(`principal: ${healwell.name} (${healwell.code})`);
check('  the principal is a JOB_WORK_PRINCIPAL party, not a duplicate register',
  healwell.partyType === 'JOB_WORK_PRINCIPAL', healwell.partyType);

const makeItem = async (spec) => {
  const existing = (await api(`/production/items?search=${spec.code}`)).body;
  const rows = rowsOf(existing);
  const found = rows.find((i) => i.code === spec.code);

  if (found) return found;

  return must('/production/items', { method: 'POST', body: spec }, `create item ${spec.code}`);
};

const api1 = await makeItem({
  code: `RM-PARA-${tag}`,
  name: 'Paracetamol API',
  type: 'RAW_MATERIAL',
  uom: 'KG',
  hsnCode: '29242930',
  gstRate: '12',
  genericName: 'Paracetamol',
  shelfLifeMonths: 36,
});

const lactose = await makeItem({
  code: `RM-LAC-${tag}`,
  name: 'Lactose',
  type: 'RAW_MATERIAL',
  uom: 'KG',
  hsnCode: '17021900',
  gstRate: '5',
  genericName: 'Lactose monohydrate',
  shelfLifeMonths: 36,
});

const magStearate = await makeItem({
  code: `RM-MGS-${tag}`,
  name: 'Magnesium Stearate',
  type: 'RAW_MATERIAL',
  uom: 'KG',
  hsnCode: '29159070',
  gstRate: '18',
  genericName: 'Magnesium stearate',
  shelfLifeMonths: 24,
});

const healcure = await makeItem({
  code: `FG-HC500-${tag}`,
  name: 'HealCure-500',
  type: 'FINISHED_GOOD',
  uom: 'NOS',
  hsnCode: '30049099',
  gstRate: '12',
  genericName: 'Paracetamol 500 mg tablets',
  brandName: 'HealCure-500',
  shelfLifeMonths: 24,
});

note(`materials: ${api1.code}, ${lactose.code}, ${magStearate.code}`);
note(`product  : ${healcure.code} (${healcure.name}), GST ${healcure.gstRate}%`);

// A BOM for 100,000 tablets: the recipe the principal is buying.
const bom = await must('/production/boms', {
  method: 'POST',
  body: {
    productId: healcure.id,
    outputQuantity: '100000',
    activate: true,
    instructions: 'Direct compression. Blend, compress, de-dust, inspect.',
    lines: [
      { itemId: api1.id, quantityPer: '50', notes: '500 mg per tablet' },
      { itemId: lactose.id, quantityPer: '30' },
      { itemId: magStearate.id, quantityPer: '1' },
    ],
  },
}, 'create BOM');

note(`BOM ${bom.version ?? ''} for ${bom.outputQuantity} tablets, ${bom.lines.length} lines`);

// A pack specification, because production refuses a work order without one.
const carton = await makeItem({
  code: `PM-CTN-${tag}`,
  name: 'HealCure-500 carton 10x10',
  type: 'PACKING_MATERIAL',
  uom: 'NOS',
  hsnCode: '48191010',
  gstRate: '18',
  genericName: 'Printed folding carton',
});

const packaging = await must('/packaging/requirements', {
  method: 'POST',
  body: {
    productId: healcure.id,
    packVariant: '10 x 10 blister carton',
    unitsPerPack: '100',
    isActive: true,
    lines: [
      {
        itemId: carton.id,
        level: 'SECONDARY',
        quantityPer: '1',
        quantityBasis: 'PER_PACK',
        requirement: 'MANDATORY',
      },
    ],
  },
}, 'packaging requirement');

note(`pack: ${packaging.packVariant}, ${packaging.unitsPerPack} tablets per carton`);

// ---------------------------------------------------------------------------
section('POINT 1 — JOB-WORK AGREEMENT');
// ---------------------------------------------------------------------------

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const plusYears = (n) => {
  const d = new Date(today);
  d.setFullYear(d.getFullYear() + n);
  return d;
};

const agreement = await must('/job-work/agreements', {
  method: 'POST',
  body: {
    principalId: healwell.id,
    billingModel: 'PURE_CONVERSION',
    conversionChargeRate: '0.15',
    conversionRateBasis: 'PER_UNIT',
    validFrom: iso(today),
    validTo: iso(plusYears(1)),
    notes: 'HealCure-500 contract manufacturing. Principal supplies all raw material.',
    mappings: [{ bomId: bom.id, principalBrandName: 'HealCure-500' }],
  },
}, 'create agreement');

note(`agreement ${agreement.agreementReference}: ${agreement.billingModel} @ ${agreement.conversionChargeRate} ${agreement.conversionRateBasis}`);

check('  the agreement holds the billing model', agreement.billingModel === 'PURE_CONVERSION',
  agreement.billingModel);
check('  the conversion rate is Rs 0.15 per unit',
  Number(agreement.conversionChargeRate) === 0.15 && agreement.conversionRateBasis === 'PER_UNIT',
  `${agreement.conversionChargeRate} ${agreement.conversionRateBasis}`);
check('  RULE 1 — it is in force today', agreement.status === 'IN_FORCE',
  JSON.stringify({ status: agreement.status }));
check('  the product mapping links the BOM to the principal brand',
  agreement.mappings?.[0]?.principalBrandName === 'HealCure-500',
  JSON.stringify(agreement.mappings));

const mappingId = agreement.mappings[0].id;

// ---------------------------------------------------------------------------
section('POINT 2 — JOB-WORK ORDER (billing model auto-inherited)');
// ---------------------------------------------------------------------------

const deliveryDate = new Date(today);
deliveryDate.setMonth(deliveryDate.getMonth() + 2);

const order = await must('/job-work/orders', {
  method: 'POST',
  body: {
    principalId: healwell.id,
    mappingId,
    quantity: '100000',
    deliveryDate: iso(deliveryDate),
    notes: 'HealCure-500, 100,000 tablets.',
  },
}, 'create job-work order');

note(`order ${order.orderNumber}: ${order.quantity} of ${order.principalBrandName ?? healcure.name}`);

check('  RULE 3 — the billing model is inherited from the agreement',
  order.billingModel === 'PURE_CONVERSION', order.billingModel);
check('  the order is linked to the agreement',
  order.agreementId === agreement.id || order.agreement?.id === agreement.id,
  JSON.stringify({ a: order.agreementId, b: order.agreement?.id }));
check('  the order is linked to the principal',
  order.principalId === healwell.id || order.principal?.id === healwell.id,
  JSON.stringify({ a: order.principalId, b: order.principal?.id }));

// RULE 4 — the billing model is not a field a user may send.
const tamper = await api(`/job-work/orders/${order.id}`, {
  method: 'PATCH',
  body: { billingModel: 'OWN_PROCUREMENT' },
});
check('  RULE 4 — an order cannot have its billing model changed',
  tamper.status === 400, `${tamper.status} ${JSON.stringify(tamper.body?.message)}`);

// No stock has moved yet.
const ledgerBefore = (await api('/production/stock-lots')).body;
const lotsBefore = rowsOf(ledgerBefore).filter(
  (l) => l.jobWorkOrderId === order.id || l.jobWorkOrder?.id === order.id,
);
check('  no inventory transaction yet — the order is only a request',
  lotsBefore.length === 0, `${lotsBefore.length} lots already`);

// ---------------------------------------------------------------------------
section('POINT 3 — MATERIAL RECEIPT (principal-owned, no purchase)');
// ---------------------------------------------------------------------------

const invoicesBefore = (await api('/procurement/invoices')).body.total;
const posBefore = (await api('/procurement/purchase-orders')).body.total;
const grnsBefore = (await api('/procurement/goods-receipts')).body.total;

const challan = `DC-HW-${tag}`;

// THE WHOLE CHALLAN IN ONE REQUEST, which is how it arrives: three materials
// on one document, recorded together or not at all.
const delivered = [
  [api1, '60', `HW-API-${tag}`],
  [lactose, '40', `HW-LAC-${tag}`],
  [magStearate, '2', `HW-MGS-${tag}`],
];

const challanResponse = await store('/job-work/material-receipts', {
  method: 'POST',
  body: {
    jobWorkOrderId: order.id,
    deliveryChallanNumber: challan,
    receiptDate: iso(today),
    // NO qcRequired FIELD. Every consignment now passes the incoming gate —
    // the checkbox that used to make it optional was withdrawn on 2026-09-21,
    // and the API rejects the field rather than ignoring it.
    lines: delivered.map(([item, quantity, batch]) => ({
      itemId: item.id,
      batchNumber: batch,
      receivedQuantity: quantity,
      manufacturingDate: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      expiryDate: iso(plusYears(2)),
    })),
  },
});

if (challanResponse.status >= 400) {
  throw new Error(`challan: ${challanResponse.status} ${JSON.stringify(challanResponse.body)}`);
}

const receipt = challanResponse.body;

for (const [item, quantity, batch] of delivered) {
  note(`received ${quantity} ${item.uom} ${item.name} on batch ${batch}`);
}

check('  one receipt carries all three materials',
  receipt.lines?.length === 3 && receipt.lines.every((line) => line.deliveryChallanNumber === challan),
  JSON.stringify({ challans: receipt.lines?.map((l) => l.deliveryChallanNumber), lines: receipt.lines?.length }));
check('  and it starts as a draft, awaiting the store’s submission',
  receipt.status === 'DRAFT',
  JSON.stringify({ status: receipt.status }));

const receipts = receipt.lines ?? [];

// The materials offered are the ones the formulation calls for — not the
// whole item master, and not a list typed into the screen.
const expected = (await api(`/job-work/orders/${order.id}/materials`)).body;

check('  the order knows which materials it expects, from its own BOM and pack',
  Array.isArray(expected) && expected.length >= delivered.length &&
    expected.some((m) => m.kind === 'RAW') && expected.some((m) => m.kind === 'PACKING'),
  JSON.stringify(expected?.map?.((m) => [m.item.code, m.kind])));
check('  and every material received is one of them',
  Array.isArray(expected) &&
    delivered.every(([item]) => expected.some((m) => m.item.id === item.id)),
  JSON.stringify(expected?.map?.((m) => m.item.code)));

// A material the formulation does not list is refused, so the form's list is
// a rule rather than a convenience.
const strangerMaterial = await store('/job-work/material-receipts', {
  method: 'POST',
  body: {
    jobWorkOrderId: order.id,
    deliveryChallanNumber: `DC-HW-X-${tag}`,
    lines: [{ itemId: healcure.id, batchNumber: `X-${tag}`, receivedQuantity: '1' }],
  },
});

check("  a material outside the formulation is REFUSED", strangerMaterial.status === 400,
  `${strangerMaterial.status} ${JSON.stringify(strangerMaterial.body)}`);
check('  the receipt number is system-generated',
  /^[A-Z]+-\d{4}-\d+$/.test(receipt.receiptNumber ?? ''), receipt.receiptNumber);

// NOT A PURCHASE.
check('  no purchase order was created',
  (await api('/procurement/purchase-orders')).body.total === posBefore, 'a PO appeared');
check('  no goods receipt note was created',
  (await api('/procurement/goods-receipts')).body.total === grnsBefore, 'a GRN appeared');
check('  no purchase invoice was created',
  (await api('/procurement/invoices')).body.total === invoicesBefore, 'an invoice appeared');

// PRINCIPAL-OWNED INVENTORY.
const lotsAfter = (await api('/production/stock-lots')).body;
const lotRows = rowsOf(lotsAfter);
const byBatch = (batch) => lotRows.find((l) => l.vendorBatchNumber === batch);

const principalLots = [`HW-API-${tag}`, `HW-LAC-${tag}`, `HW-MGS-${tag}`]
  .map(byBatch)
  .filter(Boolean);

const apiLot = byBatch(`HW-API-${tag}`);

check('  the received material became three stock lots',
  principalLots.length === 3, `${principalLots.length} lots matched`);
check('  and the listing names the principal whose material it is',
  principalLots.every((l) => l.principalName === 'HealWell Pharmaceuticals'),
  JSON.stringify(principalLots.map((l) => l.principalName)));
check('  RULE 5/6 — the stock is PRINCIPAL_OWNED',
  apiLot?.ownership === 'PRINCIPAL_OWNED', JSON.stringify(apiLot?.ownership));
check('  the lot carries the principal’s own batch number from the challan',
  apiLot?.vendorBatchNumber === `HW-API-${tag}`, JSON.stringify(apiLot?.vendorBatchNumber));

// ---------------------------------------------------------------------------
section('INCOMING QC — the principal\u2019s material passes the same gate');
// ---------------------------------------------------------------------------

const readiness = async (batchSize) =>
  (await api(`/job-work/orders/${order.id}/readiness${batchSize ? `?batchSize=${batchSize}` : ''}`))
    .body;

const quarantined = await readiness();

check('  every material arrived in quarantine',
  principalLots.every((l) => l.status === 'QUARANTINE'),
  JSON.stringify(principalLots.map((l) => l.status)));
check('  so the readiness check says the order is NOT ready',
  quarantined.ready === false, JSON.stringify(quarantined.ready));
check('  and it says why: the quantity is awaiting QC, not missing',
  quarantined.lines.every((line) => Number(line.quantityAwaitingQc) > 0),
  JSON.stringify(quarantined.lines.map((l) => [l.item.code, l.quantityAwaitingQc])));
check('  eligible is zero while it sits there',
  quarantined.lines.every((line) => Number(line.eligibleQuantity) === 0),
  JSON.stringify(quarantined.lines.map((l) => l.eligibleQuantity)));
check('  but the received quantity is still reported',
  quarantined.lines.every((line) => Number(line.receivedQuantity) > 0),
  JSON.stringify(quarantined.lines.map((l) => l.receivedQuantity)));

// A work order raised now must be refused, on those same figures.
const tooEarly = await production(`/production/orders`, {
  method: 'POST',
  body: {
    productId: healcure.id,
    plannedQuantity: '100000',
    jobWorkOrderId: order.id,
    plannedStartOn: iso(today),
  },
});

check('  a work order on quarantined material is REFUSED',
  tooEarly.status >= 400, `${tooEarly.status}`);
note(`refusal: ${JSON.stringify(tooEarly.body?.message)}`);

// JOB WORK HAS ITS OWN GATE. The consignment used to be cleared drum by drum
// on the procurement incoming-QC queue; since 2026-09-21 the store says the
// delivery is completely recorded ("Send for approval") and a quality user
// approves or refuses the whole consignment. The rule being tested is the
// same one: nothing the principal sent may be used until quality has cleared
// it.
const findReceipt = async () =>
  rowsOf((await api('/job-work/material-receipts')).body).find((r) => r.id === receipt.id);

// The quality user cannot approve what the store has not submitted.
const undecided = await quality(`/job-work/material-receipts/${receipt.id}/decision`, {
  method: 'POST',
  body: { decision: 'APPROVED', testReference: `COA-${tag}` },
});

check('  a consignment cannot be approved before it is submitted',
  undecided.status >= 400, `${undecided.status}`);

const submitted = await store(`/job-work/material-receipts/${receipt.id}/submit`, {
  method: 'POST',
});

if (submitted.status >= 400) {
  throw new Error(`submit: ${submitted.status} ${JSON.stringify(submitted.body)}`);
}

check('  the store sends the consignment for approval',
  submitted.body?.status === 'PENDING_APPROVAL', JSON.stringify(submitted.body?.status));

// SENDING FOR APPROVAL IS NOT APPROVING. The material is still quarantined.
const stillHeld = await readiness();

check('  submitting it does not release the material',
  stillHeld.ready === false, JSON.stringify(stillHeld.blockedReason));

const decided = await quality(`/job-work/material-receipts/${receipt.id}/decision`, {
  method: 'POST',
  body: { decision: 'APPROVED', testReference: `COA-${tag}`, notes: 'Conforms.' },
});

if (decided.status >= 400) {
  throw new Error(`decision: ${decided.status} ${JSON.stringify(decided.body)}`);
}

const afterQc = await findReceipt();

check('  approving the consignment clears it',
  afterQc?.status === 'APPROVED', JSON.stringify(afterQc?.status));
check('  and every line now reports its lot usable',
  afterQc?.lines?.every((line) => line.lotStatus === 'USABLE'),
  JSON.stringify(afterQc?.lines?.map((l) => l.lotStatus)));
check('  the decision is attributed and dated',
  Boolean(afterQc?.decidedBy) && Boolean(afterQc?.decidedAt),
  JSON.stringify({ by: afterQc?.decidedBy, at: afterQc?.decidedAt }));

const ready = await readiness();

check('  the readiness check now says READY',
  ready.ready === true, JSON.stringify(ready.blockedReason));
check('  eligible matches what was received',
  ready.lines.every((line) => Number(line.eligibleQuantity) === Number(line.receivedQuantity)),
  JSON.stringify(ready.lines.map((l) => [l.item.code, l.receivedQuantity, l.eligibleQuantity])));
check('  and nothing is short',
  ready.lines.every((line) => Number(line.shortageQuantity) === 0),
  JSON.stringify(ready.lines.map((l) => l.shortageQuantity)));

// RULE 13: enough is enough, not exactly enough. Lactose was over-received
// (40 kg against 30 required) and that is a pass, not a discrepancy.
const lactoseLine = ready.lines.find((line) => line.item.id === lactose.id);

check('  RULE 13 — an EXCESS receipt is ready, not a mismatch',
  lactoseLine && Number(lactoseLine.eligibleQuantity) > Number(lactoseLine.requiredQuantity) &&
    lactoseLine.ready === true,
  JSON.stringify(lactoseLine));

// And a batch size nothing could cover is short, on the same figures.
const oversized = await readiness('1000000');

check('  ten times the batch size is short on every material',
  oversized.ready === false && oversized.lines.every((line) => Number(line.shortageQuantity) > 0),
  JSON.stringify(oversized.lines.map((l) => [l.item.code, l.shortageQuantity])));
check('  and the refusal names required, available and shortage',
  /required .* available .* short /.test(oversized.blockedReason ?? ''),
  JSON.stringify(oversized.blockedReason));

// ---------------------------------------------------------------------------
section('ABC-OWNED STOCK OF THE SAME MATERIAL (the bucket test needs both)');
// ---------------------------------------------------------------------------

// ABC buys its own lactose, through the real purchase flow, so the two buckets
// hold the same item at the same time.
const vendors = (await api('/parties?partyType=VENDOR')).body;
const vendorRows = rowsOf(vendors).filter((p) => p.partyType === 'VENDOR');
const vendor = vendorRows[0];

let abcLactoseLot = null;

if (vendor) {
  // A purchase order line must come from an approved requisition — the
  // procurement module's own rule, followed rather than worked around.
  const requisition = await must('/procurement/requisitions', {
    method: 'POST',
    body: {
      itemId: lactose.id,
      requiredQuantity: '25',
      preferredVendorId: vendor.id,
      notes: 'ABC’s own lactose, for the ownership test.',
    },
  }, 'ABC requisition');

  const approved = await api(`/procurement/requisitions/${requisition.id}/status`, {
    method: 'POST',
    body: { status: 'APPROVED' },
  });

  if (approved.status >= 400) {
    note(`could not approve requisition: ${approved.status} ${JSON.stringify(approved.body?.message)}`);
  }

  const po = await must('/procurement/purchase-orders', {
    method: 'POST',
    body: {
      vendorId: vendor.id,
      lines: [
        {
          itemId: lactose.id,
          quantity: '25',
          rate: '90',
          taxRatePercent: '5',
          requisitionId: requisition.id,
        },
      ],
    },
  }, 'ABC purchase order');

  const placed = await api(`/procurement/purchase-orders/${po.id}/submit`, { method: 'POST' });
  if (placed.status >= 400) {
    await api(`/procurement/purchase-orders/${po.id}`, {
      method: 'PATCH',
      body: { status: 'OPEN' },
    });
  }

  const grn = await store('/procurement/goods-receipts', {
    method: 'POST',
    body: {
      purchaseOrderId: po.id,
      lines: [
        {
          purchaseOrderLineId: po.lines[0].id,
          quantityReceived: '25',
          vendorBatchNumber: `ABC-LAC-${tag}`,
          manufacturingDate: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
          expiryDate: iso(plusYears(2)),
        },
      ],
    },
  });

  if (grn.status < 400) {
    const lotId = grn.body.lines[0]?.lot?.id;
    const qcLot = lotId
      ? await quality(`/procurement/qc/lots/${lotId}/decision`, {
          method: 'POST',
          body: { decision: 'ACCEPTED', testReference: `QC-${tag}`, remarks: 'Conforms.' },
        })
      : { status: 500 };

    const refreshed = (await api('/production/stock-lots')).body;
    abcLactoseLot = rowsOf(refreshed).find(
      (l) => l.vendorBatchNumber === `ABC-LAC-${tag}`,
    );

    note(`ABC-owned lactose lot ${abcLactoseLot?.lotNumber} (${abcLactoseLot?.ownership}), QC ${qcLot.status}`);
  } else {
    note(`could not book ABC lactose: ${grn.status} ${JSON.stringify(grn.body?.message)}`);
  }
}

check('  ABC-owned lactose exists alongside HealWell lactose',
  abcLactoseLot?.ownership === 'COMPANY_OWNED',
  JSON.stringify({ ownership: abcLactoseLot?.ownership }));

// ---------------------------------------------------------------------------
section('POINT 4 — MANUFACTURING (work order, BMR, BPR)');
// ---------------------------------------------------------------------------

const productionOrder = await production('/production/orders', {
  method: 'POST',
  body: {
    productId: healcure.id,
    plannedQuantity: '100000',
    plannedStartOn: iso(today),
    jobWorkOrderId: order.id,
  },
});

if (productionOrder.status >= 400) {
  throw new Error(`work order: ${productionOrder.status} ${JSON.stringify(productionOrder.body)}`);
}

const wo = productionOrder.body;
note(`work order ${wo.orderNumber}: ${wo.plannedQuantity} of ${healcure.name}`);

check('  RULE 10 — the work order is the normal production order, tagged as job work',
  wo.jobWork?.jobWorkOrderId === order.id, JSON.stringify(wo.jobWork));
check('  the work order names the principal, the agreement and their order',
  wo.jobWork?.principalName === 'HealWell Pharmaceuticals' &&
    Boolean(wo.jobWork?.agreementId) &&
    wo.jobWork?.orderNumber === order.orderNumber,
  JSON.stringify(wo.jobWork));
check('  RULE 3 — the work order carries the inherited billing model',
  wo.jobWork?.billingModel === 'PURE_CONVERSION', wo.jobWork?.billingModel);

// --- RULE 9: the wrong bucket is refused -----------------------------------
if (abcLactoseLot) {
  const wrongBucket = await store(`/production/orders/${wo.id}/issue`, {
    method: 'POST',
    body: {
      overrides: [
        { itemId: lactose.id, lotId: abcLactoseLot.id, quantity: '1', reason: 'testing the gate' },
      ],
    },
  });

  check('  RULE 9 — issuing ABC-owned stock to a Pure Conversion order is BLOCKED',
    wrongBucket.status >= 400, `${wrongBucket.status}`);
  check('  and the refusal explains the bucket',
    /principal|ownership|job.?work/i.test(JSON.stringify(wrongBucket.body?.message ?? '')),
    JSON.stringify(wrongBucket.body?.message));
  note(`refusal: ${JSON.stringify(wrongBucket.body?.message)}`);
}

// --- the correct issue ------------------------------------------------------
const issue = await store(`/production/orders/${wo.id}/issue`, { method: 'POST', body: {} });

if (issue.status >= 400) {
  throw new Error(`material issue: ${issue.status} ${JSON.stringify(issue.body)}`);
}

note(`material issue ${issue.body.issueNumber}, ${issue.body.lines.length} lines`);

// The issue view names lots by number, so the ownership is read back off the
// stock listing by the same key.
const issuedLotNumbers = issue.body.lines.map((l) => l.lotNumber);
const allLots = (await api('/production/stock-lots')).body;
const allLotRows = rowsOf(allLots);
const issuedLots = allLotRows.filter((l) => issuedLotNumbers.includes(l.lotNumber));

check('  RULE 7 — every issued lot is PRINCIPAL_OWNED',
  issuedLots.length > 0 && issuedLots.every((l) => l.ownership === 'PRINCIPAL_OWNED'),
  JSON.stringify(issuedLots.map((l) => `${l.lotNumber}:${l.ownership}`)));
check('  and none of ABC’s own stock was drawn',
  !issuedLotNumbers.includes(abcLactoseLot?.lotNumber), 'ABC lactose was consumed');
check('  every issued lot belongs to HealWell',
  issuedLots.every((l) => l.principalName === 'HealWell Pharmaceuticals'),
  JSON.stringify(issuedLots.map((l) => l.principalName)));

// --- BMR --------------------------------------------------------------------
const batch = await production('/production/batches', {
  method: 'POST',
  body: {
    productionOrderId: wo.id,
    actualQuantity: '100000',
    manufacturedOn: iso(today),
  },
});

if (batch.status >= 400) throw new Error(`BMR: ${batch.status} ${JSON.stringify(batch.body)}`);

const bmr = batch.body;
note(`BMR batch ${bmr.batchNumber}: ${bmr.actualQuantity} tablets`);

check('  the BMR records the actual quantity made', Number(bmr.actualQuantity) === 100000,
  bmr.actualQuantity);
check('  the BMR traces to the job-work order through its production order',
  bmr.productionOrderId === wo.id || bmr.productionOrder?.id === wo.id,
  JSON.stringify({ a: bmr.productionOrderId, b: bmr.productionOrder?.id }));

// --- BPR --------------------------------------------------------------------
const packing = await production(`/production/batches/${bmr.id}/packing`, {
  method: 'POST',
  body: { packedQuantity: '100000' },
});

if (packing.status >= 400) throw new Error(`BPR: ${packing.status} ${JSON.stringify(packing.body)}`);

note(`BPR: ${packing.body.packedQuantity ?? packing.body.packingRecord?.packedQuantity} packed`);
check('  RULE 10 — the BPR is the existing packing record, 100,000 packed',
  Number(packing.body.packedQuantity ?? packing.body.packingRecord?.packedQuantity) === 100000,
  JSON.stringify(packing.body).slice(0, 200));

// ---------------------------------------------------------------------------
section('POINT 5 — QUALITY GATE');
// ---------------------------------------------------------------------------

// RULES 12-14: dispatch is blocked before release.
const earlyDispatch = await api('/job-work/dispatches', {
  method: 'POST',
  body: { jobWorkOrderId: order.id, batchId: bmr.id, dispatchedQuantity: '100000' },
});

check('  RULE 14 — dispatch before release is BLOCKED',
  earlyDispatch.status >= 400, `${earlyDispatch.status}`);
note(`refusal: ${JSON.stringify(earlyDispatch.body?.message)}`);

// The store officer must not be able to release: the gate belongs to Quality.
// ADMIN is deliberately allowed alongside them — the decision is audited and
// attributed either way — so the admin is not the case that proves the rule.
const storeRelease = await store(`/production/batches/${bmr.id}/release`, {
  method: 'POST',
  body: { decision: 'RELEASED' },
});
check('  RULE 11 — the gate is the existing one, and it is the Quality Officer’s',
  storeRelease.status === 403, `${storeRelease.status}`);

const released = await quality(`/production/batches/${bmr.id}/release`, {
  method: 'POST',
  body: { decision: 'RELEASED', notes: 'Assay and dissolution conform. Released.' },
});

if (released.status >= 400) {
  throw new Error(`release: ${released.status} ${JSON.stringify(released.body)}`);
}

note(`quality decision: ${released.body.releaseStatus} by ${released.body.releaseDecidedBy}`);
check('  the batch is Released', released.body.releaseStatus === 'RELEASED',
  released.body.releaseStatus);
check('  and the decision is attributed and dated',
  Boolean(released.body.releaseDecidedBy) && Boolean(released.body.releaseDecidedAt),
  JSON.stringify({ by: released.body.releaseDecidedBy, at: released.body.releaseDecidedAt }));

// --- finished goods ledger ---------------------------------------------------
const fg = (await api('/production/finished-goods')).body;
const fgRows = rowsOf(fg);
const fgLot = fgRows.find((l) => l.batchNumber === bmr.batchNumber || l.batch?.id === bmr.id);

note(`finished goods: ${fgLot?.quantityAvailable ?? '?'} available on ${fgLot?.batchNumber ?? '?'}`);
check('  the released batch is in the finished-goods ledger',
  Number(fgLot?.quantityAvailable) === 100000, JSON.stringify(fgLot));

// ---------------------------------------------------------------------------
section('POINT 6 — DISPATCH AND JOB-WORK INVOICE');
// ---------------------------------------------------------------------------

const dispatchable = (await api(`/job-work/orders/${order.id}/dispatchable`)).body;
check('  the released batch is offered for dispatch',
  dispatchable.some((b) => b.batchId === bmr.id || b.id === bmr.id),
  JSON.stringify(dispatchable).slice(0, 200));

// RULE 11 of the negative list: over-dispatch.
const tooMuch = await api('/job-work/dispatches', {
  method: 'POST',
  body: { jobWorkOrderId: order.id, batchId: bmr.id, dispatchedQuantity: '100001' },
});
check('  dispatching more than the released stock is BLOCKED',
  tooMuch.status >= 400, `${tooMuch.status} ${JSON.stringify(tooMuch.body?.message)}`);

// RULE 15: a request naming the wrong basis is refused, not honoured.
const wrongBasis = await api('/job-work/dispatches', {
  method: 'POST',
  body: {
    jobWorkOrderId: order.id,
    batchId: bmr.id,
    dispatchedQuantity: '100000',
    invoiceBasis: 'FULL_FINISHED_GOODS_VALUE',
  },
});
check('  RULE 15 — a dispatch naming an invoice basis is REJECTED',
  wrongBasis.status === 400, `${wrongBasis.status} ${JSON.stringify(wrongBasis.body?.message)}`);

const dispatch = await api('/job-work/dispatches', {
  method: 'POST',
  body: {
    jobWorkOrderId: order.id,
    batchId: bmr.id,
    dispatchedQuantity: '100000',
    dispatchDate: iso(today),
    notes: 'Full order, one consignment.',
  },
});

if (dispatch.status >= 400) {
  throw new Error(`dispatch: ${dispatch.status} ${JSON.stringify(dispatch.body)}`);
}

const invoice = dispatch.body;
note(`invoice ${invoice.invoiceNumber}: basis ${invoice.invoiceBasis}`);
note(`  rate ${invoice.rateApplied} ${invoice.rateBasis} x 100,000`);
check('  the rate applied is the agreement’s Rs 0.15 per unit',
  Number(invoice.rateApplied) === 0.15 && invoice.rateBasis === 'PER_UNIT',
  `${invoice.rateApplied} ${invoice.rateBasis}`);
note(`  taxable ${invoice.taxableValue}, GST ${invoice.gstRatePercent}% = ${invoice.gstAmount}, total ${invoice.totalValue}`);

check('  RULE 15/16 — the basis is CONVERSION_CHARGE_ONLY, derived not chosen',
  invoice.invoiceBasis === 'CONVERSION_CHARGE_ONLY', invoice.invoiceBasis);
check('  the conversion charge is 100,000 x 0.15 = 15,000',
  Number(invoice.taxableValue) === 15000, invoice.taxableValue);
check('  GST is computed from the product’s own rate (12%)',
  Number(invoice.gstRatePercent) === 12 && Number(invoice.gstAmount) === 1800,
  `${invoice.gstRatePercent}% = ${invoice.gstAmount}`);
check('  the invoice total is 16,800', Number(invoice.totalValue) === 16800, invoice.totalValue);
check('  RULE 16 — no raw-material value is billed',
  Number(invoice.taxableValue) === 15000, 'material value crept into the invoice');

// --- RULE 18: stock actually moved -------------------------------------------
const fgAfter = (await api('/production/finished-goods')).body;
const fgAfterRows = rowsOf(fgAfter);
const fgLotAfter = fgAfterRows.find((l) => l.batchNumber === bmr.batchNumber);

note(`finished goods after dispatch: ${fgLotAfter?.quantityAvailable ?? '(gone from the ledger)'}`);
check('  RULE 18 — finished-goods stock fell to zero',
  Number(fgLotAfter?.quantityAvailable ?? 0) === 0,
  JSON.stringify(fgLotAfter));

// ---------------------------------------------------------------------------
section('POINT 7 — JOB-WORK REGISTER (derived, read-only)');
// ---------------------------------------------------------------------------

const register = (await api(`/job-work/register?principalId=${healwell.id}`)).body;
// A group per AGREEMENT, and this principal has more than one by now, so the
// row is looked for across all of them rather than in whichever group happens
// to come first.
const group = register.find((g) =>
  g.rows.some((r) => r.jobWorkOrderId === order.id),
);
const row = group?.rows?.find((r) => r.jobWorkOrderId === order.id);

check('  the register groups this order under its own agreement',
  group?.agreementId === agreement.id && group?.principalId === healwell.id,
  JSON.stringify({ group: group?.agreementId, expected: agreement.id }));

note(
  `register: received ${row?.materialReceived}, consumed ${row?.quantityConsumed}, ` +
    `dispatched ${row?.finishedGoodsDispatched}, closing ${row?.closingBalance}`,
);

check('  RULE 20 — the order appears in the register with nobody entering it', Boolean(row),
  JSON.stringify(register).slice(0, 300));
check('  material received is derived from the three receipts (60 + 40 + 2 = 102)',
  Number(row?.materialReceived) === 102, row?.materialReceived);
check('  material consumed is derived from the material issue',
  Number(row?.quantityConsumed) > 0, row?.quantityConsumed);
check('  finished goods dispatched is 100,000',
  Number(row?.finishedGoodsDispatched) === 100000, row?.finishedGoodsDispatched);
check('  closing balance is received minus consumed',
  Number(row?.closingBalance) === Number(row?.materialReceived) - Number(row?.quantityConsumed),
  `${row?.materialReceived} - ${row?.quantityConsumed} != ${row?.closingBalance}`);

for (const [method, verb] of [['POST', 'create'], ['PATCH', 'edit'], ['DELETE', 'remove']]) {
  const attempt = await api('/job-work/register', { method, body: { anything: 1 } });
  check(`  RULE 19 — the register cannot be written to (${verb} -> ${attempt.status})`,
    attempt.status === 404 || attempt.status === 405, `${attempt.status}`);
}

// ---------------------------------------------------------------------------
section('NEGATIVE TESTS');
// ---------------------------------------------------------------------------

// 1 — no agreement at all.
const strangerName = `Stranger Pharma ${tag}`;
const stranger = await must('/parties', {
  method: 'POST',
  body: {
    code: `PRIN-ST-${tag}`,
    name: strangerName,
    partyType: 'JOB_WORK_PRINCIPAL',
    paymentTermsDays: 30,
  },
}, 'stranger principal');

const noAgreement = await api('/job-work/orders', {
  method: 'POST',
  body: { principalId: stranger.id, mappingId, quantity: '100', deliveryDate: iso(deliveryDate) },
});
check('  1. order for a principal with no agreement is BLOCKED', noAgreement.status >= 400,
  `${noAgreement.status} ${JSON.stringify(noAgreement.body?.message)}`);

// 2 — expired agreement.
const expired = await must('/job-work/agreements', {
  method: 'POST',
  body: {
    principalId: stranger.id,
    billingModel: 'PURE_CONVERSION',
    conversionChargeRate: '0.20',
    conversionRateBasis: 'PER_UNIT',
    validFrom: '2020-01-01',
    validTo: '2020-12-31',
    mappings: [{ bomId: bom.id, principalBrandName: 'Stranger-500' }],
  },
}, 'expired agreement');

const expiredOrder = await api('/job-work/orders', {
  method: 'POST',
  body: {
    principalId: stranger.id,
    mappingId: expired.mappings[0].id,
    quantity: '100',
    deliveryDate: iso(deliveryDate),
  },
});
check('  2. order against a lapsed agreement is BLOCKED', expiredOrder.status >= 400,
  `${expiredOrder.status} ${JSON.stringify(expiredOrder.body?.message)}`);

// 3 — a mapping belonging to someone else's agreement.
const crossed = await api('/job-work/orders', {
  method: 'POST',
  body: {
    principalId: healwell.id,
    mappingId: expired.mappings[0].id,
    quantity: '100',
    deliveryDate: iso(deliveryDate),
  },
});
check('  3. product not mapped to this principal’s agreement is BLOCKED', crossed.status >= 400,
  `${crossed.status} ${JSON.stringify(crossed.body?.message)}`);

// 4 — covered above (RULE 4).
check('  4. manual billing-model change is BLOCKED', tamper.status === 400, `${tamper.status}`);

// 7/8 — On-Hold and Rejected batches cannot be dispatched.
/**
 * A work order of its own, carried as far as a packed batch.
 *
 * One work order produces one batch — the production module's rule — so the
 * on-hold and rejected cases cannot reuse the released one.
 */
const spareBatch = async (quantity) => {
  const spareOrder = await production('/production/orders', {
    method: 'POST',
    body: {
      productId: healcure.id,
      plannedQuantity: quantity,
      plannedStartOn: iso(today),
      jobWorkOrderId: order.id,
    },
  });

  if (spareOrder.status >= 400) return { error: spareOrder };

  const spareIssue = await store(`/production/orders/${spareOrder.body.id}/issue`, {
    method: 'POST',
    body: {},
  });

  if (spareIssue.status >= 400) return { error: spareIssue };

  const made = await production('/production/batches', {
    method: 'POST',
    body: {
      productionOrderId: spareOrder.body.id,
      actualQuantity: quantity,
      manufacturedOn: iso(today),
    },
  });

  if (made.status >= 400) return { error: made };

  const packed = await production(`/production/batches/${made.body.id}/packing`, {
    method: 'POST',
    body: { packedQuantity: quantity },
  });

  if (packed.status >= 400) return { error: packed };

  return { batch: made.body };
};

const holdBatchResponse = await spareBatch('100');

if (holdBatchResponse.batch) {
  const holdBatch = holdBatchResponse.batch;

  const onHold = await quality(`/production/batches/${holdBatch.id}/release`, {
    method: 'POST',
    body: { decision: 'ON_HOLD', notes: 'Pending assay repeat.' },
  });

  check('  the quality gate records ON_HOLD as its own decision',
    onHold.status < 400 && onHold.body.releaseStatus === 'ON_HOLD',
    `${onHold.status} ${JSON.stringify(onHold.body?.message ?? onHold.body?.releaseStatus)}`);

  const holdDispatch = await api('/job-work/dispatches', {
    method: 'POST',
    body: { jobWorkOrderId: order.id, batchId: holdBatch.id, dispatchedQuantity: '100' },
  });
  check('  7. dispatching an On-Hold batch is BLOCKED', holdDispatch.status >= 400,
    `${holdDispatch.status} ${JSON.stringify(holdDispatch.body?.message)}`);

  // A fresh batch: the one above has already been decided, and that guard
  // would answer first — correctly, but about something else.
  const reasonCase = await spareBatch('100');

  if (reasonCase.batch) {
    const noReason = await quality(`/production/batches/${reasonCase.batch.id}/release`, {
      method: 'POST',
      body: { decision: 'REJECTED' },
    });
    check('  a decision other than release needs a recorded reason',
      noReason.status === 400, `${noReason.status}`);

    check('  a release decision is final and cannot be retaken',
      (
        await quality(`/production/batches/${holdBatch.id}/release`, {
          method: 'POST',
          body: { decision: 'REJECTED', notes: 'second thoughts' },
        })
      ).status === 409,
      'a decided batch was re-decided');
  }
} else {
  check('  a batch could be made for the on-hold case', false,
    JSON.stringify(holdBatchResponse.error?.body?.message));
}

const rejectBatchResponse = await spareBatch('100');

if (rejectBatchResponse.batch) {
  const rejectBatch = rejectBatchResponse.batch;

  const rejected = await quality(`/production/batches/${rejectBatch.id}/release`, {
    method: 'POST',
    body: { decision: 'REJECTED', notes: 'Assay out of specification.' },
  });

  check('  the quality gate records REJECTED as its own decision',
    rejected.status < 400 && rejected.body.releaseStatus === 'REJECTED',
    `${rejected.status} ${JSON.stringify(rejected.body?.message ?? rejected.body?.releaseStatus)}`);

  const rejectedDispatch = await api('/job-work/dispatches', {
    method: 'POST',
    body: { jobWorkOrderId: order.id, batchId: rejectBatch.id, dispatchedQuantity: '100' },
  });
  check('  8. dispatching a Rejected batch is BLOCKED', rejectedDispatch.status >= 400,
    `${rejectedDispatch.status} ${JSON.stringify(rejectedDispatch.body?.message)}`);
} else {
  check('  a batch could be made for the rejected case', false,
    JSON.stringify(rejectBatchResponse.error?.body?.message));
}

console.log(`\n${failures === 0 ? 'HEALWELL SCENARIO VERIFIED' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
