import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type {
  Paginated,
  ProcurementListQuery,
  QcDecision,
  QcQueueItem,
  StockLotStatus,
} from '@pharma-erp/types';
import { QC_DECISION_LABELS, STOCK_LOT_STATUS_LABELS } from '@pharma-erp/types';

import { AuditService } from '../common/audit/audit.service';
import { JobWorkReceiptsService } from '../job-work/job-work-receipts.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import { daysUntil } from './decimal.util';
import type { RecordQcDecisionDto } from './dto/qc.dto';
import { dateRange, paginate } from './filters.util';
import {
  ITEM_SELECT,
  collectIds,
  toItemSummary,
  toQcResultItem,
  toStockLotSummary,
} from './mappers';
import { PeopleService } from './people.service';

const LOT_INCLUDE = {
  item: { select: ITEM_SELECT },
  qcResults: { orderBy: { createdAt: 'desc' } },
  goodsReceiptLine: {
    select: {
      goodsReceipt: {
        select: {
          id: true,
          number: true,
          receiptDate: true,
          vendor: { select: { id: true, name: true } },
          purchaseOrder: { select: { id: true, number: true } },
        },
      },
      // THE DEMAND THIS DRUM WAS BOUGHT FOR, four links back:
      // GRN line -> purchase order line -> requisition -> sales order line.
      // Every link already existed; nothing here is a copy of anything.
      purchaseOrderLine: {
        select: {
          requisition: {
            select: {
              number: true,
              salesOrderId: true,
              salesOrderItemId: true,
              salesOrder: { select: { orderNumber: true, status: true } },
            },
          },
        },
      },
    },
  },
  // The other half of the either/or: a principal's challan, which has no
  // vendor and no purchase order because there was no purchase.
  jobWorkMaterialReceiptLine: {
    select: {
      // The challan belongs to the line: one receipt gathers materials from
      // several of them.
      deliveryChallanNumber: true,
      receipt: {
        select: {
          id: true,
          receiptNumber: true,
          receiptDate: true,
          jobWorkOrder: {
            select: {
              id: true,
              orderNumber: true,
              principal: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.StockLotInclude;

type LotRow = Prisma.StockLotGetPayload<{ include: typeof LOT_INCLUDE }>;

/**
 * Incoming quality control: the gate between quarantine and usable inventory.
 *
 * This service is the only thing in the system that can make received material
 * usable, which is what makes business rules 7 and 8 enforceable rather than
 * aspirational:
 *
 *   ACCEPTED  -> lot becomes USABLE, a positive ledger entry is posted with
 *                affectsUsableStock = true, and the batch joins the FEFO pool
 *                with its number, manufacturing date and expiry intact.
 *
 *   REJECTED  -> lot becomes REJECTED and stays out of every usable-stock
 *   / ON_HOLD    figure. The ledger entry posted is NEGATIVE against quarantine
 *                and never touches usable stock, so a rejection cannot increase
 *                inventory by any path. The row is never deleted: rejected
 *                material must remain traceable for a vendor return or a debit
 *                note.
 *
 * A decision is never overwritten. Re-inspecting a held lot appends a second
 * QcResult, and the lot's status follows the latest one.
 */
@Injectable()
export class QcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly people: PeopleService,
    /**
     * Only to keep a job-work receipt's status in step with its lots.
     *
     * Injected rather than reaching into the table directly so the rule for
     * what a consignment's status means lives in one place — the service that
     * owns the receipt — instead of being restated here.
     */
    private readonly jobWorkReceipts: JobWorkReceiptsService,
  ) {}

  /**
   * Lots awaiting or having had a QC decision.
   *
   * Defaults to the pending queue, because that is the Quality Officer's
   * actual worklist; the status filter widens it to the history.
   */
  async queue(query: ProcurementListQuery): Promise<Paginated<QcQueueItem>> {
    // COMPANY-OWNED ONLY. Incoming QC clears a VENDOR’s material before it may
    // be used; a principal's free-of-cost material (US-JW-02) arrives on their
    // own delivery challan, has no goods receipt behind it, and has no
    // incoming-QC step in the specification. Listing it here would put rows in
    // a Quality Officer’s worklist that they have no document to inspect
    // against. The quality gate job work DOES have is US-JW-04, on the
    // finished batch.
    // COMPANY-OWNED ONLY. Principal material is decided on Job Work → Quality
    // Check, a consignment at a time, against its own receipt. It briefly
    // appeared here too; two screens able to release the same drum is two
    // places to look when asking who cleared it.
    const where: Prisma.StockLotWhereInput = { ownership: 'COMPANY_OWNED' };

    if (query.status) {
      where.status = query.status as StockLotStatus;
    } else {
      // Everything QC has a view on. CONSUMED lots are excluded: they have
      // left inventory and are no longer a quality decision.
      where.status = { in: ['QUARANTINE', 'USABLE', 'REJECTED', 'ON_HOLD'] };
    }

    if (query.itemId) where.itemId = query.itemId;

    // WHO INSPECTED IT. A lot with no decision yet has no inspector, so
    // filtering by one narrows to lots somebody has actually judged — which is
    // what the question means.
    if (query.raisedById) {
      where.qcResults = { some: { inspectedById: query.raisedById } };
    }

    // Vendor and receipt date both live two levels up, on the goods receipt.
    // Assembled as one object and assigned once — merging into a partially
    // built nested filter is how a clause silently overwrites its neighbour.
    const between = dateRange(query.dateFrom, query.dateTo);
    const receiptFilter: Prisma.GoodsReceiptWhereInput = {
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(between ? { receiptDate: between } : {}),
    };

    if (Object.keys(receiptFilter).length > 0) {
      where.goodsReceiptLine = { goodsReceipt: receiptFilter };
    }

    if (query.search) {
      const search = query.search.trim();

      where.OR = [
        { lotNumber: { contains: search, mode: 'insensitive' } },
        { vendorBatchNumber: { contains: search, mode: 'insensitive' } },
        { item: { name: { contains: search, mode: 'insensitive' } } },
        { item: { code: { contains: search, mode: 'insensitive' } } },
        {
          goodsReceiptLine: { goodsReceipt: { number: { contains: search, mode: 'insensitive' } } },
        },
        // The principal’s side of the same lookup, now that their material is
        // on this queue too.
        {
          jobWorkMaterialReceiptLine: {
            OR: [{ deliveryChallanNumber: { contains: search, mode: 'insensitive' } }],
            receipt: {
              OR: [
                { receiptNumber: { contains: search, mode: 'insensitive' } },
                { jobWorkOrder: { orderNumber: { contains: search, mode: 'insensitive' } } },
                { jobWorkOrder: { principal: { name: { contains: search, mode: 'insensitive' } } } },
              ],
            },
          },
        },
        // WHO INSPECTED IT. The decision carries the person as a bare UUID, so
        // the name is resolved to ids the same way every other list does it.
        { qcResults: { some: { inspectedById: { in: await this.people.idsMatching(search) } } } },
      ];
    }

    const { skip, take, page, pageSize } = paginate(query);

    const rows = await this.prisma.scoped.stockLot.findMany({
      where,
      include: LOT_INCLUDE,
      // NEWEST FIRST. A lot booked in this morning is the one the Quality
      // Officer is looking for, and it used to land wherever its expiry date
      // put it — often pages down. Expiry still breaks ties between lots
      // entered in the same instant.
      //
      // WHAT THIS GIVES UP: the register no longer surfaces the soonest-expiry
      // lot at the top on its own. Expiry-first triage is now the Expiry
      // column's sort and the pending filter's job, not the default order.
      orderBy: [{ createdAt: 'desc' }, { expiryDate: { sort: 'asc', nulls: 'last' } }],
      skip,
      take,
    });

    const total = await this.prisma.scoped.stockLot.count({ where });

    const people = await this.people.load(
      collectIds(...rows.flatMap((row) => row.qcResults.map((result) => result.inspectedById))),
    );

    return { rows: rows.map((row) => this.toQueueItem(row, people)), total, page, pageSize };
  }

  async findLot(id: string): Promise<QcQueueItem> {
    const row = await this.requireLot(id);
    const people = await this.people.load(
      collectIds(...row.qcResults.map((result) => result.inspectedById)),
    );

    return this.toQueueItem(row, people);
  }

  /**
   * Records a QC decision and moves the lot accordingly.
   *
   * Decision, lot status and ledger entry are written in one transaction. A
   * lot marked usable without the ledger entry would be invisible to stock
   * reporting; a ledger entry without the status change would let production
   * pick material that had not actually been released. Neither half is
   * meaningful alone.
   */
  async recordDecision(lotId: string, dto: RecordQcDecisionDto): Promise<QcQueueItem> {
    const tenantId = this.tenantContext.requireTenantId();
    const inspectedById = this.requireActingUser();

    const lot = await this.requireLot(lotId);

    this.assertDecidable(lot.status, dto.decision);

    if (dto.decision !== 'ACCEPTED' && !dto.remarks?.trim()) {
      // A rejection or a hold has consequences for the vendor and may end in a
      // debit note. Requiring the reason at the point of decision is the only
      // time anyone reliably remembers it.
      throw new BadRequestException('A reason is required when rejecting or holding a batch.');
    }

    const quantity = new Prisma.Decimal(lot.quantityAvailable);
    const wasUsable = lot.status === 'USABLE';
    const willBeUsable = dto.decision === 'ACCEPTED';

    const newStatus = statusFor(dto.decision);
    const location = dto.storageLocation?.trim() || defaultLocationFor(newStatus);

    await this.prisma.transaction(async (tx) => {
      const result = await tx.qcResult.create({
        data: {
          tenantId,
          stockLotId: lot.id,
          decision: dto.decision,
          testReference: dto.testReference?.trim() || null,
          remarks: dto.remarks?.trim() || null,
          inspectedById,
        },
        select: { id: true },
      });

      await tx.stockLot.update({
        where: { id: lot.id },
        // WHERE IT MOVED TO, alongside what it became. The two travel together
        // because they describe one physical act: a rejected drum goes to the
        // rejected area BECAUSE it was rejected.
        data: { status: newStatus, storageLocation: location },
      });

      // Non-null by the `ownership` filter in requireLot; guarded rather than
      // asserted so widening that filter fails loudly instead of at runtime.
      const reference = lot.goodsReceiptLine
        ? lot.goodsReceiptLine.goodsReceipt.number
        : lot.lotNumber;

      // ---------------------------------------------------------------------
      // A LEDGER RECORD FOR EVERY DECISION, whatever the verdict.
      //
      // It used to write one NEGATIVE entry for a rejection or a hold —
      // quarantine falls, and nothing anywhere says where the material went.
      // The quantity existed only on the lot row, so the ledger could not
      // answer "how much rejected stock is in the building", which is exactly
      // what a return, a debit note or an inspector asks.
      //
      // Now every decision writes the same PAIR: out of the bucket it was in,
      // into the bucket it moved to. Accepted, held and rejected read
      // identically in shape and differ only in `resultingStatus` — which is
      // what makes them comparable and countable.
      //
      // `affectsUsableStock` stays a separate flag because it answers a
      // different question: only ACCEPTED material may be dispensed, and rule 8
      // is that flag being false everywhere else.
      // ---------------------------------------------------------------------

      const from = lot.status;
      const movement = {
        tenantId,
        itemId: lot.itemId,
        stockLotId: lot.id,
        entryType: entryTypeFor(dto.decision),
        qcResultId: result.id,
        reference,
        createdById: inspectedById,
      };

      const verdict = QC_DECISION_LABELS[dto.decision].toLowerCase();
      const reason = dto.remarks?.trim();

      await tx.stockLedgerEntry.createMany({
        data: [
          {
            ...movement,
            // OUT of wherever it was. Negative, and flagged against usable
            // stock only when it was actually usable — a lot leaving
            // quarantine never counted towards it.
            quantityDelta: quantity.negated(),
            affectsUsableStock: wasUsable,
            resultingStatus: from,
            storageLocation: lot.storageLocation,
            notes: `Left ${STOCK_LOT_STATUS_LABELS[from].toLowerCase()} on a QC decision.`,
          },
          {
            ...movement,
            // INTO the bucket the decision named. This is the entry that did
            // not exist for a rejection or a hold.
            quantityDelta: quantity,
            affectsUsableStock: willBeUsable,
            resultingStatus: newStatus,
            storageLocation: location,
            notes: willBeUsable
              ? 'Accepted into usable stock, available for FEFO picking.'
              : `${verdict === 'on hold' ? 'Held' : 'Rejected'} at incoming QC${
                  // The remark usually ends in a full stop of its own, and
                  // "assay.." on a GMP record reads as a typo nobody fixed.
                  reason ? `: ${reason.replace(/[.s]+$/, '')}` : ''
                }. Tracked here for return, debit note and audit; never usable.`,
          },
        ],
      });

      // ---------------------------------------------------------------------
      // AND, WHERE THE MATERIAL WAS BOUGHT FOR A SALES ORDER, HOLD IT FOR IT.
      //
      // Accepting material that a sales order's requirement paid for does not
      // make it free stock — it makes it that order's. Without this the
      // Required stock tab would see it as available, report the next order as
      // covered, and the same drum would be promised twice.
      //
      // The chain is walked, never copied: GRN line -> purchase order line ->
      // requisition -> sales order line.
      // ---------------------------------------------------------------------

      const demand = lot.goodsReceiptLine?.purchaseOrderLine?.requisition ?? null;

      if (willBeUsable && demand?.salesOrderId && demand.salesOrderItemId) {
        // NOT FOR AN ORDER THAT IS OVER. A cancelled or completed order has no
        // claim left, and holding material for one would lock it away for good.
        const settled = demand.salesOrder?.status === 'CANCELLED' ||
          demand.salesOrder?.status === 'COMPLETED';

        if (!settled) {
          // UPSERT, because the partial unique index allows one live hold per
          // (lot, order line): re-accepting a lot that was held and then
          // released tops the hold up rather than failing on the second write.
          const existing = await tx.stockReservation.findFirst({
            where: {
              stockLotId: lot.id,
              salesOrderItemId: demand.salesOrderItemId,
              releasedAt: null,
            },
            select: { id: true },
          });

          if (existing) {
            await tx.stockReservation.update({
              where: { id: existing.id },
              data: { quantity, reference, createdById: inspectedById },
            });
          } else {
            await tx.stockReservation.create({
              data: {
                tenantId,
                stockLotId: lot.id,
                salesOrderId: demand.salesOrderId,
                salesOrderItemId: demand.salesOrderItemId,
                quantity,
                reference,
                notes:
                  `Held for ${demand.salesOrder?.orderNumber ?? 'the originating sales order'}, ` +
                  `which ${demand.number} was raised to serve.`,
                createdById: inspectedById,
              },
            });
          }
        }
      }

      // A LOT THAT LEAVES USABLE STOCK CANNOT STAY RESERVED. Rejecting or
      // holding material somebody was counting on is exactly when the shortage
      // has to become visible again, so the hold is released — and kept, with
      // its reason, because it is history.
      if (!willBeUsable) {
        await tx.stockReservation.updateMany({
          where: { stockLotId: lot.id, releasedAt: null },
          data: {
            releasedAt: new Date(),
            releasedReason: `Lot ${verdict} at incoming QC${reason ? `: ${reason}` : ''}.`,
          },
        });
      }


    });

    await this.audit.record({
      entityType: 'StockLot',
      entityId: lot.id,
      action: 'UPDATE',
      before: { status: lot.status },
      after: {
        status: statusFor(dto.decision),
        decision: dto.decision,
        lotNumber: lot.lotNumber,
        testReference: dto.testReference ?? null,
        remarks: dto.remarks ?? null,
      },
    });

    return this.findLot(lot.id);
  }

  private assertDecidable(current: StockLotStatus, decision: QcDecision): void {
    if (current === 'CONSUMED') {
      throw new ConflictException(
        'This batch has been consumed and can no longer be re-inspected.',
      );
    }

    // A rejection is final. Releasing rejected material would defeat the point
    // of rejecting it; the correct route is a vendor return and a fresh receipt.
    if (current === 'REJECTED') {
      throw new ConflictException(
        'This batch was rejected. Rejected material cannot be released — return it to the ' +
          'vendor and receive a replacement against the purchase order.',
      );
    }

    if (current === 'USABLE' && decision === 'ACCEPTED') {
      throw new ConflictException('This batch has already been accepted.');
    }
  }

  private async requireLot(id: string): Promise<LotRow> {
    const row = await this.prisma.scoped.stockLot.findFirst({
      // Same narrowing as the queue, and for the same reason: a QC decision
      // recorded against a principal's material would be a decision about
      // stock this gate does not govern.
      where: { id, ownership: 'COMPANY_OWNED' },
      include: LOT_INCLUDE,
    });

    if (!row) throw new NotFoundException('Batch not found.');

    return row;
  }

  private requireActingUser(): string {
    const userId = this.tenantContext.getUserId();

    if (!userId) {
      throw new BadRequestException('This action must be performed by a signed-in user.');
    }

    return userId;
  }

  private toQueueItem(row: LotRow, people: Map<string, string>): QcQueueItem {
    const purchase = row.goodsReceiptLine?.goodsReceipt ?? null;
    const line = row.jobWorkMaterialReceiptLine ?? null;
    const challan = line?.receipt ?? null;

    if (!purchase && !challan) {
      // Unreachable: `stock_lots_has_one_source` guarantees every lot has
      // exactly one of the two behind it. Stated as a throw rather than a `!`
      // so that if the constraint is ever relaxed this fails where the cause
      // is, not three frames away in a mapper.
      throw new Error(
        `Lot ${row.lotNumber} has neither a goods receipt nor a job-work receipt behind it, ` +
          'so there is nothing to inspect it against.',
      );
    }

    return {
      lot: toStockLotSummary(row),
      item: toItemSummary(row.item),

      vendor: purchase?.vendor ?? null,
      goodsReceipt: purchase
        ? {
            id: purchase.id,
            number: purchase.number,
            receiptDate: purchase.receiptDate.toISOString(),
          }
        : null,
      purchaseOrder: purchase?.purchaseOrder ?? null,

      jobWork: challan
        ? {
            principal: challan.jobWorkOrder.principal,
            jobWorkOrder: { id: challan.jobWorkOrder.id, number: challan.jobWorkOrder.orderNumber },
            materialReceipt: {
              id: challan.id,
              number: challan.receiptNumber,
              receiptDate: challan.receiptDate.toISOString(),
            },
            deliveryChallanNumber: line?.deliveryChallanNumber ?? '',
          }
        : null,

      history: row.qcResults.map((result) => toQcResultItem(result, people)),
      daysToExpiry: row.expiryDate ? daysUntil(row.expiryDate) : null,
    };
  }
}

function statusFor(decision: QcDecision): StockLotStatus {
  return decision === 'ACCEPTED' ? 'USABLE' : decision === 'REJECTED' ? 'REJECTED' : 'ON_HOLD';
}

/** The ledger's own name for what the decision did. */
function entryTypeFor(decision: QcDecision): 'QC_ACCEPTED' | 'QC_REJECTED' | 'QC_HOLD' {
  return decision === 'ACCEPTED'
    ? 'QC_ACCEPTED'
    : decision === 'REJECTED'
      ? 'QC_REJECTED'
      : 'QC_HOLD';
}

/**
 * Where material in a given state is kept, when nobody says otherwise.
 *
 * A STARTING POINT, NOT A RULE. Every site names its areas differently and the
 * decision form can override this; what it must not do is leave the question
 * blank, because "rejected, location unknown" is the state an inspector asks
 * about. GMP requires the three to be physically separate, which is why the
 * default is three different places rather than one store with a flag.
 */
function defaultLocationFor(status: StockLotStatus): string {
  switch (status) {
    case 'USABLE':
      return 'Approved store';
    case 'REJECTED':
      return 'Rejected store (locked)';
    case 'ON_HOLD':
      return 'Quarantine — held';
    default:
      return 'Quarantine';
  }
}
