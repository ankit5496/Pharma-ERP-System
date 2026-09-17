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

import type { DispatchDetail, DispatchListItem } from '@pharma-erp/types';

import { Roles } from '../../auth/auth.decorators';
import { SkipAudit } from '../../common/audit/audit.decorators';

import { DispatchService } from './dispatch.service';
import { CreateDispatchDto, UpdateDispatchDto } from './dto/dispatch.dto';

/**
 * Despatch.
 *
 * STORE_OFFICER can raise and confirm one — the people who pick the stock are
 * the people who record it leaving. `delivered` is separate from `confirm`
 * because the van leaving and the goods arriving are different events, often
 * days apart, and the second is what starts the returns clock.
 */
@Controller('order-to-cash/dispatch')
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get()
  @SkipAudit('Read-only.')
  async list(@Query('search') search?: string): Promise<DispatchListItem[]> {
    return this.dispatch.list(search);
  }

  @Get(':id')
  @SkipAudit('Read-only.')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<DispatchDetail> {
    return this.dispatch.get(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'SALES_MANAGER', 'STORE_OFFICER')
  async create(@Body() dto: CreateDispatchDto): Promise<DispatchDetail> {
    return this.dispatch.create(dto);
  }

  /** Amends a DRAFT consignment note. Lines are allocation's, not this form's. */
  @Patch(':id')
  @Roles('ADMIN', 'SALES_MANAGER', 'STORE_OFFICER')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDispatchDto,
  ): Promise<DispatchDetail> {
    return this.dispatch.update(id, dto);
  }

  /** Stock leaves the lot here — see the service. */
  @Post(':id/confirm')
  @Roles('ADMIN', 'SALES_MANAGER', 'STORE_OFFICER')
  async confirm(@Param('id', ParseUUIDPipe) id: string): Promise<DispatchDetail> {
    return this.dispatch.confirm(id);
  }

  @Post(':id/delivered')
  @Roles('ADMIN', 'SALES_MANAGER', 'STORE_OFFICER')
  async delivered(@Param('id', ParseUUIDPipe) id: string): Promise<DispatchDetail> {
    return this.dispatch.markDelivered(id);
  }
}
