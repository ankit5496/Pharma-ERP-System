import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';

import type { ItemListItem } from '@pharma-erp/types';

import { Roles } from '../auth/auth.decorators';
import { SkipAudit } from '../common/audit/audit.decorators';

import { CreateItemDto } from './dto/item.dto';
import { MastersService } from './masters.service';

/**
 * Read-only master data for the Order-to-Cash screens.
 *
 * Reads are open to every signed-in role. There is ONE write — creating a
 * finished product — because an order cannot be taken for a product that does
 * not exist yet, and until the master-data screens cover it there is nowhere
 * else to add one. It writes to the SHARED register, so it is a convenience
 * route rather than a second item master, and it names its own roles.
 */
@Controller('masters')
export class MastersController {
  constructor(private readonly masters: MastersService) {}

  /** `itemType=FINISHED_GOOD` is what the sales-order product picker asks for. */
  @Get('items')
  @SkipAudit('Read-only master data.')
  async listItems(
    @Query('itemType') itemType?: string,
    @Query('search') search?: string,
  ): Promise<ItemListItem[]> {
    return this.masters.listItems(itemType, search);
  }

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'SALES_MANAGER', 'PURCHASE_MANAGER')
  async createItem(@Body() dto: CreateItemDto): Promise<ItemListItem> {
    return this.masters.createItem(dto);
  }
}
