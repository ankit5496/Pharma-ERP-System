import { Prisma } from '@pharma-erp/database';
import type { ItemSummary, JobWorkMaterialKind } from '@pharma-erp/types';

import { toItemSummary } from '../production/production.mappers';

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
 * What a job-work batch of a given size needs, from the formulation and the
 * pack specification.
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
  quantity: Prisma.Decimal;
}

/** One product's two masters, as read. `null` where the master is absent. */
export interface ProductRecipe {
  productName: string;
  bom: {
    version: number;
    outputQuantity: Prisma.Decimal;
    lines: { quantityPer: Prisma.Decimal; item: Prisma.ItemGetPayload<object> }[];
  } | null;
  packaging: {
    unitsPerPack: Prisma.Decimal;
    lines: {
      itemId: string;
      quantityPer: Prisma.Decimal;
      quantityBasis: string;
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
            ? { version: bom.version, outputQuantity: bom.outputQuantity, lines: bom.lines }
            : null,
          packaging: packaging
            ? { unitsPerPack: packaging.unitsPerPack, lines: packaging.lines }
            : null,
        },
      ];
    }),
  );
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

  const raw = bom.lines
    // A finished product listed as its own input is a data-entry trap; the
    // receipt form filters it for the same reason.
    .filter((line) => line.item.type !== 'FINISHED_GOOD')
    .map((line) => ({
      item: toItemSummary(line.item),
      kind: (line.item.type === 'PACKING_MATERIAL' ? 'PACKING' : 'RAW') as JobWorkMaterialKind,
      quantity: line.quantityPer.mul(scale).toDecimalPlaces(3),
    }));

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

      return {
        item: toItemSummary(line.item),
        kind: 'PACKING' as JobWorkMaterialKind,
        quantity: line.quantityPer.mul(packs).toDecimalPlaces(3),
      };
    });

  return [...raw, ...packing];
}

/** One product, read and scaled. For the callers that only ever need one. */
export async function materialRequirementFor(
  client: RecipeReader,
  product: { id: string; name: string },
  plannedQuantity: Prisma.Decimal,
): Promise<string | MaterialRequirement[]> {
  const recipes = await loadRecipes(client, [product]);

  return scaleRecipe(recipes.get(product.id), plannedQuantity);
}
