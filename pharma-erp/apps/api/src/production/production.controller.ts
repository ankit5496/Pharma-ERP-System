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
  BatchView,
  BomView,
  FinishedGoodsLotView,
  ItemSummary,
  MaterialIssuePlan,
  MaterialIssueView,
  ProductionStockLot,
  ProductionOrderSummary,
  WorkOrderFeasibility,
} from '@pharma-erp/types';

import { Roles } from '../auth/auth.decorators';
import { Auditable, SkipAudit } from '../common/audit/audit.decorators';

import { BatchService } from './batch.service';
import {
  CreateBomDto,
  CreateItemDto,
  CreateProductionOrderDto,
  IssueMaterialDto,
  RecordBatchDto,
  RecordPackingDto,
  ReleaseDecisionDto,
  UpdateBomDto,
  UpdateItemDto,
} from './dto/production.dto';
import { MaterialIssueService } from './material-issue.service';
import { ProductionService } from './production.service';

/**
 * Production & Quality Gate.
 *
 * Reads are open to every authenticated member of the tenant — a Sales Manager
 * checking whether a batch has been released is a legitimate question, and
 * hiding it would only push people to ask over the phone. Writes name their
 * roles, and the division follows who signs for the work in a real plant:
 *
 *   PRODUCTION_OFFICER  plans the order, records manufacture and packing
 *   STORE_OFFICER       dispenses material from stores
 *   QUALITY_OFFICER     and nobody else decides release
 *
 * ADMIN is included on each so a small company can operate with one account,
 * but note what is NOT here: ADMIN is absent from the release decision. The
 * quality gate is the one action that should require the person who is
 * accountable for it, and letting an administrator sign it off would make the
 * separation cosmetic.
 *
 * MANAGEMENT is refused on every mutating verb by RolesGuard regardless.
 */
@Auditable('Production')
@Controller('production')
export class ProductionController {
  constructor(
    private readonly production: ProductionService,
    private readonly materialIssue: MaterialIssueService,
    private readonly batches: BatchService,
  ) {}

  // -------------------------------------------------------------------------
  // Master data
  // -------------------------------------------------------------------------

  @Get('items')
  @SkipAudit('Read-only master data.')
  async listItems(@Query('type') type?: string): Promise<ItemSummary[]> {
    return this.production.listItems(type);
  }

  /**
   * Audited, unlike the read above: an item's code, schedule and GST rate
   * appear on every document that cites it, so who added it and when is part
   * of the record.
   */
  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'PRODUCTION_OFFICER', 'QUALITY_OFFICER')
  async createItem(@Body() dto: CreateItemDto): Promise<ItemSummary> {
    return this.production.createItem(dto);
  }

  @Patch('items/:id')
  @Roles('ADMIN', 'PRODUCTION_OFFICER', 'QUALITY_OFFICER')
  async updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemDto,
  ): Promise<ItemSummary> {
    return this.production.updateItem(id, dto);
  }

  /**
   * Retires an item. Admin only — every other screen in the company reads
   * this register, so withdrawing an entry from it is not a shop-floor act.
   *
   * A soft delete; see the service for why the database gives it no choice.
   */
  @Delete('items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('ADMIN')
  async deleteItem(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.production.deleteItem(id);
  }

  @Get('stock-lots')
  @SkipAudit('Read-only stock listing.')
  async listStockLots(): Promise<ProductionStockLot[]> {
    return this.production.listStockLots();
  }

  // -------------------------------------------------------------------------
  // 1. Formulations
  // -------------------------------------------------------------------------

  @Get('boms')
  @SkipAudit('Read-only listing.')
  async listBoms(): Promise<BomView[]> {
    return this.production.listBoms();
  }

  @Post('boms')
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'PRODUCTION_OFFICER', 'QUALITY_OFFICER')
  async createBom(@Body() dto: CreateBomDto): Promise<BomView> {
    return this.production.createBom(dto);
  }

  // -------------------------------------------------------------------------
  // 2. Production orders
  // -------------------------------------------------------------------------

  @Patch('boms/:id')
  @Roles('ADMIN', 'PRODUCTION_OFFICER', 'QUALITY_OFFICER')
  async updateBom(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBomDto,
  ): Promise<BomView> {
    return this.production.updateBom(id, dto);
  }

  @Get('orders')
  @SkipAudit('Read-only listing.')
  async listOrders(): Promise<ProductionOrderSummary[]> {
    return this.production.listProductionOrders();
  }

  /**
   * What a batch of this size would consume, and whether it can be raised —
   * US-PROD-01.
   *
   * A GET, because it writes nothing: the form asks it on every change to the
   * quantity, and asking twice must cost nothing and change nothing.
   */
  /**
   * The number the next work order would take — US-PROD-01's "Work Order No.
   * (auto-generated)", so the form can show it before anything is saved.
   *
   * A prediction rather than a reservation: nothing is held, and a work order
   * saved between this call and the create takes the number instead. Declared
   * before `orders/:id` so the literal segment wins over the UUID parameter.
   */
  @Get('orders/next-number')
  @SkipAudit('Reads a number; reserves nothing.')
  async nextOrderNumber(): Promise<{ orderNumber: string }> {
    return this.production.previewOrderNumber();
  }

  @Get('orders/feasibility')
  @SkipAudit('Computes nothing persistent.')
  async feasibility(
    @Query('productId', new ParseUUIDPipe()) productId: string,
    @Query('batchQuantity') batchQuantity?: string,
  ): Promise<WorkOrderFeasibility> {
    return this.production.workOrderFeasibility(productId, batchQuantity ?? '0');
  }

  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'PRODUCTION_OFFICER')
  async createOrder(@Body() dto: CreateProductionOrderDto): Promise<ProductionOrderSummary> {
    return this.production.createProductionOrder(dto);
  }

  // -------------------------------------------------------------------------
  // 3. Material issue
  // -------------------------------------------------------------------------

  /** What issuing would consume. Writes nothing. */
  /**
   * Every dispensing record. Declared BEFORE `orders/:id/issues` so the literal
   * segment is matched first — `issues` would otherwise be read as an order id
   * and fail the UUID pipe.
   */
  @Get('issues')
  @SkipAudit('Read-only listing.')
  async listAllIssues(): Promise<MaterialIssueView[]> {
    return this.materialIssue.list();
  }

  /**
   * The number the next dispensing record would take — US-PROD-02, so the form
   * can show it before saving. A prediction; nothing is reserved.
   */
  @Get('issues/next-number')
  @SkipAudit('Reads a number; reserves nothing.')
  async nextIssueNumber(): Promise<{ issueNumber: string }> {
    return this.materialIssue.previewIssueNumber();
  }

  @Get('orders/:id/issue-plan')
  @SkipAudit('A preview; it changes no state.')
  async issuePlan(@Param('id', new ParseUUIDPipe()) id: string): Promise<MaterialIssuePlan> {
    return this.materialIssue.plan(id);
  }

  @Get('orders/:id/issues')
  @SkipAudit('Read-only listing.')
  async listIssues(@Param('id', new ParseUUIDPipe()) id: string): Promise<MaterialIssueView[]> {
    return this.materialIssue.listForOrder(id);
  }

  @Post('orders/:id/issue')
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'STORE_OFFICER', 'PRODUCTION_OFFICER')
  async issue(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: IssueMaterialDto,
  ): Promise<MaterialIssueView> {
    return this.materialIssue.issue(id, dto.overrides ?? []);
  }

  // -------------------------------------------------------------------------
  // 4. Batch record
  // -------------------------------------------------------------------------

  @Get('batches')
  @SkipAudit('Read-only listing.')
  async listBatches(): Promise<BatchView[]> {
    return this.batches.list();
  }

  @Get('batches/:id')
  @SkipAudit('Read-only.')
  async findBatch(@Param('id', new ParseUUIDPipe()) id: string): Promise<BatchView> {
    return this.batches.findOne(id);
  }

  @Post('batches')
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'PRODUCTION_OFFICER')
  async recordBatch(@Body() dto: RecordBatchDto): Promise<BatchView> {
    return this.batches.record(dto);
  }

  @Post('batches/:id/packing')
  @Roles('ADMIN', 'PRODUCTION_OFFICER')
  async recordPacking(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RecordPackingDto,
  ): Promise<BatchView> {
    return this.batches.recordPacking(id, dto);
  }

  // -------------------------------------------------------------------------
  // 7. Batch release — the quality gate
  // -------------------------------------------------------------------------

  /**
   * Deliberately NOT open to ADMIN. See the class comment: an administrator
   * signing off a quality decision would make the role separation decorative.
   */
  @Post('batches/:id/release')
  @Roles('QUALITY_OFFICER')
  async decideRelease(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReleaseDecisionDto,
  ): Promise<BatchView> {
    return this.batches.decideRelease(id, dto);
  }

  @Get('finished-goods')
  @SkipAudit('Read-only listing.')
  async listFinishedGoods(): Promise<FinishedGoodsLotView[]> {
    return this.batches.listFinishedGoods();
  }
}
