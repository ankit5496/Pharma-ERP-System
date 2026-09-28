import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import type {
  MaterialRequirementSummary,
  SalesOrderDetail,
  SalesOrderListItem,
} from '@pharma-erp/types';

import { Roles } from '../../auth/auth.decorators';
import { SkipAudit } from '../../common/audit/audit.decorators';
import { MaterialRequirementService } from '../../production/material-requirement.service';

import { CreateSalesOrderDto, UpdateSalesOrderDto } from './dto/sales-order.dto';
import { SalesOrdersService } from './sales-orders.service';

/**
 * Sales orders.
 *
 * Reads are open to every signed-in role — despatch and accounts both work
 * from the order. Raising and gating one belongs to the sales desk.
 *
 * `check` is a POST rather than a GET because it WRITES: it records the
 * verdict and the credit position on the order. Modelling it as a read would
 * make it look repeatable and cacheable, and it is neither.
 */
@Controller('order-to-cash/sales-orders')
export class SalesOrdersController {
  constructor(
    private readonly orders: SalesOrdersService,
    private readonly materialRequirement: MaterialRequirementService,
  ) {}

  /** `search` matches the order number or the customer's code or name. */
  @Get()
  @SkipAudit('Read-only.')
  async list(@Query('search') search?: string): Promise<SalesOrderListItem[]> {
    return this.orders.list(search);
  }

  /**
   * The number the next order would take.
   *
   * Declared BEFORE `:id` so the literal segment is not swallowed by the
   * parameter route. Read-only: it does not allocate the number.
   */
  @Get('next-number')
  @SkipAudit('Read-only.')
  async nextNumber(): Promise<{ number: string }> {
    return this.orders.nextNumberPreview();
  }

  @Get(':id')
  @SkipAudit('Read-only.')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<SalesOrderDetail> {
    return this.orders.get(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'SALES_MANAGER')
  async create(@Body() dto: CreateSalesOrderDto): Promise<SalesOrderDetail> {
    return this.orders.create(dto);
  }

  /** Amends a DRAFT order. Refused once the gate has run — see the service. */
  @Patch(':id')
  @Roles('ADMIN', 'SALES_MANAGER')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalesOrderDto,
  ): Promise<SalesOrderDetail> {
    return this.orders.update(id, dto);
  }

  @Post(':id/check')
  @Roles('ADMIN', 'SALES_MANAGER')
  async check(@Param('id', ParseUUIDPipe) id: string): Promise<SalesOrderDetail> {
    return this.orders.runCheck(id);
  }

  /**
   * What confirming this order was determined to require — US-MD-07.
   *
   * A READ, so it is open to every signed-in role and audited as one. The
   * determination itself is written by confirmation, not by this route: asking
   * what an order needs must never be the thing that decides it, or opening a
   * screen would raise requisitions.
   */
  @Get(':id/material-requirements')
  @SkipAudit('Read-only.')
  async materialRequirements(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MaterialRequirementSummary> {
    return this.materialRequirement.findForSalesOrder(id);
  }

  @Post(':id/cancel')
  @Roles('ADMIN', 'SALES_MANAGER')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason?: string,
  ): Promise<SalesOrderDetail> {
    return this.orders.cancel(id, reason);
  }
}
