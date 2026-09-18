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

import type { SalesInvoiceDetail, SalesInvoiceListItem } from '@pharma-erp/types';

import { Roles } from '../../auth/auth.decorators';
import { SkipAudit } from '../../common/audit/audit.decorators';

import { CreateSalesInvoiceDto, UpdateSalesInvoiceDto } from './dto/sales-invoice.dto';
import { SalesInvoicesService } from './sales-invoices.service';

/**
 * Tax invoices.
 *
 * ACCOUNTANT can raise and cancel: invoicing is the finance desk's work, and
 * the sales desk should not be able to alter what a customer is billed.
 */
@Controller('order-to-cash/sales-invoices')
export class SalesInvoicesController {
  constructor(private readonly invoices: SalesInvoicesService) {}

  /** `paymentStatus` filters the receivables view: UNPAID, PARTIALLY_PAID, PAID. */
  @Get()
  @SkipAudit('Read-only.')
  async list(
    @Query('paymentStatus') paymentStatus?: string,
    @Query('search') search?: string,
  ): Promise<SalesInvoiceListItem[]> {
    return this.invoices.list(paymentStatus, search);
  }

  @Get(':id')
  @SkipAudit('Read-only.')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<SalesInvoiceDetail> {
    return this.invoices.get(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'ACCOUNTANT', 'SALES_MANAGER')
  async create(@Body() dto: CreateSalesInvoiceDto): Promise<SalesInvoiceDetail> {
    return this.invoices.createFromDispatch(dto);
  }

  /**
   * Amends the commercial terms only — due date and note.
   *
   * Nothing on the filed tax document is editable; see the service for why.
   */
  @Patch(':id')
  @Roles('ADMIN', 'ACCOUNTANT')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalesInvoiceDto,
  ): Promise<SalesInvoiceDetail> {
    return this.invoices.update(id, dto);
  }

  @Post(':id/cancel')
  @Roles('ADMIN', 'ACCOUNTANT')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason?: string,
  ): Promise<SalesInvoiceDetail> {
    return this.invoices.cancel(id, reason);
  }
}
