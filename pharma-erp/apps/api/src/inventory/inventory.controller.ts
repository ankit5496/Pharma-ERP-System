import { Body, Controller, Get, Patch, Query } from '@nestjs/common';

import {
  rolesWithModule,
  type NearExpiryReport,
  type StockEnquiry,
  type StockMovement,
} from '@pharma-erp/types';

import { Roles } from '../auth/auth.decorators';
import { SkipAudit } from '../common/audit/audit.decorators';

import {
  BatchMovementsQueryDto,
  NearExpiryQueryDto,
  StockEnquiryQueryDto,
  UpdateExpiryAlertsDto,
} from './dto/stock-enquiry-query.dto';
import { ExpiryService } from './expiry.service';
import { InventoryService } from './inventory.service';
import { MovementsService } from './movements.service';

/**
 * Inventory — US-INV-01, US-INV-03.
 *
 * Read-only apart from the near-expiry windows. Open to the roles ROLE_MODULES
 * gives 'inventory' — Admin, Store Officer and Management; MANAGEMENT reads
 * but cannot write, as elsewhere.
 */
@Controller('inventory')
// Admin, Store Officer and Management — whoever ROLE_MODULES gives 'inventory'.
@Roles(...rolesWithModule('inventory'))
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly movements: MovementsService,
    private readonly expiry: ExpiryService,
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

  /** Batches expired or expiring inside this company's windows, soonest first. */
  @Get('near-expiry')
  @SkipAudit('Read-only report over the stock enquiry.')
  async nearExpiry(@Query() query: NearExpiryQueryDto): Promise<NearExpiryReport> {
    return this.expiry.report(query);
  }

  /**
   * Changes the near-expiry windows. Store owns the shelf and Admin owns the
   * company's settings; Management reads the report but does not set it.
   */
  @Patch('near-expiry/alerts')
  @Roles('ADMIN', 'STORE_OFFICER')
  async setExpiryAlerts(@Body() dto: UpdateExpiryAlertsDto): Promise<{ alertDays: number[] }> {
    return { alertDays: await this.expiry.setAlertDays(dto.alertDays) };
  }
}
