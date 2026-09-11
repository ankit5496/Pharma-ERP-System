import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import type { PartySummary } from '@pharma-erp/types';

import { Roles } from '../auth/auth.decorators';
import { SkipAudit } from '../common/audit/audit.decorators';

import { CreatePartyDto, UpdatePartyDto } from './dto/party.dto';
import { PartiesService } from './parties.service';

/**
 * The party register — US-MD-02.
 *
 * Suppliers and customers on one controller because they are one table: a
 * distributor that also supplies cartons is a single legal entity, and
 * splitting the routes would force the UI to guess which one to call.
 *
 * Reads are open to every signed-in role: a storekeeper raising a goods
 * receipt needs the supplier list. Writes are narrower, and retiring is
 * narrower still.
 */
@Controller('parties')
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  /** `type` filters to one side; SUPPLIER and CUSTOMER both include BOTH. */
  @Get()
  @SkipAudit('Read-only master data.')
  async list(@Query('type') type?: string): Promise<PartySummary[]> {
    return this.parties.list(type);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'PURCHASE_MANAGER', 'SALES_MANAGER')
  async create(@Body() dto: CreatePartyDto): Promise<PartySummary> {
    return this.parties.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PURCHASE_MANAGER', 'SALES_MANAGER')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartyDto,
  ): Promise<PartySummary> {
    return this.parties.update(id, dto);
  }

  /**
   * Retires a party. Admin only — purchase and sales both read this register,
   * so withdrawing an entry affects more than one desk.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('ADMIN')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.parties.remove(id);
  }
}
