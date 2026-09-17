import { ConflictException } from '@nestjs/common';

import type { Prisma } from '@pharma-erp/database';
import { STOCK_BUCKET_FOR_BILLING_MODEL, type StockOwnership } from '@pharma-erp/types';

/**
 * Which stock a work order is allowed to consume — US-JW-03, controls 4 and 5.
 *
 * SHARED BY PRODUCTION AND MATERIAL ISSUE, deliberately in a module of its own.
 * The rule has to hold in three places — the feasibility check when the order
 * is raised, the FEFO proposal, and the actual dispensing — and three copies of
 * a `where` clause is exactly how one of them ends up a version behind. This is
 * the one definition; each caller spreads it into its own query.
 *
 * THE FOUR CASES:
 *
 *   Own-brand work order          COMPANY_OWNED, no principal.
 *   Job work, OWN_PROCUREMENT     COMPANY_OWNED — we bought the material.
 *   Job work, PURE_CONVERSION     PRINCIPAL_OWNED, and only the lots that came
 *                                 in against THIS job-work order.
 *
 * The last narrowing is not in the written rules and is worth stating plainly:
 * US-JW-02 says principal-owned stock is "structurally separate from
 * company-owned stock", and rule 7 repeats it. It says nothing about one
 * principal's material versus another's — but "Principal-Owned" can only mean
 * owned by THAT principal, and consuming principal A's paracetamol on principal
 * B's order would be giving away A's property. Scoping to the job-work order is
 * the tightest reading that cannot be wrong; a looser one (any lot of the same
 * principal) can be adopted later without unpicking anything, because it is the
 * same column.
 */
export interface StockBucketRule {
  ownership: StockOwnership;
  /** Set only under PURE_CONVERSION: the order whose receipts may be drawn on. */
  jobWorkOrderId: string | null;
}

/** The rule for a work order, from the terms pinned on it. */
export function stockBucketFor(order: {
  jobWorkOrderId: string | null;
  jobWorkBillingModel: 'OWN_PROCUREMENT' | 'PURE_CONVERSION' | null;
}): StockBucketRule {
  if (!order.jobWorkOrderId || !order.jobWorkBillingModel) {
    return { ownership: 'COMPANY_OWNED', jobWorkOrderId: null };
  }

  const ownership = STOCK_BUCKET_FOR_BILLING_MODEL[order.jobWorkBillingModel];

  return {
    ownership,
    jobWorkOrderId: ownership === 'PRINCIPAL_OWNED' ? order.jobWorkOrderId : null,
  };
}

/**
 * The rule as a Prisma `where` fragment on StockLot.
 *
 * Spread into the caller's filter. Every stock query that feeds production goes
 * through this, which is what makes control 5 — "attempt to consume incorrect
 * stock → BLOCK TRANSACTION" — true of the queries rather than of a check
 * somebody has to remember to write beside them.
 */
export function stockBucketWhere(rule: StockBucketRule): Prisma.StockLotWhereInput {
  if (rule.ownership === 'COMPANY_OWNED') {
    return { ownership: 'COMPANY_OWNED' };
  }

  return {
    ownership: 'PRINCIPAL_OWNED',
    jobWorkMaterialReceipt: { jobWorkOrderId: rule.jobWorkOrderId ?? undefined },
  };
}

/** How to describe the bucket in a refusal a store officer can act on. */
export function describeBucket(rule: StockBucketRule): string {
  return rule.ownership === 'PRINCIPAL_OWNED'
    ? "the principal's own material received against this job-work order"
    : 'company-owned stock released by incoming QC';
}

/**
 * Whether a lot satisfies the rule — used when someone picks a lot by hand.
 *
 * The FEFO proposal never offers the wrong bucket, but US-PROD-02 lets a person
 * override the proposal with a named lot. Without this, that override would be
 * the one door left open in control 5.
 */
export function assertLotInBucket(
  lot: {
    lotNumber: string;
    ownership: StockOwnership;
    jobWorkMaterialReceipt: { jobWorkOrderId: string } | null;
  },
  rule: StockBucketRule,
): void {
  if (lot.ownership !== rule.ownership) {
    throw new ConflictException(
      `Lot ${lot.lotNumber} is ${lot.ownership === 'PRINCIPAL_OWNED' ? 'principal-owned' : 'company-owned'} ` +
        `stock, and this work order must consume ${describeBucket(rule)}. ` +
        'The stock bucket follows from the job-work agreement and is not something an override ' +
        'can set aside.',
    );
  }

  if (
    rule.ownership === 'PRINCIPAL_OWNED' &&
    lot.jobWorkMaterialReceipt?.jobWorkOrderId !== rule.jobWorkOrderId
  ) {
    throw new ConflictException(
      `Lot ${lot.lotNumber} was received against a different job-work order. Material one ` +
        'principal supplied cannot be consumed on another order.',
    );
  }
}

// There was an `assertNotYetStarted` helper here. It is gone: the rule it
// expressed — job-work terms are fixed once a work order leaves PLANNED — is
// enforced by the `production_orders_freeze_job_work_terms` trigger, which a
// direct UPDATE cannot get past either. A second copy in TypeScript would have
// been a rule with two homes and one of them eventually out of date.
