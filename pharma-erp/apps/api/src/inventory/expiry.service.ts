import { BadRequestException, Injectable } from '@nestjs/common';

import {
  DEFAULT_EXPIRY_ALERT_DAYS,
  expiryBucketFor,
  expiryBuckets,
  type ExpiryBucketKey,
  type NearExpiryQuery,
  type NearExpiryReport,
  type NearExpiryRow,
} from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

import { InventoryService } from './inventory.service';

/**
 * The near-expiry report — US-INV-03.
 *
 * Built on the stock enquiry rather than beside it, so "what is on hand" means
 * the same thing on both screens: a batch the enquiry shows is a batch this
 * report can flag. A batch is flagged when it has an expiry date inside the
 * company's widest window, or has already expired and is still held — expired
 * stock on the shelf is the write-off this report exists to prevent, and
 * dropping it once the date passes would hide it at the worst moment.
 *
 * The windows are `Tenant.expiryAlertDays`, not constants.
 */
@Injectable()
export class ExpiryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly inventory: InventoryService,
  ) {}

  /** This company's windows, smallest first. */
  async alertDays(): Promise<number[]> {
    const tenant = await this.prisma.scoped.tenant.findFirst({
      where: { id: this.tenantContext.requireTenantId() },
      select: { expiryAlertDays: true },
    });

    return sorted(
      tenant?.expiryAlertDays.length ? tenant.expiryAlertDays : [...DEFAULT_EXPIRY_ALERT_DAYS],
    );
  }

  async report(query: NearExpiryQuery): Promise<NearExpiryReport> {
    const [alertDays, stock] = await Promise.all([
      this.alertDays(),
      this.inventory.stockEnquiry(query.itemId ? { itemId: query.itemId } : {}),
    ]);

    const buckets = expiryBuckets(alertDays);

    if (query.bucket && !buckets.some((bucket) => bucket.key === query.bucket)) {
      throw new BadRequestException(
        `${query.bucket} is not one of this company's expiry windows (${alertDays.join(', ')} days).`,
      );
    }

    const term = query.search?.toLowerCase();

    const flagged: NearExpiryRow[] = stock.groups
      .flatMap((group) => group.batches.map((batch) => ({ ...batch, item: group.item })))
      .flatMap((row) => {
        const bucket =
          row.daysToExpiry === null ? null : expiryBucketFor(row.daysToExpiry, alertDays);

        return bucket ? [{ ...row, bucket }] : [];
      })
      // Narrows to the batch typed, unlike the enquiry's search, which widens
      // to the whole item: here the question is "this batch — how long has it got?"
      .filter(
        (row) =>
          !term ||
          [row.batchNumber, row.vendorBatchNumber ?? '', row.item.name, row.item.code].some(
            (value) => value.toLowerCase().includes(term),
          ),
      );

    // Counted before the bucket filter, so every bucket's figure stays visible
    // while one of them is selected.
    const counts = new Map<ExpiryBucketKey, number>();
    for (const row of flagged) counts.set(row.bucket, (counts.get(row.bucket) ?? 0) + 1);

    return {
      alertDays,
      buckets: buckets.map((bucket) => ({ ...bucket, batchCount: counts.get(bucket.key) ?? 0 })),
      rows: flagged
        .filter((row) => !query.bucket || row.bucket === query.bucket)
        .sort(
          (a, b) =>
            a.daysToExpiry! - b.daysToExpiry! ||
            a.item.name.localeCompare(b.item.name) ||
            a.batchNumber.localeCompare(b.batchNumber),
        ),
    };
  }

  /** Changes the windows. The DTO has already checked count, range and repeats. */
  async setAlertDays(days: number[]): Promise<number[]> {
    const tenant = await this.prisma.scoped.tenant.update({
      where: { id: this.tenantContext.requireTenantId() },
      data: { expiryAlertDays: sorted(days) },
      // One setting changed, one column returned — see LicencesService.setAlertLeadDays.
      select: { expiryAlertDays: true },
    });

    return sorted(tenant.expiryAlertDays);
  }
}

function sorted(days: number[]): number[] {
  return [...days].sort((a, b) => a - b);
}
