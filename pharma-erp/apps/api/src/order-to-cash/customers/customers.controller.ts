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

import type { CustomerDetail, CustomerListItem } from '@pharma-erp/types';

import { Roles } from '../../auth/auth.decorators';
import { SkipAudit } from '../../common/audit/audit.decorators';

import { CustomersService } from './customers.service';
import {
  CreateCustomerDto,
  CreateCustomerLicenceDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

/**
 * The Order-to-Cash customer register.
 *
 * Reads are open to every signed-in role: a despatch clerk picking an order
 * needs the shipping address, and hiding the register would not make that
 * safer. Writes are the sales desk's, and retiring is narrower still, because
 * withdrawing a customer stops orders other people are relying on.
 *
 * Note what this controller does NOT do: it enforces no business rule itself.
 * Uniqueness is a database constraint, tenant isolation is row-level security,
 * and role checks are RolesGuard. This layer turns a request into a call.
 */
@Controller('order-to-cash/customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  /** `search` matches code, name or GSTIN, case-insensitively. */
  @Get()
  @SkipAudit('Read-only master data.')
  async list(@Query('search') search?: string): Promise<CustomerListItem[]> {
    return this.customers.list(search);
  }

  @Get(':id')
  @SkipAudit('Read-only master data.')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<CustomerDetail> {
    return this.customers.get(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'SALES_MANAGER')
  async create(@Body() dto: CreateCustomerDto): Promise<CustomerDetail> {
    return this.customers.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'SALES_MANAGER')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ): Promise<CustomerDetail> {
    return this.customers.update(id, dto);
  }

  /**
   * Retires a customer — a soft delete. Admin only: their invoices and orders
   * reference this row, so withdrawing it reaches past the sales desk.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('ADMIN')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.customers.remove(id);
  }

  @Post(':id/licences')
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'SALES_MANAGER')
  async addLicence(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCustomerLicenceDto,
  ): Promise<CustomerDetail> {
    return this.customers.addLicence(id, dto);
  }

  @Delete(':id/licences/:licenceId')
  @Roles('ADMIN', 'SALES_MANAGER')
  async removeLicence(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('licenceId', ParseUUIDPipe) licenceId: string,
  ): Promise<CustomerDetail> {
    return this.customers.removeLicence(id, licenceId);
  }
}
