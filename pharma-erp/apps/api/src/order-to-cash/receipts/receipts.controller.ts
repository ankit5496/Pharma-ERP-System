import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';

import type { ReceiptListItem } from '@pharma-erp/types';

import { Roles } from '../../auth/auth.decorators';
import { SkipAudit } from '../../common/audit/audit.decorators';

import { CreateReceiptDto } from './dto/receipt.dto';
import { ReceiptsService } from './receipts.service';

/**
 * Receipts — money in, applied to an invoice.
 *
 * ACCOUNTANT and ADMIN only. Recording a payment moves the receivable ledger,
 * and the sales desk must not be able to mark its own invoices settled.
 */
@Controller('order-to-cash/receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get()
  @SkipAudit('Read-only.')
  async list(@Query('search') search?: string): Promise<ReceiptListItem[]> {
    return this.receipts.list(search);
  }

  @Get(':id')
  @SkipAudit('Read-only.')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<ReceiptListItem> {
    return this.receipts.get(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'ACCOUNTANT')
  async create(@Body() dto: CreateReceiptDto): Promise<ReceiptListItem> {
    return this.receipts.create(dto);
  }

  /** A bounced payment writes a reversing entry; it never deletes the receipt. */
  @Post(':id/bounce')
  @Roles('ADMIN', 'ACCOUNTANT')
  async bounce(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason?: string,
  ): Promise<ReceiptListItem> {
    return this.receipts.bounce(id, reason);
  }
}
