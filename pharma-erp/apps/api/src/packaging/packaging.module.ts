import { Module } from '@nestjs/common';

import { ProcurementModule } from '../procurement/procurement.module';

import { PackagingController } from './packaging.controller';
import { PackagingService } from './packaging.service';

/**
 * The Packaging Requirement Master — US-MD-06.
 *
 * Imports ProcurementModule for StockService: the availability check reads
 * usable stock, and Procure-to-Pay already owns that question. Asking it there
 * rather than re-implementing a stock sum here is what keeps "how much of this
 * component do we have" a single answer.
 *
 * Exported because two other places ask it questions — ProductionService for
 * the work-order gate, and DashboardService for the shortage sweep.
 *
 * PrismaModule and TenantModule are global, so they are not imported here.
 */
@Module({
  imports: [ProcurementModule],
  controllers: [PackagingController],
  providers: [PackagingService],
  exports: [PackagingService],
})
export class PackagingModule {}
