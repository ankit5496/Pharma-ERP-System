import { Module } from '@nestjs/common';

import { GoodsReceiptsService } from './goods-receipts.service';
import { InvoicesService } from './invoices.service';
import { MastersService } from './masters.service';
import { NumberingService } from './numbering.service';
import { PaymentsService } from './payments.service';
import { PeopleService } from './people.service';
import { ProcurementController } from './procurement.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { QcService } from './qc.service';
import { ReorderService } from './reorder.service';
import { RequisitionsService } from './requisitions.service';
import { StockService } from './stock.service';
import { SummaryService } from './summary.service';

/**
 * Procure-to-Pay.
 *
 * One service per step of the workflow rather than one large ProcurementService:
 * each step has its own state machine and its own rules, and the QC service in
 * particular is worth being able to read on its own — it is the only thing that
 * can turn quarantined material into usable stock.
 *
 * PrismaModule, AuditModule and TenantModule are @Global, so nothing is
 * imported here; the same arrangement UsersModule uses.
 */
@Module({
  controllers: [ProcurementController],
  providers: [
    NumberingService,
    PeopleService,
    StockService,
    ReorderService,
    MastersService,
    RequisitionsService,
    PurchaseOrdersService,
    GoodsReceiptsService,
    QcService,
    InvoicesService,
    PaymentsService,
    SummaryService,
  ],
  // StockService is exported because Production will need the same FEFO view
  // when it is built; nothing else here has a consumer outside the module yet.
  exports: [StockService],
})
export class ProcurementModule {}
