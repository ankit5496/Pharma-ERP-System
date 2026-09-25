import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import {
  INVOICE_BASIS_FOR_BILLING_MODEL,
  STOCK_BUCKET_FOR_BILLING_MODEL,
  type BatchReleaseStatus,
  type BillingModel,
  type ConversionRateBasis,
  type JobWorkDispatchableBatch,
  type JobWorkInvoiceBasis,
  type JobWorkInvoiceView,
} from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../procurement/numbering.service';
import { fromIsoDate, toItemSummary, toIsoDate, todayUtc } from '../production/production.mappers';
import { TenantContextService } from '../tenant/tenant-context.service';

import type { CreateJobWorkDispatchDto } from './dto/job-work-dispatch.dto';
import { JobWorkOrdersService, parseQuantity } from './job-work-orders.service';

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
const THOUSAND = new Prisma.Decimal(1000);

/**
 * Sending finished goods back to the principal, and billing for them —
 * US-JW-05.
 *
 * ONE RECORD for the challan and the invoice, because US-JW-05 names one:
 * "Job-Work Delivery Challan / Invoice". Goods returning to the brand owner who
 * commissioned them are not a sale — no sales order, no customer price list, no
 * distributor receivable — so this does not reuse SalesInvoice, every row of
 * which must hang off a SalesOrder and a BatchAllocation. Bending that chain
 * would have put fictitious sales orders into the order book and the
 * receivables ageing, which is a worse falsehood than a second table.
 *
 * What it DOES reuse: the same Batch and FinishedGoodsLot any other dispatch
 * reduces, Item.gstRate for tax, the agreement's conversion rate, and
 * NumberingService for the document number.
 *
 * TWO CONTROLS LIVE HERE AND ARE ENFORCED AGAINST THE API, not the screen:
 *
 *   CONTROL 6 — a batch that is not RELEASED cannot be dispatched. Checked
 *     before the transaction and re-checked inside it against the batch row.
 *   CONTROL 7 — the invoice basis is derived from the order's frozen billing
 *     model. The DTO has no field for it, and the
 *     `job_work_invoices_basis_matches_model` CHECK makes the contradictory
 *     pair unstorable even by direct SQL.
 */
@Injectable()
export class JobWorkDispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly numbering: NumberingService,
    private readonly orders: JobWorkOrdersService,
  ) {}

  /**
   * Batches made for this order that may be sent back.
   *
   * RELEASED only, with finished-goods stock left. A held or rejected batch is
   * not listed AND would be refused — this is the courtesy, `create` is the
   * control.
   */
  async dispatchable(jobWorkOrderId: string): Promise<JobWorkDispatchableBatch[]> {
    const order = await this.orders.requireOrder(jobWorkOrderId);

    const [internal, own] = await Promise.all([
      this.dispatchableInternalBatches(order.id),
      this.dispatchableJobWorkBatches(order.id),
    ]);

    // Job Work's own batches first: on a pure-conversion order they are what
    // this screen is now for, and the internal ones are the legacy route.
    return [...own, ...internal].map((row) => row.batch);
  }

  /**
   * The same answer for EVERY order, in two queries rather than two per order.
   *
   * WHY IT EXISTS. The Outward dispatch screen lists every job-work order and
   * asks what each one has ready to send, so it was calling `dispatchable`
   * once per order — eighty requests to draw one page on the current data,
   * each opening its own tenant-scoped transaction, and the page waiting on
   * the slowest of them. It is the same fan-out that tripped the thirty-second
   * timeout on production orders, and the same remedy: ask once.
   *
   * KEYED BY ORDER ID, and an order with nothing ready is simply absent —
   * which is what the screen already checks for.
   */
  async dispatchableByOrder(): Promise<Record<string, JobWorkDispatchableBatch[]>> {
    const [own, internal] = await Promise.all([
      this.dispatchableJobWorkBatches(),
      this.dispatchableInternalBatches(),
    ]);

    const byOrder: Record<string, JobWorkDispatchableBatch[]> = {};

    // Job Work's own batches first, for the reason `dispatchable` gives.
    for (const { jobWorkOrderId, batch } of [...own, ...internal]) {
      (byOrder[jobWorkOrderId] ??= []).push(batch);
    }

    return byOrder;
  }

  /**
   * Released batches from Job Work's OWN production workflow.
   *
   * WHAT IS LEFT is the packed quantity less what has already gone back — there
   * is no finished-goods lot to read, because these goods were never ours to
   * sell. They are the principal's throughout, which is the whole point of pure
   * conversion, and they leave on a challan rather than out of stock.
   *
   * WITHOUT AN ORDER it answers for every order at once, which is what
   * `dispatchableByOrder` above is built on. The filter is the only difference
   * between the two calls, so there is one query here rather than two spellings
   * of it that can drift apart.
   */
  private async dispatchableJobWorkBatches(
    jobWorkOrderId?: string,
  ): Promise<{ jobWorkOrderId: string; batch: JobWorkDispatchableBatch }[]> {
    const batches = await this.prisma.scoped.jobWorkBatch.findMany({
      where: {
        deletedAt: null,
        releaseStatus: 'RELEASED',
        productionOrder: {
          ...(jobWorkOrderId ? { jobWorkOrderId } : {}),
          deletedAt: null,
          jobWorkOrder: { deletedAt: null },
        },
      },
      include: {
        productionOrder: {
          select: {
            orderNumber: true,
            jobWorkOrderId: true,
            jobWorkOrder: {
              select: { billingModel: true, mapping: { select: { bom: { select: { product: true } } } } },
            },
          },
        },
        invoices: { where: { deletedAt: null }, select: { dispatchedQuantity: true } },
      },
      orderBy: { expiryDate: 'asc' },
    });

    return batches
      .map((batch) => {
        const dispatched = batch.invoices.reduce(
          (total, invoice) => total.add(invoice.dispatchedQuantity),
          ZERO,
        );

        // Nothing packed means nothing to send, whatever was made: the packed
        // figure is what physically leaves.
        const packed = batch.packedQuantity ?? ZERO;
        const remaining = packed.sub(dispatched);

        return { batch, remaining };
      })
      .filter(({ remaining }) => remaining.greaterThan(ZERO))
      .map(({ batch, remaining }) => ({
        jobWorkOrderId: batch.productionOrder.jobWorkOrderId,
        batch: {
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        productionOrderNumber: batch.productionOrder.orderNumber,
        expiryDate: toIsoDate(batch.expiryDate),
        releaseStatus: batch.releaseStatus as BatchReleaseStatus,
        quantityAvailable: remaining.toString(),
        item: toItemSummary(batch.productionOrder.jobWorkOrder.mapping.bom.product),
        stockOwnership:
          STOCK_BUCKET_FOR_BILLING_MODEL[
            batch.productionOrder.jobWorkOrder.billingModel as BillingModel
          ],
        },
      }));
  }

  /** Released batches from the internal Production & Quality Gate workflow. */
  private async dispatchableInternalBatches(
    jobWorkOrderId?: string,
  ): Promise<{ jobWorkOrderId: string; batch: JobWorkDispatchableBatch }[]> {
    const batches = await this.prisma.scoped.batch.findMany({
      where: {
        deletedAt: null,
        releaseStatus: 'RELEASED',
        // Only batches made against a job-work order — and, when one is named,
        // only that one. A released batch of the same product made for our own
        // brand is not the principal's to receive.
        productionOrder: jobWorkOrderId
          ? { jobWorkOrderId, deletedAt: null }
          : { jobWorkOrderId: { not: null }, deletedAt: null },
      },
      include: {
        productionOrder: {
          select: {
            orderNumber: true,
            jobWorkOrderId: true,
            product: true,
            jobWorkBillingModel: true,
          },
        },
        finishedGoodsLot: { select: { quantityAvailable: true } },
      },
      orderBy: { expiryDate: 'asc' },
    });

    return batches
      .filter((batch) => (batch.finishedGoodsLot?.quantityAvailable ?? ZERO).greaterThan(ZERO))
      .map((batch) => ({
        // Non-null by the filter above: a batch with no job-work order behind
        // it is not selected.
        jobWorkOrderId: batch.productionOrder.jobWorkOrderId!,
        batch: {
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        productionOrderNumber: batch.productionOrder.orderNumber,
        expiryDate: toIsoDate(batch.expiryDate),
        releaseStatus: batch.releaseStatus,
        quantityAvailable: (batch.finishedGoodsLot?.quantityAvailable ?? ZERO).toString(),
        item: toItemSummary(batch.productionOrder.product),
        // THE MODEL FROZEN ON THE PRODUCTION ORDER, through the same rule the
        // tagging code applies when it decides a batch's bucket — so the screen
        // reports the decision that was made, not one re-derived from the
        // agreement as it stands today. A batch reaching here always has a
        // job-work order behind it, so the fallback only satisfies the type.
        stockOwnership: batch.productionOrder.jobWorkBillingModel
          ? STOCK_BUCKET_FOR_BILLING_MODEL[batch.productionOrder.jobWorkBillingModel]
          : 'COMPANY_OWNED',
        },
      }));
  }

  async list(jobWorkOrderId?: string): Promise<JobWorkInvoiceView[]> {
    const invoices = await this.prisma.scoped.jobWorkInvoice.findMany({
      where: { deletedAt: null, ...(jobWorkOrderId ? { jobWorkOrderId } : {}) },
      include: INVOICE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return invoices.map(toInvoiceView);
  }

  /**
   * Dispatches a released batch and raises the invoice for it.
   *
   * One transaction covering the invoice, the finished-goods reduction and the
   * release re-check, because a dispatch that bills without reducing stock — or
   * reduces without billing — is worse than one that fails (section 21).
   */
  async create(dto: CreateJobWorkDispatchDto): Promise<JobWorkInvoiceView> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    const order = await this.orders.requireOrder(dto.jobWorkOrderId);
    const billingModel = order.billingModel as BillingModel;

    const quantity = parseQuantity(dto.dispatchedQuantity, 'dispatchedQuantity');

    if (quantity.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException('The quantity dispatched has to be more than zero.');
    }

    // JOB WORK'S OWN BATCH FIRST. The id may name either table; the browser is
    // not asked which, because which workflow made a batch is the API's
    // business and a request that had to say could say the wrong one.
    const ownBatch = await this.prisma.scoped.jobWorkBatch.findFirst({
      where: { id: dto.batchId, deletedAt: null },
      include: {
        productionOrder: {
          select: {
            jobWorkOrderId: true,
            orderNumber: true,
            jobWorkOrder: { select: { mapping: { select: { bom: { select: { product: true } } } } } },
          },
        },
        invoices: { where: { deletedAt: null }, select: { dispatchedQuantity: true } },
      },
    });

    if (ownBatch) {
      return this.dispatchOwnBatch(ownBatch, order, billingModel, quantity, dto);
    }

    const batch = await this.prisma.scoped.batch.findFirst({
      where: { id: dto.batchId, deletedAt: null },
      include: {
        productionOrder: { select: { jobWorkOrderId: true, orderNumber: true, product: true } },
        finishedGoodsLot: true,
      },
    });

    if (!batch) throw new BadRequestException('That batch does not exist.');

    if (batch.productionOrder.jobWorkOrderId !== order.id) {
      throw new ConflictException(
        `Batch ${batch.batchNumber} was not made against ${order.orderNumber}. A job-work ` +
          'dispatch can only send back goods manufactured for that order.',
      );
    }

    // CONTROL 6. US-JW-04: "A batch cannot be dispatched unless its Quality
    // Gate status is Released." The message names the status so the person
    // reading it knows whether to chase QC or write the batch off.
    if (batch.releaseStatus !== 'RELEASED') {
      throw new ConflictException(
        `Batch ${batch.batchNumber} is ${batch.releaseStatus === 'PENDING' ? 'on hold — its quality gate has not been decided' : 'rejected by the quality gate'}, ` +
          'so it cannot be dispatched. Only a released batch may leave.',
      );
    }

    const available = batch.finishedGoodsLot?.quantityAvailable ?? ZERO;

    // CONTROL 8.
    if (quantity.greaterThan(available)) {
      throw new ConflictException(
        `Only ${available.toString()} of batch ${batch.batchNumber} is available; ` +
          `${quantity.toString()} was requested.`,
      );
    }

    const pricing = this.price(order, billingModel, quantity, batch.productionOrder.product, dto);

    const invoice = await this.prisma.transaction(async (tx) => {
      const invoiceNumber = await this.numbering.next(tx, tenantId, 'JWI');

      // The guarded decrement, exactly as MaterialIssueService does it: only
      // reduce if the stock is still there. Two dispatches prepared at once
      // would otherwise both read the same availability and both succeed.
      const claimed = await tx.finishedGoodsLot.updateMany({
        where: { batchId: batch.id, quantityAvailable: { gte: quantity } },
        data: { quantityAvailable: { decrement: quantity } },
      });

      if (claimed.count === 0) {
        throw new ConflictException(
          `Batch ${batch.batchNumber} no longer has ${quantity.toString()} available — it was ` +
            'dispatched while this one was being prepared. Nothing has been sent; check the ' +
            'remaining quantity and try again.',
        );
      }

      // Re-read the release status INSIDE the transaction. The check above was
      // against a row read earlier; a quality officer blocking the batch in
      // between must not be overtaken by a dispatch already in flight.
      const stillReleased = await tx.batch.findFirstOrThrow({
        where: { id: batch.id },
        select: { releaseStatus: true },
      });

      if (stillReleased.releaseStatus !== 'RELEASED') {
        throw new ConflictException(
          `Batch ${batch.batchNumber} was taken off release while this dispatch was being ` +
            'prepared. Nothing has been sent.',
        );
      }

      const created = await tx.jobWorkInvoice.create({
        data: {
          tenantId,
          invoiceNumber,
          jobWorkOrderId: order.id,
          batchId: batch.id,
          // AUTO-DERIVED, both of them, from the order's frozen model.
          invoiceBasis: pricing.invoiceBasis,
          billingModel,
          dispatchDate: dto.dispatchDate ? fromIsoDate(dto.dispatchDate) : todayUtc(),
          dispatchedQuantity: quantity,
          rateApplied: pricing.rate,
          rateBasis: pricing.rateBasis,
          taxableValue: pricing.taxableValue,
          gstRatePercent: pricing.gstRatePercent,
          gstAmount: pricing.gstAmount,
          totalValue: pricing.totalValue,
          notes: dto.notes?.trim() || null,
          createdById: userId,
        },
      });

      return tx.jobWorkInvoice.findFirstOrThrow({
        where: { id: created.id },
        include: INVOICE_INCLUDE,
      });
    });

    return toInvoiceView(invoice);
  }

  /**
   * Sends one of Job Work's own released batches back, and invoices it.
   *
   * THE SAME CONTROLS AS THE INTERNAL ROUTE — the batch must belong to this
   * order, it must be released, and the quantity must be there — measured
   * against what is left of the PACKED figure rather than a finished-goods lot,
   * because these goods were never ours to hold in stock.
   *
   * THE GUARDED INSERT IS THE RE-CHECK. There is no stock row to decrement, so
   * the race is guarded by re-reading the release status and re-summing what
   * has been dispatched inside the transaction: two dispatches prepared at once
   * cannot both take the last of a batch.
   */
  private async dispatchOwnBatch(
    batch: {
      id: string;
      batchNumber: string;
      packedQuantity: Prisma.Decimal | null;
      releaseStatus: string;
      productionOrder: {
        jobWorkOrderId: string;
        orderNumber: string;
        jobWorkOrder: { mapping: { bom: { product: { code: string; gstRate: Prisma.Decimal | null } } } };
      };
      invoices: { dispatchedQuantity: Prisma.Decimal }[];
    },
    order: Awaited<ReturnType<JobWorkOrdersService['requireOrder']>>,
    billingModel: BillingModel,
    quantity: Prisma.Decimal,
    dto: CreateJobWorkDispatchDto,
  ): Promise<JobWorkInvoiceView> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    if (batch.productionOrder.jobWorkOrderId !== order.id) {
      throw new ConflictException(
        `Batch ${batch.batchNumber} was not made against ${order.orderNumber}. A job-work ` +
          'dispatch can only send back goods manufactured for that order.',
      );
    }

    // CONTROL 6, on this module's own gate.
    if (batch.releaseStatus !== 'RELEASED') {
      throw new ConflictException(
        `Batch ${batch.batchNumber} is ${batch.releaseStatus === 'PENDING' ? 'still awaiting a release decision' : batch.releaseStatus.toLowerCase().replace('_', ' ')}, ` +
          'so it cannot be dispatched. Only a released batch may leave.',
      );
    }

    const packed = batch.packedQuantity ?? ZERO;

    if (packed.lessThanOrEqualTo(ZERO)) {
      throw new ConflictException(
        `Batch ${batch.batchNumber} has no packed quantity recorded, so there is nothing to send ` +
          'back. Record the packing under Batch record first.',
      );
    }

    const already = batch.invoices.reduce(
      (total, invoice) => total.add(invoice.dispatchedQuantity),
      ZERO,
    );

    // CONTROL 8, against the packed figure.
    if (quantity.greaterThan(packed.sub(already))) {
      throw new ConflictException(
        `Only ${packed.sub(already).toString()} of batch ${batch.batchNumber} is left to send ` +
          `(${packed.toString()} packed, ${already.toString()} already dispatched); ` +
          `${quantity.toString()} was requested.`,
      );
    }

    const product = batch.productionOrder.jobWorkOrder.mapping.bom.product;
    const pricing = this.price(order, billingModel, quantity, product, dto);

    const invoice = await this.prisma.transaction(async (tx) => {
      const invoiceNumber = await this.numbering.next(tx, tenantId, 'JWI');

      // Re-read inside the transaction: a quality officer taking the batch off
      // release, or another dispatch, must not be overtaken by this one.
      const current = await tx.jobWorkBatch.findFirstOrThrow({
        where: { id: batch.id },
        select: {
          releaseStatus: true,
          packedQuantity: true,
          invoices: { where: { deletedAt: null }, select: { dispatchedQuantity: true } },
        },
      });

      if (current.releaseStatus !== 'RELEASED') {
        throw new ConflictException(
          `Batch ${batch.batchNumber} was taken off release while this dispatch was being ` +
            'prepared. Nothing has been sent.',
        );
      }

      const remaining = (current.packedQuantity ?? ZERO).sub(
        current.invoices.reduce((total, row) => total.add(row.dispatchedQuantity), ZERO),
      );

      if (quantity.greaterThan(remaining)) {
        throw new ConflictException(
          `Batch ${batch.batchNumber} no longer has ${quantity.toString()} left — it was ` +
            'dispatched while this one was being prepared. Nothing has been sent.',
        );
      }

      const created = await tx.jobWorkInvoice.create({
        data: {
          tenantId,
          invoiceNumber,
          jobWorkOrderId: order.id,
          // The OTHER column. The CHECK constraint refuses a row naming both.
          jobWorkBatchId: batch.id,
          invoiceBasis: pricing.invoiceBasis,
          billingModel,
          dispatchDate: dto.dispatchDate ? fromIsoDate(dto.dispatchDate) : todayUtc(),
          dispatchedQuantity: quantity,
          rateApplied: pricing.rate,
          rateBasis: pricing.rateBasis,
          taxableValue: pricing.taxableValue,
          gstRatePercent: pricing.gstRatePercent,
          gstAmount: pricing.gstAmount,
          totalValue: pricing.totalValue,
          notes: dto.notes?.trim() || null,
          createdById: userId,
        },
      });

      return tx.jobWorkInvoice.findFirstOrThrow({
        where: { id: created.id },
        include: INVOICE_INCLUDE,
      });
    });

    return toInvoiceView(invoice);
  }

  /**
   * What the principal is charged, and on what.
   *
   * SECTION 10 OF THE BRIEF, in one place:
   *
   *   PURE_CONVERSION  -> the agreed conversion charge only. The raw-material
   *                       value is not merely omitted from the sum; there is no
   *                       term for it in this function, and `unitValue` is
   *                       REJECTED rather than ignored so it cannot be smuggled
   *                       in by a direct API call.
   *   OWN_PROCUREMENT  -> the full finished-goods value, which the agreement
   *                       does not carry (it is a commercial figure per
   *                       dispatch), so it is supplied per request.
   *
   * GST comes from the item master, the same source every other invoice in this
   * system uses. An item with no rate configured cannot be invoiced, which is
   * the existing rule rather than a new one.
   */
  private price(
    order: { orderNumber: string; agreement: { conversionChargeRate: Prisma.Decimal | null; conversionRateBasis: ConversionRateBasis | null } },
    billingModel: BillingModel,
    quantity: Prisma.Decimal,
    product: { code: string; gstRate: Prisma.Decimal | null },
    dto: CreateJobWorkDispatchDto,
  ): {
    invoiceBasis: JobWorkInvoiceBasis;
    rate: Prisma.Decimal;
    rateBasis: ConversionRateBasis | null;
    taxableValue: Prisma.Decimal;
    gstRatePercent: Prisma.Decimal;
    gstAmount: Prisma.Decimal;
    totalValue: Prisma.Decimal;
  } {
    const invoiceBasis = INVOICE_BASIS_FOR_BILLING_MODEL[billingModel];

    const gstRatePercent = product.gstRate ?? null;

    if (gstRatePercent === null) {
      throw new BadRequestException(
        `${product.code} has no GST rate on the item master, so an invoice for it cannot be ` +
          'calculated. Set the rate under Items first.',
      );
    }

    let rate: Prisma.Decimal;
    let rateBasis: ConversionRateBasis | null;
    let taxableValue: Prisma.Decimal;

    if (billingModel === 'PURE_CONVERSION') {
      // CONTROL 7, the aggressive half: a caller who sends a unit value under
      // pure conversion is told no. Silently dropping it would leave them
      // believing they had billed the goods.
      if (dto.unitValue !== undefined) {
        throw new BadRequestException(
          `${order.orderNumber} is a pure-conversion order, so only the agreed conversion charge ` +
            'is invoiced and the raw-material value is not. A unit value cannot be supplied.',
        );
      }

      if (!order.agreement.conversionChargeRate || !order.agreement.conversionRateBasis) {
        throw new ConflictException(
          'The agreement behind this order has no conversion charge on it, so there is nothing ' +
            'to invoice. Record the agreed rate and its basis on the agreement first.',
        );
      }

      rate = order.agreement.conversionChargeRate;
      rateBasis = order.agreement.conversionRateBasis;
      taxableValue = conversionCharge(rate, rateBasis, quantity);
    } else {
      // OWN_PROCUREMENT: the full finished-goods value.
      if (dto.unitValue === undefined) {
        throw new BadRequestException(
          `${order.orderNumber} is an own-procurement order, so the principal is invoiced the ` +
            'full finished-goods value. Supply the value per unit.',
        );
      }

      rate = parseQuantity(dto.unitValue, 'unitValue');

      if (rate.lessThan(ZERO)) {
        throw new BadRequestException('The value per unit cannot be negative.');
      }

      // No basis: the rate is per unit of the product, which is what
      // `dispatchedQuantity` counts.
      rateBasis = null;
      taxableValue = rate.mul(quantity);
    }

    taxableValue = round2(taxableValue);

    const gstAmount = round2(taxableValue.mul(gstRatePercent).div(HUNDRED));
    const totalValue = round2(taxableValue.add(gstAmount));

    return { invoiceBasis, rate, rateBasis, taxableValue, gstRatePercent, gstAmount, totalValue };
  }
}

/**
 * The conversion charge for a quantity, on the agreement's basis.
 *
 * The four bases are the ones the agreement register already stores, and each
 * is read literally:
 *
 *   PER_BATCH       one dispatch of one batch is one charge, so the rate stands
 *                   on its own and quantity does not scale it.
 *   PER_UNIT        rate x quantity, quantity being units -- a tablet, a vial,
 *                   a capsule. This is the basis the brief's "Rs 0.15 per
 *                   tablet" is quoted on.
 *   PER_1000_UNITS  rate x quantity / 1000.
 *   PER_PACK        rate x quantity, quantity being packs.
 *   PER_KG          rate x quantity, quantity being kilograms.
 *
 * PER_PACK and PER_KG multiply identically; they are kept apart because the
 * UNIT differs, and collapsing them would lose what the number means.
 */
function conversionCharge(
  rate: Prisma.Decimal,
  basis: ConversionRateBasis,
  quantity: Prisma.Decimal,
): Prisma.Decimal {
  switch (basis) {
    case 'PER_BATCH':
      return rate;
    case 'PER_1000_UNITS':
      return rate.mul(quantity).div(THOUSAND);
    case 'PER_UNIT':
    case 'PER_PACK':
    case 'PER_KG':
      return rate.mul(quantity);
    default: {
      // Exhaustiveness: a basis added to the enum without a rule here should
      // fail loudly rather than bill zero.
      const unreachable: never = basis;

      throw new BadRequestException(`Unsupported conversion rate basis: ${String(unreachable)}`);
    }
  }
}

/** Decimal(14,2) is what the money columns hold. */
function round2(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

const INVOICE_INCLUDE = {
  jobWorkOrder: {
    select: { id: true, orderNumber: true, principal: { select: { id: true, name: true } } },
  },
  batch: { select: { batchNumber: true } },
  jobWorkBatch: { select: { batchNumber: true } },
  createdBy: { select: { fullName: true } },
} satisfies Prisma.JobWorkInvoiceInclude;

type InvoiceWithRelations = Prisma.JobWorkInvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

function toInvoiceView(invoice: InvoiceWithRelations): JobWorkInvoiceView {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,

    jobWorkOrderId: invoice.jobWorkOrder.id,
    jobWorkOrderNumber: invoice.jobWorkOrder.orderNumber,
    principalId: invoice.jobWorkOrder.principal.id,
    principalName: invoice.jobWorkOrder.principal.name,

    // WHICHEVER OF THE TWO the row names — the CHECK guarantees exactly one,
    // so the fallback is unreachable and only satisfies the type.
    batchId: invoice.batchId ?? invoice.jobWorkBatchId ?? '',
    batchNumber: invoice.batch?.batchNumber ?? invoice.jobWorkBatch?.batchNumber ?? '—',

    invoiceBasis: invoice.invoiceBasis,
    billingModel: invoice.billingModel as BillingModel,

    dispatchDate: toIsoDate(invoice.dispatchDate),
    dispatchedQuantity: invoice.dispatchedQuantity.toString(),

    rateApplied: invoice.rateApplied.toString(),
    rateBasis: invoice.rateBasis,

    taxableValue: invoice.taxableValue.toString(),
    gstRatePercent: invoice.gstRatePercent.toString(),
    gstAmount: invoice.gstAmount.toString(),
    totalValue: invoice.totalValue.toString(),

    notes: invoice.notes,
    createdAt: invoice.createdAt.toISOString(),
    createdBy: invoice.createdBy?.fullName ?? null,
  };
}
