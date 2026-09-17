import { Module } from '@nestjs/common';

import { JobWorkModule } from '../job-work/job-work.module';
import { NumberingService } from '../procurement/numbering.service';
import { PackagingModule } from '../packaging/packaging.module';

import { BatchService } from './batch.service';
import { MaterialIssueService } from './material-issue.service';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';

/**
 * Production & Quality Gate.
 *
 * Three services behind one controller, split by the operation rather than by
 * the table: planning, dispensing and the batch record are separate concerns
 * with separate rules, and a single service covering all of them would be the
 * usual thousand-line file nobody wants to change.
 *
 * PrismaModule and TenantModule are global. PackagingModule is not, and has
 * to be imported: US-MD-06 forbids a work order for a product with no active
 * pack specification, and ProductionService asks PackagingService that
 * question rather than reading packaging tables itself.
 */
@Module({
  // JobWorkModule for the same reason PackagingModule is here: US-JW-03 makes a
  // work order resolvable against a job-work order, and ProductionService asks
  // JobWorkOrdersService that question rather than reading job-work tables.
  imports: [PackagingModule, JobWorkModule],
  controllers: [ProductionController],
  // NumberingService is stateless and takes the caller's transaction client, so
  // a second instance allocates from the same row-locked counter table. See the
  // note in JobWorkModule.
  providers: [NumberingService, ProductionService, MaterialIssueService, BatchService],
  exports: [ProductionService, BatchService],
})
export class ProductionModule {}
