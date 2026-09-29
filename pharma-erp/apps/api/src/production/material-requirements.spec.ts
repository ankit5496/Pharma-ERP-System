import { Prisma } from '@pharma-erp/database';

import { scaleRecipe, type ProductRecipe } from './material-requirements';

/**
 * The Default Overage % — US-MD-03, as Required Stock applies it.
 *
 * PER MATERIAL, NOT PER PRODUCT. Each formulation line carries its own
 * allowance and is grossed up by that alone; there is no product-level default
 * behind it. A binder that spoils at 5% and an active dosed exactly are
 * different materials, and one figure across a formulation cannot say so.
 *
 * TESTED HERE RATHER THAN THROUGH THE DATABASE, and that is the only place it
 * can be tested properly. Every formulation on the shared database carries 0%,
 * and every one that sits behind a live sales order is locked against editing
 * by change control — correctly, since a work order already references it. So
 * a probe cannot set an overage and watch the tab move. This can, because the
 * arithmetic is a pure function by design.
 *
 * THE WORKED EXAMPLE FROM THE BRIEF IS THE FIRST TEST, spelled out in its own
 * units: 10,000 units of a product whose formulation calls for 2 kg per 1,000,
 * at 5% on that line, must come to 21 kg.
 */

const dec = (value: string | number) => new Prisma.Decimal(value);

/**
 * An item ROW, as Prisma hands one to the mapper.
 *
 * `createdAt` is a Date rather than a string because `toItemSummary` calls
 * `.toISOString()` on it — this is the database row, not the view.
 */
const item = (code: string, type = 'RAW_MATERIAL') =>
  ({
    id: `item-${code}`,
    code,
    name: code,
    type,
    uom: 'KG',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    shelfLifeMonths: null,
    hsnCode: null,
    brandName: null,
    genericName: null,
    scheduleClassification: 'NONE',
    gstRate: null,
    mrp: null,
    dpcoCeiling: false,
    storageConditions: null,
    reorderLevel: null,
    reorderQuantity: null,
    requiresBatchTracking: true,
    notes: null,
  }) as never;

/**
 * A formulation producing 1,000 units.
 *
 * `outputQuantity` 1000 with a line of 2 is "2 kg per 1,000 units", which is
 * how the brief states it.
 */
const recipe = (
  lines: { code: string; quantityPer: string; overagePercent?: string | null; type?: string }[],
  defaultOveragePercent: string,
  packaging?: ProductRecipe['packaging'],
): ProductRecipe => ({
  productName: 'HealCure-500',
  bom: {
    version: 1,
    outputQuantity: dec(1000),
    defaultOveragePercent: dec(defaultOveragePercent),
    lines: lines.map((line) => ({
      quantityPer: dec(line.quantityPer),
      // Undefined means the line sets none, which is the nullable column's
      // "use the BOM default". An explicit '0' is the other thing entirely.
      overagePercent:
        line.overagePercent === undefined || line.overagePercent === null
          ? null
          : dec(line.overagePercent),
      item: item(line.code, line.type),
    })),
  },
  packaging: packaging ?? null,
});

/** The requirement for one material, by code. */
const find = (result: string | ReturnType<typeof scaleRecipe>, code: string) => {
  if (typeof result === 'string') throw new Error(`scaleRecipe refused: ${result}`);

  const line = result.find((entry) => entry.item.code === code);

  if (!line) throw new Error(`${code} is not in the requirement`);

  return line;
};

describe('scaleRecipe — per-material Overage %', () => {
  describe('the brief’s worked example', () => {
    // 5% ON THE LINE, and the product default left at 0: the allowance belongs
    // to the material, and nothing inherits.
    const masters = recipe([{ code: 'RM-A', quantityPer: '2', overagePercent: '5' }], '0');

    it('grosses 20 kg up to 21 kg at 5%', () => {
      const result = scaleRecipe(masters, dec(10_000), { applyOverage: true });
      const line = find(result, 'RM-A');

      expect(line.baseQuantity.toString()).toBe('20');
      expect(line.overagePercent.toString()).toBe('5');
      expect(line.quantity.toString()).toBe('21');
    });

    it('leaves it at 20 kg when the caller does not ask for overage', () => {
      const line = find(scaleRecipe(masters, dec(10_000)), 'RM-A');

      expect(line.baseQuantity.toString()).toBe('20');
      expect(line.overagePercent.toString()).toBe('0');
      expect(line.quantity.toString()).toBe('20');
    });
  });

  describe('the brief’s three-material example', () => {
    // RM-A 20 kg at 5% -> 21; RM-B 10 kg at 2% -> 10.2; PM-A 10,000 at 3% ->
    // 10,300. Three materials, three different rates, one formulation.
    const masters = recipe(
      [
        { code: 'RM-A', quantityPer: '2', overagePercent: '5' },
        { code: 'RM-B', quantityPer: '1', overagePercent: '2' },
      ],
      '0',
      {
        packVariant: '1x1',
        unitsPerPack: dec(1),
        lines: [
          {
            itemId: 'item-PM-A',
            quantityPer: dec(1),
            quantityBasis: 'PER_PACK',
            overagePercent: dec('3'),
            item: item('PM-A', 'PACKING_MATERIAL'),
          },
        ],
      },
    );

    const result = scaleRecipe(masters, dec(10_000), { applyOverage: true });

    it('grosses each material up by its own rate', () => {
      expect(find(result, 'RM-A').quantity.toString()).toBe('21');
      expect(find(result, 'RM-B').quantity.toString()).toBe('10.2');
      expect(find(result, 'PM-A').quantity.toString()).toBe('10300');
    });

    it('and reports the rate it used on each', () => {
      expect(find(result, 'RM-A').overagePercent.toString()).toBe('5');
      expect(find(result, 'RM-B').overagePercent.toString()).toBe('2');
      expect(find(result, 'PM-A').overagePercent.toString()).toBe('3');
    });
  });

  describe('each line carries its own, and the product default is ignored', () => {
    // The BOM default is set to 5% here PRECISELY SO THAT IT CAN BE SEEN NOT TO
    // apply: a line that names no allowance must be grossed up by nothing, not
    // by the product's figure.
    const masters = recipe(
      [
        { code: 'RM-SILENT', quantityPer: '2' },
        { code: 'RM-OWN', quantityPer: '2', overagePercent: '10' },
        { code: 'RM-ZERO', quantityPer: '2', overagePercent: '0' },
      ],
      '5',
    );

    const result = scaleRecipe(masters, dec(10_000), { applyOverage: true });

    it('adds nothing to a line that names no allowance', () => {
      expect(find(result, 'RM-SILENT').overagePercent.toString()).toBe('0');
      expect(find(result, 'RM-SILENT').quantity.toString()).toBe('20');
    });

    it('takes the line’s own where it sets one', () => {
      expect(find(result, 'RM-OWN').overagePercent.toString()).toBe('10');
      expect(find(result, 'RM-OWN').quantity.toString()).toBe('22');
    });

    it('and nothing where the line says zero', () => {
      expect(find(result, 'RM-ZERO').overagePercent.toString()).toBe('0');
      expect(find(result, 'RM-ZERO').quantity.toString()).toBe('20');
    });

    it('so the product-level default changes no figure at all', () => {
      const withoutDefault = scaleRecipe(recipe(
        [
          { code: 'RM-SILENT', quantityPer: '2' },
          { code: 'RM-OWN', quantityPer: '2', overagePercent: '10' },
          { code: 'RM-ZERO', quantityPer: '2', overagePercent: '0' },
        ],
        '0',
      ), dec(10_000), { applyOverage: true });

      for (const code of ['RM-SILENT', 'RM-OWN', 'RM-ZERO']) {
        expect(find(withoutDefault, code).quantity.toString()).toBe(
          find(result, code).quantity.toString(),
        );
      }
    });
  });

  describe('packing materials, before the column exists', () => {
    // PackagingRequirementLine has no overage field today, so these lines carry
    // none and nothing is added — the stated behaviour in the meantime. The BOM
    // default is 5% here to show it does not leak in.
    const masters = recipe([{ code: 'RM-A', quantityPer: '2' }], '5', {
      packVariant: '10x10 blister',
      unitsPerPack: dec(100),
      lines: [
        {
          itemId: 'item-PM-CTN',
          quantityPer: dec(1),
          quantityBasis: 'PER_PACK',
          item: item('PM-CTN', 'PACKING_MATERIAL'),
        },
        {
          itemId: 'item-PM-LEAF',
          quantityPer: dec(2),
          quantityBasis: 'PER_BATCH',
          item: item('PM-LEAF', 'PACKING_MATERIAL'),
        },
      ],
    });

    const result = scaleRecipe(masters, dec(10_000), { applyOverage: true });

    it('adds nothing to a per-pack component', () => {
      // 10,000 units / 100 per pack = 100 cartons, and 100 is what is bought.
      const line = find(result, 'PM-CTN');

      expect(line.kind).toBe('PACKING');
      expect(line.baseQuantity.toString()).toBe('100');
      expect(line.overagePercent.toString()).toBe('0');
      expect(line.quantity.toString()).toBe('100');
    });

    it('nor to a per-batch one', () => {
      const line = find(result, 'PM-LEAF');

      expect(line.baseQuantity.toString()).toBe('2');
      expect(line.quantity.toString()).toBe('2');
    });
  });

  describe('packing materials, once the column exists', () => {
    // THE EXTENSIBILITY TEST, and the reason the packing line's overage is
    // typed optional and read even though nothing sets it yet: the day the
    // column is added, the value arrives on the row and this is what happens.
    // No second code path, no redesign of Required Stock.
    const masters = recipe([{ code: 'RM-A', quantityPer: '2', overagePercent: '5' }], '0', {
      packVariant: '10x10 blister',
      unitsPerPack: dec(100),
      lines: [
        {
          itemId: 'item-PM-CTN',
          quantityPer: dec(1),
          quantityBasis: 'PER_PACK',
          overagePercent: dec('3'),
          item: item('PM-CTN', 'PACKING_MATERIAL'),
        },
        {
          itemId: 'item-PM-LEAF',
          quantityPer: dec(2),
          quantityBasis: 'PER_BATCH',
          overagePercent: dec('10'),
          item: item('PM-LEAF', 'PACKING_MATERIAL'),
        },
      ],
    });

    const result = scaleRecipe(masters, dec(10_000), { applyOverage: true });

    it('applies a packing component’s own rate', () => {
      expect(find(result, 'PM-CTN').overagePercent.toString()).toBe('3');
      expect(find(result, 'PM-CTN').quantity.toString()).toBe('103');
    });

    it('independently of every other line', () => {
      expect(find(result, 'PM-LEAF').overagePercent.toString()).toBe('10');
      expect(find(result, 'PM-LEAF').quantity.toString()).toBe('2.2');
      expect(find(result, 'RM-A').overagePercent.toString()).toBe('5');
      expect(find(result, 'RM-A').quantity.toString()).toBe('21');
    });

    it('and still adds nothing when overage is switched off', () => {
      const plain = scaleRecipe(masters, dec(10_000));

      expect(find(plain, 'PM-CTN').quantity.toString()).toBe('100');
      expect(find(plain, 'RM-A').quantity.toString()).toBe('20');
    });
  });

  describe('a formulation whose lines allow none', () => {
    const masters = recipe([{ code: 'RM-A', quantityPer: '2' }], '0');

    it('changes nothing even when overage is asked for', () => {
      const line = find(scaleRecipe(masters, dec(10_000), { applyOverage: true }), 'RM-A');

      expect(line.baseQuantity.toString()).toBe('20');
      expect(line.overagePercent.toString()).toBe('0');
      expect(line.quantity.toString()).toBe('20');
    });
  });

  describe('the numbers on screen add up', () => {
    // The base is rounded before the overage is taken off it, so a reader can
    // check base + pct = final on the row. Rounding only at the end would give
    // three numbers that do not reconcile.
    const masters = recipe([{ code: 'RM-ODD', quantityPer: '0.3333', overagePercent: '7.5' }], '0');

    it('reconciles to three decimal places', () => {
      const line = find(scaleRecipe(masters, dec(10_000), { applyOverage: true }), 'RM-ODD');

      const expected = line.baseQuantity
        .mul(line.overagePercent)
        .div(100)
        .plus(line.baseQuantity)
        .toDecimalPlaces(3);

      expect(line.quantity.toString()).toBe(expected.toString());
    });
  });

  describe('what the measuring callers see', () => {
    // Job work's readiness gate and variance report must be untouched: overage
    // is an allowance for buying, not a target to measure a batch against.
    const masters = recipe(
      [
        { code: 'RM-A', quantityPer: '2', overagePercent: '5' },
        { code: 'RM-B', quantityPer: '1', overagePercent: '10' },
      ],
      '0',
    );

    it('is exactly the formulation, with no allowance added', () => {
      const result = scaleRecipe(masters, dec(10_000));

      for (const line of typeof result === 'string' ? [] : result) {
        expect(line.overagePercent.toString()).toBe('0');
        expect(line.quantity.toString()).toBe(line.baseQuantity.toString());
      }

      expect(find(result, 'RM-A').quantity.toString()).toBe('20');
      expect(find(result, 'RM-B').quantity.toString()).toBe('10');
    });
  });
});
