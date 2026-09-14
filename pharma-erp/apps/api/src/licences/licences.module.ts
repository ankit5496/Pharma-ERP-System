import { Module } from '@nestjs/common';

import { LicencesController } from './licences.controller';
import { LicencesService } from './licences.service';

/**
 * The Licence & Compliance register — US-MD-04.
 *
 * Exported because DashboardService reads the expiry sweep through it. That
 * is the whole reason this is a module rather than a controller folder: the
 * alert and the register have to agree on what "expiring" means, and they do
 * so by sharing one service instead of each computing it.
 *
 * PrismaModule and TenantModule are global, so nothing is imported here.
 */
@Module({
  controllers: [LicencesController],
  providers: [LicencesService],
  exports: [LicencesService],
})
export class LicencesModule {}
