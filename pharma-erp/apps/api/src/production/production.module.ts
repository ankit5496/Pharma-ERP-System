import { Module } from '@nestjs/common';

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
 * PrismaModule and TenantModule are global, so nothing is imported here.
 */
@Module({
  controllers: [ProductionController],
  providers: [ProductionService, MaterialIssueService, BatchService],
  exports: [ProductionService, BatchService],
})
export class ProductionModule {}
