import { Module } from '@nestjs/common';

import { PartiesController } from './parties.controller';
import { PartiesService } from './parties.service';

/**
 * The party register — suppliers and customers.
 *
 * Its own module rather than part of Production: a party is bought from and
 * sold to, and neither belongs under manufacturing. Exported because
 * Procure-to-Pay and Order-to-Cash will both need to resolve one.
 *
 * PrismaModule and TenantModule are global, so nothing is imported here.
 */
@Module({
  controllers: [PartiesController],
  providers: [PartiesService],
  exports: [PartiesService],
})
export class PartiesModule {}
