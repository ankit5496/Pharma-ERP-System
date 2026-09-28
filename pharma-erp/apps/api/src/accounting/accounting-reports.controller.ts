import { Controller, Get, Query } from '@nestjs/common';

import type { RegisterReport } from '@pharma-erp/types';

import { SkipAudit } from '../common/audit/audit.decorators';

import { AccountingReportsService } from './accounting-reports.service';
import { RegisterQueryDto } from './dto/register-query.dto';

/**
 * US-ACC-03 — the purchase and sales registers.
 *
 * NO `@Roles(...)`, matching the dashboard: any authenticated member of the
 * tenant may read the registers, and what they can see is decided by row-level
 * security in Postgres rather than by this route. Both endpoints are GETs that
 * write nothing.
 */
@Controller('accounting/reports')
export class AccountingReportsController {
  constructor(private readonly reports: AccountingReportsService) {}

  @Get('purchase-register')
  @SkipAudit('Read-only report over invoices that are themselves audited.')
  async purchaseRegister(@Query() query: RegisterQueryDto): Promise<RegisterReport> {
    return this.reports.purchaseRegister(query);
  }

  @Get('sales-register')
  @SkipAudit('Read-only report over invoices that are themselves audited.')
  async salesRegister(@Query() query: RegisterQueryDto): Promise<RegisterReport> {
    return this.reports.salesRegister(query);
  }
}
