import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  JobWorkMaterialReceiptView,
  JobWorkOrderMaterial,
  JobWorkReceiptStatus,
} from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../procurement/numbering.service';
import { fromIsoDate, toItemSummary, toIsoDate } from '../production/production.mappers';
import { TenantContextService } from '../tenant/tenant-context.service';

import type {
  CreateJobWorkMaterialReceiptDto,
  JobWorkMaterialReceiptLineDto,
} from './dto/job-work-receipt.dto';
import { JobWorkOrdersService, parseQuantity } from './job-work-orders.service';

const ZERO = new Prisma.Decimal(0);

/**
 * Free-of-cost material from the principal — US-JW-02.
 *
 * NOT A PURCHASE, and nothing here could make it one: no vendor is named, no
 * purchase order is looked up, no rate or tax is calculated, and no invoice is
 * raised. "This transaction does NOT create a Purchase transaction" holds
 * because there is no code path to it, not because a flag says so.
 *
 * A RECEIPT IS A DOCUMENT WITH MATERIALS ON IT. The header names the
 * consignment — principal, order, challan, date — and carries the one decision
 * taken at consignment level: whether it needs incoming QC. The lines are what
 * physically arrived, one per material and batch marking, each becoming its own
 * StockLot.
 *
 * WHAT IT CREATES is lots tagged PRINCIPAL_OWNED, in the same table every other
 * lot lives in — which is what lets the principal's material be issued FEFO by
 * the existing material-issue service and appear in the existing stock ledger.
 * Separation comes from the `ownership` discriminator and the
 * `stock_lots_has_one_source` CHECK, not from a second table nothing else knows
 * how to read.
 *
 * INCOMING QC IS THE SAME GATE PURCHASED MATERIAL PASSES THROUGH. A consignment
 * marked `qcRequired` lands in QUARANTINE and is released by the existing
 * incoming-QC screen, by a Quality Officer, against the existing QcResult
 * record. This reverses an earlier reading of US-JW-02 — which describes no
 * inspection step, so principal material used to be usable on arrival — because
 * "no step is described" is not the same as "no step is wanted", and material
 * entering a GMP plant unexamined is the more expensive mistake. The choice is
 * now explicit per consignment rather than implied by the code.
 */
@Injectable()
export class JobWorkReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly numbering: NumberingService,
    private readonly orders: JobWorkOrdersService,
  ) {}

  async list(jobWorkOrderId?: string): Promise<JobWorkMaterialReceiptView[]> {
    const receipts = await this.prisma.scoped.jobWorkMaterialReceipt.findMany({
      where: { deletedAt: null, ...(jobWorkOrderId ? { jobWorkOrderId } : {}) },
      include: RECEIPT_INCLUDE,
      orderBy: { receivedAt: 'desc' },
    });

    return receipts.map(toReceiptView);
  }

  /**
   * Everything the principal might ship against this order — of both kinds.
   *
   * TWO MASTERS, ONE LIST. The formulation says what goes into the product; the
   * pack specification says what it goes into. A principal supplies both, on
   * one challan, and reading only the BOM meant cartons and labels could not be
   * received at all. Each line says which kind it is so the form can show two
   * sections while still recording one receipt.
   *
   * THE RECIPE IS THE ONE THE ORDER IS PINNED TO, not the product's current
   * active version: the order froze a specific version when it was raised, and
   * that is what the principal agreed to supply for. The pack specification has
   * no such pinning, so the active one is used.
   *
   * Finished goods are excluded — a receipt records input material, and
   * offering the product itself as one of its own inputs is a data-entry trap.
   */
  async materialsFor(jobWorkOrderId: string): Promise<JobWorkOrderMaterial[]> {
    const order = await this.orders.requireOrder(jobWorkOrderId);

    const [bom, packaging] = await Promise.all([
      this.prisma.scoped.bom.findFirst({
        where: { id: order.mapping.bomId, deletedAt: null },
        include: {
          lines: { include: { item: true }, orderBy: { item: { code: 'asc' } } },
        },
      }),
      // THE PACK SPECIFICATION, which is a different master from the recipe.
      // A principal supplies cartons and labels as readily as they supply the
      // API, and those components are listed here and nowhere else — so a
      // receipt that only read the BOM could not take them in at all.
      this.prisma.scoped.packagingRequirement.findFirst({
        where: { productId: order.mapping.bom.product.id, isActive: true, deletedAt: null },
        include: {
          lines: { include: { item: true }, orderBy: { item: { code: 'asc' } } },
        },
      }),
    ]);

    if (!bom) {
      throw new BadRequestException(
        `${order.orderNumber} has no formulation behind it, so there is no list of materials to ` +
          'receive against. Map the product to a BOM on the agreement first.',
      );
    }

    const raw: JobWorkOrderMaterial[] = bom.lines
      // A finished product arriving as its own input is a data-entry trap.
      .filter((line) => line.item.type !== 'FINISHED_GOOD')
      .map((line) => ({
        item: toItemSummary(line.item),
        // BOM lines are typed by the item master, so a packing component
        // listed on a recipe is still a packing component and belongs in that
        // section rather than under "raw materials".
        kind: line.item.type === 'PACKING_MATERIAL' ? ('PACKING' as const) : ('RAW' as const),
        quantityPerBatch: line.quantityPer.toString(),
        quantityBasis: `per ${bom.outputQuantity.toString()}`,
        bomOutputQuantity: bom.outputQuantity.toString(),
      }));

    const alreadyListed = new Set(raw.map((material) => material.item.id));

    const packing: JobWorkOrderMaterial[] = (packaging?.lines ?? [])
      // A component on both masters is listed once. The recipe’s figure wins,
      // being the one the work order will actually scale.
      .filter((line) => !alreadyListed.has(line.itemId))
      .map((line) => ({
        item: toItemSummary(line.item),
        kind: 'PACKING' as const,
        quantityPerBatch: line.quantityPer.toString(),
        quantityBasis:
          line.quantityBasis === 'PER_BATCH'
            ? 'per batch'
            : `per pack of ${packaging?.unitsPerPack?.toString() ?? '?'}`,
        bomOutputQuantity: bom.outputQuantity.toString(),
      }));

    const materials = [...raw, ...packing];

    if (materials.length === 0) {
      throw new BadRequestException(
        `The formulation behind ${order.orderNumber} lists no input materials, so there is ` +
          'nothing for the principal to supply. Add its materials to the BOM first.',
      );
    }

    return materials;
  }

  /**
   * Records a challan and the principal-owned lots it creates, atomically.
   *
   * ONE TRANSACTION FOR THE WHOLE DELIVERY. The receipt and the stock are the
   * same event — a receipt with no lot is material the store has taken in and
   * cannot issue, and a lot with no receipt is stock with no challan behind it
   * — and so are the materials with respect to each other: a challan listing
   * three is one delivery, and recording two of the three because the third was
   * rejected leaves the store reconciling against a document that does not
   * match what is on the shelf. Either all of it lands or none does (section 21
   * of the brief).
   *
   * EVERY LINE IS VALIDATED BEFORE ANY IS WRITTEN, which is what makes that
   * promise cheap to keep: by the time the transaction opens, the only thing
   * that can fail is the database itself.
   */
  async create(dto: CreateJobWorkMaterialReceiptDto): Promise<JobWorkMaterialReceiptView> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const order = await this.orders.requireOrder(dto.jobWorkOrderId);

    // THE FROZEN MODEL ON THE ORDER, not the agreement's current one. If the
    // agreement were renegotiated to OWN_PROCUREMENT tomorrow, material already
    // in flight against this order is still the principal's.
    if (order.billingModel !== 'PURE_CONVERSION') {
      throw new ConflictException(
        `${order.orderNumber} is an own-procurement order, so its material is bought through the ` +
          'normal purchase flow — requisition, order, goods receipt and incoming QC. A job-work ' +
          'material receipt records material the PRINCIPAL supplied free of cost, which does not ' +
          'apply here.',
      );
    }

    const challan = dto.deliveryChallanNumber.trim();

    // THE MATERIALS THE FORMULATION ACTUALLY CALLS FOR. The form offers these
    // and nothing else, and checking them again here is what makes that true
    // rather than merely displayed: a hand-made request naming some other
    // item — or the same item twice — is refused, so a principal's challan
    // cannot quietly introduce stock the order never expected.
    const expected = await this.materialsFor(order.id);
    const expectedById = new Map(expected.map((material) => [material.item.id, material.item]));

    const prepared = dto.lines.map((line) =>
      this.prepareLine(line, order.orderNumber, expectedById),
    );

    const duplicated = prepared
      .map((line) => line.item)
      .filter((item, index, all) => all.findIndex((other) => other.id === item.id) !== index);

    if (duplicated[0]) {
      throw new BadRequestException(
        `${duplicated[0].code} is on this challan twice. Record the whole quantity of a material ` +
          'on one line, or enter the second delivery on its own challan.',
      );
    }

    // INSPECTED BY DEFAULT, matching the rule purchased material already lives
    // under: a receipt does not make material usable, incoming QC does. Someone
    // booking the consignment may say it is not needed — a principal shipping
    // under an agreed quality arrangement, say — and that choice is recorded on
    // the receipt and audited with the rest of the create.
    const qcRequired = dto.qcRequired ?? true;
    const lotStatus = qcRequired ? 'QUARANTINE' : 'USABLE';

    const receiptId = await this.prisma.transaction(async (tx) => {
      const receiptNumber = await this.numbering.next(tx, tenantId, 'JWR');

      const receipt = await tx.jobWorkMaterialReceipt.create({
        data: {
          tenantId,
          receiptNumber,
          jobWorkOrderId: order.id,
          deliveryChallanNumber: challan,
          receiptDate: fromIsoDate(dto.receiptDate),
          qcRequired,
          status: qcRequired ? 'PENDING_QC' : 'RELEASED',
          notes: dto.notes?.trim() || null,
          receivedById: userId,
        },
      });

      for (const line of prepared) {
        // The lot takes a LOT-series number like every other lot, because it is
        // one: the store finds it in the same register and the same reports.
        const lotNumber = await this.numbering.next(tx, tenantId, 'LOT');

        const created = await tx.jobWorkMaterialReceiptLine.create({
          data: {
            tenantId,
            receiptId: receipt.id,
            itemId: line.item.id,
            batchNumber: line.batchNumber,
            receivedQuantity: line.quantity,
            manufacturingDate: line.manufacturingDate,
            expiryDate: line.expiryDate,
            notes: line.notes,
          },
        });

        const lot = await tx.stockLot.create({
          data: {
            tenantId,
            lotNumber,
            itemId: line.item.id,
            // SYSTEM-SET, and the DTO has no field for it. The CHECK constraint
            // then makes the pairing below the only storable one.
            ownership: 'PRINCIPAL_OWNED',
            jobWorkMaterialReceiptLineId: created.id,
            // No goods receipt line: there was no purchase. This is why the
            // column had to become nullable.
            goodsReceiptLineId: null,
            // The principal's own batch marking, kept in the field that means
            // "the supplier's number for this", which is exactly what it is.
            vendorBatchNumber: line.batchNumber,
            manufacturingDate: line.manufacturingDate,
            expiryDate: line.expiryDate,
            quantityReceived: line.quantity,
            quantityAvailable: line.quantity,
            status: lotStatus,
          },
        });

        // The same ledger every other movement is written to, so a principal's
        // material has a movement history for the same reason ours does. The
        // ledger is append-only at the database level.
        await tx.stockLedgerEntry.create({
          data: {
            tenantId,
            itemId: line.item.id,
            stockLotId: lot.id,
            // The entry says what actually happened to the stock. Quarantined
            // material has arrived but is not usable, which is precisely what
            // GRN_QUARANTINE means; material taken in without an inspection
            // step enters the usable pool, which is QC_ACCEPTED.
            entryType: qcRequired ? 'GRN_QUARANTINE' : 'QC_ACCEPTED',
            quantityDelta: line.quantity,
            affectsUsableStock: !qcRequired,
            reference: receiptNumber,
            notes:
              `Principal-owned material for ${order.orderNumber} on delivery challan ` +
              `${challan}. Free of cost — not a purchase.` +
              (qcRequired ? ' Held for incoming QC.' : ''),
            createdById: userId,
          },
        });
      }

      return receipt.id;
    });

    return this.findOne(receiptId);
  }

  async findOne(id: string): Promise<JobWorkMaterialReceiptView> {
    const receipt = await this.prisma.scoped.jobWorkMaterialReceipt.findFirst({
      where: { id, deletedAt: null },
      include: RECEIPT_INCLUDE,
    });

    if (!receipt) throw new BadRequestException('That material receipt does not exist.');

    return toReceiptView(receipt);
  }

  /**
   * Brings a receipt's status back in line with its lines.
   *
   * CALLED AFTER AN INCOMING-QC DECISION, from the QC service. The header's
   * status is a summary of its lots and nothing else, so it is recomputed from
   * them rather than advanced by hand — which is what stops a consignment
   * reading "released" while one of its drums sits rejected.
   *
   * Takes the transaction it is called in, so the decision and the summary
   * land together or not at all.
   */
  async syncStatus(
    tx: Prisma.TransactionClient,
    receiptId: string,
  ): Promise<JobWorkReceiptStatus> {
    const lines = await tx.jobWorkMaterialReceiptLine.findMany({
      where: { receiptId, deletedAt: null },
      select: { stockLot: { select: { status: true } } },
    });

    const statuses = lines.map((line) => line.stockLot?.status ?? null);

    // Worst-first: one rejected drum makes the consignment rejected, and one
    // drum still in quarantine means the consignment is not through QC yet.
    // Anything else — every lot usable, or consumed and gone — is released.
    const status: JobWorkReceiptStatus = statuses.includes('REJECTED')
      ? 'REJECTED'
      : statuses.includes('ON_HOLD')
        ? 'ON_HOLD'
        : statuses.includes('QUARANTINE')
          ? 'PENDING_QC'
          : 'RELEASED';

    await tx.jobWorkMaterialReceipt.update({ where: { id: receiptId }, data: { status } });

    return status;
  }

  /**
   * Checks one line of the challan, and turns it into what the writer needs.
   *
   * Pure and synchronous on purpose: every line goes through this before the
   * transaction opens, so a bad fourth material cannot leave three lines
   * committed and three lot numbers spent out of the series.
   */
  private prepareLine(
    line: JobWorkMaterialReceiptLineDto,
    orderNumber: string,
    expected: Map<string, PreparedLine['item']>,
  ): PreparedLine {
    const item = expected.get(line.itemId);

    if (!item) {
      throw new BadRequestException(
        'That material is not in the formulation behind ' +
          `${orderNumber}, so it cannot be received against it. Receive only the materials the ` +
          'order lists.',
      );
    }

    const quantity = parseQuantity(line.receivedQuantity, 'receivedQuantity');

    if (quantity.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException(
        `The quantity received for ${item.code} has to be more than zero.`,
      );
    }

    assertDatesOrdered(item.code, line.manufacturingDate ?? null, line.expiryDate ?? null);

    return {
      item,
      batchNumber: line.batchNumber.trim(),
      quantity,
      manufacturingDate: line.manufacturingDate ? fromIsoDate(line.manufacturingDate) : null,
      expiryDate: line.expiryDate ? fromIsoDate(line.expiryDate) : null,
      notes: line.notes?.trim() || null,
    };
  }
}

// -----------------------------------------------------------------------------
// Shapes and helpers
// -----------------------------------------------------------------------------

const RECEIPT_INCLUDE = {
  jobWorkOrder: {
    select: {
      id: true,
      orderNumber: true,
      principal: { select: { id: true, name: true } },
    },
  },
  receivedBy: { select: { fullName: true } },
  lines: {
    where: { deletedAt: null },
    include: {
      item: true,
      stockLot: true,
    },
    orderBy: { item: { code: 'asc' } },
  },
} satisfies Prisma.JobWorkMaterialReceiptInclude;

type ReceiptWithRelations = Prisma.JobWorkMaterialReceiptGetPayload<{
  include: typeof RECEIPT_INCLUDE;
}>;

/** One validated line, ready to write. */
interface PreparedLine {
  item: JobWorkOrderMaterial['item'];
  batchNumber: string;
  quantity: Prisma.Decimal;
  manufacturingDate: Date | null;
  expiryDate: Date | null;
  notes: string | null;
}

function toReceiptView(receipt: ReceiptWithRelations): JobWorkMaterialReceiptView {
  return {
    id: receipt.id,
    receiptNumber: receipt.receiptNumber,

    jobWorkOrderId: receipt.jobWorkOrder.id,
    jobWorkOrderNumber: receipt.jobWorkOrder.orderNumber,
    principalId: receipt.jobWorkOrder.principal.id,
    principalName: receipt.jobWorkOrder.principal.name,

    deliveryChallanNumber: receipt.deliveryChallanNumber,
    receiptDate: toIsoDate(receipt.receiptDate),

    qcRequired: receipt.qcRequired,
    status: receipt.status as JobWorkReceiptStatus,

    notes: receipt.notes,

    lines: receipt.lines.map((line) => ({
      id: line.id,
      item: toItemSummary(line.item),
      batchNumber: line.batchNumber,
      receivedQuantity: line.receivedQuantity.toString(),
      manufacturingDate: line.manufacturingDate ? toIsoDate(line.manufacturingDate) : null,
      expiryDate: line.expiryDate ? toIsoDate(line.expiryDate) : null,
      notes: line.notes,

      // Constant by construction. Sent anyway so the screen shows the tag the
      // story asks for without hard-coding the word in the markup.
      stockOwnership: 'PRINCIPAL_OWNED',

      lotId: line.stockLot?.id ?? null,
      lotNumber: line.stockLot?.lotNumber ?? null,
      lotStatus: line.stockLot?.status ?? null,
      lotQuantityAvailable: line.stockLot?.quantityAvailable.toString() ?? null,
    })),

    totalReceivedQuantity: receipt.lines
      .reduce((total, line) => total.add(line.receivedQuantity), ZERO)
      .toString(),

    receivedAt: receipt.receivedAt.toISOString(),
    receivedBy: receipt.receivedBy?.fullName ?? null,
  };
}

function assertDatesOrdered(
  itemCode: string,
  manufacturingDate: string | null,
  expiryDate: string | null,
): void {
  if (manufacturingDate && expiryDate && expiryDate <= manufacturingDate) {
    // Named, because a challan carries several materials and "the two dates"
    // is not enough to find the one that is wrong.
    throw new BadRequestException(
      `The expiry date for ${itemCode} has to be after its manufacturing date. Check the two ` +
        'dates on the challan.',
    );
  }
}
