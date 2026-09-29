import { Injectable } from '@nestjs/common';

import { Prisma } from '@pharma-erp/database';
import {
  PROCUREMENT_ROUTES,
  type ProcurementSummary,
  type ProcurementSummaryCard,
} from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';

import { ZERO, money, positiveDifference } from './decimal.util';
import { RequiredStockService } from './required-stock.service';

/**
 * The counts across the top of Procure-to-Pay.
 *
 * Each card carries its own `href`, built here rather than in the UI. The card
 * and its destination then cannot disagree about what "pending" means — if the
 * count says seven and the link filters to something else, the number was
 * measuring one thing and the link showing another, and nobody notices until
 * they count the rows.
 */
@Injectable()
export class SummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requiredStock: RequiredStockService,
  ) {}

  async build(): Promise<ProcurementSummary> {
    const scoped = this.prisma.scoped;

    const [
      requiredStock,
      pendingRequisitions,
      approvedRequisitions,
      draftOrders,
      openOrders,
      pendingQc,
      heldLots,
      draftInvoices,
      approvedInvoices,
    ] = await Promise.all([
      this.requiredStock.lines(),
      scoped.purchaseRequisition.count({ where: { deletedAt: null, status: 'OPEN' } }),
      scoped.purchaseRequisition.count({ where: { deletedAt: null, status: 'APPROVED' } }),
      scoped.purchaseOrder.count({ where: { deletedAt: null, status: 'OPEN' } }),
      scoped.purchaseOrder.count({
        where: { deletedAt: null, status: { in: ['OPEN', 'PARTIALLY_RECEIVED'] } },
      }),
      scoped.stockLot.count({ where: { status: 'QUARANTINE' } }),
      scoped.stockLot.count({ where: { status: 'ON_HOLD' } }),
      scoped.purchaseInvoice.count({ where: { deletedAt: null, status: 'BOOKED' } }),
      scoped.purchaseInvoice.findMany({
        where: { deletedAt: null, status: { not: 'CANCELLED' } },
        select: { totalAmount: true, dueDate: true, payments: { select: { amount: true } } },
      }),
    ]);

    // Outstanding payables, and how much of it is already past due. Computed
    // from the same rule the payables screen uses, so the card and the list
    // cannot report different totals.
    const now = new Date();
    let outstanding = ZERO;
    let overdueAmount = ZERO;
    let overdueCount = 0;

    for (const invoice of approvedInvoices) {
      const paid = invoice.payments.reduce((sum, payment) => sum.plus(payment.amount), ZERO);
      const due = positiveDifference(new Prisma.Decimal(invoice.totalAmount), paid);

      if (due.isZero()) continue;

      outstanding = outstanding.plus(due);

      if (invoice.dueDate.getTime() < now.getTime()) {
        overdueAmount = overdueAmount.plus(due);
        overdueCount += 1;
      }
    }

    const unpaidCount = approvedInvoices.filter((invoice) => {
      const paid = invoice.payments.reduce((sum, payment) => sum.plus(payment.amount), ZERO);

      return positiveDifference(new Prisma.Decimal(invoice.totalAmount), paid).greaterThan(0);
    }).length;

    const shortages = requiredStock.filter(
      (line) => line.blockedReason === null && Number(line.shortfallQuantity) > 0,
    );

    const cards: ProcurementSummaryCard[] = [
      {
        // SHORTAGES, not lines. The tab lists one line per material per order
        // and most of them are covered; what is worth a tile is the number
        // that cannot be served from stock.
        key: 'required-stock',
        label: 'Materials short',
        count: shortages.length,
        detail:
          shortages.length > 0
            ? 'Sales orders need more than is free'
            : 'Every live sales order can be served from stock',
        href: PROCUREMENT_ROUTES.requiredStock,
        tone: shortages.length > 0 ? 'attention' : 'neutral',
      },
      {
        key: 'pending-requisitions',
        label: 'Open requisitions',
        count: pendingRequisitions,
        detail: approvedRequisitions > 0 ? `${approvedRequisitions} approved, ready for PO` : null,
        href: `${PROCUREMENT_ROUTES.requisitions}?status=OPEN`,
        tone: pendingRequisitions > 0 ? 'attention' : 'neutral',
      },
      {
        key: 'draft-orders',
        label: 'Open purchase orders',
        count: draftOrders,
        detail: draftOrders > 0 ? 'Awaiting delivery' : null,
        href: `${PROCUREMENT_ROUTES.purchaseOrders}?status=OPEN`,
        tone: draftOrders > 0 ? 'attention' : 'neutral',
      },
      {
        key: 'awaiting-receipt',
        label: 'Orders awaiting delivery',
        count: openOrders,
        detail: openOrders > 0 ? 'Issued or part received' : null,
        href: `${PROCUREMENT_ROUTES.purchaseOrders}?status=PARTIALLY_RECEIVED`,
        tone: 'neutral',
      },
      {
        key: 'pending-qc',
        label: 'Batches pending QC',
        count: pendingQc,
        detail: heldLots > 0 ? `${heldLots} on hold` : 'In quarantine, unusable until released',
        href: `${PROCUREMENT_ROUTES.incomingQc}?status=QUARANTINE`,
        tone: pendingQc > 0 ? 'warn' : 'neutral',
      },
      {
        key: 'draft-invoices',
        label: 'Unpaid invoices',
        count: draftInvoices,
        detail: draftInvoices > 0 ? 'Booked, nothing paid yet' : null,
        href: `${PROCUREMENT_ROUTES.invoices}?status=BOOKED`,
        tone: draftInvoices > 0 ? 'attention' : 'neutral',
      },
      {
        key: 'outstanding-payables',
        label: 'Outstanding payables',
        count: unpaidCount,
        detail: `₹${money(outstanding)} owed`,
        href: PROCUREMENT_ROUTES.payments,
        tone: outstanding.greaterThan(0) ? 'attention' : 'neutral',
      },
      {
        key: 'overdue-payables',
        label: 'Overdue payments',
        count: overdueCount,
        detail: overdueCount > 0 ? `₹${money(overdueAmount)} past due` : 'Nothing past due',
        href: `${PROCUREMENT_ROUTES.payments}?status=OVERDUE`,
        tone: overdueCount > 0 ? 'warn' : 'neutral',
      },
    ];

    return { cards, generatedAt: now.toISOString() };
  }
}
