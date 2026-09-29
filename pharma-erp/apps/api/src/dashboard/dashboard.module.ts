import { Module } from '@nestjs/common';

import { InventoryModule } from '../inventory/inventory.module';
import { LicencesModule } from '../licences/licences.module';
import { PackagingModule } from '../packaging/packaging.module';

import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * PrismaModule and TenantModule are @Global, so they are not imported here.
 *
 * LicencesModule is not global and has to be: the dashboard's renewal warning
 * reads LicencesService so that the alert and the register cannot disagree
 * about which licences count as expiring. PackagingModule is imported for the
 * same reason: the shortage panel and the packaging register must agree on
 * what counts as short. InventoryModule likewise, so the near-expiry widgets
 * and the near-expiry report count the same batches.
 */
@Module({
  imports: [LicencesModule, PackagingModule, InventoryModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
