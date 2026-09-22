import { Module } from '@nestjs/common';

import { NumberingService } from '../procurement/numbering.service';

import { JobWorkDispatchService } from './job-work-dispatch.service';
import { JobWorkExecutionController } from './job-work-execution.controller';
import { JobWorkOrdersService } from './job-work-orders.service';
import { JobWorkProductionService } from './job-work-production.service';
import { JobWorkReadinessService } from './job-work-readiness.service';
import { JobWorkReceiptsService } from './job-work-receipts.service';
import { JobWorkRegisterService } from './job-work-register.service';
import { JobWorkWorkflowService } from './job-work-workflow.service';
import { JobWorkController } from './job-work.controller';
import { JobWorkService } from './job-work.service';

/**
 * Job work — the agreement register (US-MD-05) and everything it governs
 * (US-JW-01 … US-JW-06).
 *
 * Services split by operation rather than by table, the way ProductionModule
 * is: orders, the principal's material, dispatch/invoice and the derived
 * register have separate rules, and one service covering all four would be the
 * usual thousand-line file nobody wants to change.
 *
 * NumberingService is provided here rather than imported. It is stateless — its
 * one method takes the caller's transaction client and touches only
 * `document_sequences` — so a second instance allocates from exactly the same
 * row-locked counter as the procurement module's. The alternative was exporting
 * it from ProcurementModule and importing that whole module for one helper.
 *
 * JobWorkOrdersService is exported because ProductionService needs it: raising
 * a work order under a job-work order has to resolve and validate that order,
 * and that is where the unenforced half of US-MD-05 finally gets built.
 *
 * PrismaModule, AuditModule and TenantModule are @Global, so nothing else is
 * imported here.
 */
@Module({
  controllers: [JobWorkController, JobWorkExecutionController],
  providers: [
    NumberingService,
    JobWorkService,
    JobWorkOrdersService,
    JobWorkProductionService,
    JobWorkReadinessService,
    JobWorkReceiptsService,
    JobWorkDispatchService,
    JobWorkRegisterService,
    JobWorkWorkflowService,
  ],
  // JobWorkReadinessService is exported for the same reason as the orders
  // service: ProductionService refuses a work order on its figures, and the
  // Production screen shows the same figures as a table. One answer, two
  // callers — which is the only way the screen and the refusal can agree.
  exports: [
    JobWorkService,
    JobWorkOrdersService,
    JobWorkReadinessService,
    // Incoming QC keeps a challan’s status in step with its lots.
    JobWorkReceiptsService,
  ],
})
export class JobWorkModule {}
