import { Injectable } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import type { BillingModel, JobWorkRegisterGroup, JobWorkRegisterRow } from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';

const ZERO = new Prisma.Decimal(0);

/**
 * The Job-Work Register — US-JW-06.
 *
 * READ-ONLY BY CONSTRUCTION, not by permission. There is no `job_work_register`
 * table, no create/update/delete method on this service and no write route on
 * the controller. US-JW-06's rules 1 and 2 — "register is READ-ONLY" and "user
 * cannot manually edit register values" — are therefore not access-control
 * decisions that a future role change could undo; there is nothing to edit.
 *
 * EVERY FIGURE IS AN AGGREGATE over records written by the rest of the flow:
 *
 *   Material Received   SUM(job_work_material_receipts.received_quantity)
 *                       for the order                                  US-JW-02
 *   Quantity Consumed   SUM(material_issue_lines.quantity_issued) over lines
 *                       whose lot came from this order's receipts   Material Issue
 *   FG Dispatched       SUM(job_work_invoices.dispatched_quantity)    US-JW-05
 *   Closing Balance     Received - Consumed
 *
 * Rule 5 — "every material receipt, production consumption and dispatch event
 * must automatically appear" — follows from that: an event appears because it
 * is counted, not because something remembered to post it here.
 *
 * CONSUMPTION IS COUNTED THROUGH THE LOT, not through the work order. The join
 * is issue line -> stock lot -> job-work material receipt -> order, which means
 * it measures the principal's material actually dispensed rather than what a
 * work order was nominally for. Under OWN_PROCUREMENT there are no such lots,
 * so consumption is legitimately zero: the company consumed its OWN material,
 * and counting that against the principal's balance would be wrong.
 */
@Injectable()
export class JobWorkRegisterService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The register, grouped by principal and agreement.
   *
   * Four aggregate queries and one order listing, rather than N+1 per order:
   * the register is the one screen that reads every job-work order at once.
   */
  async register(principalId?: string): Promise<JobWorkRegisterGroup[]> {
    const orders = await this.prisma.scoped.jobWorkOrder.findMany({
      where: { deletedAt: null, ...(principalId ? { principalId } : {}) },
      include: {
        principal: { select: { id: true, name: true } },
        agreement: { select: { id: true, agreementReference: true } },
        mapping: {
          select: {
            principalBrandName: true,
            bom: { select: { product: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ principalId: 'asc' }, { createdAt: 'asc' }],
    });

    if (orders.length === 0) return [];

    const orderIds = orders.map((order) => order.id);

    const [received, consumed, dispatched] = await Promise.all([
      this.prisma.scoped.jobWorkMaterialReceipt.groupBy({
        by: ['jobWorkOrderId'],
        where: { jobWorkOrderId: { in: orderIds }, deletedAt: null },
        _sum: { receivedQuantity: true },
      }),
      // No groupBy: the grouping key lives three joins away, on the receipt
      // behind the lot behind the line. Reading the lines with their receipt
      // and folding in memory is one round trip and exact; a groupBy here would
      // need a raw query that bypasses the RLS-scoped client.
      this.prisma.scoped.materialIssueLine.findMany({
        where: { lot: { jobWorkMaterialReceipt: { jobWorkOrderId: { in: orderIds } } } },
        select: {
          quantityIssued: true,
          lot: { select: { jobWorkMaterialReceipt: { select: { jobWorkOrderId: true } } } },
        },
      }),
      this.prisma.scoped.jobWorkInvoice.groupBy({
        by: ['jobWorkOrderId'],
        where: { jobWorkOrderId: { in: orderIds }, deletedAt: null },
        _sum: { dispatchedQuantity: true },
      }),
    ]);

    const receivedBy = new Map(
      received.map((row) => [row.jobWorkOrderId, row._sum.receivedQuantity ?? ZERO]),
    );
    const dispatchedBy = new Map(
      dispatched.map((row) => [row.jobWorkOrderId, row._sum.dispatchedQuantity ?? ZERO]),
    );

    const consumedBy = new Map<string, Prisma.Decimal>();

    for (const line of consumed) {
      const orderId = line.lot.jobWorkMaterialReceipt?.jobWorkOrderId;

      if (!orderId) continue;

      consumedBy.set(orderId, (consumedBy.get(orderId) ?? ZERO).add(line.quantityIssued));
    }

    const rows: JobWorkRegisterRow[] = orders.map((order) => {
      const materialReceived = receivedBy.get(order.id) ?? ZERO;
      const quantityConsumed = consumedBy.get(order.id) ?? ZERO;

      return {
        jobWorkOrderId: order.id,
        jobWorkOrderNumber: order.orderNumber,

        principalId: order.principal.id,
        principalName: order.principal.name,

        agreementId: order.agreement.id,
        agreementReference: order.agreement.agreementReference,
        billingModel: order.billingModel as BillingModel,

        productName: order.mapping.bom.product.name,
        principalBrandName: order.mapping.principalBrandName,

        orderedQuantity: order.quantity.toString(),
        materialReceived: materialReceived.toString(),
        quantityConsumed: quantityConsumed.toString(),
        finishedGoodsDispatched: (dispatchedBy.get(order.id) ?? ZERO).toString(),
        // US-JW-06's stated calculation, verbatim: received less consumed. The
        // dispatch column sits beside it as the third part of the trail rather
        // than inside the balance, because finished goods and input material
        // are not the same unit and subtracting one from the other would
        // produce a number that means nothing.
        closingBalance: materialReceived.sub(quantityConsumed).toString(),
      };
    });

    return this.group(rows);
  }

  /** Groups the rows by principal + agreement, with totals per group. */
  private group(rows: readonly JobWorkRegisterRow[]): JobWorkRegisterGroup[] {
    const groups = new Map<string, JobWorkRegisterGroup>();

    for (const row of rows) {
      const key = `${row.principalId}:${row.agreementId}`;

      const group = groups.get(key) ?? {
        principalId: row.principalId,
        principalName: row.principalName,
        agreementId: row.agreementId,
        agreementReference: row.agreementReference,
        billingModel: row.billingModel,
        rows: [],
        totalMaterialReceived: '0',
        totalQuantityConsumed: '0',
        totalFinishedGoodsDispatched: '0',
        totalClosingBalance: '0',
      };

      group.rows.push(row);

      group.totalMaterialReceived = new Prisma.Decimal(group.totalMaterialReceived)
        .add(row.materialReceived)
        .toString();
      group.totalQuantityConsumed = new Prisma.Decimal(group.totalQuantityConsumed)
        .add(row.quantityConsumed)
        .toString();
      group.totalFinishedGoodsDispatched = new Prisma.Decimal(group.totalFinishedGoodsDispatched)
        .add(row.finishedGoodsDispatched)
        .toString();
      group.totalClosingBalance = new Prisma.Decimal(group.totalClosingBalance)
        .add(row.closingBalance)
        .toString();

      groups.set(key, group);
    }

    return [...groups.values()];
  }
}
