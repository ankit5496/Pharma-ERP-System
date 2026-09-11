/**
 * Seeds a runnable Production & Quality Gate example for one company.
 *
 * Creates the master data a batch needs — items, stock lots and a formulation
 * — and stops there. It deliberately does NOT create a work order, issue
 * material or release a batch: those are the steps the workflow exists to
 * demonstrate, and pre-running them would leave nothing to see.
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
import { createProvisioningClient } from '@pharma-erp/database';

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

  // Stock lots --------------------------------------------------------------
  // `quantityAvailable` is reset to the received quantity on every run, so
  // re-seeding restores consumed stock and the demo can be replayed.
  for (const lot of LOTS) {
    const item = itemsByCode.get(lot.item);

    await prisma.materialLot.upsert({
      where: {
        tenantId_itemId_lotNumber: { tenantId, itemId: item.id, lotNumber: lot.lot },
      },
      create: {
        tenantId,
        itemId: item.id,
        lotNumber: lot.lot,
        expiryDate: monthsFromNow(lot.months),
        receivedOn: monthsFromNow(-1),
        quantityReceived: lot.qty,
        quantityAvailable: lot.qty,
        status: lot.status,
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
