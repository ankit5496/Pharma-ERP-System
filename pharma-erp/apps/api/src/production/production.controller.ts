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
  MaterialLotSummary,
  ProductionOrderSummary,
} from '@pharma-erp/types';

import { Roles } from '../auth/auth.decorators';
import { Auditable, SkipAudit } from '../common/audit/audit.decorators';

import { BatchService } from './batch.service';
import {
  CreateBomDto,
  CreateItemDto,
  CreateProductionOrderDto,
  RecordBatchDto,
  RecordPackingDto,
  ReleaseDecisionDto,
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

  @Get('material-lots')
  @SkipAudit('Read-only stock listing.')
  async listMaterialLots(): Promise<MaterialLotSummary[]> {
    return this.production.listMaterialLots();
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

  @Get('orders')
  @SkipAudit('Read-only listing.')
  async listOrders(): Promise<ProductionOrderSummary[]> {
    return this.production.listProductionOrders();
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
  async issue(@Param('id', new ParseUUIDPipe()) id: string): Promise<MaterialIssueView> {
    return this.materialIssue.issue(id);
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
