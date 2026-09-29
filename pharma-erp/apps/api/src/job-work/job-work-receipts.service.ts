import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  JobWorkMaterialReceiptView,
  JobWorkOrderMaterial,
  JobWorkReceiptStatus,
} from '@pharma-erp/types';
import { JOB_WORK_RECEIPT_STATUS_LABELS, JOB_WORK_RECEIPT_STATUSES } from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../procurement/numbering.service';
import { fromIsoDate, toItemSummary, toIsoDate } from '../production/production.mappers';
import { TenantContextService } from '../tenant/tenant-context.service';

import type {
  CreateJobWorkMaterialReceiptDto,
  DecideJobWorkReceiptDto,
  JobWorkMaterialReceiptLineDto,
} from './dto/job-work-receipt.dto';
import { jobWorkListWhere, statusIn, type JobWorkListQueryDto } from './job-work-list-query';
import { JobWorkOrdersService, parseQuantity } from './job-work-orders.service';

const ZERO = new Prisma.Decimal(0);

/**
 * How a status reads inside a refusal.
 *
 * Lower case and in the middle of a sentence — "JWR-2026-0001 is pending
 * approval" — rather than the title-case labels the screens use.
 */
const RECEIPT_STATUS_WORDS: Record<string, string> = {
  DRAFT: 'still a draft',
  PENDING_APPROVAL: 'pending approval',
  APPROVED: 'approved',
  ON_HOLD: 'on hold',
  REJECTED: 'rejected',
};

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

  /** The register, filtered in the database. See `jobWorkListWhere`. */
  async list(
    jobWorkOrderId?: string,
    query: JobWorkListQueryDto = {},
  ): Promise<JobWorkMaterialReceiptView[]> {
    const search = query.search?.trim();

    // THE RECEIPT'S OWN CREATOR COLUMN. A consignment is received rather than
    // created, and the column says so; the filter means the same thing.
    const status = statusIn(query.status, JOB_WORK_RECEIPT_STATUSES);

    const receipts = await this.prisma.scoped.jobWorkMaterialReceipt.findMany({
      where: {
        deletedAt: null,
        ...(jobWorkOrderId ? { jobWorkOrderId } : {}),
        ...jobWorkListWhere(query, 'receivedById'),
        ...(status ? { status } : {}),
        ...(query.principalId ? { jobWorkOrder: { principalId: query.principalId } } : {}),
        ...(query.billingModel
          ? { jobWorkOrder: { billingModel: query.billingModel } }
          : {}),
        ...(search
          ? {
              OR: [
                { receiptNumber: { contains: search, mode: 'insensitive' } },
                { jobWorkOrder: { orderNumber: { contains: search, mode: 'insensitive' } } },
                {
                  jobWorkOrder: {
                    principal: { name: { contains: search, mode: 'insensitive' } },
                  },
                },
                { lines: { some: { deliveryChallanNumber: { contains: search, mode: 'insensitive' } } } },
                { lines: { some: { batchNumber: { contains: search, mode: 'insensitive' } } } },
                { lines: { some: { item: { code: { contains: search, mode: 'insensitive' } } } } },
                { lines: { some: { item: { name: { contains: search, mode: 'insensitive' } } } } },
              ],
            }
          : {}),
      },
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
   * Adds a delivery to the order's open receipt, creating it if there is none.
   *
   * ONE RECEIPT PER ORDER, PER RECEIVING CYCLE. A principal sends material for
   * one order across several challans — the API on Monday, the cartons on
   * Thursday — and booking each as its own document left a register with four
   * rows for one delivery and nothing to approve as a whole. So the materials
   * join the order’s DRAFT receipt, whichever challan they came on, and the
   * challan number travels on the line.
   *
   * A receipt that has been submitted is closed to additions: it is a document
   * somebody is being asked to approve, and adding to it after the fact would
   * change what they were shown. Material arriving then opens a fresh draft.
   *
   * NOTHING IS ISSUABLE YET. Every lot lands in QUARANTINE and stays there
   * until the receipt is approved — which is the whole point of the workflow
   * this sits in, and is enforced by the lot status rather than by a flag.
   */
  async create(dto: CreateJobWorkMaterialReceiptDto): Promise<JobWorkMaterialReceiptView> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const order = await this.orders.requireOrder(dto.jobWorkOrderId);

    // THE FROZEN MODEL ON THE ORDER, not the agreement’s current one. If the
    // agreement were renegotiated to OWN_PROCUREMENT tomorrow, material already
    // in flight against this order is still the principal’s.
    if (order.billingModel !== 'PURE_CONVERSION') {
      throw new ConflictException(
        `${order.orderNumber} is an own-procurement order, so its material is bought through the ` +
          'normal purchase flow — requisition, order, goods receipt and incoming QC. A job-work ' +
          'material receipt records material the PRINCIPAL supplied free of cost, which does not ' +
          'apply here.',
      );
    }

    const challan = dto.deliveryChallanNumber.trim();

    // THE MATERIALS THE ORDER ACTUALLY EXPECTS — its formulation and its pack
    // specification. Checked here and not only on the form: a hand-made request
    // naming some other item is refused, so a principal’s challan cannot
    // quietly introduce stock the order never expected.
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

    const receiptId = await this.prisma.transaction(async (tx) => {
      // The order’s open receipt, or a new one. Read inside the transaction so
      // two people booking at once cannot both decide there is none.
      const open = await tx.jobWorkMaterialReceipt.findFirst({
        where: { jobWorkOrderId: order.id, status: 'DRAFT', deletedAt: null },
        select: { id: true },
      });

      const receipt =
        open ??
        (await tx.jobWorkMaterialReceipt.create({
          data: {
            tenantId,
            receiptNumber: await this.numbering.next(tx, tenantId, 'JWR'),
            jobWorkOrderId: order.id,
            receiptDate: fromIsoDate(dto.receiptDate),
            notes: dto.notes?.trim() || null,
            receivedById: userId,
          },
          select: { id: true },
        }));

      // A material already on the open receipt is a second delivery of it, and
      // that is ordinary — the two lots stay separate, as they physically are.
      //
      // THE SAME CHALLAN AND THE SAME BATCH IS NOT A SECOND DELIVERY. It is the
      // same drum booked twice, which is what a double-submitted form produces:
      // a receipt in the field came back with every material on it twice, same
      // quantity, same challan number. Two lots were created for one physical
      // drum and the principal's account was overstated by exactly double.
      //
      // Checked against what is ALREADY STORED, not just within this request —
      // the within-request check above cannot see the first submission.
      const already = await tx.jobWorkMaterialReceiptLine.findMany({
        where: {
          receiptId: receipt.id,
          deliveryChallanNumber: challan,
          itemId: { in: prepared.map((line) => line.item.id) },
          deletedAt: null,
        },
        select: { itemId: true, batchNumber: true },
      });

      const seen = new Set(already.map((line) => `${line.itemId}:${line.batchNumber}`));

      const repeated = prepared.find((line) => seen.has(`${line.item.id}:${line.batchNumber}`));

      if (repeated) {
        throw new ConflictException(
          `${repeated.item.code} batch ${repeated.batchNumber} is already recorded on challan ` +
            `${challan} for this receipt. That delivery has been booked — recording it again ` +
            'would create a second lot for one drum. Use a different batch number if this is a ' +
            'genuinely separate consignment.',
        );
      }

      for (const line of prepared) {
        // The lot takes a LOT-series number like every other lot, because it is
        // one: the store finds it in the same register and the same reports.
        const lotNumber = await this.numbering.next(tx, tenantId, 'LOT');

        const created = await tx.jobWorkMaterialReceiptLine.create({
          data: {
            tenantId,
            receiptId: receipt.id,
            itemId: line.item.id,
            deliveryChallanNumber: challan,
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
            // The principal’s own batch marking, kept in the field that means
            // "the supplier’s number for this", which is exactly what it is.
            vendorBatchNumber: line.batchNumber,
            manufacturingDate: line.manufacturingDate,
            expiryDate: line.expiryDate,
            quantityReceived: line.quantity,
            quantityAvailable: line.quantity,
            // Quarantined until the receipt is approved. There is no longer a
            // per-consignment choice about this.
            status: 'QUARANTINE',
          },
        });

        // The same ledger every other movement is written to, so a principal’s
        // material has a movement history for the same reason ours does. The
        // ledger is append-only at the database level.
        await tx.stockLedgerEntry.create({
          data: {
            tenantId,
            itemId: line.item.id,
            stockLotId: lot.id,
            // Arrived, not yet usable — which is precisely what this type means.
            entryType: 'GRN_QUARANTINE',
            quantityDelta: line.quantity,
            affectsUsableStock: false,
            reference: challan,
            notes:
              `Principal-owned material for ${order.orderNumber} on delivery challan ` +
              `${challan}. Free of cost — not a purchase. Held pending approval.`,
            createdById: userId,
          },
        });
      }

      return receipt.id;
    });

    return this.findOne(receiptId);
  }

  /**
   * Says the delivery is completely recorded, and asks for it to be approved.
   *
   * NOT THE APPROVAL. This is the store officer stating that what is on the
   * receipt is what arrived; the quality decision is somebody else’s, on the
   * Quality Check screen. Keeping the two apart is the point of the stage —
   * one action would let whoever booked the material also clear it.
   */

  /**
   * Corrects a receipt that is still a DRAFT.
   *
   * WHY ONLY A DRAFT, and why that is not a limitation. A draft is a delivery
   * somebody is still writing down: nothing has been approved, every lot it
   * created is quarantined, and no production order can have drawn on it. The
   * moment it is sent for approval it becomes a document a quality officer is
   * being asked to judge, and changing it underneath them is the one thing a
   * consignment record must never do. So this refuses anything else, and the
   * screen offers Edit on drafts and View on the rest for the same reason.
   *
   * REPLACES THE WHOLE SET rather than patching lines one by one. A correction
   * to a challan is a restatement — this drum, not that one, and 40 kg rather
   * than 400 — and matching old lines to new ones by position or by batch
   * number invents an identity the paperwork does not have. Replacing is also
   * the only version of this that is obviously correct at a glance.
   *
   * THE LINES ARE SOFT-DELETED, NOT REMOVED. `job_work_material_receipt_lines`
   * carries a no-hard-delete trigger, and rightly: a line that was recorded and
   * then corrected is part of what happened. Its lot is emptied and closed, and
   * the ledger gets a reversing entry rather than losing the original — the
   * ledger is append-only for the same reason.
   */
  async update(
    id: string,
    dto: CreateJobWorkMaterialReceiptDto,
  ): Promise<JobWorkMaterialReceiptView> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const existing = await this.requireReceipt(id);

    if (existing.status !== 'DRAFT') {
      throw new ConflictException(
        `${existing.receiptNumber} is ${JOB_WORK_RECEIPT_STATUS_LABELS[
          existing.status
        ].toLowerCase()}, so it can no longer be changed. A consignment already with the quality ` +
          'user is theirs to decide on; material that arrives now opens a fresh receipt.',
      );
    }

    const order = await this.orders.requireOrder(existing.jobWorkOrderId);

    // THE SAME CHECKS THE FIRST ENTRY PASSED. A correction is not a lesser
    // document, and an edit that skipped the material and date rules would be
    // the way round them.
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

    const challan = dto.deliveryChallanNumber.trim();

    await this.prisma.transaction(async (tx) => {
      const current = await tx.jobWorkMaterialReceiptLine.findMany({
        where: { receiptId: existing.id, deletedAt: null },
        include: { stockLot: true, issueLines: { take: 1 } },
      });

      // BELT AND BRACES. A draft's material cannot have been issued — issuing
      // requires an approved receipt — so this is unreachable rather than
      // defensive. Stated as a refusal anyway, because the cost of being wrong
      // is stock that was dispensed and then unrecorded.
      const issued = current.find((line) => line.issueLines.length > 0);

      if (issued) {
        throw new ConflictException(
          `Material on ${existing.receiptNumber} has already been issued to production, so the ` +
            'receipt can no longer be corrected.',
        );
      }

      const now = new Date();

      for (const line of current) {
        await tx.jobWorkMaterialReceiptLine.update({
          where: { id: line.id },
          data: { deletedAt: now },
        });

        if (!line.stockLot) continue;

        // The drum this line put on the shelf, emptied and closed. CONSUMED
        // rather than deleted: the lot number was allocated and reports have
        // seen it, and a number that vanishes is worse than one that ends.
        await tx.stockLot.update({
          where: { id: line.stockLot.id },
          data: { quantityAvailable: ZERO, status: 'CONSUMED' },
        });

        await tx.stockLedgerEntry.create({
          data: {
            tenantId,
            itemId: line.itemId,
            stockLotId: line.stockLot.id,
            entryType: 'ADJUSTMENT',
            quantityDelta: line.stockLot.quantityAvailable.negated(),
            affectsUsableStock: false,
            resultingStatus: 'CONSUMED',
            reference: existing.receiptNumber,
            notes: `Reversed: ${existing.receiptNumber} was corrected before approval.`,
            createdById: userId,
          },
        });
      }

      await tx.jobWorkMaterialReceipt.update({
        where: { id: existing.id },
        data: {
          receiptDate: fromIsoDate(dto.receiptDate),
          notes: dto.notes?.trim() || null,
        },
      });

      // And the new set, written exactly as a first entry writes it.
      for (const line of prepared) {
        const lotNumber = await this.numbering.next(tx, tenantId, 'LOT');

        const created = await tx.jobWorkMaterialReceiptLine.create({
          data: {
            tenantId,
            receiptId: existing.id,
            itemId: line.item.id,
            deliveryChallanNumber: challan,
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
            ownership: 'PRINCIPAL_OWNED',
            jobWorkMaterialReceiptLineId: created.id,
            goodsReceiptLineId: null,
            vendorBatchNumber: line.batchNumber,
            manufacturingDate: line.manufacturingDate,
            expiryDate: line.expiryDate,
            quantityReceived: line.quantity,
            quantityAvailable: line.quantity,
            status: 'QUARANTINE',
          },
        });

        await tx.stockLedgerEntry.create({
          data: {
            tenantId,
            itemId: line.item.id,
            stockLotId: lot.id,
            entryType: 'GRN_QUARANTINE',
            quantityDelta: line.quantity,
            affectsUsableStock: false,
            resultingStatus: 'QUARANTINE',
            reference: existing.receiptNumber,
            notes: `Recorded on challan ${challan} (corrected).`,
            createdById: userId,
          },
        });
      }
    });

    return this.findOne(existing.id);
  }

  async submit(id: string): Promise<JobWorkMaterialReceiptView> {
    const receipt = await this.requireReceipt(id);

    if (receipt.status !== 'DRAFT') {
      throw new ConflictException(
        `${receipt.receiptNumber} has already been sent for approval — it is ` +
          `${RECEIPT_STATUS_WORDS[receipt.status]}. A receipt is submitted once.`,
      );
    }

    if (receipt.lines.length === 0) {
      throw new BadRequestException(
        `${receipt.receiptNumber} has no material on it yet. Record what arrived before ` +
          'sending it for approval.',
      );
    }

    await this.prisma.scoped.jobWorkMaterialReceipt.update({
      where: { id: receipt.id },
      data: {
        status: 'PENDING_APPROVAL',
        submittedById: this.tenantContext.getUserId(),
        submittedAt: new Date(),
      },
    });

    return this.findOne(receipt.id);
  }

  /**
   * The quality decision on a whole consignment.
   *
   * ONE DECISION FOR THE RECEIPT, and every lot under it follows. A principal
   * delivers a consignment and it is accepted or it is not; deciding drum by
   * drum was the purchased-material model, and it left a store officer with
   * four decisions to make about one delivery.
   *
   * A QcResult IS STILL WRITTEN PER LOT. That is the existing quality record —
   * the same table incoming QC writes, carrying the same inspector, reference
   * and remarks — so a principal’s material has the same evidence behind it as
   * anything bought, and a recall reads one register rather than two.
   */
  async decide(
    id: string,
    dto: DecideJobWorkReceiptDto,
  ): Promise<JobWorkMaterialReceiptView> {
    const tenantId = this.tenantContext.requireTenantId();
    // A quality decision must be attributable; an unattributed one is not a
    // quality record at all.
    const inspectedById = this.tenantContext.getUserId();

    if (!inspectedById) {
      throw new BadRequestException('A quality decision has to be recorded by a signed-in user.');
    }

    const receipt = await this.requireReceipt(id);

    if (receipt.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(
        `${receipt.receiptNumber} is ${RECEIPT_STATUS_WORDS[receipt.status]}. Only a receipt ` +
          'waiting for approval can be decided.',
      );
    }

    if (dto.decision !== 'APPROVED' && !dto.notes?.trim()) {
      // A rejection or a hold has consequences for the principal and may end in
      // material going back. Requiring the reason at the point of decision is
      // the only time anyone reliably records it.
      throw new BadRequestException(
        'A reason is required when holding or rejecting a consignment.',
      );
    }

    const decision = dto.decision;
    const lotStatus = decision === 'APPROVED' ? 'USABLE' : decision === 'REJECTED' ? 'REJECTED' : 'ON_HOLD';

    await this.prisma.transaction(async (tx) => {
      for (const line of receipt.lines) {
        if (!line.stockLot) continue;

        const quantity = line.stockLot.quantityAvailable;

        await tx.qcResult.create({
          data: {
            tenantId,
            stockLotId: line.stockLot.id,
            decision: decision === 'APPROVED' ? 'ACCEPTED' : decision,
            testReference: dto.testReference?.trim() || null,
            remarks: dto.notes?.trim() || null,
            inspectedById,
          },
        });

        await tx.stockLot.update({
          where: { id: line.stockLot.id },
          data: { status: lotStatus },
        });

        // Quarantine empties either way; usable stock gains only on approval.
        await tx.stockLedgerEntry.create({
          data: {
            tenantId,
            itemId: line.itemId,
            stockLotId: line.stockLot.id,
            entryType:
              decision === 'APPROVED'
                ? 'QC_ACCEPTED'
                : decision === 'REJECTED'
                  ? 'QC_REJECTED'
                  : 'QC_HOLD',
            quantityDelta: decision === 'APPROVED' ? quantity : quantity.negated(),
            affectsUsableStock: decision === 'APPROVED',
            reference: receipt.receiptNumber,
            notes:
              decision === 'APPROVED'
                ? `Approved on ${receipt.receiptNumber}; released into principal-owned stock.`
                : `${RECEIPT_STATUS_WORDS[decision]} on ${receipt.receiptNumber}: ${
                    dto.notes?.trim() ?? 'no reason recorded'
                  }.`,
            createdById: inspectedById,
          },
        });
      }

      await tx.jobWorkMaterialReceipt.update({
        where: { id: receipt.id },
        data: {
          status: decision,
          decidedById: inspectedById,
          decidedAt: new Date(),
          decisionNotes: dto.notes?.trim() || null,
        },
      });
    });

    return this.findOne(receipt.id);
  }

  private async requireReceipt(id: string) {
    const receipt = await this.prisma.scoped.jobWorkMaterialReceipt.findFirst({
      where: { id, deletedAt: null },
      include: RECEIPT_INCLUDE,
    });

    if (!receipt) throw new BadRequestException('That material receipt does not exist.');

    return receipt;
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

/**
 * Exported so the production order can embed a receipt without a second mapper.
 *
 * One shape for "a receipt as the screens see it" — a production order showing
 * different material from the receipt it names would be the worst kind of bug,
 * silent and plausible.
 */
export const RECEIPT_INCLUDE = {
  jobWorkOrder: {
    select: {
      id: true,
      orderNumber: true,
      principal: { select: { id: true, name: true } },
      mapping: {
        select: {
          principalBrandName: true,
          bom: { select: { product: { select: { code: true, name: true } } } },
        },
      },
    },
  },
  receivedBy: { select: { fullName: true } },
  submittedBy: { select: { fullName: true } },
  decidedBy: { select: { fullName: true } },
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

export function toReceiptView(receipt: ReceiptWithRelations): JobWorkMaterialReceiptView {
  return {
    id: receipt.id,
    receiptNumber: receipt.receiptNumber,

    jobWorkOrderId: receipt.jobWorkOrder.id,
    jobWorkOrderNumber: receipt.jobWorkOrder.orderNumber,
    principalId: receipt.jobWorkOrder.principal.id,
    principalName: receipt.jobWorkOrder.principal.name,

    productName: receipt.jobWorkOrder.mapping.bom.product.name,
    productCode: receipt.jobWorkOrder.mapping.bom.product.code,
    principalBrandName: receipt.jobWorkOrder.mapping.principalBrandName,

    receiptDate: toIsoDate(receipt.receiptDate),

    status: receipt.status as JobWorkReceiptStatus,

    submittedBy: receipt.submittedBy?.fullName ?? null,
    submittedAt: receipt.submittedAt?.toISOString() ?? null,

    decidedBy: receipt.decidedBy?.fullName ?? null,
    decidedAt: receipt.decidedAt?.toISOString() ?? null,
    decisionNotes: receipt.decisionNotes,

    // In the order they were first seen, which is the order the material came.
    deliveryChallanNumbers: [
      ...new Set(receipt.lines.map((line) => line.deliveryChallanNumber)),
    ],

    rawMaterialCount: receipt.lines.filter((line) => line.item.type !== 'PACKING_MATERIAL')
      .length,
    packingMaterialCount: receipt.lines.filter((line) => line.item.type === 'PACKING_MATERIAL')
      .length,

    notes: receipt.notes,

    lines: receipt.lines.map((line) => ({
      id: line.id,
      item: toItemSummary(line.item),
      // Read off the item master rather than stored: an item reclassified later
      // then reads correctly here without a data fix.
      kind: line.item.type === 'PACKING_MATERIAL' ? 'PACKING' : 'RAW',
      deliveryChallanNumber: line.deliveryChallanNumber,
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

/**
 * The two dates on one received material, checked against each other and
 * against today.
 *
 * THE FORM ALREADY GREYS THESE OUT, and that is not the same as enforcing
 * them. A date typed into an API request never passed through a picker, and
 * the expiry on a drum is what decides whether production may dispense it — so
 * the rule lives here, where nothing can go round it.
 *
 * STRING COMPARISON IS CORRECT for YYYY-MM-DD: it is lexicographic and
 * chronological at once, and it cannot be moved by a timezone the way parsing
 * to Date and back can.
 *
 * ONE MATERIAL NAMED PER FAILURE. A challan carries several, and "the two
 * dates" is not enough to find the one that is wrong.
 */
function assertDatesOrdered(
  itemCode: string,
  manufacturingDate: string | null,
  expiryDate: string | null,
): void {
  const today = new Date().toISOString().slice(0, 10);

  // A DRUM CANNOT HAVE BEEN MADE TOMORROW. The commonest cause is a mistyped
  // year, which otherwise sits in the record unnoticed until somebody works
  // out a shelf life from it.
  if (manufacturingDate && manufacturingDate > today) {
    throw new BadRequestException(
      `The manufacturing date for ${itemCode} is in the future (${manufacturingDate}). Material ` +
        'cannot be made after the day it arrived — check the date on the challan.',
    );
  }

  // AN EXPIRY IS REQUIRED. A drum with no expiry on the challan is one nobody
  // can decide about later: FEFO cannot order it, the quality gate cannot
  // judge it, and the first person to notice is whoever goes to dispense it.
  if (!expiryDate) {
    throw new BadRequestException(
      `The expiry date for ${itemCode} is missing. Every drum received has to carry one — it is ` +
        'what decides whether the material may still be used.',
    );
  }

  // AND IT CANNOT ALREADY HAVE PASSED. Material that expired before it arrived
  // cannot lawfully be taken into stock; booking it in would put unusable
  // material on the shelf for production to draw on.
  if (expiryDate < today) {
    throw new BadRequestException(
      `The expiry date for ${itemCode} has already passed (${expiryDate}). Expired material ` +
        'cannot be received into stock — refuse the delivery or raise it with the principal.',
    );
  }

  if (manufacturingDate && expiryDate <= manufacturingDate) {
    throw new BadRequestException(
      `The expiry date for ${itemCode} has to be after its manufacturing date. Check the two ` +
        'dates on the challan.',
    );
  }
}
