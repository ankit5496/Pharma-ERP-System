import { Module } from '@nestjs/common';

import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { MovementsService } from './movements.service';

/** Inventory — US-INV-01. PrismaModule is global, so nothing is imported. */
@Module({
  controllers: [InventoryController],
  providers: [InventoryService, MovementsService],
})
export class InventoryModule {}
