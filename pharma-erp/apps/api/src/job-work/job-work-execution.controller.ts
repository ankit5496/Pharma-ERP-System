import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import type {
  JobWorkBatchView,
  JobWorkDispatchableBatch,
  JobWorkEligibleReceipt,
  JobWorkInvoiceView,
  JobWorkIssuableMaterial,
  JobWorkIssuePlan,
  JobWorkMaterialIssueView,
  JobWorkMaterialSufficiency,
  JobWorkMaterialReadiness,
  JobWorkMaterialReceiptView,
  JobWorkOrderMaterial,
  JobWorkProductionOrderView,
  JobWorkOrderablePrincipal,
  JobWorkOrderSummary,
  JobWorkRegisterGroup,
} from '@pharma-erp/types';

import { Roles } from '../auth/auth.decorators';
import { SkipAudit } from '../common/audit/audit.decorators';

import { CreateJobWorkDispatchDto } from './dto/job-work-dispatch.dto';
import { CreateJobWorkOrderDto, UpdateJobWorkOrderDto } from './dto/job-work-order.dto';
import {
  CreateJobWorkProductionOrderDto,
  UpdateJobWorkProductionOrderDto,
} from './dto/job-work-production.dto';
import {
  CreateJobWorkMaterialReceiptDto,
  DecideJobWorkReceiptDto,
} from './dto/job-work-receipt.dto';
import {
  DecideJobWorkBatchDto,
  RecordJobWorkBatchDto,
  RecordJobWorkIssueDto,
  RecordJobWorkPackingDto,
} from './dto/job-work-workflow.dto';
import { JobWorkDispatchService } from './job-work-dispatch.service';
import { JobWorkOrdersService } from './job-work-orders.service';
import { JobWorkProductionService } from './job-work-production.service';
import { JobWorkReadinessService } from './job-work-readiness.service';
import { JobWorkReceiptsService } from './job-work-receipts.service';
import { JobWorkRegisterService } from './job-work-register.service';
import { JobWorkWorkflowService } from './job-work-workflow.service';

/**
 * Job-work execution — US-JW-01, US-JW-02, US-JW-05 and US-JW-06.
 *
 * ROLES FOLLOW SECTION 18 OF THE BRIEF, and no new authorisation machinery is
 * introduced: `@Roles` is the guard the rest of the API already uses.
 *
 *   Sales Manager           creates orders, dispatches and invoices
 *   Store Officer           records the principal's material
 *   Production Officer      manufactures — handled by ProductionController,
 *                           which already gates its own routes
 *   Quality Officer         the quality gate (ProductionController) and the
 *                           register
 *
 * ADMIN is added to every write for the reason it is everywhere else in this
 * codebase: somebody has to be able to unstick a company on a Sunday.
 *
 * READS ARE OPEN to every signed-in role, matching the agreement register
 * above: a production officer about to run a job-work batch needs to see the
 * order and the principal's material, and withholding that would make the
 * screens useless to the people they exist to inform. MANAGEMENT is read-only
 * globally, so it reaches these and none of the writes.
 */
@Controller('job-work')
export class JobWorkExecutionController {
  constructor(
    private readonly orders: JobWorkOrdersService,
    private readonly readinessService: JobWorkReadinessService,
    private readonly production: JobWorkProductionService,
    private readonly receipts: JobWorkReceiptsService,
    private readonly dispatch: JobWorkDispatchService,
    private readonly register: JobWorkRegisterService,
    private readonly workflow: JobWorkWorkflowService,
  ) {}

  // ---------------------------------------------------------------------------
  // US-JW-01 — job-work orders
  // ---------------------------------------------------------------------------

  /**
   * Principals that can be ordered against today, with their products.
   *
   * Declared BEFORE `orders/:id`, or Nest would match "orderable" as an id.
   */
  @Get('orders/orderable')
  @SkipAudit('Read-only lookup for the order form.')
  async orderable(): Promise<JobWorkOrderablePrincipal[]> {
    return this.orders.orderable();
  }

  @Get('orders')
  @SkipAudit('Read-only register.')
  async listOrders(): Promise<JobWorkOrderSummary[]> {
    return this.orders.list();
  }

  @Get('orders/:id')
  @SkipAudit('Read-only register.')
  async findOrder(@Param('id', ParseUUIDPipe) id: string): Promise<JobWorkOrderSummary> {
    return this.orders.findOne(id);
  }

  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'SALES_MANAGER')
  async createOrder(@Body() dto: CreateJobWorkOrderDto): Promise<JobWorkOrderSummary> {
    return this.orders.create(dto);
  }

  @Patch('orders/:id')
  @Roles('ADMIN', 'SALES_MANAGER')
  async updateOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobWorkOrderDto,
  ): Promise<JobWorkOrderSummary> {
    return this.orders.update(id, dto);
  }

  /** Withdraws an order nothing has happened against. Admin and Sales Manager. */
  @Delete('orders/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('ADMIN', 'SALES_MANAGER')
  async removeOrder(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.orders.remove(id);
  }

  // ---------------------------------------------------------------------------
  // US-JW-02 — the principal's material
  // ---------------------------------------------------------------------------

  /**
   * The materials the order's formulation calls for.
   *
   * Declared before the collection routes below so the receipt form can ask
   * "what am I expecting against this order" without loading every BOM in
   * the company and picking one on the client.
   */
  /**
   * Can this order be manufactured, and if not, why not.
   *
   * THE SAME CALL THE REFUSAL MAKES. The Production screen renders this as a
   * table so somebody can see the shortage before pressing the button, and
   * ProductionService re-asks it when the button is pressed — a screen that
   * says "Ready" over a service that then refuses would be worse than no
   * screen at all.
   *
   * `batchSize` is optional: without it the order's own quantity is used,
   * which is what the screen shows before anyone edits the figure.
   */
  @Get('orders/:id/readiness')
  @SkipAudit('Read-only check.')
  async readiness(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('batchSize') batchSize?: string,
  ): Promise<JobWorkMaterialReadiness> {
    return this.readinessService.forOrder(id, batchSize);
  }

  @Get('orders/:id/materials')
  @SkipAudit('Read-only lookup for the receipt form.')
  async orderMaterials(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<JobWorkOrderMaterial[]> {
    return this.receipts.materialsFor(id);
  }

  @Get('material-receipts')
  @SkipAudit('Read-only register.')
  async listReceipts(
    @Query('jobWorkOrderId') jobWorkOrderId?: string,
  ): Promise<JobWorkMaterialReceiptView[]> {
    return this.receipts.list(jobWorkOrderId);
  }

  /** The store takes material in, so STORE_OFFICER — section 18. */
  @Post('material-receipts')
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'STORE_OFFICER')
  async createReceipt(
    @Body() dto: CreateJobWorkMaterialReceiptDto,
  ): Promise<JobWorkMaterialReceiptView> {
    return this.receipts.create(dto);
  }

  /**
   * Says the delivery is completely recorded, and asks for approval.
   *
   * THE STORE'S ACTION, not the quality user's — which is why it carries the
   * store officer's role and not the quality one. It submits; it does not
   * approve.
   */
  @Post('material-receipts/:id/submit')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN', 'STORE_OFFICER')
  async submitReceipt(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<JobWorkMaterialReceiptView> {
    return this.receipts.submit(id);
  }

  /**
   * The quality decision on a consignment.
   *
   * QUALITY_OFFICER, with ADMIN — the same pair that decides a batch release,
   * and deliberately NOT the store officer who booked the material in. One
   * person doing both is the thing this stage exists to prevent.
   */
  @Post('material-receipts/:id/decision')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN', 'QUALITY_OFFICER')
  async decideReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideJobWorkReceiptDto,
  ): Promise<JobWorkMaterialReceiptView> {
    return this.receipts.decide(id, dto);
  }

  // ---------------------------------------------------------------------------
  // Job-work production orders — the module's own manufacturing record
  //
  // Deliberately NOT the ProductionController's routes: the two workflows are
  // separate, and Production & Quality Gate is untouched by any of this.
  // ---------------------------------------------------------------------------

  /** What the next JWPO number would be. Reserves nothing — see peek(). */
  @Get('production-orders/next-number')
  @SkipAudit('Reads a number; reserves nothing.')
  async nextProductionNumber(): Promise<{ orderNumber: string }> {
    return this.production.previewOrderNumber();
  }

  @Get('production-orders')
  @SkipAudit('Read-only register.')
  async listProduction(
    @Query('jobWorkOrderId') jobWorkOrderId?: string,
  ): Promise<JobWorkProductionOrderView[]> {
    return this.production.list(jobWorkOrderId);
  }

  @Get('production-orders/:id')
  @SkipAudit('Read-only register.')
  async findProduction(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<JobWorkProductionOrderView> {
    return this.production.findOne(id);
  }

  /**
   * Has the principal sent enough to make the batch?
   *
   * The same answer `create` refuses on, so the form can show a shortage
   * before somebody presses the button rather than after.
   */
  @Get('orders/:id/material-sufficiency')
  @SkipAudit('Computes nothing persistent.')
  async materialSufficiency(
    @Param('id', ParseUUIDPipe) id: string,
    // OPTIONAL: an own-procurement order has no consignment to measure, and
    // the service refuses one that names it anyway.
    @Query('materialReceiptId', new ParseUUIDPipe({ optional: true }))
    materialReceiptId?: string,
  ): Promise<JobWorkMaterialSufficiency> {
    return this.production.materialSufficiency(id, materialReceiptId);
  }

  /**
   * Every approved consignment, keyed by job-work order.
   *
   * Declared before 'orders/:id/...' so Nest does not read the literal segment
   * as an identifier.
   */
  @Get('eligible-receipts')
  @SkipAudit('Read-only lookup for the production-order form.')
  async eligibleReceiptsByOrder(): Promise<Record<string, JobWorkEligibleReceipt[]>> {
    return this.production.eligibleReceiptsByOrder();
  }

  /** The approved consignments an order could be manufactured from. */
  @Get('orders/:id/eligible-receipts')
  @SkipAudit('Read-only lookup for the production-order form.')
  async eligibleReceipts(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<JobWorkMaterialReceiptView[]> {
    return this.production.eligibleReceipts(id);
  }

  /** Production plans the batch, so PRODUCTION_OFFICER — section 18. */
  @Post('production-orders')
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'PRODUCTION_OFFICER')
  async createProduction(
    @Body() dto: CreateJobWorkProductionOrderDto,
  ): Promise<JobWorkProductionOrderView> {
    return this.production.create(dto);
  }

  @Patch('production-orders/:id')
  @Roles('ADMIN', 'PRODUCTION_OFFICER')
  async updateProduction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobWorkProductionOrderDto,
  ): Promise<JobWorkProductionOrderView> {
    return this.production.update(id, dto);
  }

  // ---------------------------------------------------------------------------
  // Material issue — drawing the principal's material into a batch
  // ---------------------------------------------------------------------------

  @Get('material-issues/next-number')
  @SkipAudit('Reads a number; reserves nothing.')
  async nextIssueNumber(): Promise<{ issueNumber: string }> {
    return this.workflow.previewIssueNumber();
  }

  @Get('material-issues')
  @SkipAudit('Read-only register.')
  async listIssues(
    @Query('productionOrderId') productionOrderId?: string,
  ): Promise<JobWorkMaterialIssueView[]> {
    return this.workflow.listIssues(productionOrderId);
  }

  @Get('material-issues/:id')
  @SkipAudit('Read-only register.')
  async findIssue(@Param('id', ParseUUIDPipe) id: string): Promise<JobWorkMaterialIssueView> {
    return this.workflow.findIssue(id);
  }

  /**
   * What is left to draw on, drum by drum.
   *
   * THE RECEIPT'S OWN LINES with what has already gone out taken off — not a
   * copy of them. This is how Pure Conversion material reaches the issue form.
   */
  @Get('production-orders/:id/issuable-material')
  @SkipAudit('Read-only lookup for the issue form.')
  async issuableMaterial(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<JobWorkIssuableMaterial[]> {
    return this.workflow.issuableMaterial(id);
  }

  /**
   * What issuing this order would consume, and out of which drums.
   *
   * The same shape the internal issue form works from, over the principal's
   * own consignment — so a shortage is visible before anyone dispenses.
   */
  @Get('production-orders/:id/issue-plan')
  @SkipAudit('Computes nothing persistent.')
  async issuePlan(@Param('id', ParseUUIDPipe) id: string): Promise<JobWorkIssuePlan> {
    return this.workflow.issuePlan(id);
  }

  /** The store hands material to production, so STORE_OFFICER — section 18. */
  @Post('material-issues')
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'STORE_OFFICER', 'PRODUCTION_OFFICER')
  async recordIssue(@Body() dto: RecordJobWorkIssueDto): Promise<JobWorkMaterialIssueView> {
    return this.workflow.recordIssue(dto);
  }

  // ---------------------------------------------------------------------------
  // Batch record, and the release decision on it
  // ---------------------------------------------------------------------------

  @Get('batches/next-number')
  @SkipAudit('Reads a number; reserves nothing.')
  async nextBatchNumber(): Promise<{ batchNumber: string }> {
    return this.workflow.previewBatchNumber();
  }

  @Get('batches')
  @SkipAudit('Read-only register.')
  async listBatches(
    @Query('productionOrderId') productionOrderId?: string,
  ): Promise<JobWorkBatchView[]> {
    return this.workflow.listBatches(productionOrderId);
  }

  @Get('batches/:id')
  @SkipAudit('Read-only register.')
  async findBatch(@Param('id', ParseUUIDPipe) id: string): Promise<JobWorkBatchView> {
    return this.workflow.findBatch(id);
  }

  @Post('batches')
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'PRODUCTION_OFFICER')
  async recordBatch(@Body() dto: RecordJobWorkBatchDto): Promise<JobWorkBatchView> {
    return this.workflow.recordBatch(dto);
  }

  /** The packing figures, added to a batch already recorded. */
  @Patch('batches/:id')
  @Roles('ADMIN', 'PRODUCTION_OFFICER')
  async recordPacking(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordJobWorkPackingDto,
  ): Promise<JobWorkBatchView> {
    return this.workflow.recordPacking(id, dto);
  }

  /**
   * The quality gate on what was made.
   *
   * QUALITY_OFFICER and ADMIN, matching the incoming decision above and the
   * internal batch release — and deliberately not the production officer who
   * recorded the batch.
   */
  @Post('batches/:id/release')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN', 'QUALITY_OFFICER')
  async decideBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideJobWorkBatchDto,
  ): Promise<JobWorkBatchView> {
    return this.workflow.decideBatch(id, dto);
  }

  // ---------------------------------------------------------------------------
  // US-JW-05 — dispatch and invoice
  // ---------------------------------------------------------------------------

  /** Released batches with stock left, for this order. */
  @Get('orders/:id/dispatchable')
  @SkipAudit('Read-only lookup for the dispatch form.')
  async dispatchable(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<JobWorkDispatchableBatch[]> {
    return this.dispatch.dispatchable(id);
  }

  @Get('invoices')
  @SkipAudit('Read-only register.')
  async listInvoices(
    @Query('jobWorkOrderId') jobWorkOrderId?: string,
  ): Promise<JobWorkInvoiceView[]> {
    return this.dispatch.list(jobWorkOrderId);
  }

  @Post('dispatches')
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'SALES_MANAGER')
  async createDispatch(@Body() dto: CreateJobWorkDispatchDto): Promise<JobWorkInvoiceView> {
    return this.dispatch.create(dto);
  }

  // ---------------------------------------------------------------------------
  // US-JW-06 — the derived register
  // ---------------------------------------------------------------------------

  /**
   * NOTE WHAT IS NOT HERE: no POST, PATCH or DELETE.
   *
   * US-JW-06 rules 1 and 2 — read-only, no manual editing — are enforced by the
   * absence of a write route rather than by a role check that a future change
   * could relax. There is no register table to write to either.
   */
  @Get('register')
  @SkipAudit('Read-only derived view.')
  async jobWorkRegister(
    @Query('principalId') principalId?: string,
  ): Promise<JobWorkRegisterGroup[]> {
    return this.register.register(principalId);
  }
}
