import { Module } from '@nestjs/common';

import { AccountingReportsController } from './accounting-reports.controller';
import { AccountingReportsService } from './accounting-reports.service';

/**
 * US-ACC-03 — accounting reports.
 *
 * PrismaModule and TenantModule are @Global, so they are not imported here.
 * Nothing else is: the registers read the invoice tables directly rather than
 * calling Procurement or Order-to-Cash, because those services answer the
 * questions their own screens ask — a page of invoices, filtered and
 * paginated — and a register needs every invoice in a period, unpaged, with
 * its lines. Reusing them would mean bending both to a third purpose.
 */
@Module({
  controllers: [AccountingReportsController],
  providers: [AccountingReportsService],
})
export class AccountingModule {}
