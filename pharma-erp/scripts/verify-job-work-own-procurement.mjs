// The OTHER billing model, on the same machinery.
//
// Under OWN_PROCUREMENT the principal buys nothing: ABC procures the material
// through the ordinary purchase flow, consumes its OWN stock, and bills the
// full finished-goods value rather than a conversion fee. Nothing about
// manufacturing changes — same work order, same BMR, same BPR, same quality
// gate — which is the point: there is one production engine, not two.
//
// The case this exists for is negative test 6: an own-procurement order must be
// refused the principal's material, exactly as a pure-conversion order is
// refused the company's.
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
  if (!body.accessToken) throw new Error(`login ${email}: ${JSON.stringify(body)}`);
  return body.accessToken;
};

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

const api = call(
  await login(
    process.env.JOB_WORK_TEST_EMAIL ?? 'admin@devanshu.test',
    process.env.JOB_WORK_TEST_PASSWORD ?? 'render-shared-dev-2026-b',
  ),
);
const rowsOf = (b) => (Array.isArray(b) ? b : (b?.rows ?? []));

const must = async (path, init, what) => {
  const r = await api(path, init);
  if (r.status >= 400) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

const tag = Date.now().toString().slice(-6);
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const plusYears = (n) => {
  const d = new Date(today);
  d.setFullYear(d.getFullYear() + n);
  return d;
};

// Role users, reusing whoever holds each role, with a settled password.
const userRows = rowsOf((await api('/users')).body);

const signIn = async (role) => {
  const user = userRows.find((u) => u.role === role);
  if (!user) throw new Error(`no ${role}`);

  const temp = `OP-${tag}-Role!x`;
  const settled = `${temp}-ok`;

  await must(`/users/${user.id}/reset-password`, {
    method: 'POST',
    body: { temporaryPassword: temp },
  }, `reset ${role}`);

  const first = await login(user.email, temp);
  const changed = await fetch(`${API}/auth/change-password`, {
    method: 'POST',
    headers: { authorization: `Bearer ${first}`, 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword: temp, newPassword: settled }),
  });

  if (changed.status >= 400) throw new Error(`change-password ${role}: ${await changed.text()}`);

  return call(await login(user.email, settled));
};

const store = await signIn('STORE_OFFICER');
const quality = await signIn('QUALITY_OFFICER');
const production = await signIn('PRODUCTION_OFFICER');

// ---------------------------------------------------------------------------
section('SETUP — a second principal, on own-procurement terms');
// ---------------------------------------------------------------------------

const principal = await must('/parties', {
  method: 'POST',
  body: {
    code: `PRIN-MW-${tag}`,
    name: `MediWell Labs ${tag}`,
    partyType: 'JOB_WORK_PRINCIPAL',
    paymentTermsDays: 45,
  },
}, 'principal');

const makeItem = (spec) => must('/production/items', { method: 'POST', body: spec }, `item ${spec.code}`);

const material = await makeItem({
  code: `RM-IBU-${tag}`,
  name: 'Ibuprofen API',
  type: 'RAW_MATERIAL',
  uom: 'KG',
  hsnCode: '29420090',
  gstRate: '12',
  genericName: 'Ibuprofen',
  shelfLifeMonths: 36,
});

const product = await makeItem({
  code: `FG-MW-${tag}`,
  name: `MediCure-400 ${tag}`,
  type: 'FINISHED_GOOD',
  uom: 'NOS',
  hsnCode: '30049099',
  gstRate: '12',
  genericName: 'Ibuprofen 400 mg tablets',
  brandName: 'MediCure-400',
  shelfLifeMonths: 24,
});

const carton = await makeItem({
  code: `PM-MW-${tag}`,
  name: 'MediCure carton',
  type: 'PACKING_MATERIAL',
  uom: 'NOS',
  hsnCode: '48191010',
  gstRate: '18',
  genericName: 'Printed folding carton',
});

const bom = await must('/production/boms', {
  method: 'POST',
  body: {
    productId: product.id,
    outputQuantity: '10000',
    activate: true,
    lines: [{ itemId: material.id, quantityPer: '4' }],
  },
}, 'BOM');

await must('/packaging/requirements', {
  method: 'POST',
  body: {
    productId: product.id,
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
}, 'packaging');

const agreement = await must('/job-work/agreements', {
  method: 'POST',
  body: {
    principalId: principal.id,
    billingModel: 'OWN_PROCUREMENT',
    validFrom: iso(today),
    validTo: iso(plusYears(1)),
    notes: 'We procure the material and bill the finished goods.',
    mappings: [{ bomId: bom.id, principalBrandName: 'MediCure-400' }],
  },
}, 'agreement');

note(`agreement ${agreement.agreementReference}: ${agreement.billingModel}`);

check('  RULE 2 — the billing model is set at agreement level',
  agreement.billingModel === 'OWN_PROCUREMENT', agreement.billingModel);
check('  no conversion rate is required for own-procurement',
  agreement.conversionChargeRate === null || agreement.conversionChargeRate === undefined,
  `${agreement.conversionChargeRate}`);

const order = await must('/job-work/orders', {
  method: 'POST',
  body: {
    principalId: principal.id,
    mappingId: agreement.mappings[0].id,
    quantity: '10000',
    deliveryDate: iso(new Date(today.getFullYear(), today.getMonth() + 2, 1)),
  },
}, 'job-work order');

note(`order ${order.orderNumber}: ${order.quantity} of MediCure-400`);
check('  RULE 3 — OWN_PROCUREMENT is inherited by the order',
  order.billingModel === 'OWN_PROCUREMENT', order.billingModel);

// ---------------------------------------------------------------------------
section('ABC BUYS THE MATERIAL — the ordinary purchase flow, not a challan');
// ---------------------------------------------------------------------------

const vendor = rowsOf((await api('/parties?partyType=VENDOR')).body).find(
  (p) => p.partyType === 'VENDOR',
);

const requisition = await must('/procurement/requisitions', {
  method: 'POST',
  body: { itemId: material.id, requiredQuantity: '50', preferredVendorId: vendor.id },
}, 'requisition');

await must(`/procurement/requisitions/${requisition.id}/status`, {
  method: 'POST',
  body: { status: 'APPROVED' },
}, 'approve');

const po = await must('/procurement/purchase-orders', {
  method: 'POST',
  body: {
    vendorId: vendor.id,
    lines: [
      {
        itemId: material.id,
        quantity: '50',
        rate: '120',
        taxRatePercent: '12',
        requisitionId: requisition.id,
      },
    ],
  },
}, 'purchase order');

const placed = await api(`/procurement/purchase-orders/${po.id}/submit`, { method: 'POST' });
note(`PO ${po.number} placed (${placed.status})`);

const grn = await store('/procurement/goods-receipts', {
  method: 'POST',
  body: {
    purchaseOrderId: po.id,
    lines: [
      {
        purchaseOrderLineId: po.lines[0].id,
        quantityReceived: '50',
        vendorBatchNumber: `ABC-IBU-${tag}`,
        manufacturingDate: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        expiryDate: iso(plusYears(2)),
      },
    ],
  },
});

if (grn.status >= 400) throw new Error(`GRN: ${grn.status} ${JSON.stringify(grn.body)}`);

const quarantined = rowsOf((await api('/production/stock-lots')).body).find(
  (l) => l.vendorBatchNumber === `ABC-IBU-${tag}`,
);

if (!quarantined) throw new Error('the GRN created no stock lot');

const lotId = quarantined.id;
const decision = await quality(`/procurement/qc/lots/${lotId}/decision`, {
  method: 'POST',
  body: { decision: 'ACCEPTED', testReference: `QC-${tag}`, remarks: 'Conforms.' },
});

note(`GRN ${grn.body.number}, incoming QC ${decision.status}`);

const abcLot = rowsOf((await api('/production/stock-lots')).body).find(
  (l) => l.vendorBatchNumber === `ABC-IBU-${tag}`,
);

check('  the purchased material is COMPANY_OWNED', abcLot?.ownership === 'COMPANY_OWNED',
  JSON.stringify(abcLot?.ownership));
check('  and it is released by incoming QC', abcLot?.status === 'USABLE', abcLot?.status);

// The principal's own material, received against the SAME order, to be refused.
const challanReceipt = await store('/job-work/material-receipts', {
  method: 'POST',
  body: {
    jobWorkOrderId: order.id,
    deliveryChallanNumber: `DC-MW-${tag}`,
    receiptDate: iso(today),
    lines: [
      {
        itemId: material.id,
        batchNumber: `MW-IBU-${tag}`,
        receivedQuantity: '50',
        manufacturingDate: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        expiryDate: iso(plusYears(2)),
      },
    ],
  },
});

note(`principal's challan receipt: ${challanReceipt.status}`);

check('  6a. a principal material receipt against an own-procurement order is REFUSED',
  challanReceipt.status >= 400, `${challanReceipt.status}`);
check('  and the refusal points at the purchase flow instead',
  /purchase flow|requisition|free of cost/i.test(
    JSON.stringify(challanReceipt.body?.message ?? ''),
  ),
  JSON.stringify(challanReceipt.body?.message));
note(`refusal: ${JSON.stringify(challanReceipt.body?.message)}`);

// THE SAME MATERIAL IN BOTH BUCKETS, which is the only way to prove the guard
// is about ownership rather than about the item. A second principal takes a
// pure-conversion agreement on the same recipe and supplies the same ibuprofen
// under their own challan.
const conversionPrincipal = await must('/parties', {
  method: 'POST',
  body: {
    code: `PRIN-CV-${tag}`,
    name: `Converse Pharma ${tag}`,
    partyType: 'JOB_WORK_PRINCIPAL',
    paymentTermsDays: 30,
  },
}, 'conversion principal');

const conversionAgreement = await must('/job-work/agreements', {
  method: 'POST',
  body: {
    principalId: conversionPrincipal.id,
    billingModel: 'PURE_CONVERSION',
    conversionChargeRate: '0.20',
    conversionRateBasis: 'PER_UNIT',
    validFrom: iso(today),
    validTo: iso(plusYears(1)),
    mappings: [{ bomId: bom.id, principalBrandName: 'ConverseCure-400' }],
  },
}, 'conversion agreement');

const conversionOrder = await must('/job-work/orders', {
  method: 'POST',
  body: {
    principalId: conversionPrincipal.id,
    mappingId: conversionAgreement.mappings[0].id,
    quantity: '10000',
    deliveryDate: iso(new Date(today.getFullYear(), today.getMonth() + 2, 1)),
  },
}, 'conversion order');

const conversionReceipt = await store('/job-work/material-receipts', {
  method: 'POST',
  body: {
    jobWorkOrderId: conversionOrder.id,
    deliveryChallanNumber: `DC-CV-${tag}`,
    receiptDate: iso(today),
    lines: [
      {
        itemId: material.id,
        batchNumber: `CV-IBU-${tag}`,
        receivedQuantity: '50',
        manufacturingDate: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        expiryDate: iso(plusYears(2)),
      },
    ],
  },
});

note(`second principal's challan receipt: ${conversionReceipt.status}`);

const principalLot = rowsOf((await api('/production/stock-lots')).body).find(
  (l) => l.vendorBatchNumber === `CV-IBU-${tag}`,
);

check('  the same material now sits in both buckets',
  principalLot?.ownership === 'PRINCIPAL_OWNED' && abcLot?.ownership === 'COMPANY_OWNED',
  JSON.stringify({ principal: principalLot?.ownership, company: abcLot?.ownership }));

// ---------------------------------------------------------------------------
section('THE BUCKET RULE, THE OTHER WAY ROUND');
// ---------------------------------------------------------------------------

const wo = await production('/production/orders', {
  method: 'POST',
  body: {
    productId: product.id,
    plannedQuantity: '10000',
    plannedStartOn: iso(today),
    jobWorkOrderId: order.id,
  },
});

if (wo.status >= 400) throw new Error(`work order: ${wo.status} ${JSON.stringify(wo.body)}`);

check('  the work order carries the OWN_PROCUREMENT tag',
  wo.body.jobWork?.billingModel === 'OWN_PROCUREMENT', JSON.stringify(wo.body.jobWork));

if (principalLot) {
  const wrongBucket = await store(`/production/orders/${wo.body.id}/issue`, {
    method: 'POST',
    body: {
      overrides: [
        {
          itemId: material.id,
          lotId: principalLot.id,
          quantity: '1',
          reason: 'testing the gate from the other side',
        },
      ],
    },
  });

  check('  6b. own-procurement consuming PRINCIPAL-OWNED stock is BLOCKED at the issue too',
    wrongBucket.status >= 400, `${wrongBucket.status}`);
  check('  and the refusal explains the bucket',
    /principal|own|ownership/i.test(JSON.stringify(wrongBucket.body?.message ?? '')),
    JSON.stringify(wrongBucket.body?.message));
  note(`refusal: ${JSON.stringify(wrongBucket.body?.message)}`);
} else {
  note('no principal-owned lot on hand to put in front of the issue — guard untested here');
}

const issue = await store(`/production/orders/${wo.body.id}/issue`, { method: 'POST', body: {} });

if (issue.status >= 400) throw new Error(`issue: ${issue.status} ${JSON.stringify(issue.body)}`);

const issuedNumbers = issue.body.lines.map((l) => l.lotNumber);
const issuedLots = rowsOf((await api('/production/stock-lots')).body).filter((l) =>
  issuedNumbers.includes(l.lotNumber),
);

check('  RULE 8 — the issue drew ABC’s own stock',
  issuedLots.length > 0 && issuedLots.every((l) => l.ownership === 'COMPANY_OWNED'),
  JSON.stringify(issuedLots.map((l) => `${l.lotNumber}:${l.ownership}`)));

// ---------------------------------------------------------------------------
section('THE SAME MANUFACTURING, AND A FULL-VALUE INVOICE');
// ---------------------------------------------------------------------------

const batch = await production('/production/batches', {
  method: 'POST',
  body: { productionOrderId: wo.body.id, actualQuantity: '10000', manufacturedOn: iso(today) },
});

if (batch.status >= 400) throw new Error(`BMR: ${batch.status} ${JSON.stringify(batch.body)}`);

await production(`/production/batches/${batch.body.id}/packing`, {
  method: 'POST',
  body: { packedQuantity: '10000' },
});

const released = await quality(`/production/batches/${batch.body.id}/release`, {
  method: 'POST',
  body: { decision: 'RELEASED', notes: 'Conforms.' },
});

check('  RULE 10/11 — the same work order, BMR, BPR and quality gate were used',
  released.status < 400 && released.body.releaseStatus === 'RELEASED',
  `${released.status} ${JSON.stringify(released.body?.message)}`);

const dispatch = await api('/job-work/dispatches', {
  method: 'POST',
  body: {
    jobWorkOrderId: order.id,
    batchId: batch.body.id,
    dispatchedQuantity: '10000',
    dispatchDate: iso(today),
    unitValue: '2.50',
  },
});

if (dispatch.status >= 400) throw new Error(`dispatch: ${dispatch.status} ${JSON.stringify(dispatch.body)}`);

const invoice = dispatch.body;
note(`invoice ${invoice.invoiceNumber}: basis ${invoice.invoiceBasis}`);
note(`  taxable ${invoice.taxableValue}, GST ${invoice.gstRatePercent}% = ${invoice.gstAmount}, total ${invoice.totalValue}`);

check('  RULE 15/17 — the basis is FULL_FINISHED_GOODS_VALUE, derived from the model',
  invoice.invoiceBasis === 'FULL_FINISHED_GOODS_VALUE', invoice.invoiceBasis);
check('  the taxable value is 10,000 x 2.50 = 25,000',
  Number(invoice.taxableValue) === 25000, invoice.taxableValue);
check('  GST at the product’s 12% is 3,000',
  Number(invoice.gstAmount) === 3000, invoice.gstAmount);
check('  the total is 28,000', Number(invoice.totalValue) === 28000, invoice.totalValue);

// And the conversion-fee route is not available under this model.
const conversionAttempt = await api('/job-work/dispatches', {
  method: 'POST',
  body: {
    jobWorkOrderId: order.id,
    batchId: batch.body.id,
    dispatchedQuantity: '1',
    invoiceBasis: 'CONVERSION_CHARGE_ONLY',
  },
});
check('  10. naming an invoice basis is refused under this model too',
  conversionAttempt.status === 400, `${conversionAttempt.status}`);

console.log(`\n${failures === 0 ? 'OWN-PROCUREMENT VERIFIED' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
