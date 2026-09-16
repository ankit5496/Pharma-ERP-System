import { Module } from '@nestjs/common';

import { NumberingService } from '../procurement/numbering.service';

import { AllocationController } from './allocation/allocation.controller';
import { AllocationService } from './allocation/allocation.service';
import { CustomersController } from './customers/customers.controller';
import { CustomersService } from './customers/customers.service';
import { DispatchController } from './dispatch/dispatch.controller';
import { DispatchService } from './dispatch/dispatch.service';
import { ReceiptsController } from './receipts/receipts.controller';
import { ReceiptsService } from './receipts/receipts.service';
import { SalesInvoicesController } from './sales-invoices/sales-invoices.controller';
import { SalesInvoicesService } from './sales-invoices/sales-invoices.service';
import { SalesOrdersController } from './sales-orders/sales-orders.controller';
import { SalesOrdersService } from './sales-orders/sales-orders.service';
import { SalesReturnsController } from './sales-returns/sales-returns.controller';
import { SalesReturnsService } from './sales-returns/sales-returns.service';

/**
 * Order-to-Cash — selling finished product and collecting payment.
 *
 * All seven steps: customers, sales orders, allocation, despatch, invoicing,
 * receipts and returns. They form one chain, and each link refuses to skip the
 * one before it — an order cannot be allocated until it has passed the licence
 * and credit gates, stock cannot be despatched until a scheduled line has had
 * its compliance re-check, an invoice cannot be raised until the despatch is
 * confirmed, and a return cannot be credited until the goods are recorded back.
 *
 * NumberingService is provided here rather than imported from ProcurementModule
 * so the two modules do not depend on each other. It is stateless and takes the
 * transaction client on every call, so a second instance allocates from the
 * same `document_sequences` rows under the same row lock.
 *
 * PrismaModule and TenantModule are global, so nothing is imported here.
 */
@Module({
  controllers: [
    CustomersController,
    SalesOrdersController,
    AllocationController,
    DispatchController,
    SalesInvoicesController,
    ReceiptsController,
    SalesReturnsController,
  ],
  providers: [
    CustomersService,
    SalesOrdersService,
    AllocationService,
    DispatchService,
    SalesInvoicesService,
    ReceiptsService,
    SalesReturnsService,
    NumberingService,
  ],
  exports: [CustomersService, SalesOrdersService],
})
export class OrderToCashModule {}
