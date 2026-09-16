/**
 * Seeds a runnable Production & Quality Gate example for one company.
 *
 * Creates the master data a batch needs — items, stock and a formulation —
 * and stops there. It deliberately does NOT create a work order, issue
 * material or release a batch: those are the steps the workflow exists to
 * demonstrate, and pre-running them would leave nothing to see.
 *
 * The stock is seeded as `stock_lots`, which is the one stock table: the lots
 * Procure-to-Pay receives are the lots production consumes. A stock lot exists
 * only against a goods-receipt line, so the seeder builds the chain a real lot
 * arrives through — vendor, purchase order, goods receipt, lot — rather than
 * inventing stock that no receipt explains. That constraint is the point: it
 * is what makes "which supplier lot went into this batch" answerable.
 *
 * The lots are dated to make FEFO visible rather than merely correct:
 *
 *   - Every material has at least two lots with different expiry dates, so the
 *     issue plan visibly reaches for the earlier one.
 *   - The earliest lot of the active ingredient is deliberately too small to
 *     cover a full batch, so the plan splits across two lots — the case that
 *     actually exercises the allocator.
 *   - One lot is QUARANTINE and one is REJECTED, both with early expiry dates.
 *     A correct FEFO run skips them despite being the soonest to expire; if a
 *     future change starts picking them, the demo shows it immediately.
 *
 * Run it:
 *   pnpm seed:production --tenant appsavio
 *
 * Idempotent: re-running updates the same records rather than duplicating them.
 *
 * Connects on MIGRATION_DATABASE_URL, like the other provisioning scripts —
 * these are cross-tenant writes made deliberately, from outside a request.
 */
import { createHash } from 'node:crypto';

import { createProvisioningClient } from '@pharma-erp/database';

/**
 * A stable UUID for a demo row, derived from what the row IS.
 *
 * Goods-receipt lines and stock lots have no natural key to upsert on — a
 * receipt line is identified by its receipt and position, both of which this
 * script invents. Deriving the id from the tenant and the lot number instead
 * makes re-running the seeder update the same rows, which is what keeps the
 * demo replayable: a second run restores stock the first run's batch consumed.
 *
 * Version 5 shape, because `assertTenantId` and the UUID column both expect a
 * well-formed one; a hash with the version and variant nibbles left alone is
 * not a UUID, it is 16 bytes that usually pass.
 */
function demoId(key) {
  const bytes = Buffer.from(
    createHash('sha1').update(`pharma-erp:production-demo:${key}`).digest().subarray(0, 16),
  );

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const key = token.slice(2);
    const next = argv[i + 1];

    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }

  return args;
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/** A date `months` from today, as a UTC calendar day. */
function monthsFromNow(months) {
  const now = new Date();
  const target = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, now.getUTCDate()),
  );

  return new Date(target.toISOString().slice(0, 10));
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`
  Seed the Production & Quality Gate demo data.

    --tenant   Company slug to seed        (required)
`);
  process.exit(0);
}

const { MIGRATION_DATABASE_URL } = process.env;

if (!MIGRATION_DATABASE_URL) {
  fail(
    'MIGRATION_DATABASE_URL is not set.\n  Run this via `pnpm seed:production` from the repo root so the root .env is loaded.',
  );
}

const slug = typeof args.tenant === 'string' ? args.tenant.trim().toLowerCase() : '';

if (!slug) fail('--tenant is required, e.g. --tenant appsavio. Use --help for usage.');

// -----------------------------------------------------------------------------
// The data
// -----------------------------------------------------------------------------

const ITEMS = [
  {
    code: 'FG-PARA-500',
    name: 'Paracetamol 500 mg Tablets (10x10 blister)',
    type: 'FINISHED_GOOD',
    uom: 'tablets',
    shelfLifeMonths: 24,
    hsnCode: '30049099',
  },
  { code: 'RM-PARA-API', name: 'Paracetamol IP (API)', type: 'RAW_MATERIAL', uom: 'kg' },
  { code: 'RM-STARCH', name: 'Maize Starch IP', type: 'RAW_MATERIAL', uom: 'kg' },
  { code: 'RM-MG-ST', name: 'Magnesium Stearate IP', type: 'RAW_MATERIAL', uom: 'kg' },
  { code: 'RM-PVP-K30', name: 'Povidone K30 IP', type: 'RAW_MATERIAL', uom: 'kg' },
  { code: 'PM-BLISTER', name: 'PVC/Aluminium Blister Foil', type: 'PACKING_MATERIAL', uom: 'm' },
  { code: 'PM-CARTON', name: 'Printed Carton, 10x10', type: 'PACKING_MATERIAL', uom: 'nos' },
];

/**
 * `months` is the expiry, relative to today, so the demo never goes stale.
 *
 * The active ingredient's earliest lot holds 20 kg against a 52 kg requirement
 * — chosen so a standard batch must open a second lot.
 */
const LOTS = [
  // Active ingredient: short-dated small lot, then a larger one.
  { item: 'RM-PARA-API', lot: 'PAR-2405-A', months: 5, qty: '20.000', status: 'USABLE' },
  { item: 'RM-PARA-API', lot: 'PAR-2408-B', months: 14, qty: '120.000', status: 'USABLE' },
  // Sooner than both of the above, and must NOT be picked.
  { item: 'RM-PARA-API', lot: 'PAR-2403-Q', months: 2, qty: '80.000', status: 'QUARANTINE' },
  { item: 'RM-PARA-API', lot: 'PAR-2402-R', months: 1, qty: '40.000', status: 'REJECTED' },

  { item: 'RM-STARCH', lot: 'STR-2404-A', months: 7, qty: '60.000', status: 'USABLE' },
  { item: 'RM-STARCH', lot: 'STR-2409-B', months: 19, qty: '150.000', status: 'USABLE' },

  { item: 'RM-MG-ST', lot: 'MGS-2406-A', months: 9, qty: '25.000', status: 'USABLE' },
  { item: 'RM-MG-ST', lot: 'MGS-2410-B', months: 22, qty: '40.000', status: 'USABLE' },

  { item: 'RM-PVP-K30', lot: 'PVP-2405-A', months: 8, qty: '30.000', status: 'USABLE' },
  { item: 'RM-PVP-K30', lot: 'PVP-2411-B', months: 26, qty: '45.000', status: 'USABLE' },

  { item: 'PM-BLISTER', lot: 'BLF-2407-A', months: 15, qty: '4000.000', status: 'USABLE' },
  { item: 'PM-BLISTER', lot: 'BLF-2412-B', months: 30, qty: '9000.000', status: 'USABLE' },

  { item: 'PM-CARTON', lot: 'CTN-2407-A', months: 24, qty: '3000.000', status: 'USABLE' },
  { item: 'PM-CARTON', lot: 'CTN-2501-B', months: 36, qty: '12000.000', status: 'USABLE' },
];

/**
 * What the demo vendor charges, per unit of issue.
 *
 * Nominal but not arbitrary: a purchase order line needs a rate, and a rate of
 * zero would make the order's totals meaningless and the GST columns untestable.
 * These are plausible Indian bulk figures in rupees, and nothing in production
 * reads them — they exist so the receipt the stock arrived on is a real
 * document rather than a placeholder.
 */
const RATES = {
  'RM-PARA-API': '420.0000',
  'RM-STARCH': '65.0000',
  'RM-MG-ST': '180.0000',
  'RM-PVP-K30': '640.0000',
  'PM-BLISTER': '38.0000',
  'PM-CARTON': '4.5000',
};

const PURCHASE_TAX_PERCENT = 12;

/** Quantities per 100,000 tablets — a realistic 100 kg-ish granulation batch. */
const BOM_OUTPUT_QUANTITY = '100000.000';

const BOM_LINES = [
  { item: 'RM-PARA-API', quantityPer: '52.000', notes: 'Active. 500 mg per tablet plus overage.' },
  { item: 'RM-STARCH', quantityPer: '18.500', notes: 'Diluent and disintegrant.' },
  { item: 'RM-PVP-K30', quantityPer: '3.200', notes: 'Binder, added as granulating solution.' },
  { item: 'RM-MG-ST', quantityPer: '0.600', notes: 'Lubricant. Blend no longer than 3 minutes.' },
  { item: 'PM-BLISTER', quantityPer: '1250.000', notes: '10 tablets per blister.' },
  { item: 'PM-CARTON', quantityPer: '1000.000', notes: '100 tablets per carton.' },
];

const BOM_INSTRUCTIONS = [
  '1. Sift the API and starch through a 40-mesh sieve and dry-mix for 10 minutes.',
  '2. Prepare the binder solution with Povidone K30 and granulate.',
  '3. Dry the granules to a loss on drying of not more than 2.0 %.',
  '4. Sift through 20-mesh, blend with magnesium stearate for 3 minutes.',
  '5. Compress to a target weight of 550 mg, hardness 4-7 kp.',
  '6. Blister-pack and carton. Reconcile packing material before closing the BPR.',
].join('\n');

// -----------------------------------------------------------------------------

const prisma = createProvisioningClient(MIGRATION_DATABASE_URL);

try {
  const tenant = await prisma.tenant.findFirst({
    where: { slug, deletedAt: null },
    select: { id: true, name: true },
  });

  if (!tenant) {
    fail(`No company with the slug "${slug}". Create one with \`pnpm create-tenant\` first.`);
  }

  const tenantId = tenant.id;

  // Items -------------------------------------------------------------------
  const itemsByCode = new Map();

  for (const item of ITEMS) {
    const saved = await prisma.item.upsert({
      where: { tenantId_code: { tenantId, code: item.code } },
      create: { tenantId, ...item },
      update: { name: item.name, uom: item.uom, shelfLifeMonths: item.shelfLifeMonths ?? null },
    });

    itemsByCode.set(item.code, saved);
  }

  // Who the documents are attributed to --------------------------------------
  // A purchase order and a goods receipt both record a person. Any active user
  // of the company will do for a demo; the seeder is not trying to model who
  // actually buys things.
  const actor = await prisma.user.findFirst({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (!actor) {
    fail(
      `"${tenant.name}" has no users, so there is nobody to attribute the demo purchase order ` +
        'to. Invite one first.',
    );
  }

  // The vendor ---------------------------------------------------------------
  const vendor = await prisma.party.upsert({
    where: { tenantId_code: { tenantId, code: 'V-DEMO-01' } },
    create: {
      tenantId,
      code: 'V-DEMO-01',
      name: 'Meridian Fine Chemicals Pvt Ltd',
      partyType: 'VENDOR',
      gstin: '27AAFCM1234R1ZQ',
      drugLicenceNumber: 'MH-MFG-20B-4417',
      email: 'despatch@meridianfine.example',
      phone: '+912240998100',
      address: 'Plot 14, MIDC Taloja, Raigad, Maharashtra 410208',
      paymentTermsDays: 45,
    },
    update: { name: 'Meridian Fine Chemicals Pvt Ltd', partyType: 'VENDOR' },
  });

  // The purchase order -------------------------------------------------------
  // One line per material, carrying the total of that material's lots. Several
  // lots against one order line is the ordinary case: a vendor ships one order
  // in whatever batches they have.
  const quantityByItem = new Map();

  for (const lot of LOTS) {
    quantityByItem.set(lot.item, (quantityByItem.get(lot.item) ?? 0) + Number(lot.qty));
  }

  const orderLines = [...quantityByItem].map(([code, quantity]) => {
    const rate = Number(RATES[code]);
    const taxable = quantity * rate;
    const tax = (taxable * PURCHASE_TAX_PERCENT) / 100;

    return {
      id: demoId(`${tenantId}:po-line:${code}`),
      code,
      quantity: quantity.toFixed(3),
      rate: RATES[code],
      taxableAmount: taxable.toFixed(2),
      taxAmount: tax.toFixed(2),
      totalAmount: (taxable + tax).toFixed(2),
    };
  });

  const orderTotals = orderLines.reduce(
    (running, line) => ({
      taxable: running.taxable + Number(line.taxableAmount),
      tax: running.tax + Number(line.taxAmount),
      total: running.total + Number(line.totalAmount),
    }),
    { taxable: 0, tax: 0, total: 0 },
  );

  const order = await prisma.purchaseOrder.upsert({
    where: { tenantId_number: { tenantId, number: 'PO-DEMO-0001' } },
    create: {
      tenantId,
      number: 'PO-DEMO-0001',
      vendorId: vendor.id,
      poDate: monthsFromNow(-2),
      expectedDeliveryDate: monthsFromNow(-1),
      paymentTermsDays: 45,
      // CLOSED because everything on it has been received below. An order
      // still OPEN against stock that is already on the shelf would make the
      // pending-receipts view wrong.
      status: 'CLOSED',
      notes:
        'Demo order. Created by the production seeder to explain where the demo stock came from.',
      taxableAmount: orderTotals.taxable.toFixed(2),
      taxAmount: orderTotals.tax.toFixed(2),
      totalAmount: orderTotals.total.toFixed(2),
      createdById: actor.id,
      issuedAt: monthsFromNow(-2),
    },
    update: {
      status: 'CLOSED',
      taxableAmount: orderTotals.taxable.toFixed(2),
      taxAmount: orderTotals.tax.toFixed(2),
      totalAmount: orderTotals.total.toFixed(2),
    },
  });

  for (const line of orderLines) {
    const item = itemsByCode.get(line.code);

    await prisma.purchaseOrderLine.upsert({
      where: { id: line.id },
      create: {
        id: line.id,
        tenantId,
        purchaseOrderId: order.id,
        itemId: item.id,
        quantity: line.quantity,
        rate: line.rate,
        taxRatePercent: PURCHASE_TAX_PERCENT,
        taxableAmount: line.taxableAmount,
        taxAmount: line.taxAmount,
        totalAmount: line.totalAmount,
        quantityReceived: line.quantity,
      },
      update: { quantity: line.quantity, quantityReceived: line.quantity },
    });
  }

  // The goods receipt --------------------------------------------------------
  const receipt = await prisma.goodsReceipt.upsert({
    where: { tenantId_number: { tenantId, number: 'GRN-DEMO-0001' } },
    create: {
      tenantId,
      number: 'GRN-DEMO-0001',
      purchaseOrderId: order.id,
      vendorId: vendor.id,
      receiptDate: monthsFromNow(-1),
      vendorDocumentNumber: 'MFC/DN/2026/0881',
      receivedById: actor.id,
      remarks: 'Demo receipt. The stock the production workflow issues against arrives here.',
    },
    update: { purchaseOrderId: order.id, vendorId: vendor.id },
  });

  // Stock --------------------------------------------------------------------
  // `quantityAvailable` is reset to the received quantity on every run, so
  // re-seeding restores consumed stock and the demo can be replayed.
  //
  // The status is set here rather than left at the QUARANTINE default: incoming
  // QC is what normally moves a lot to USABLE, and the demo needs stock that is
  // already issuable — plus one quarantined and one rejected lot that FEFO must
  // visibly decline to pick.
  for (const lot of LOTS) {
    const item = itemsByCode.get(lot.item);
    const receiptLineId = demoId(`${tenantId}:grn-line:${lot.lot}`);
    const orderLineId = demoId(`${tenantId}:po-line:${lot.item}`);

    await prisma.goodsReceiptLine.upsert({
      where: { id: receiptLineId },
      create: {
        id: receiptLineId,
        tenantId,
        goodsReceiptId: receipt.id,
        purchaseOrderLineId: orderLineId,
        itemId: item.id,
        vendorBatchNumber: lot.lot,
        manufacturingDate: monthsFromNow(-2),
        expiryDate: monthsFromNow(lot.months),
        quantityReceived: lot.qty,
        storageLocation: 'Raw material store, rack A',
      },
      update: {
        expiryDate: monthsFromNow(lot.months),
        quantityReceived: lot.qty,
      },
    });

    await prisma.stockLot.upsert({
      where: { id: demoId(`${tenantId}:stock-lot:${lot.lot}`) },
      create: {
        id: demoId(`${tenantId}:stock-lot:${lot.lot}`),
        tenantId,
        lotNumber: lot.lot,
        itemId: item.id,
        goodsReceiptLineId: receiptLineId,
        vendorBatchNumber: lot.lot,
        manufacturingDate: monthsFromNow(-2),
        expiryDate: monthsFromNow(lot.months),
        quantityReceived: lot.qty,
        quantityAvailable: lot.qty,
        status: lot.status,
        storageLocation: 'Raw material store, rack A',
      },
      update: {
        expiryDate: monthsFromNow(lot.months),
        quantityReceived: lot.qty,
        quantityAvailable: lot.qty,
        status: lot.status,
      },
    });
  }

  // Formulation -------------------------------------------------------------
  const product = itemsByCode.get('FG-PARA-500');

  const existingBom = await prisma.bom.findFirst({
    where: { tenantId, productId: product.id },
    orderBy: { version: 'desc' },
  });

  if (existingBom) {
    console.log(`\n  Formulation v${existingBom.version} already exists; left untouched.`);
  } else {
    await prisma.bom.create({
      data: {
        tenantId,
        productId: product.id,
        version: 1,
        outputQuantity: BOM_OUTPUT_QUANTITY,
        instructions: BOM_INSTRUCTIONS,
        isActive: true,
        lines: {
          create: BOM_LINES.map((line) => ({
            tenantId,
            itemId: itemsByCode.get(line.item).id,
            quantityPer: line.quantityPer,
            notes: line.notes,
          })),
        },
      },
    });
  }

  const line = '-'.repeat(68);

  console.log(`\n${line}`);
  console.log(`  Production demo data seeded for ${tenant.name}`);
  console.log(line);
  console.log(`  Items        : ${ITEMS.length}`);
  console.log(`  Stock lots   : ${LOTS.length}  (2 unpickable on purpose: quarantine, rejected)`);
  console.log(`  Received on  : PO-DEMO-0001 → GRN-DEMO-0001, from ${vendor.name}`);
  console.log(`  Formulation  : FG-PARA-500 v1, per ${BOM_OUTPUT_QUANTITY} tablets`);
  console.log(line);
  console.log(`
  Walk the flow at /workflows/production-quality:

    1. Formulations      see FG-PARA-500 v1 and its 6 materials
    2. Production orders raise one for 100000 tablets
    3. Material issue    preview the FEFO plan. RM-PARA-API needs 52 kg and the
                         earliest usable lot holds 20, so it splits across two —
                         and skips the quarantined lot that expires sooner
    4. Batch record      record the yield, then the packed quantity
    7. Batch release     release it, and watch finished-goods stock appear
`);
} catch (error) {
  console.error('\n  Failed to seed the production demo data:\n', error);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
