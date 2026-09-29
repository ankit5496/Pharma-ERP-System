import { Module } from '@nestjs/common';

import { ExpiryService } from './expiry.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { MovementsService } from './movements.service';

/**
 * Inventory — US-INV-01, US-INV-03. PrismaModule is global, so nothing is
 * imported. ExpiryService is exported for the dashboard's near-expiry widgets.
 */
@Module({
  controllers: [InventoryController],
  providers: [InventoryService, MovementsService, ExpiryService],
  exports: [ExpiryService],
})
export class InventoryModule {}
