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
  JobWorkDispatchableBatch,
  JobWorkInvoiceView,
  JobWorkMaterialReadiness,
  JobWorkMaterialReceiptView,
  JobWorkOrderMaterial,
  JobWorkOrderablePrincipal,
  JobWorkOrderSummary,
  JobWorkRegisterGroup,
} from '@pharma-erp/types';

import { Roles } from '../auth/auth.decorators';
import { SkipAudit } from '../common/audit/audit.decorators';

import { CreateJobWorkDispatchDto } from './dto/job-work-dispatch.dto';
import { CreateJobWorkOrderDto, UpdateJobWorkOrderDto } from './dto/job-work-order.dto';
import { CreateJobWorkMaterialReceiptDto } from './dto/job-work-receipt.dto';
import { JobWorkDispatchService } from './job-work-dispatch.service';
import { JobWorkOrdersService } from './job-work-orders.service';
import { JobWorkReadinessService } from './job-work-readiness.service';
import { JobWorkReceiptsService } from './job-work-receipts.service';
import { JobWorkRegisterService } from './job-work-register.service';

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
    private readonly receipts: JobWorkReceiptsService,
    private readonly dispatch: JobWorkDispatchService,
    private readonly register: JobWorkRegisterService,
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
