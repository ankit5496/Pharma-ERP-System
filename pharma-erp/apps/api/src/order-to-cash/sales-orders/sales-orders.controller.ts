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

import type { SalesOrderDetail, SalesOrderListItem } from '@pharma-erp/types';

import { Roles } from '../../auth/auth.decorators';
import { SkipAudit } from '../../common/audit/audit.decorators';

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
  constructor(private readonly orders: SalesOrdersService) {}

  /** `search` matches the order number or the customer's code or name. */
  @Get()
  @SkipAudit('Read-only.')
  async list(@Query('search') search?: string): Promise<SalesOrderListItem[]> {
    return this.orders.list(search);
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

  @Post(':id/cancel')
  @Roles('ADMIN', 'SALES_MANAGER')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason?: string,
  ): Promise<SalesOrderDetail> {
    return this.orders.cancel(id, reason);
  }
}
