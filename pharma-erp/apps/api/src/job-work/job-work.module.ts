import { Module } from '@nestjs/common';

import { JobWorkController } from './job-work.controller';
import { JobWorkService } from './job-work.service';

/**
 * Principal & Job-Work agreements — US-MD-05.
 *
 * Exported ahead of a consumer: when the Production module learns to raise a
 * work order under an agreement, it will need to resolve one — and that is the
 * point at which the unenforced half of US-MD-05 gets built. See the migration
 * header for what is owed.
 *
 * PrismaModule and TenantModule are global, so nothing is imported here.
 */
@Module({
  controllers: [JobWorkController],
  providers: [JobWorkService],
  exports: [JobWorkService],
})
export class JobWorkModule {}
