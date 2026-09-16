import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';

import type { AllocationPlan, AllocationRow } from '@pharma-erp/types';

import { Roles } from '../../auth/auth.decorators';
import { SkipAudit } from '../../common/audit/audit.decorators';

import { AllocationService } from './allocation.service';

/**
 * Allocation — reserving released batches against an order.
 *
 * `plan` is a GET because it only previews. `commit`, the compliance check and
 * `release` all write, and are POSTs. The plan is never posted back: commit
 * recomputes FEFO server-side, so the rule cannot be edited in transit.
 */
@Controller('order-to-cash/allocation')
export class AllocationController {
  constructor(private readonly allocation: AllocationService) {}

  @Get()
  @SkipAudit('Read-only.')
  async list(@Query('search') search?: string): Promise<AllocationRow[]> {
    return this.allocation.list(search);
  }

  /** The FEFO preview for one order, before anything is reserved. */
  @Get('plan/:salesOrderId')
  @SkipAudit('Read-only preview.')
  async plan(
    @Param('salesOrderId', ParseUUIDPipe) salesOrderId: string,
  ): Promise<AllocationPlan> {
    return this.allocation.plan(salesOrderId);
  }

  @Get(':id')
  @SkipAudit('Read-only.')
  async forOrder(@Param('id', ParseUUIDPipe) id: string): Promise<AllocationRow[]> {
    return this.allocation.listForOrder(id);
  }

  /**
   * Commits FEFO for one order. The id in the path is the SALES ORDER, not an
   * allocation — allocations are what this creates.
   */
  @Post(':id')
  @Roles('ADMIN', 'SALES_MANAGER', 'STORE_OFFICER')
  async commit(@Param('id', ParseUUIDPipe) id: string): Promise<AllocationRow[]> {
    return this.allocation.commit(id);
  }

  /** The second look a Schedule H1 / H1X / X line needs before stock moves. */
  @Post(':id/compliance-check')
  @Roles('ADMIN', 'QUALITY_OFFICER', 'SALES_MANAGER')
  async complianceCheck(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('notes') notes?: string,
  ): Promise<AllocationRow> {
    return this.allocation.recordComplianceCheck(id, notes);
  }

  @Post(':id/release')
  @Roles('ADMIN', 'SALES_MANAGER', 'STORE_OFFICER')
  async release(@Param('id', ParseUUIDPipe) id: string): Promise<AllocationRow> {
    return this.allocation.release(id);
  }
}
