import {
  Body,
  Controller,
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
  GoodsReceiptListItem,
  PayablesReport,
  BomSummary,
  ProductionPlanSummary,
  ReorderCheckResult,
  ItemStockPosition,
  ItemSummary,
  LowStockItem,
  PartySummary,
  PartyType,
  ProcurementSummary,
  PurchaseInvoiceListItem,
  PurchaseOrderListItem,
  QcQueueItem,
  RequisitionListItem,
  StockLedgerRow,
  VendorPayableRow,
} from '@pharma-erp/types';

import { Auditable, SkipAudit } from '../common/audit/audit.decorators';
import { TenantContextService } from '../tenant/tenant-context.service';

import { parsePositive } from './decimal.util';
import { ConsumeStockDto, ProcurementListQueryDto } from './dto/common.dto';
import { CreateGoodsReceiptDto } from './dto/goods-receipt.dto';
import { ChangeInvoiceStatusDto, CreatePurchaseInvoiceDto } from './dto/invoice.dto';
import {
  CreateItemDto,
  CreatePartyDto,
  CreateProductionPlanDto,
} from './dto/masters.dto';
import { RecordPaymentDto } from './dto/payment.dto';
import {
  ChangePurchaseOrderStatusDto,
  ConvertRequisitionDto,
  CreatePurchaseOrderDto,
  UpdatePurchaseOrderDto,
} from './dto/purchase-order.dto';
import { RecordQcDecisionDto } from './dto/qc.dto';
import {
  ChangeRequisitionStatusDto,
  CreateRequisitionDto,
  UpdateRequisitionDto,
} from './dto/requisition.dto';
import { GoodsReceiptsService } from './goods-receipts.service';
import { InvoicesService } from './invoices.service';
import { MastersService } from './masters.service';
import { PaymentsService } from './payments.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { QcService } from './qc.service';
import { ReorderService } from './reorder.service';
import { RequisitionsService } from './requisitions.service';
import { StockService } from './stock.service';
import { SummaryService } from './summary.service';

/**
 * Procure-to-Pay.
 *
 * NO `@Roles(...)` ANYWHERE IN THIS CONTROLLER, deliberately and temporarily.
 * The brief for this stage is that every role can use the workflow, so the
 * class inherits the global default: authenticated members of the tenant may
 * call it. Two protections are unaffected and still apply to every route here:
 *
 *   - RolesGuard refuses MANAGEMENT on any mutating verb, platform-wide.
 *   - Row-level security scopes every query to the caller's own company, so
 *     no route here can read or write another tenant's records regardless of
 *     what id is passed in.
 *
 * When per-role permissions arrive, they belong on the individual routes —
 * `@Roles('PURCHASE_MANAGER')` on requisition writes, `@Roles('STORE_OFFICER')`
 * on receipts, `@Roles('QUALITY_OFFICER')` on the QC decision — and nothing
 * else in the module needs to change.
 *
 * `@Auditable` is set per resource rather than on the class, because the audit
 * interceptor records the entity type it is given and one label for the whole
 * module would make the trail useless.
 */
@Controller('procurement')
export class ProcurementController {
  constructor(
    private readonly summary: SummaryService,
    private readonly stock: StockService,
    private readonly masters: MastersService,
    private readonly requisitions: RequisitionsService,
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly goodsReceipts: GoodsReceiptsService,
    private readonly qc: QcService,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly reorder: ReorderService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // -------------------------------------------------------------------------
  // Summary and stock
  // -------------------------------------------------------------------------

  @Get('summary')
  @SkipAudit('Read-only aggregate.')
  async getSummary(): Promise<ProcurementSummary> {
    return this.summary.build();
  }

  @Get('low-stock')
  @SkipAudit('Read-only.')
  async lowStock(): Promise<LowStockItem[]> {
    return this.stock.lowStockItems();
  }

  @Get('stock')
  @SkipAudit('Read-only.')
  async stockPositions(): Promise<ItemStockPosition[]> {
    return this.stock.stockPositions();
  }

  @Get('stock/ledger')
  @SkipAudit('Read-only.')
  async ledger(@Query('itemId') itemId?: string): Promise<StockLedgerRow[]> {
    return this.stock.ledger(itemId);
  }

  // -------------------------------------------------------------------------
  // Master data
  // -------------------------------------------------------------------------

  @Get('items')
  @SkipAudit('Read-only.')
  async listItems(@Query('type') type?: string): Promise<ItemSummary[]> {
    return this.masters.listItems(type);
  }

  @Post('items')
  @Auditable('Item')
  @HttpCode(HttpStatus.CREATED)
  async createItem(@Body() dto: CreateItemDto): Promise<ItemSummary> {
    return this.masters.createItem(dto);
  }

  @Get('parties')
  @SkipAudit('Read-only.')
  async listParties(@Query('partyType') partyType?: PartyType): Promise<PartySummary[]> {
    return this.masters.listParties(partyType);
  }

  @Post('parties')
  @Auditable('Party')
  @HttpCode(HttpStatus.CREATED)
  async createParty(@Body() dto: CreatePartyDto): Promise<PartySummary> {
    return this.masters.createParty(dto);
  }

  @Get('boms')
  @SkipAudit('Read-only.')
  async listBoms(): Promise<BomSummary[]> {
    return this.masters.listBoms();
  }

  @Get('production-plans')
  @SkipAudit('Read-only.')
  async listProductionPlans(): Promise<ProductionPlanSummary[]> {
    return this.masters.listProductionPlans();
  }

  @Post('production-plans')
  @Auditable('ProductionPlan')
  @HttpCode(HttpStatus.CREATED)
  async createProductionPlan(
    @Body() dto: CreateProductionPlanDto,
  ): Promise<ProductionPlanSummary> {
    return this.masters.createProductionPlan(dto);
  }

  /**
   * Consumes usable stock, FEFO.
   *
   * A real inventory operation — an issue, a breakage, a count correction —
   * and the thing that makes the reorder trigger observable before Production
   * exists. Runs the reorder check straight afterwards, in the same request,
   * so a movement that crosses the level raises its requisition immediately
   * rather than waiting for someone to open a screen.
   */
  @Post('stock/consume')
  @Auditable('StockLot')
  @HttpCode(HttpStatus.CREATED)
  async consumeStock(@Body() dto: ConsumeStockDto): Promise<ReorderCheckResult> {
    await this.stock.consumeStock(
      dto.itemId,
      parsePositive(dto.quantity, 'Quantity'),
      dto.reason,
      this.tenantContext.getUserId(),
    );

    return this.runReorderCheck();
  }

  /** Runs the reorder check on demand. Idempotent. */
  @Post('reorder-check')
  @SkipAudit('The requisitions it raises are audited individually.')
  @HttpCode(HttpStatus.CREATED)
  async runReorderCheck(): Promise<ReorderCheckResult> {
    const outcome = await this.reorder.run();

    const created = await Promise.all(
      outcome.createdIds.map((id) => this.requisitions.findOne(id)),
    );

    return { created, skipped: outcome.skipped, checkedAt: new Date().toISOString() };
  }

  // -------------------------------------------------------------------------
  // 1. Requisitions
  // -------------------------------------------------------------------------

  @Get('requisitions')
  @SkipAudit('Read-only listing.')
  async listRequisitions(@Query() query: ProcurementListQueryDto): Promise<RequisitionListItem[]> {
    return this.requisitions.list(query);
  }

  @Get('requisitions/:id')
  @SkipAudit('Read-only.')
  async getRequisition(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<RequisitionListItem> {
    return this.requisitions.findOne(id);
  }

  @Post('requisitions')
  @Auditable('PurchaseRequisition')
  @HttpCode(HttpStatus.CREATED)
  async createRequisition(@Body() dto: CreateRequisitionDto): Promise<RequisitionListItem> {
    return this.requisitions.create(dto);
  }

  @Patch('requisitions/:id')
  @Auditable('PurchaseRequisition')
  async updateRequisition(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateRequisitionDto,
  ): Promise<RequisitionListItem> {
    return this.requisitions.update(id, dto);
  }

  @Post('requisitions/:id/status')
  @Auditable('PurchaseRequisition')
  async changeRequisitionStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ChangeRequisitionStatusDto,
  ): Promise<RequisitionListItem> {
    return this.requisitions.changeStatus(id, dto.status);
  }

  /** Approved requisition -> purchase order, keeping the link between them. */
  @Post('requisitions/:id/convert')
  @Auditable('PurchaseOrder')
  @HttpCode(HttpStatus.CREATED)
  async convertRequisition(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConvertRequisitionDto,
  ): Promise<PurchaseOrderListItem> {
    return this.purchaseOrders.convertRequisition(id, dto);
  }

  // -------------------------------------------------------------------------
  // 2. Purchase orders
  // -------------------------------------------------------------------------

  @Get('purchase-orders')
  @SkipAudit('Read-only listing.')
  async listPurchaseOrders(
    @Query() query: ProcurementListQueryDto,
  ): Promise<PurchaseOrderListItem[]> {
    return this.purchaseOrders.list(query);
  }

  /** Orders open for receiving, for the GRN form. */
  @Get('purchase-orders/receivable')
  @SkipAudit('Read-only.')
  async receivableOrders(): Promise<PurchaseOrderListItem[]> {
    return this.purchaseOrders.receivable();
  }

  /** Orders with something received, for the invoice form. */
  @Get('purchase-orders/invoiceable')
  @SkipAudit('Read-only.')
  async invoiceableOrders(): Promise<PurchaseOrderListItem[]> {
    return this.purchaseOrders.invoiceable();
  }

  @Get('purchase-orders/:id')
  @SkipAudit('Read-only.')
  async getPurchaseOrder(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PurchaseOrderListItem> {
    return this.purchaseOrders.findOne(id);
  }

  @Post('purchase-orders')
  @Auditable('PurchaseOrder')
  @HttpCode(HttpStatus.CREATED)
  async createPurchaseOrder(@Body() dto: CreatePurchaseOrderDto): Promise<PurchaseOrderListItem> {
    return this.purchaseOrders.create(dto);
  }

  @Patch('purchase-orders/:id')
  @Auditable('PurchaseOrder')
  async updatePurchaseOrder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePurchaseOrderDto,
  ): Promise<PurchaseOrderListItem> {
    return this.purchaseOrders.update(id, dto);
  }

  @Post('purchase-orders/:id/status')
  @Auditable('PurchaseOrder')
  async changePurchaseOrderStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ChangePurchaseOrderStatusDto,
  ): Promise<PurchaseOrderListItem> {
    return this.purchaseOrders.changeStatus(id, dto.status);
  }

  // -------------------------------------------------------------------------
  // 3. Goods receipts
  // -------------------------------------------------------------------------

  @Get('goods-receipts')
  @SkipAudit('Read-only listing.')
  async listGoodsReceipts(
    @Query() query: ProcurementListQueryDto,
  ): Promise<GoodsReceiptListItem[]> {
    return this.goodsReceipts.list(query);
  }

  @Get('goods-receipts/:id')
  @SkipAudit('Read-only.')
  async getGoodsReceipt(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GoodsReceiptListItem> {
    return this.goodsReceipts.findOne(id);
  }

  @Post('goods-receipts')
  @Auditable('GoodsReceipt')
  @HttpCode(HttpStatus.CREATED)
  async createGoodsReceipt(@Body() dto: CreateGoodsReceiptDto): Promise<GoodsReceiptListItem> {
    return this.goodsReceipts.create(dto);
  }

  // -------------------------------------------------------------------------
  // 4. Incoming QC
  // -------------------------------------------------------------------------

  @Get('qc/lots')
  @SkipAudit('Read-only listing.')
  async qcQueue(@Query() query: ProcurementListQueryDto): Promise<QcQueueItem[]> {
    return this.qc.queue(query);
  }

  @Get('qc/lots/:id')
  @SkipAudit('Read-only.')
  async qcLot(@Param('id', new ParseUUIDPipe()) id: string): Promise<QcQueueItem> {
    return this.qc.findLot(id);
  }

  /** The quality gate. The only route that can make material usable. */
  @Post('qc/lots/:id/decision')
  @Auditable('StockLot')
  @HttpCode(HttpStatus.CREATED)
  async recordQcDecision(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RecordQcDecisionDto,
  ): Promise<QcQueueItem> {
    return this.qc.recordDecision(id, dto);
  }

  // -------------------------------------------------------------------------
  // 5. Purchase invoices
  // -------------------------------------------------------------------------

  @Get('invoices')
  @SkipAudit('Read-only listing.')
  async listInvoices(
    @Query() query: ProcurementListQueryDto,
  ): Promise<PurchaseInvoiceListItem[]> {
    return this.invoices.list(query);
  }

  @Get('invoices/:id')
  @SkipAudit('Read-only.')
  async getInvoice(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PurchaseInvoiceListItem> {
    return this.invoices.findOne(id);
  }

  @Post('invoices')
  @Auditable('PurchaseInvoice')
  @HttpCode(HttpStatus.CREATED)
  async createInvoice(@Body() dto: CreatePurchaseInvoiceDto): Promise<PurchaseInvoiceListItem> {
    return this.invoices.create(dto);
  }

  @Post('invoices/:id/status')
  @Auditable('PurchaseInvoice')
  async changeInvoiceStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ChangeInvoiceStatusDto,
  ): Promise<PurchaseInvoiceListItem> {
    return this.invoices.changeStatus(id, dto.status);
  }

  // -------------------------------------------------------------------------
  // 6. Vendor payables and payments
  // -------------------------------------------------------------------------

  @Get('payables')
  @SkipAudit('Read-only listing.')
  async payables(@Query() query: ProcurementListQueryDto): Promise<VendorPayableRow[]> {
    return this.payments.payables(query);
  }

  /**
   * The outstanding payables report, aged by days past due.
   *
   * Filterable by vendor; the ageing bands are fixed rather than a parameter,
   * because a report whose buckets move is a report two people cannot compare.
   */
  @Get('payables/report')
  @SkipAudit('Read-only report.')
  async payablesReport(@Query('vendorId') vendorId?: string): Promise<PayablesReport> {
    return this.payments.payablesReport(vendorId);
  }

  @Post('payments')
  @Auditable('VendorPayment')
  @HttpCode(HttpStatus.CREATED)
  async recordPayment(@Body() dto: RecordPaymentDto): Promise<VendorPayableRow> {
    return this.payments.record(dto);
  }
}
