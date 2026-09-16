import { Module } from '@nestjs/common';

import { MastersController } from './masters.controller';
import { MastersService } from './masters.service';

/**
 * Read-only master data, in the vocabulary the Order-to-Cash contract uses.
 *
 * Deliberately thin: it owns no tables. The item register belongs to
 * Procure-to-Pay and is maintained on the master-data screens; this module
 * projects it, adds saleable-stock figures, and writes nothing.
 *
 * PrismaModule and TenantModule are global, so nothing is imported here.
 */
@Module({
  controllers: [MastersController],
  providers: [MastersService],
  exports: [MastersService],
})
export class MastersModule {}
