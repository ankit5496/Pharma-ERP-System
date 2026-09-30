import { Prisma } from '@pharma-erp/database';
import type { ItemSummary, JobWorkMaterialKind } from '@pharma-erp/types';

import { toItemSummary } from './production.mappers';

/**
 * A TRANSACTION CLIENT, NOT THE SCOPED ONE, and that is the point.
 *
 * Every operation on `prisma.scoped` opens a transaction of its own — BEGIN,
 * set_config, the query, COMMIT — which measures at about 1,160ms against this
 * database where the query alone costs 277ms. Four round trips per query is
 * what made the job-work screens slow enough to trip a thirty-second client
 * timeout.
 *
 * Demanding a transaction client here means a caller cannot accidentally pay
 * that price twice: it has to open one transaction and read everything inside
 * it. The type is the reminder.
 */
export type RecipeReader = Prisma.TransactionClient;

/**
 * What a run of a given size needs, from the formulation and the pack
 * specification.
 *
 * SHARED, and deliberately not owned by any one module. Job work asks it what a
 * batch needs before a production order may be raised and again when comparing
 * what was drawn; Procure-to-Pay asks it what a sales order needs before
 * deciding what to buy. Three copies of this arithmetic would eventually
 * disagree, and the disagreement would read as a stock error.
 *
 * A FUNCTION RATHER THAN A METHOD ON EITHER SERVICE, because both of them need
 * the same answer and neither owns it: the production order checks the
 * principal has sent enough before it is raised, and the batch record compares
 * what was drawn against it afterwards. Two copies of this arithmetic would
 * eventually disagree, and the disagreement would read as a stock error.
 *
 * THE ACTIVE FORMULATION, not the version pinned to the agreement — the same
 * choice the readiness check makes, and for the same reason: measuring one
 * version and manufacturing to another gives a screen that passes and a batch
 * that comes up short.
 *
 * SPLIT IN TWO, DELIBERATELY. Reading the masters is a database round trip;
 * scaling them to a batch size is arithmetic. The batch register compares
 * twenty batches that are usually the same product at the same size, and asking
 * the database once per batch — which is what a single combined function
 * invited — cost sixteen round trips to answer one question. `loadRecipes`
 * reads every product at once; `scaleRecipe` is pure.
 */

export interface MaterialRequirement {
  item: ItemSummary;
  kind: JobWorkMaterialKind;

  /**
   * What the masters call for, before any overage.
   *
   * CARRIED SEPARATELY so the figure can be shown beside the final one. A
   * purchase requisition for 21 kg where the formulation says 20 is a number
   * somebody will query, and "20 plus 5% overage" is the answer — which the
   * screen can only give if the two are kept apart.
   */
  baseQuantity: Prisma.Decimal;

  /** The overage applied to this line, as a percent. Zero when none was. */
  overagePercent: Prisma.Decimal;

  /** `baseQuantity` plus its overage. What to buy, or to issue. */
  quantity: Prisma.Decimal;
}

/** One product's two masters, as read. `null` where the master is absent. */
export interface ProductRecipe {
  productName: string;
  bom: {
    version: number;
    outputQuantity: Prisma.Decimal;
    /**
     * US-MD-03's product-level Default Overage %.
     *
     * READ BUT NOT APPLIED. The requirement is that each material line carries
     * its own allowance — a binder that spoils at 5% and an active dosed
     * exactly are different materials, and one figure across a formulation
     * cannot say so. Kept on the recipe because Master Data still holds and
     * shows it, and dropping it here would hide a field the BOM screen edits.
     */
    defaultOveragePercent: Prisma.Decimal;
    lines: {
      quantityPer: Prisma.Decimal;
/**
       * This material's own wastage allowance — US-MD-03.
       *
       * THE ONLY FIGURE THAT COUNTS. It used to fall back to the BOM's default
       * where a line set none; it no longer does. A formulation's materials
       * spoil at different rates, so the allowance belongs to the material, and
       * a product-level figure silently applied to every line is how an active
       * ingredient comes to be over-ordered by the binder's wastage rate.
       *
       * Null now means NO OVERAGE, not "inherit".
       */
      overagePercent: Prisma.Decimal | null;
      item: Prisma.ItemGetPayload<object>;
    }[];
  } | null;
  packaging: {
    /** The pack presentation, e.g. "10x10 blister". For the record, not the maths. */
    packVariant: string;
    unitsPerPack: Prisma.Decimal;
    lines: {
      itemId: string;
      quantityPer: Prisma.Decimal;
      quantityBasis: string;
      /**
       * The packing component's own overage — the same idea as a BOM line's.
       *
       * OPTIONAL BECAUSE THE COLUMN IS NOT THERE YET. `PackagingRequirementLine`
       * has no overage field today, so this is undefined on every row and every
       * packing component is grossed up by nothing, which is what the brief
       * asks for in the meantime.
       *
       * IT IS READ ANYWAY, and that is the point. `loadRecipes` selects whole
       * rows, so on the day the column is added and the client regenerated,
       * the value arrives here and the arithmetic below applies it with no
       * further change — no redesign of Required Stock, no second code path.
       */
      overagePercent?: Prisma.Decimal | null;
      item: Prisma.ItemGetPayload<object>;
    }[];
  } | null;
}

/**
 * Every named product's active formulation and pack specification, in two
 * queries however many products are asked for.
 */
export async function loadRecipes(
  client: RecipeReader,
  products: readonly { id: string; name: string }[],
): Promise<Map<string, ProductRecipe>> {
  const ids = [...new Set(products.map((product) => product.id))];

  if (ids.length === 0) return new Map();

  const [boms, packagings] = await Promise.all([
    client.bom.findMany({
      where: { productId: { in: ids }, isActive: true, deletedAt: null },
      include: { lines: { include: { item: true }, orderBy: { item: { code: 'asc' } } } },
    }),
    client.packagingRequirement.findMany({
      where: { productId: { in: ids }, isActive: true, deletedAt: null },
      include: { lines: { include: { item: true }, orderBy: { item: { code: 'asc' } } } },
    }),
  ]);

  const bomByProduct = new Map(boms.map((bom) => [bom.productId, bom]));
  const packagingByProduct = new Map(packagings.map((pack) => [pack.productId, pack]));

  return new Map(
    products.map((product) => {
      const bom = bomByProduct.get(product.id);
      const packaging = packagingByProduct.get(product.id);

      return [
        product.id,
        {
          productName: product.name,
          bom: bom
            ? {
                version: bom.version,
                outputQuantity: bom.outputQuantity,
                defaultOveragePercent: bom.defaultOveragePercent,
                lines: bom.lines,
              }
            : null,
          packaging: packaging
            ? {
                packVariant: packaging.packVariant,
                unitsPerPack: packaging.unitsPerPack,
                lines: packaging.lines,
              }
            : null,
        },
      ];
    }),
  );
}

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/** What scaling should do beyond the arithmetic. */
export interface ScaleOptions {
  /**
   * Add each line's overage to what the masters call for.
   *
   * OFF BY DEFAULT, and that is a decision rather than caution. Overage is an
   * allowance for what the process spoils, so it belongs to BUYING: a purchase
   * requisition that orders exactly what the formulation calls for buys a batch
   * that comes up short. It does NOT belong to the checks that measure a batch
   * — job work's readiness gate asks whether the principal sent enough to make
   * the run, and its variance report asks how much was actually drawn against
   * what the formulation called for. Adding a wastage allowance to either would
   * refuse consignments that are sufficient and report every batch as favourable
   * against an inflated target.
   *
   * So the callers that measure leave this alone and get exactly what they got
   * before; Required Stock turns it on.
   */
  applyOverage?: boolean;
}

/**
 * One line, with its overage worked out and shown.
 *
 * THE BASE IS ROUNDED FIRST, and then the overage is taken off that rounded
 * figure. Rounding only at the end would give a row whose three numbers do not
 * add up — 20.001 + 1.000 printed as 20 + 1 = 21.001 — and the whole point of
 * carrying the base is that somebody can check the arithmetic on screen.
 */
function withOverage(
  item: ItemSummary,
  kind: JobWorkMaterialKind,
  scaled: Prisma.Decimal,
  overagePercent: Prisma.Decimal,
): MaterialRequirement {
  const baseQuantity = scaled.toDecimalPlaces(3);

  if (overagePercent.isZero()) {
    return { item, kind, baseQuantity, overagePercent: ZERO, quantity: baseQuantity };
  }

  const overage = baseQuantity.mul(overagePercent).div(HUNDRED);

  return {
    item,
    kind,
    baseQuantity,
    overagePercent,
    quantity: baseQuantity.plus(overage).toDecimalPlaces(3),
  };
}

/**
 * The masters scaled to one batch size. Pure — no database.
 *
 * Returns the REASON as a string when there is nothing to scale, so the caller
 * can put it on screen: "this product has no active formulation" is the answer
 * somebody needs, and a 400 from a form that was only asking what a batch would
 * need is not.
 */
export function scaleRecipe(
  recipe: ProductRecipe | undefined,
  plannedQuantity: Prisma.Decimal,
  options: ScaleOptions = {},
): string | MaterialRequirement[] {
  if (!recipe) return 'That product could not be read.';

  const { bom, packaging } = recipe;

  if (!bom) {
    return (
      `${recipe.productName} has no active formulation, so there is nothing to work a material ` +
      'requirement out from. Create one under Formulations first.'
    );
  }

  if (bom.lines.length === 0) {
    return `Formulation version ${bom.version} lists no materials, so nothing could be issued.`;
  }

  const scale = plannedQuantity.div(bom.outputQuantity);

  // THE OVERAGE FOR A LINE: ITS OWN, OR NONE.
  //
  // ONE RULE FOR EVERY MATERIAL, raw and packing alike, which is what makes
  // this extensible rather than a raw-material special case. A line that names
  // an allowance is grossed up by it; a line that names none is grossed up by
  // nothing. There is no product-level fallback, deliberately — see the note on
  // `defaultOveragePercent`.
  //
  // Off entirely unless the caller asked for overage at all — see ScaleOptions.
  const overageFor = (lineOverage: Prisma.Decimal | null | undefined): Prisma.Decimal =>
    options.applyOverage ? (lineOverage ?? ZERO) : ZERO;

  const raw = bom.lines
    // A finished product listed as its own input is a data-entry trap; the
    // receipt form filters it for the same reason.
    .filter((line) => line.item.type !== 'FINISHED_GOOD')
    .map((line) =>
      withOverage(
        toItemSummary(line.item),
        (line.item.type === 'PACKING_MATERIAL' ? 'PACKING' : 'RAW') as JobWorkMaterialKind,
        line.quantityPer.mul(scale),
        overageFor(line.overagePercent),
      ),
    );

  const alreadyListed = new Set(raw.map((line) => line.item.id));

  // THE PACK, scaled by its own basis. A per-batch component is needed once
  // however big the batch; a per-pack one is needed once per pack, and how many
  // packs there are depends on how many units go in each.
  const packing = (packaging?.lines ?? [])
    .filter((line) => !alreadyListed.has(line.itemId))
    .map((line) => {
      const packs =
        line.quantityBasis === 'PER_BATCH'
          ? new Prisma.Decimal(1)
          : packaging && !packaging.unitsPerPack.isZero()
            ? plannedQuantity.div(packaging.unitsPerPack)
            : new Prisma.Decimal(0);

      // THE COMPONENT'S OWN, read exactly as a raw material's is.
      //
      // Undefined today, because PackagingRequirementLine has no such column,
      // so this resolves to no overage and nothing is added — which is the
      // stated behaviour until the field exists. The call is identical to the
      // raw-material one above so that adding the column is the whole change.
      return withOverage(
        toItemSummary(line.item),
        'PACKING' as JobWorkMaterialKind,
        line.quantityPer.mul(packs),
        overageFor(line.overagePercent),
      );
    });

  return [...raw, ...packing];
}

/** One product, read and scaled. For the callers that only ever need one. */
export async function materialRequirementFor(
  client: RecipeReader,
  product: { id: string; name: string },
  plannedQuantity: Prisma.Decimal,
  options: ScaleOptions = {},
): Promise<string | MaterialRequirement[]> {
  const recipes = await loadRecipes(client, [product]);

  return scaleRecipe(recipes.get(product.id), plannedQuantity, options);
}
