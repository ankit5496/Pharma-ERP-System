import { Controller, Get, Query } from '@nestjs/common';

import type { StockEnquiry, StockMovement } from '@pharma-erp/types';

import { Roles } from '../auth/auth.decorators';
import { SkipAudit } from '../common/audit/audit.decorators';

import { BatchMovementsQueryDto, StockEnquiryQueryDto } from './dto/stock-enquiry-query.dto';
import { InventoryService } from './inventory.service';
import { MovementsService } from './movements.service';

/**
 * Inventory — US-INV-01.
 *
 * Read-only. The roles are those whose work depends on what is physically
 * held; MANAGEMENT reads everything, as elsewhere.
 */
@Controller('inventory')
@Roles('ADMIN', 'STORE_OFFICER', 'PRODUCTION_OFFICER', 'MANAGEMENT')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly movements: MovementsService,
  ) {}

  @Get('stock')
  @SkipAudit('Read-only stock enquiry; the movements behind it carry their own history.')
  async stock(@Query() query: StockEnquiryQueryDto): Promise<StockEnquiry> {
    return this.inventory.stockEnquiry(query);
  }

  /** One batch's movement history, oldest first. */
  @Get('movements')
  @SkipAudit('Read-only; assembled from records that carry their own history.')
  async batchMovements(@Query() query: BatchMovementsQueryDto): Promise<StockMovement[]> {
    return query.source === 'MATERIAL'
      ? this.movements.forMaterialLot(query.id)
      : this.movements.forFinishedLot(query.id);
  }
}
