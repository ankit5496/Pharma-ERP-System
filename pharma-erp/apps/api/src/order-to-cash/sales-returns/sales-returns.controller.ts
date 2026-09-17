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

import type { SalesReturnDetail, SalesReturnListItem } from '@pharma-erp/types';

import { Roles } from '../../auth/auth.decorators';
import { SkipAudit } from '../../common/audit/audit.decorators';

import { CreateSalesReturnDto, UpdateSalesReturnDto } from './dto/sales-return.dto';
import { SalesReturnsService } from './sales-returns.service';

/**
 * Sales returns and recalls.
 *
 * `receive` and `credit` are separate acts by different desks: the store
 * records what physically came back and where it went, and only then does
 * finance give the money back. Collapsing them would credit a customer for
 * goods nobody had confirmed arriving.
 */
@Controller('order-to-cash/sales-returns')
export class SalesReturnsController {
  constructor(private readonly returns: SalesReturnsService) {}

  @Get()
  @SkipAudit('Read-only.')
  async list(@Query('search') search?: string): Promise<SalesReturnListItem[]> {
    return this.returns.list(search);
  }

  @Get(':id')
  @SkipAudit('Read-only.')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<SalesReturnDetail> {
    return this.returns.get(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'SALES_MANAGER', 'STORE_OFFICER')
  async create(@Body() dto: CreateSalesReturnDto): Promise<SalesReturnDetail> {
    return this.returns.create(dto);
  }

  /** Amends a DRAFT return. Refused once the goods have been received. */
  @Patch(':id')
  @Roles('ADMIN', 'SALES_MANAGER', 'STORE_OFFICER')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalesReturnDto,
  ): Promise<SalesReturnDetail> {
    return this.returns.update(id, dto);
  }

  /** Goods physically back; only RESTOCK lines re-enter saleable stock. */
  @Post(':id/receive')
  @Roles('ADMIN', 'STORE_OFFICER', 'QUALITY_OFFICER')
  async receive(@Param('id', ParseUUIDPipe) id: string): Promise<SalesReturnDetail> {
    return this.returns.receive(id);
  }

  @Post(':id/credit')
  @Roles('ADMIN', 'ACCOUNTANT')
  async credit(@Param('id', ParseUUIDPipe) id: string): Promise<SalesReturnDetail> {
    return this.returns.credit(id);
  }
}
