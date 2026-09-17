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
  PurchaseOrderListItem,
  PurchaseOrderLineItem,
  PurchaseOrderStatus,
} from '@pharma-erp/types';

import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import {
  computeLineAmounts,
  money,
  parseNonNegative,
  parsePositive,
  pendingOn,
  percent,
  qty,
  sumLineAmounts,
} from './decimal.util';
import type {
  ConvertRequisitionDto,
  CreatePurchaseOrderDto,
  UpdatePurchaseOrderDto,
} from './dto/purchase-order.dto';
import { dateRange, paginate } from './filters.util';
import { ITEM_SELECT, PARTY_SELECT, collectIds, toItemSummary, toPartySummary } from './mappers';
import { NumberingService } from './numbering.service';
import { PeopleService } from './people.service';

const PO_INCLUDE = {
  vendor: { select: PARTY_SELECT },
  lines: {
    include: {
      item: { select: ITEM_SELECT },
      requisition: { select: { id: true, number: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
  goodsReceipts: {
    where: { deletedAt: null },
    select: { id: true, number: true, receiptDate: true },
    orderBy: { receiptDate: 'asc' },
  },
  purchaseInvoices: {
    where: { deletedAt: null },
    select: { id: true, number: true, vendorInvoiceNumber: true },
  },
} satisfies Prisma.PurchaseOrderInclude;

type PurchaseOrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof PO_INCLUDE }>;

/**
 * Statuses a purchase order may be moved to BY HAND.
 *
 * PARTIALLY_RECEIVED IS ABSENT FROM EVERY LIST. It is a fact about what turned
 * up, computed from the line quantities by `fulfilmentStatus` on every receipt;
 * setting it would be a claim about stock that the next GRN overwrites anyway.
 *
 * CLOSING IS ALLOWED AT ANY TIME, including with material still outstanding,
 * and that is safe now for a reason worth stating: receivability follows the
 * PENDING QUANTITY, not the status. An order closed early keeps its pending
 * quantity, stays in the goods-receipt picker, and accepts the balance if it
 * ever arrives — at which point the receipt recomputes the status from the
 * lines. Closing early is therefore a judgement about expectation, not a door
 * that locks; the original defect was that it locked.
 *
 * Cancelled is the one genuinely terminal state. It says the order should not
 * have existed, and no material may be received against it at all.
 */
const ALLOWED_TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  // A draft leaves by being submitted — which is `submitDraft`, not a status
  // change, because it also converts the requisition — or by being abandoned.
  DRAFT: ['CANCELLED'],
  OPEN: ['APPROVED', 'CLOSED', 'CANCELLED'],
  APPROVED: ['OPEN', 'CLOSED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['CLOSED', 'CANCELLED'],
  CLOSED: [],
  CANCELLED: [],
};

/**
 * Statuses from which material may still be booked in.
 *
 * Everything except CANCELLED, because RECEIVABILITY IS DECIDED BY THE PENDING
 * QUANTITY, not by the label. CLOSED is in the list deliberately: an order
 * closed by hand under the old rules still has material owed on it, and hiding
 * it was the defect this replaced. A properly short-closed order drops out on
 * its own, because its pending quantity is genuinely zero.
 */
const RECEIVABLE_STATUSES: readonly PurchaseOrderStatus[] = [
  'OPEN',
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'CLOSED',
];

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly people: PeopleService,
    private readonly numbering: NumberingService,
  ) {}

  async list(query: ProcurementListQuery): Promise<Paginated<PurchaseOrderListItem>> {
    const where: Prisma.PurchaseOrderWhereInput = { deletedAt: null };

    // DRAFTS ARE EXCLUDED unless asked for by name. They are unfinished work
    // rather than orders, they have their own table on the screen, and a
    // half-priced draft sitting among placed orders made the register's totals
    // read as though money had been committed that had not.
    if (query.status) where.status = query.status as PurchaseOrderStatus;
    else where.status = { not: 'DRAFT' };
    if (query.vendorId) where.vendorId = query.vendorId;
    const lineFilters: Prisma.PurchaseOrderLineWhereInput[] = [];

    if (query.itemId) lineFilters.push({ itemId: query.itemId });
    if (query.requisitionId) lineFilters.push({ requisitionId: query.requisitionId });

    if (lineFilters.length > 0) {
      where.AND = lineFilters.map((filter) => ({ lines: { some: filter } }));
    }

    const between = dateRange(query.dateFrom, query.dateTo);

    if (between) where.poDate = between;

    if (query.search) {
      const search = query.search.trim();

      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { vendor: { name: { contains: search, mode: 'insensitive' } } },
        { lines: { some: { item: { name: { contains: search, mode: 'insensitive' } } } } },
        { lines: { some: { item: { code: { contains: search, mode: 'insensitive' } } } } },
      ];
    }

    const { skip, take, page, pageSize } = paginate(query);

    const rows = await this.prisma.scoped.purchaseOrder.findMany({
      where,
      include: PO_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
      skip,
      take,
    });

    const total = await this.prisma.scoped.purchaseOrder.count({ where });

    const people = await this.people.load(collectIds(...rows.map((row) => row.createdById)));

    return { rows: rows.map((row) => this.toListItem(row, people)), total, page, pageSize };
  }

  /**
   * Drafts only, newest first.
   *
   * A separate method rather than a status filter on `list` because the screen
   * shows both at once: one paged register of real orders, and above it the
   * drafts belonging to whoever is looking. Sharing the pager between them
   * would make paging one of them page the other.
   */
  async drafts(): Promise<PurchaseOrderListItem[]> {
    const rows = await this.prisma.scoped.purchaseOrder.findMany({
      where: { deletedAt: null, status: 'DRAFT' },
      include: PO_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });

    const people = await this.people.load(collectIds(...rows.map((row) => row.createdById)));

    return rows.map((row) => this.toListItem(row, people));
  }

  async findOne(id: string): Promise<PurchaseOrderListItem> {
    const row = await this.requireOrder(id);
    const people = await this.people.load(collectIds(row.createdById));

    return this.toListItem(row, people);
  }

  /** Creates an order directly, with one or more lines. */
  async create(dto: CreatePurchaseOrderDto): Promise<PurchaseOrderListItem> {
    // A draft is an order being prepared: inert, editable, and not yet a
    // commitment to the vendor. Everything else about creating it is identical,
    // which is why this is a flag rather than a second code path.
    const asDraft = dto.saveAsDraft === true;

    const tenantId = this.tenantContext.requireTenantId();
    const createdById = this.requireActingUser();

    // A DRAFT IS PARKED WORK, so nothing below is demanded of it. A placed
    // order is a commitment to a vendor and every rule still applies — the
    // difference is the draft flag, which is why these checks live here and not
    // in the DTO. `submitDraft` runs the same rules again when the draft is
    // finally placed, and that is the check that decides: a draft can sit for a
    // week and be edited in between.
    const submitted = dto.lines ?? [];

    if (!asDraft && submitted.length === 0) {
      throw new BadRequestException('A purchase order needs at least one line.');
    }

    const vendor = await this.requireVendor(dto.vendorId);

    // On a draft, a line nobody has put a quantity on yet is not stored at all.
    // Keeping it as a zero would be a number nobody typed, and `submitDraft`
    // would then accept an order for nothing.
    const usable = asDraft
      ? submitted.filter((line) => line.quantity !== undefined && line.quantity.trim() !== '')
      : submitted;

    // Every item and requisition is resolved before anything is written, so a
    // bad id fails the whole request rather than leaving a half-built order.
    const lines = await Promise.all(
      usable.map(async (line) => {
        const item = await this.requireItem(line.itemId);
        const quantity = parsePositive(line.quantity ?? '', `Quantity for ${item.code}`);

        // Unpriced on a draft: the rate is what a buyer is still negotiating,
        // and zero is the only figure that leaves the total honest until they
        // have one.
        const rate = parseNonNegative(line.rate ?? (asDraft ? '0' : ''), `Rate for ${item.code}`);
        const taxRatePercent = parseNonNegative(
          line.taxRatePercent ?? (asDraft ? '0' : ''),
          `Tax rate for ${item.code}`,
        );

        // US-PUR-02: "A Purchase Order can only be created from an Approved
        // Purchase Requisition." Every line must cite one — there is no path
        // to an order for material nobody requested, which is what makes the
        // requisition-to-order trace complete rather than best-effort.
        if (!line.requisitionId) {
          throw new BadRequestException(
            `${item.code}: a purchase order line must come from an approved requisition.`,
          );
        }

        await this.assertRequisitionConvertible(line.requisitionId);

        return {
          itemId: item.id,
          requisitionId: line.requisitionId ?? null,
          quantity,
          rate,
          taxRatePercent,
          ...computeLineAmounts(quantity, rate, taxRatePercent),
        };
      }),
    );

    const totals = sumLineAmounts(lines);

    const created = await this.prisma.transaction(async (tx) => {
      const number = await this.numbering.next(tx, tenantId, 'PO');

      const order = await tx.purchaseOrder.create({
        data: {
          tenantId,
          number,
          vendorId: vendor.id,
          expectedDeliveryDate: dto.expectedDeliveryDate
            ? new Date(dto.expectedDeliveryDate)
            : null,
          paymentTermsDays: dto.paymentTermsDays ?? vendor.paymentTermsDays,
          notes: dto.notes ?? null,
          createdById,
          status: asDraft ? 'DRAFT' : 'OPEN',
          taxableAmount: totals.taxableAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          lines: { create: lines.map((line) => ({ ...line, tenantId })) },
        },
        include: PO_INCLUDE,
      });

      // A DRAFT leaves its requisitions APPROVED. They are converted when the
      // draft is submitted, because until then no order has been placed — and
      // a requisition showing "converted" against an order that may never
      // exist is the sort of thing a buyer chases for an afternoon.
      //
      // The draft still BLOCKS a second order on the same requisition; that
      // guard is `assertRequisitionConvertible`, which looks at the order
      // lines rather than at the requisition's status.
      if (!asDraft) {
        const requisitionIds = collectIds(...lines.map((line) => line.requisitionId));

        if (requisitionIds.length > 0) {
          await tx.purchaseRequisition.updateMany({
            where: { id: { in: requisitionIds } },
            data: { status: 'CONVERTED_TO_PO' },
          });
        }
      }

      return order;
    });

    await this.audit.record({
      entityType: 'PurchaseOrder',
      entityId: created.id,
      action: 'CREATE',
      after: {
        number: created.number,
        vendor: vendor.name,
        lines: created.lines.length,
        totalAmount: money(created.totalAmount),
      },
    });

    const people = await this.people.load(collectIds(created.createdById));

    return this.toListItem(created, people);
  }

  /**
   * Turns one approved requisition into a single-line purchase order.
   *
   * The convenience path for the common case, and the one that guarantees
   * business rule 2: the line carries `requisitionId`, so the order is
   * traceable back to the request that caused it.
   */
  async convertRequisition(
    requisitionId: string,
    dto: ConvertRequisitionDto,
  ): Promise<PurchaseOrderListItem> {
    const requisition = await this.assertRequisitionConvertible(requisitionId);

    return this.create({
      vendorId: dto.vendorId,
      expectedDeliveryDate: dto.expectedDeliveryDate,
      paymentTermsDays: dto.paymentTermsDays,
      notes: `Raised from requisition ${requisition.number}.`,
      lines: [
        {
          itemId: requisition.itemId,
          requisitionId,
          quantity: requisition.requiredQuantity.toString(),
          rate: dto.rate,
          taxRatePercent: dto.taxRatePercent,
        },
      ],
    });
  }

  /** Edits a draft order's header. Lines are replaced wholesale, not patched. */
  async update(id: string, dto: UpdatePurchaseOrderDto): Promise<PurchaseOrderListItem> {
    const before = await this.requireOrder(id);

    // THE STATUS IS NOT SUBJECT TO THE SAME RESTRICTION AS THE FIELDS, and the
    // difference is the point. A partially received order must still be
    // closable, and a live one cancellable — those are exactly the stages where
    // its terms are no longer anybody's to rewrite. What a status may become is
    // decided by ALLOWED_TRANSITIONS, further down, in one place.
    const changingStatus = dto.status !== undefined && dto.status !== before.status;

    const changingFields =
      dto.expectedDeliveryDate !== undefined ||
      dto.paymentTermsDays !== undefined ||
      dto.notes !== undefined ||
      dto.vendorId !== undefined ||
      dto.lines !== undefined;

    if (changingFields && before.status !== 'OPEN' && before.status !== 'DRAFT') {
      throw new ConflictException(
        'Only a draft or open purchase order can be edited — one with receipts against it cannot.',
      );
    }

    const data: Prisma.PurchaseOrderUpdateInput = {};

    if (dto.expectedDeliveryDate !== undefined) {
      data.expectedDeliveryDate = dto.expectedDeliveryDate
        ? new Date(dto.expectedDeliveryDate)
        : null;
    }

    if (dto.paymentTermsDays !== undefined) data.paymentTermsDays = dto.paymentTermsDays;
    if (dto.notes !== undefined) data.notes = dto.notes || null;
    if (dto.vendorId !== undefined) {
      const vendor = await this.requireVendor(dto.vendorId);

      data.vendor = { connect: { id: vendor.id } };
    }

    // Lines are replaceable ON A DRAFT ONLY. A live order's lines carry a
    // received quantity, and rewriting them would leave goods receipts citing
    // quantities that no longer exist on the order they were booked against.
    const replacingLines = dto.lines !== undefined;

    if (replacingLines && before.status !== 'DRAFT') {
      throw new ConflictException(
        `${before.number} has been placed, so its lines can no longer be rewritten. ` +
          'Cancel it and raise a new order if the requirement has changed.',
      );
    }

    if (Object.keys(data).length === 0 && !replacingLines && !changingStatus) {
      throw new BadRequestException('Nothing to update.');
    }

    const after = await this.prisma.transaction(async (tx) => {
      if (replacingLines) {
        const tenantId = this.tenantContext.requireTenantId();

        const rebuilt = await Promise.all(
          dto
            .lines!.filter((line) => line.quantity !== undefined && line.quantity.trim() !== '')
            .map(async (line) => {
              const item = await this.requireItem(line.itemId);
              const quantity = parsePositive(line.quantity ?? '', `Quantity for ${item.code}`);
              const rate = parseNonNegative(line.rate ?? '0', `Rate for ${item.code}`);
              const taxRatePercent = parseNonNegative(
                line.taxRatePercent ?? '0',
                `Tax rate for ${item.code}`,
              );

              if (!line.requisitionId) {
                throw new BadRequestException(
                  `${item.code}: a purchase order line must come from an approved requisition.`,
                );
              }

              // The draft's own lines are excluded, or editing a draft would
              // report the draft itself as a duplicate of the requisition.
              await this.assertRequisitionConvertible(line.requisitionId, id);

              return {
                tenantId,
                itemId: item.id,
                requisitionId: line.requisitionId,
                quantity,
                rate,
                taxRatePercent,
                ...computeLineAmounts(quantity, rate, taxRatePercent),
              };
            }),
        );

        const totals = sumLineAmounts(rebuilt);

        // Belt and braces. A draft cannot be received against, so this should
        // never fire — but the foreign key from goods_receipt_lines is
        // RESTRICT, and without this check a line that somehow has a receipt
        // would surface as a raw 23001 from Postgres rather than as something
        // a user can act on.
        const received = await tx.goodsReceiptLine.findFirst({
          where: { purchaseOrderLine: { purchaseOrderId: id } },
          select: { goodsReceipt: { select: { number: true } } },
        });

        if (received) {
          throw new ConflictException(
            `${before.number} has material received against it on ` +
              `${received.goodsReceipt.number}, so its lines can no longer be rewritten.`,
          );
        }

        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrderLine.createMany({
          data: rebuilt.map((line) => ({ ...line, purchaseOrderId: id })),
        });

        data.taxableAmount = totals.taxableAmount;
        data.taxAmount = totals.taxAmount;
        data.totalAmount = totals.totalAmount;
      }

      return tx.purchaseOrder.update({
        where: { id },
        data,
        include: PO_INCLUDE,
      });
    });

    await this.audit.record({
      entityType: 'PurchaseOrder',
      entityId: id,
      action: 'UPDATE',
      before: { notes: before.notes, paymentTermsDays: before.paymentTermsDays },
      after: { notes: after.notes, paymentTermsDays: after.paymentTermsDays },
    });

    // LAST, and through the same method the status endpoint uses. The
    // transition rules, the no-op case and the separate audit entry all live
    // there; duplicating them here to save a round trip is how two callers stop
    // agreeing about what a purchase order may become.
    if (changingStatus) return this.changeStatus(id, dto.status!);

    const people = await this.people.load(collectIds(after.createdById));

    return this.toListItem(after, people);
  }

  async changeStatus(id: string, target: PurchaseOrderStatus): Promise<PurchaseOrderListItem> {
    const before = await this.requireOrder(id);

    // Selecting the status an order already has is a no-op, not an error.
    // The UI presents this as a status dropdown showing the current value, so
    // pressing Update without changing the selection is an ordinary thing to
    // do — and "an open order cannot become open" would be a confusing way to
    // answer it. Nothing is written and nothing is audited, because nothing
    // changed.
    if (before.status === target) {
      const unchanged = await this.people.load(collectIds(before.createdById));

      return this.toListItem(before, unchanged);
    }

    if (!ALLOWED_TRANSITIONS[before.status].includes(target)) {
      throw new ConflictException(
        `A ${label(before.status)} purchase order cannot become ${label(target)}.`,
      );
    }

    const after = await this.prisma.scoped.purchaseOrder.update({
      where: { id },
      data: {
        status: target,
      },
      include: PO_INCLUDE,
    });

    await this.audit.record({
      entityType: 'PurchaseOrder',
      entityId: id,
      action: 'UPDATE',
      before: { status: before.status },
      after: { status: after.status },
    });

    const people = await this.people.load(collectIds(after.createdById));

    return this.toListItem(after, people);
  }

  /**
   * Orders with material still to come, for the GRN form's picker.
   *
   * SELECTED BY PENDING QUANTITY, NOT BY STATUS. An order is receivable
   * because something is still owed on it, not because its label says so —
   * which is what stops an order that was closed by hand from taking its
   * outstanding quantity with it. A short-closed order disappears from here
   * for the right reason: its pending quantity is genuinely zero.
   *
   * Only CANCELLED is excluded outright. Abandoning an order says no material
   * is expected at all, and receiving against it would contradict the decision
   * rather than record one.
   *
   * The pending test cannot be expressed in a Prisma `where` — it compares
   * three columns of the same row — so the filter is applied after the query.
   * The status pre-filter keeps that set small.
   */
  async receivable(): Promise<PurchaseOrderListItem[]> {
    const rows = await this.prisma.scoped.purchaseOrder.findMany({
      where: { deletedAt: null, status: { in: [...RECEIVABLE_STATUSES] } },
      include: PO_INCLUDE,
      orderBy: [{ poDate: 'asc' }],
    });

    const withPending = rows.filter((row) =>
      row.lines.some((line) => pendingOn(line).greaterThan(0)),
    );

    const people = await this.people.load(collectIds(...withPending.map((row) => row.createdById)));

    return withPending.map((row) => this.toListItem(row, people));
  }

  /** Orders that may be invoiced: anything received, wholly or in part. */
  async invoiceable(): Promise<PurchaseOrderListItem[]> {
    const rows = await this.prisma.scoped.purchaseOrder.findMany({
      where: {
        deletedAt: null,
        status: { in: ['PARTIALLY_RECEIVED', 'CLOSED'] },
      },
      include: PO_INCLUDE,
      orderBy: [{ poDate: 'desc' }],
    });

    const people = await this.people.load(collectIds(...rows.map((row) => row.createdById)));

    return rows.map((row) => this.toListItem(row, people));
  }

  async requireOrder(id: string): Promise<PurchaseOrderRow> {
    const row = await this.prisma.scoped.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: PO_INCLUDE,
    });

    if (!row) throw new NotFoundException('Purchase order not found.');

    return row;
  }

  /**
   * Checks a requisition may still become a purchase order, and refuses a
   * second one.
   *
   * THE DUPLICATE GUARD READS THE ORDER LINES, not the requisition's status,
   * and that distinction is the whole reason it works. A requisition with a
   * DRAFT order against it is still APPROVED — it has not been converted,
   * because no order has been placed — so a status check alone would happily
   * allow a second draft, and the buyer would end up with two orders for one
   * request. Cancelled orders are excluded: abandoning a draft must leave the
   * requisition usable again.
   *
   * `excludeOrderId` is for submitting a draft, where the draft's own line is
   * the one line that must not count against it.
   */
  private async assertRequisitionConvertible(requisitionId: string, excludeOrderId?: string) {
    const requisition = await this.prisma.scoped.purchaseRequisition.findFirst({
      where: { id: requisitionId, deletedAt: null },
      select: { id: true, number: true, itemId: true, requiredQuantity: true, status: true },
    });

    if (!requisition) throw new NotFoundException('Requisition not found.');

    if (requisition.status !== 'APPROVED') {
      throw new ConflictException(
        `Requisition ${requisition.number} is ${label(requisition.status)}. ` +
          'Only an approved requisition can be converted to a purchase order.',
      );
    }

    const existing = await this.prisma.scoped.purchaseOrderLine.findFirst({
      where: {
        requisitionId,
        ...(excludeOrderId ? { purchaseOrderId: { not: excludeOrderId } } : {}),
        purchaseOrder: { deletedAt: null, status: { not: 'CANCELLED' } },
      },
      select: { purchaseOrder: { select: { number: true, status: true } } },
    });

    if (existing) {
      throw new ConflictException(
        `Requisition ${requisition.number} already has ${existing.purchaseOrder.number} ` +
          `against it (${label(existing.purchaseOrder.status)}). Edit that order rather than ` +
          'raising a second one, or cancel it first.',
      );
    }

    return requisition;
  }

  /**
   * Turns a draft into a real purchase order.
   *
   * SEPARATE FROM A STATUS CHANGE because it does two things that must happen
   * together: the order becomes live, and the requisition behind it is marked
   * converted. Doing the first without the second would leave a placed order
   * whose requisition still looks outstanding, and the reorder check would
   * eventually raise another one for the same shortage.
   */
  async submitDraft(id: string): Promise<PurchaseOrderListItem> {
    const before = await this.requireOrder(id);

    if (before.status !== 'DRAFT') {
      throw new ConflictException(
        `${before.number} is ${label(before.status)}, not a draft — it has already been placed.`,
      );
    }

    if (before.lines.length === 0) {
      throw new BadRequestException(
        'A purchase order needs at least one line before it is placed.',
      );
    }

    // Re-checked at submission, not merely at creation: a draft may have sat
    // for a week, and the requisition behind it could have been cancelled or
    // converted by another route in the meantime.
    const requisitionIds = collectIds(...before.lines.map((line) => line.requisitionId));

    for (const requisitionId of requisitionIds) {
      await this.assertRequisitionConvertible(requisitionId, before.id);
    }

    const after = await this.prisma.transaction(async (tx) => {
      const order = await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'OPEN' },
        include: PO_INCLUDE,
      });

      if (requisitionIds.length > 0) {
        await tx.purchaseRequisition.updateMany({
          where: { id: { in: requisitionIds } },
          data: { status: 'CONVERTED_TO_PO' },
        });
      }

      return order;
    });

    await this.audit.record({
      entityType: 'PurchaseOrder',
      entityId: id,
      action: 'UPDATE',
      before: { status: 'DRAFT' },
      after: { status: after.status, placed: true, totalAmount: money(after.totalAmount) },
    });

    const people = await this.people.load(collectIds(after.createdById));

    return this.toListItem(after, people);
  }

  /**
   * Discards a draft.
   *
   * DRAFTS ONLY, and that restriction is what makes this safe: a draft has
   * never been placed, so nothing can have been received or invoiced against
   * it and no requisition has been marked converted by it. A placed order is
   * cancelled instead, which leaves the record and its history in place.
   *
   * Soft, like every deletion in this module — `purchase_orders` carries a
   * `prevent_hard_delete` trigger, and the row stays readable to anything that
   * already cites it.
   */
  async discardDraft(id: string): Promise<void> {
    const before = await this.requireOrder(id);

    if (before.status !== 'DRAFT') {
      throw new ConflictException(
        `${before.number} is ${label(before.status)}, not a draft. Cancel it instead — a placed ` +
          'order stays on the record.',
      );
    }

    await this.prisma.transaction(async (tx) => {
      // The lines go with it. They have no independent existence, and leaving
      // them would keep the requisition looking as though an order covered it.
      await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
      await tx.purchaseOrder.update({ where: { id }, data: { deletedAt: new Date() } });
    });

    await this.audit.record({
      entityType: 'PurchaseOrder',
      entityId: id,
      action: 'DELETE',
      before: { number: before.number, status: before.status },
    });
  }

  private async requireVendor(vendorId: string) {
    const vendor = await this.prisma.scoped.party.findFirst({
      where: { id: vendorId, deletedAt: null, partyType: 'VENDOR' },
      select: { id: true, name: true, paymentTermsDays: true },
    });

    if (!vendor) throw new NotFoundException('Vendor not found.');

    return vendor;
  }

  private async requireItem(itemId: string) {
    const item = await this.prisma.scoped.item.findFirst({
      where: { id: itemId, deletedAt: null },
      select: { id: true, code: true },
    });

    if (!item) throw new NotFoundException('Item not found.');

    return item;
  }

  private requireActingUser(): string {
    const userId = this.tenantContext.getUserId();

    if (!userId) {
      throw new BadRequestException('This action must be performed by a signed-in user.');
    }

    return userId;
  }

  private toListItem(row: PurchaseOrderRow, people: Map<string, string>): PurchaseOrderListItem {
    return {
      id: row.id,
      number: row.number,
      vendor: toPartySummary(row.vendor),
      poDate: row.poDate.toISOString(),
      expectedDeliveryDate: row.expectedDeliveryDate?.toISOString() ?? null,
      paymentTermsDays: row.paymentTermsDays,
      status: row.status,
      taxableAmount: money(row.taxableAmount),
      taxAmount: money(row.taxAmount),
      totalAmount: money(row.totalAmount),
      createdBy: people.get(row.createdById) ?? null,
      issuedAt: row.issuedAt?.toISOString() ?? null,
      notes: row.notes,
      lines: row.lines.map((line): PurchaseOrderLineItem => {
        const quantity = new Prisma.Decimal(line.quantity);
        const received = new Prisma.Decimal(line.quantityReceived);
        const cancelled = new Prisma.Decimal(line.quantityCancelled);

        return {
          id: line.id,
          item: toItemSummary(line.item),
          requisition: line.requisition,
          quantity: qty(quantity),
          rate: qty(line.rate),
          taxRatePercent: percent(line.taxRatePercent),
          taxableAmount: money(line.taxableAmount),
          taxAmount: money(line.taxAmount),
          totalAmount: money(line.totalAmount),
          quantityReceived: qty(received),
          quantityCancelled: qty(cancelled),
          quantityPending: qty(pendingOn(line)),
        };
      }),
      goodsReceipts: row.goodsReceipts.map((grn) => ({
        id: grn.id,
        number: grn.number,
        receiptDate: grn.receiptDate.toISOString(),
      })),
      invoices: row.purchaseInvoices,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function label(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase();
}
