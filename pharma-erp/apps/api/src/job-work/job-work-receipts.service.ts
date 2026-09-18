import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type { JobWorkMaterialReceiptView } from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../procurement/numbering.service';
import { fromIsoDate, toItemSummary, toIsoDate } from '../production/production.mappers';
import { TenantContextService } from '../tenant/tenant-context.service';

import type { CreateJobWorkMaterialReceiptDto } from './dto/job-work-receipt.dto';
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
 * WHAT IT DOES CREATE is a StockLot tagged PRINCIPAL_OWNED, in the same table
 * every other lot lives in — which is what lets the principal's material be
 * issued FEFO by the existing material-issue service and appear in the existing
 * stock ledger. Separation comes from the `ownership` discriminator and the
 * `stock_lots_has_one_source` CHECK, not from a second table nothing else knows
 * how to read.
 *
 * THE LOT IS USABLE ON ARRIVAL, and this is the one place job work departs from
 * the purchase flow deliberately. A purchased lot lands in QUARANTINE because
 * incoming QC has to clear a VENDOR's material before it may be used (business
 * rule 6, in the procurement module). US-JW-02 describes no incoming-QC step:
 * it says the material is received against the principal's challan and added to
 * principal-owned stock, full stop. Holding it in quarantine would invent a gate
 * the specification does not have and would leave every pure-conversion batch
 * unissueable. The quality gate job work DOES have is US-JW-04, on the finished
 * batch, and that one is enforced.
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
   * Records a receipt and the principal-owned lot it creates, atomically.
   *
   * One transaction, because the receipt and the stock are the same event: a
   * receipt with no lot is material the store has taken in and cannot issue,
   * and a lot with no receipt is stock with no challan behind it. Either both
   * land or neither does (section 21 of the brief).
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

    const quantity = parseQuantity(dto.receivedQuantity, 'receivedQuantity');

    if (quantity.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException('The quantity received has to be more than zero.');
    }

    const item = await this.prisma.scoped.item.findFirst({
      where: { id: dto.itemId, deletedAt: null },
    });

    if (!item) throw new BadRequestException('That material is not in the item master.');

    // A finished product arriving as input material is a data-entry slip, and
    // the resulting lot would be issueable into its own formulation.
    if (item.type === 'FINISHED_GOOD') {
      throw new BadRequestException(
        `${item.code} is a finished product. A job-work material receipt records the input ` +
          'material a principal supplies, not finished goods.',
      );
    }

    assertDatesOrdered(dto.manufacturingDate ?? null, dto.expiryDate ?? null);

    const receipt = await this.prisma.transaction(async (tx) => {
      const receiptNumber = await this.numbering.next(tx, tenantId, 'JWR');
      // The lot takes a LOT-series number like every other lot, because it is
      // one: the store finds it in the same register and the same reports.
      const lotNumber = await this.numbering.next(tx, tenantId, 'LOT');

      const created = await tx.jobWorkMaterialReceipt.create({
        data: {
          tenantId,
          receiptNumber,
          jobWorkOrderId: order.id,
          deliveryChallanNumber: dto.deliveryChallanNumber.trim(),
          itemId: item.id,
          batchNumber: dto.batchNumber.trim(),
          receivedQuantity: quantity,
          manufacturingDate: dto.manufacturingDate ? fromIsoDate(dto.manufacturingDate) : null,
          expiryDate: dto.expiryDate ? fromIsoDate(dto.expiryDate) : null,
          notes: dto.notes?.trim() || null,
          receivedById: userId,
        },
      });

      await tx.stockLot.create({
        data: {
          tenantId,
          lotNumber,
          itemId: item.id,
          // SYSTEM-SET, and the DTO has no field for it. The CHECK constraint
          // then makes the pairing below the only storable one.
          ownership: 'PRINCIPAL_OWNED',
          jobWorkMaterialReceiptId: created.id,
          // No goods receipt line: there was no purchase. This is why the
          // column had to become nullable.
          goodsReceiptLineId: null,
          // The principal's own batch marking, kept in the field that means
          // "the supplier's number for this", which is exactly what it is.
          vendorBatchNumber: dto.batchNumber.trim(),
          manufacturingDate: dto.manufacturingDate ? fromIsoDate(dto.manufacturingDate) : null,
          expiryDate: dto.expiryDate ? fromIsoDate(dto.expiryDate) : null,
          quantityReceived: quantity,
          quantityAvailable: quantity,
          // See the class comment: US-JW-02 describes no incoming-QC gate for
          // principal-supplied material, and inventing one would strand every
          // pure-conversion batch.
          status: 'USABLE',
        },
      });

      // The same ledger every other movement is written to, so a principal's
      // material has a movement history for the same reason ours does. The
      // ledger is append-only at the database level.
      await tx.stockLedgerEntry.create({
        data: {
          tenantId,
          itemId: item.id,
          stockLotId: (await tx.stockLot.findFirstOrThrow({
            where: { jobWorkMaterialReceiptId: created.id },
            select: { id: true },
          })).id,
          // QC_ACCEPTED, not a receipt type. The ledger's GRN_QUARANTINE means
          // "arrived, not yet usable", which is untrue here: US-JW-02 has no
          // incoming-QC step, so the principal's material is usable on arrival.
          // This entry records exactly that — stock entering the usable pool —
          // and the `reference` and `notes` say it came in on a challan rather
          // than through a purchase.
          entryType: 'QC_ACCEPTED',
          quantityDelta: quantity,
          affectsUsableStock: true,
          reference: receiptNumber,
          notes:
            `Principal-owned material for ${order.orderNumber} on delivery challan ` +
            `${dto.deliveryChallanNumber.trim()}. Free of cost — not a purchase.`,
          createdById: userId,
        },
      });

      return tx.jobWorkMaterialReceipt.findFirstOrThrow({
        where: { id: created.id },
        include: RECEIPT_INCLUDE,
      });
    });

    return toReceiptView(receipt);
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
      principal: { select: { name: true } },
    },
  },
  item: true,
  receivedBy: { select: { fullName: true } },
  stockLot: { select: { lotNumber: true, quantityAvailable: true } },
} satisfies Prisma.JobWorkMaterialReceiptInclude;

type ReceiptWithRelations = Prisma.JobWorkMaterialReceiptGetPayload<{
  include: typeof RECEIPT_INCLUDE;
}>;

function toReceiptView(receipt: ReceiptWithRelations): JobWorkMaterialReceiptView {
  return {
    id: receipt.id,
    receiptNumber: receipt.receiptNumber,

    jobWorkOrderId: receipt.jobWorkOrder.id,
    jobWorkOrderNumber: receipt.jobWorkOrder.orderNumber,
    principalName: receipt.jobWorkOrder.principal.name,

    deliveryChallanNumber: receipt.deliveryChallanNumber,

    item: toItemSummary(receipt.item),
    batchNumber: receipt.batchNumber,
    receivedQuantity: receipt.receivedQuantity.toString(),

    manufacturingDate: receipt.manufacturingDate ? toIsoDate(receipt.manufacturingDate) : null,
    expiryDate: receipt.expiryDate ? toIsoDate(receipt.expiryDate) : null,
    notes: receipt.notes,

    // Constant by construction. Sent anyway so the screen shows the tag the
    // story asks for without hard-coding the word in the markup.
    stockOwnership: 'PRINCIPAL_OWNED',

    lotNumber: receipt.stockLot?.lotNumber ?? null,
    lotQuantityAvailable: receipt.stockLot?.quantityAvailable.toString() ?? null,

    receivedAt: receipt.receivedAt.toISOString(),
    receivedBy: receipt.receivedBy?.fullName ?? null,
  };
}

function assertDatesOrdered(manufacturingDate: string | null, expiryDate: string | null): void {
  if (manufacturingDate && expiryDate && expiryDate <= manufacturingDate) {
    throw new BadRequestException(
      'The expiry date has to be after the manufacturing date. Check the two dates on the challan.',
    );
  }
}
